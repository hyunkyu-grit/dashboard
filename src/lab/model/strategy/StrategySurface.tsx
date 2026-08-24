'use client';

/* Lab 「모형」 · 전략 면 — 경로 하나를 놓으면 나오는 데스크 노트.
 *
 * ## 파는 것은 커브 그림이 아니라 **짧은 논증과 트레이드 표현**이다
 *
 *     뷰 · 함의 · 논거 · 트레이드 · 리스크
 *
 * 다섯 줄이 제품 전부다. 입력은 **정책금리 경로 하나**이고 나머지는 전부
 * 자동이고 읽기 전용이다.
 *
 * ## 왜 손잡이가 하나뿐인가
 *
 * 시나리오 화면에는 여섯이 있다(물가·갭·수출·Fed·유가·정책). 그 화면은 «모형이
 * 뭘 하나» 를 보는 실험대고, 이 면은 «내 뷰를 어떻게 표현하나» 를 답하는 데스크
 * 도구다. 손잡이를 여섯 두면 데스크가 매일 여섯 번 결정을 내려야 하고, 그러면
 * 아무도 안 쓴다.
 *
 * ## 골격은 시나리오 것이다
 *
 * **좌 설정 열 / 우 결과 카드.** 같은 종류의 일(입력 → 결과)을 하는 화면이라
 * 골격도 같아야 하고, `ControlCard` 는 시뮬·시나리오가 이미 쓰는 것을 그대로
 * 쓴다 — 두 벌을 두면 한쪽만 고쳐지는 날이 온다.
 *
 * **노트는 카드 안에서 구른다.** 페이지가 스크롤하지 않는 100vh 기둥이라
 * (`PRODUCT.md`), 카드가 자기 스크롤을 안 지면 다섯 줄 중 뒤의 둘과 가정 띠가
 * 아예 닿지 않는다 — 실측 2026-08-21 에 그 상태로 한 번 떴다.
 *
 * ## 화면이 못 하는 것을 화면이 말한다
 *
 * 10년은 트레이드 후보에 없고(12개월 포워드가 커브 밖), 다음 금통위 자리에는
 * 커브 숫자가 없고(분기 모형), 「이 답이 0 으로 놓은 것」 띠에는 지금 델타를
 * 움직이는 항목이 하나도 없다. 셋 다 빈칸이 아니라 **문장**으로 선다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Select } from '@coinbase/cds-web/alpha/select';
import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Pressable } from '@coinbase/cds-web/system';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import { ControlCard, Field } from '@/ui/ControlCard';
import { ErrorState, LoadingState } from '@/ui/DataState';
import { DROPDOWN_STYLES } from '@/ui/window/popup';

import { ANCHORS, anchorProps, eq, hrefFor, ledgerRow } from '../anchors';
import { AnchorsUnavailable, fetchAnchors } from './anchors';
import {
  ASSUMPTIONS,
  CONDITIONAL_NOTE,
  ENGINE_STATUS,
  NO_DELTA_ITEMS,
  STALENESS_LABEL,
  assumptionValue,
  effectGroups,
} from './assumptions';
import { decompose, type Term } from './decompose';
import {
  DEFAULT_HORIZON,
  HORIZONS,
  MPC_NO_CURVE,
  MPC_NO_TERMS,
  NO_CARRY_HERE,
  buildNote,
  noteText,
  pathInWords,
  type HorizonId,
} from './note';
import { BASIS, PINNED_Q, TENORS, outOfDomain, solvePath, type Tenor } from './path';
import { riskLines } from './risk';
import {
  HEADLINE_TENOR,
  candidates,
  gapVector,
  headlineGap,
  type StrategyAnchors,
} from './trades';

/** 점 눈금. 전부 기저의 검증 영역(`domain.policy_bp_per_q`) 안이다 — 밖을 고를
 *  수 있게 두면 화면이 «여기부터 외삽» 이라고 말하기 전에 이미 밖에 나가 있다. */
const DOT_STEPS = [50, 25, 0, -25, -50];

