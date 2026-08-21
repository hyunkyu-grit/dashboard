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
import { candidates, gapVector, headlineGap, type StrategyAnchors } from './trades';

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

/** 논거 항이 가리키는 자리. 세션 3 이 지금 그 타깃을 세우는 중이라 아직 안 닿을
 *  수 있고, **그건 정상이다** — 내가 따로 타깃을 만들면 두 주소 체계가 선다. */
const TERM_HREF: Record<Term['key'], string> = {
  eh: hrefFor(eq('36-37')),
  rule: hrefFor(eq('35')),
  cd: hrefFor(ANCHORS.model.channelPolicy),
  tp: hrefFor(ANCHORS.model.channelFinancial),
  spread: hrefFor(ANCHORS.model.channelFinancial),
};

const RISK_HREF: Record<string, string> = {
  'r-star': hrefFor(ledgerRow('r_star')),
  'horizon-exit': hrefFor(ledgerRow('policy_conditioning')),
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
  const headDecomp = head
    ? (decomp.find((d) => d.tenor === head.tenor) ?? null)
    : (decomp[2] ?? null);
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
                <a href={RISK_HREF[r.key]} title={r.source}>
                  <Text as="span" font="body">
                    {r.text}
                  </Text>
                </a>
                <HStack gap={1} flexWrap="wrap">
                  {r.badges.map((b) => (
                    <Text key={b} as="span" font="legal" color="fgMuted">
                      {b}
                    </Text>
                  ))}
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