/** 다섯 테너 전부 같은 등급이다 [진단 §C.5]. IRS 다리는 기간프리미엄을 안 받고
 *  OU 스프레드는 편차에서 상쇄되므로, 남는 것은 정책 경로의 산술뿐이다. */
const PROVENANCE = '경로 산술';

const TENOR_LABEL: Record<Tenor, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/** 논거 항이 가리키는 자리.
 *
 * **여기 있던 주소 셋이 아무 데도 안 닿고 있었다** [2026-08-24 전수 확인].
 * 세션 3 이 타깃을 세우는 중이라 그럴 수 있다고 적어 둔 주석이 그대로 남아
 * 있었는데, 세 면이 다 찬 뒤에도 아무도 다시 안 봤다.
 *
 *     eq('36-37')                 등록부는 번호를 **낱개**로 단다 → 36
 *     ledgerRow('r_star')         원장 키는 케밥이고, r* 행은 **없다**
 *     ledgerRow('policy_conditioning')  실제 키는 `policy-conditioning`
 *
 * 링크가 안 닿는 것은 조용하다 — 해시가 없으면 브라우저가 그냥 면 맨 위에
 * 선다. 그래서 `guards/model-anchor-targets.test.ts` 가 이제 이 두 표의
 * 타깃을 실제 페이로드가 낳는 앵커 집합과 대조한다. 그러려고 export 한다. */
export const TERM_HREF: Record<Term['key'], string> = {
  /* 기대가설은 eq (36)(37) 두 식인데 등록부는 낱개로 단다. 첫 식에 세운다. */
  eh: hrefFor(eq('36')),
  rule: hrefFor(eq('35')),
  cd: hrefFor(ANCHORS.model.channelPolicy),
  tp: hrefFor(ANCHORS.model.channelFinancial),
  spread: hrefFor(ANCHORS.model.channelFinancial),
};

export const RISK_HREF: Record<string, string> = {
  /* r* 줄이 답하는 것은 «왜 0 인가» 이고, 그 답이 사는 행이 편차 공간이다. */
  'r-star': hrefFor(ledgerRow('deviation-space')),
  /* 지평 이탈 줄은 이제 자기 행을 갖는다 — D.4 가 세운 `residual-tail`. */
  'horizon-exit': hrefFor(ledgerRow('residual-tail')),
  'rule-deviation': hrefFor(ANCHORS.method.ledger),
};

const bpTxt = (v: number) =>
  Math.abs(v) < 0.05 ? '0.0' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
const dirCls = (v: number | null) =>
  v == null || Math.abs(v) < 0.05 ? undefined : v > 0 ? 'sr-up' : 'sr-down';

const HORIZON_TABS = HORIZONS.map((x) => ({ id: x.id, label: x.label }));

const ZERO_DOTS = Array.from({ length: PINNED_Q }, () => 0);

export function StrategySurface() {
  const [dots, setDots] = useState<number[]>(ZERO_DOTS);
  const [horizon, setHorizon] = useState<HorizonId>(DEFAULT_HORIZON);
  const [anchors, setAnchors] = useState<StrategyAnchors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRetrying(true);
    try {
      setAnchors(await fetchAnchors());
      setError(null);
      setUnavailable(false);
    } catch (e) {
      if (e instanceof AnchorsUnavailable) setUnavailable(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const h = HORIZONS.find((x) => x.id === horizon)?.h ?? null;
  const sol = useMemo(() => solvePath(dots), [dots]);
  const decomp = useMemo(() => (h === null ? [] : decompose(sol, h)), [sol, h]);
  const gaps = useMemo(
    () => (anchors && h !== null ? gapVector(sol, anchors, h) : null),
    [anchors, sol, h],
  );
  const head = gaps ? headlineGap(gaps) : null;
  /* 커브가 없거나 12개월 자리가 아니어도 **논거·리스크는 3년으로 선다** —
     그 둘은 구운 기저만으로 나오니까. 자리 번호가 아니라 이름으로 찾는다. */
  const headDecomp = decomp.find((d) => d.tenor === HEADLINE_TENOR) ?? null;
  const cands = useMemo(() => (gaps ? candidates(gaps) : []), [gaps]);
  const risks = useMemo(() => riskLines(sol, headDecomp), [sol, headDecomp]);
  const note = useMemo(
    () =>
      buildNote({
        sol,
        gaps,
        headlineGap: head,
        headlineDecomp: headDecomp,
        candidates: cands,
        risks,
        h,
        provenance: PROVENANCE,
      }),
    [sol, gaps, head, headDecomp, cands, risks, h],
  );

  /* 화면에 보이는 평문과 복사되는 평문은 **한 문자열**이다. 두 벌로 만들면
     둘이 갈리는 날이 오고, 그때 복사된 쪽이 틀린다. */
  const exportText = useMemo(
    () =>
      noteText(note, {
        asof: anchors?.asof ?? '커브 없음',
        basisAsOf: ENGINE_STATUS.basis_as_of,
      }),
    [note, anchors],
  );

  const groups = useMemo(() => effectGroups(ASSUMPTIONS), []);
  const outside = outOfDomain(dots);
  /** 여덟 점이 다 0 인가. 유도값이라 상태로 안 든다. */
  const frozen = dots.every((v) => v === 0);
  const stale = ENGINE_STATUS.staleness;

  const setDot = (q: number, v: number) =>
    setDots((prev) => prev.map((old, i) => (i === q ? v : old)));

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied('클립보드에 담았어요');
    } catch {
      setCopied('클립보드를 못 썼어요 — 아래 글을 직접 복사하세요');
    }
  };

  /* 루트 행은 **`flexWrap` 을 안 쓴다** [실측 2026-08-21]. 줄바꿈하는 flex 행에서는
     줄의 가로높이가 «가장 큰 항목의 내용 높이» 로 정해져서, 노트 카드가 1,348px 로
     부풀고 컨테이너(668px)를 넘어섰다 — 그러면 카드가 자기 스크롤을 못 만들고
     리스크 세 줄과 가정 띠가 화면 밖에 남는다. */
  return (
    <HStack gap={2} width="100%" flexGrow={1} minHeight={0} alignItems="stretch">
      {/* ── 유일한 입력 ─────────────────────────────────────────────────── */}
      <VStack className="sr-strat-controls" gap={1}>
        <ControlCard title="정책금리 경로">
          <Text as="p" font="legal" color="fgMuted">
            여덟 점은 「레벨」이에요 — 「−25 · −25」는 한 번 인하하고 그대로 두는 거예요.
          </Text>
          <HStack gap={0.5} flexWrap="wrap">
            {dots.map((v, q) => (
              <Field key={q} label={`q${q + 1}`}>
                <Select
                  size="s"
                  font="legal"
                  styles={DROPDOWN_STYLES}
                  accessibilityLabel={`${q + 1}분기 정책금리 편차`}
                  value={String(v)}
                  onChange={(nv) => nv != null && setDot(q, Number(nv))}
                  options={DOT_STEPS.map((o) => ({
                    value: String(o),
                    label: o === 0 ? '0' : `${o > 0 ? '+' : '−'}${Math.abs(o)}`,
                  }))}
                />
              </Field>
            ))}
          </HStack>
          <HStack gap={1} alignItems="center" flexWrap="wrap">
            <Pressable
              as="button"
              noScaleOnPress
              accessibilityLabel="경로를 동결로 되돌려요"
              onClick={() => setDots(ZERO_DOTS)}
            >
              <Text as="span" font="legal">
                동결로 되돌리기
              </Text>
            </Pressable>
            {outside ? (
              <Chip size="xs" accessibilityLabel="검증 영역 밖 — 여기부터는 선형 외삽이에요">
                검증 영역 밖
              </Chip>
            ) : null}
          </HStack>
        </ControlCard>
      </VStack>

      {/* ── 노트 ────────────────────────────────────────────────────────── */}
      <VStack className="sr-card sr-strat-note" flexGrow={1} minWidth={0} minHeight={0}>
        {/* 카드 머리는 **한 층**이다 — 왼쪽에 지평, 오른쪽에 as-of. 시나리오
            결과 카드가 같은 자리에 같은 문법을 쓴다. */}
        <HStack gap={1.5} alignItems="center" flexWrap="wrap" paddingX={2} paddingTop={2}>
          <SegmentedTabs
            accessibilityLabel="지평"
            tabs={HORIZON_TABS}
            activeTab={HORIZON_TABS.find((t) => t.id === horizon) ?? null}
            onChange={(t) => t && setHorizon(t.id as HorizonId)}
          />
          <Text as="span" font="legal" color="fgMuted" style={{ marginInlineStart: 'auto' }}>
            모형 기저 {ENGINE_STATUS.basis_as_of} · {STALENESS_LABEL[stale.state]}
            {anchors ? ` · 커브 ${anchors.asof}` : ''}
          </Text>
        </HStack>

        <VStack className="sr-strat-scroll" gap={2} paddingX={2} paddingY={2}>
          {/* 뷰 */}
          <VStack gap={0.25} {...anchorProps(ANCHORS.strategy.view)}>
            <Text as="span" font="legal" color="fgMuted">
              뷰
            </Text>
            <Text as="p" font="title3">
              {pathInWords(dots)}
            </Text>
            <Text as="p" font="legal" color="fgMuted" {...anchorProps(ANCHORS.strategy.asOf)}>
              {ENGINE_STATUS.as_of_sentence}
            </Text>
          </VStack>

          {/* 함의 */}
          <VStack gap={0.25} {...anchorProps(ANCHORS.strategy.implication)}>
            <Text as="span" font="legal" color="fgMuted">
              함의
            </Text>
            {h === null ? (
              <>
                <Text as="p" font="title3">
                  {note.implication}
                </Text>
                <Text as="p" font="legal" color="fgMuted">
                  {MPC_NO_CURVE}
                </Text>
              </>
            ) : unavailable ? (
              <Text as="p" font="body" color="fgMuted">
                오늘의 커브가 없어서 시장 대비를 못 재요 — 백엔드가 꺼져 있어요.
              </Text>
            ) : error ? (
              <ErrorState what="오늘의 커브" detail={error} onRetry={load} retrying={retrying} />
            ) : !anchors ? (
              <LoadingState what="오늘의 커브" />
            ) : (
              <Text as="p" font="title3" className={dirCls(head?.vsMarketBp ?? null)}>
                {note.implication}
              </Text>
            )}
          </VStack>

          {/* 논거 */}
          <VStack gap={0.5} {...anchorProps(ANCHORS.strategy.argument)}>
            <Text as="span" font="legal" color="fgMuted">
              논거 — 이 bp 가 무엇으로 이루어져 있나
            </Text>
            {/* **동결은 표 위에서 말한다** [OWNER 2026-08-24]. 기본 경로가 동결
                이라 처음 여는 사람이 보는 것은 다섯 테너 × 여섯 항 = 서른 칸의
                `0.0` 이다. 이유(편차가 0 이면 통째로 0)는 표 **아래** 각주에만
                있어서, 그때까지 화면은 고장난 것처럼 보였다.
                기본값을 바꾸지는 않는다 — 아무것도 가정하지 않은 상태가 이
                물건의 정직한 출발점이고, 그 말을 화면이 하면 된다. */}
            {frozen ? (
              <Text as="p" font="body" color="fgMuted">
                아직 아무것도 가정하지 않았어요 — 왼쪽에 점을 하나라도 놓으면 이
                표에 숫자가 서요. 지금 0 인 건 계산이 안 된 게 아니라 편차가 0
                이라서예요.
              </Text>
            ) : null}
            {h === null ? (
              <Text as="p" font="body" color="fgMuted">
                {MPC_NO_TERMS}
              </Text>
            ) : (
              <>
                {/* 넓은 표는 자기 상자 안에서만 가로로 구른다 — 몸통이 가로로
                    밀리면 왼쪽 설정 열까지 같이 움직인다. */}
                <Box className="sr-strat-table" width="100%">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableCell>
                          <Text as="span" font="legal">
                            테너
                          </Text>
                        </TableCell>
                        {decomp[0]?.terms.map((t) => (
                          <TableCell key={t.key} align="right">
                            <a href={TERM_HREF[t.key]} title={t.note}>
                              <Text as="span" font="legal">
                                {t.label}
                              </Text>
                            </a>
                          </TableCell>
                        ))}
                        <TableCell align="right">
                          <Text as="span" font="legal">
                            합계
                          </Text>
                        </TableCell>
                        <TableCell align="right">
                          <Text as="span" font="legal">
                            준칙 몫
                          </Text>
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {decomp.map((d) => (
                        <TableRow key={d.tenor}>
                          <TableCell>
                            <Text as="span" font="legal">
                              {TENOR_LABEL[d.tenor]}
                            </Text>
                          </TableCell>
                          {d.terms.map((t) => (
                            <TableCell key={t.key} align="right">
                              <Text
                                as="span"
                                font="legal"
                                color={t.structuralZero ? 'fgMuted' : undefined}
                                className={t.structuralZero ? undefined : dirCls(t.value)}
                              >
                                {bpTxt(t.value)}
                              </Text>
                            </TableCell>
                          ))}
                          <TableCell align="right">
                            <Text as="span" font="label1" className={dirCls(d.totalBp)}>
                              {bpTxt(d.totalBp)}
                            </Text>
                          </TableCell>
                          <TableCell align="right">
                            <Text as="span" font="legal" color="fgMuted">
                              {d.ruleShare === null ? '—' : `${Math.round(d.ruleShare * 100)}%`}
                            </Text>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                <Text as="p" font="legal" color="fgMuted">
                  다섯 항의 합이 합계와 정확히 같아요. 기간프리미엄과 스왑 스프레드가 0 인
                  건 안 잰 게 아니라 이 다리에 안 오기 때문이에요 — 열을 지우면 그 사실이
                  같이 지워져요.
                </Text>
                <Text as="p" font="legal" color="fgMuted">
                  다섯 테너뿐이에요 — 기저가 1Y·2Y·3Y·5Y·10Y 만 담아요. 나머지 만기는
                  보간해서 세우지 않아요.
                </Text>
              </>
            )}
          </VStack>

          {/* 트레이드 */}
          <VStack gap={0.5} {...anchorProps(ANCHORS.strategy.trade)}>
            <Text as="span" font="legal" color="fgMuted">
              트레이드 — 모형 Δ − 시장 캐리
            </Text>
            {h === null ? (
              <Text as="p" font="body" color="fgMuted">
                {NO_CARRY_HERE}
              </Text>
            ) : !gaps ? (
              <Text as="p" font="body" color="fgMuted">
                오늘의 커브가 있어야 시장 대비를 재요.
              </Text>
            ) : cands.length === 0 ? (
              <Text as="p" font="body" color="fgMuted">
                {NO_CARRY_HERE}
              </Text>
            ) : (
              <VStack gap={0.25}>
                {cands.map((c) => (
                  <HStack key={c.label} gap={1} alignItems="baseline" flexWrap="wrap">
                    <Text as="span" font="label1" className={dirCls(c.bp)}>
                      {c.label}
                    </Text>
                    {/* 크기는 절댓값이다 — 방향은 이름이 이미 말한다.
                        「리시브 −55.2bp」 는 부호를 두 번 말하는 셈이다. */}
                    <Text as="span" font="legal">
                      {Math.abs(c.bp).toFixed(1)}bp
                    </Text>
                    {/* «수렴» 과 «여기까지밖에 못 봄» 은 다르다. 최댓값이 기저의
                        마지막 분기에 있으면 그건 수렴한 자리가 아니라 지평 끝이다. */}
                    <Text as="span" font="legal" color="fgMuted">
                      {c.convergenceAtEdge
                        ? `${c.convergenceQ}분기까지 계속 벌어져요 — 기저가 거기서 끝나요`
                        : `수렴 지평 ${c.convergenceQ}분기`}
                    </Text>
                    {c.interpolatedLeg ? (
                      <Text as="span" font="legal" color="fgMuted">
                        끝점이 호가가 아니에요
                      </Text>
                    ) : null}
                  </HStack>
                ))}
                {gaps.excluded.map((x) => (
                  <Text key={x.tenor} font="legal" color="fgMuted" as="p">
                    {TENOR_LABEL[x.tenor]} 는 후보에 없어요 — {x.why}
                  </Text>
                ))}
                <Text as="p" font="legal" color="fgMuted">
                  진입·목표·손절은 안 적어요 — 그건 트레이더 몫이에요.
                </Text>
                <Text as="p" font="legal" color="fgMuted">
                  캐리는 커브가 함의하는 이동이지 정책 기대가 아니에요 — 기간프리미엄이
                  섞여 있어요.
                </Text>
              </VStack>
            )}
          </VStack>

          {/* 리스크 */}
          <VStack gap={0.5} {...anchorProps(ANCHORS.strategy.risk)}>
            <Text as="span" font="legal" color="fgMuted">
              리스크
            </Text>
            {risks.map((r) => (
              <VStack
                key={r.key}
                gap={0.25}
                {...anchorProps(
                  r.key === 'r-star'
                    ? ANCHORS.strategy.rStar
                    : r.key === 'horizon-exit'
                      ? ANCHORS.strategy.horizonExit
                      : ANCHORS.strategy.ruleDeviation,
                )}
              >
                {/* **문장 전체를 링크로 감싸지 않는다** [2026-08-24]. 세 줄이
                    통째로 밑줄이라 링크 어포던스가 아니라 그냥 읽기 힘든 본문이
                    됐고, 어디를 눌러야 할지도 몰랐다. 문장은 문장으로 두고,
                    근거로 가는 문은 배지 줄 끝에 하나 단다. */}
                <Text as="p" font="body">
                  {r.text}
                </Text>
                <HStack gap={1} flexWrap="wrap" alignItems="baseline">
                  {r.badges.map((b) => (
                    <Text key={b} as="span" font="legal" color="fgMuted">
                      {b}
                    </Text>
                  ))}
                  <a href={RISK_HREF[r.key]} title={r.source}>
                    <Text as="span" font="legal">
                      근거
                    </Text>
                  </a>
                </HStack>
              </VStack>
            ))}
          </VStack>

          {/* 이 답이 0 으로 놓은 것 */}
          <VStack gap={0.5} {...anchorProps(ANCHORS.strategy.assumptions)}>
            <Text as="span" font="legal" color="fgMuted">
              이 답이 0 으로 놓은 것
            </Text>
            <Text as="p" font="body">
              {CONDITIONAL_NOTE}
            </Text>
            {groups.map((g) => (
              <VStack key={g.effect} gap={0.25}>
                <Text as="p" font="legal">
                  {g.items.length === 0 && g.effect === 'delta' ? NO_DELTA_ITEMS : g.headline}
                </Text>
                {g.items.map((it) => (
                  <Text key={it.key} as="p" font="legal" color="fgMuted">
                    {it.label} {assumptionValue(it)} · {it.source}
                    {it.as_of ? ` · ${it.as_of}` : ''}
                  </Text>
                ))}
              </VStack>
            ))}
            <Text as="p" font="legal" color="fgMuted">
              {stale.why}
            </Text>
          </VStack>

          {/* 노트 내보내기 */}
          <VStack gap={0.5}>
            <HStack gap={1} alignItems="center">
              <Pressable
                as="button"
                noScaleOnPress
                accessibilityLabel="다섯 줄을 평문으로 복사해요"
                onClick={() => void onCopy()}
              >
                <Text as="span" font="label1">
                  노트 복사
                </Text>
              </Pressable>
              {copied ? (
                <Text as="span" font="legal" color="fgMuted" role="status">
                  {copied}
                </Text>
              ) : null}
            </HStack>
            <Box as="pre" className="sr-strat-export">
              <Text as="span" font="legal">
                {exportText}
              </Text>
            </Box>
            <Text as="p" font="legal" color="fgMuted">
              기저 {BASIS.as_of} · 점 {PINNED_Q}개 · 테너 {TENORS.length}개
            </Text>
          </VStack>
        </VStack>
      </VStack>
    </HStack>
  );
}
