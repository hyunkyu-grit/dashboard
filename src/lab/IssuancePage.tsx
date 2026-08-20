'use client';

/* 원화 채권 발행 캘린더 — Lab 의 세 번째 세입자.
 *
 * `Codex/rawData` 의 이식이다. 그 리포가 처음부터 이 이사를 적어 두었다.
 *
 * ── 이 화면이 답하는 질문 ───────────────────────────────────────────────────
 * "내일 이 섹터에 얼마가 새로 얹히나."
 *
 * 은행채·여전채에는 발행계획이라는 것이 존재하지 않는다 — 민간 발행자에게 사전
 * 공표 의무가 없고, DART 가 하루짜리 예고를 얹을 뿐이다. 그래서 **앞날의 빈칸은
 * «없음» 이 아니라 «아직 공시 안 됨»** 이고, 화면이 그 경계를 그린다.
 *
 * ── 발행만 본다 [OWNER, 2026-08-20] ─────────────────────────────────────────
 * 만기도래는 원본도 페이로드에서부터 빼 두었다. 되살릴 일이 생기면 백엔드만
 * 되돌리면 된다.
 *
 * ── 골격 ────────────────────────────────────────────────────────────────────
 * 시뮬·시나리오와 같다: **좌 설정 열 / 우 결과**. 왼쪽에서 달과 섹터를 고르고,
 * 오른쪽에 한 달이 격자로 서고 그 아래 고른 날의 상세가 열린다.
 *
 * 섹터 합계는 **서버가 미리 더하지 않는다**. 화면의 필터가 달력을 실제로 바꾸려면
 * 하루치가 섹터별로 갈려 있어야 한다(원본의 판단 그대로).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Chip } from '@coinbase/cds-web/chips';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Pressable } from '@coinbase/cds-web/system';
import { Text } from '@coinbase/cds-web/typography';

import { ControlCard, ControlCollapsible } from '@/ui/ControlCard';
import { ErrorState, LoadingState } from '@/ui/DataState';

import {
  type Gloss,
  fetchIssuanceCalendar,
  fetchIssuanceDay,
  IssuanceUnavailable,
  type CalDay,
  type IssuanceCalendar,
  type IssuanceDay,
  type Strength,
} from './issuance/api';

/** 다섯 열이다 [OWNER, 2026-08-20] — 토·일은 백엔드가 보내지 않는다. */
const DOW = ['월', '화', '수', '목', '금'];

/* 칸의 일정은 색을 안 쓴다 — 색은 방향만 나른다. 레인은 잉크의 세기로만 가르고
 * (금통위만 진하다), 그 이상은 누른 뒤 상세가 말한다. */

const jo = (v: number) => (v >= 0.005 ? `${v.toFixed(2)}조` : '');
const eok = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v).toLocaleString()}억`;
const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(v < 10 ? 3 : 1)}%`;

function ymAdd(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const k = y * 12 + (m - 1) + delta;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export function IssuancePage() {
  const [ym, setYm] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [cal, setCal] = useState<IssuanceCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [day, setDay] = useState<IssuanceDay | null>(null);

  const load = useCallback(async (target: string) => {
    setRetrying(true);
    try {
      setCal(await fetchIssuanceCalendar(target, 1));
      setError(null);
      setUnavailable(null);
    } catch (e) {
      if (e instanceof IssuanceUnavailable) setUnavailable(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void load(ym);
  }, [load, ym]);

  useEffect(() => {
    if (!sel) {
      setDay(null);
      return;
    }
    let live = true;
    void fetchIssuanceDay(sel)
      .then((d) => live && setDay(d))
      .catch(() => live && setDay(null));
    return () => {
      live = false;
    };
  }, [sel]);

  const month = cal?.months[ym];
  /** 필터가 켠 섹터만 더한다. 서버가 미리 더하지 않는 이유가 이 한 줄이다. */
  const amountOf = useCallback(
    (d: CalDay) =>
      Object.entries(d.isec).reduce((a, [s, v]) => (off.has(s) ? a : a + v), 0),
    [off],
  );
  const countOf = useCallback(
    (d: CalDay) =>
      Object.entries(d.isn).reduce((a, [s, v]) => (off.has(s) ? a : a + v), 0),
    [off],
  );
  const peak = useMemo(
    () => Math.max(0.01, ...(month?.days ?? []).map(amountOf)),
    [month, amountOf],
  );
  const monthTotal = useMemo(
    () => (month?.days ?? []).reduce((a, d) => a + amountOf(d), 0),
    [month, amountOf],
  );
  const monthCount = useMemo(
    () => (month?.days ?? []).reduce((a, d) => a + countOf(d), 0),
    [month, countOf],
  );

  if (unavailable) {
    return (
      <VStack className="sr-card" width="100%" padding={2} gap={0.5}>
        <Text as="h2" font="label1">
          발행 캘린더
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          {unavailable}
        </Text>
        <Text as="p" font="legal" color="fgMuted">
          수집기가 쓰는 CSV 를 읽는 화면이에요. 백엔드가 떠 있는지, 그리고 그 경로가
          잡혀 있는지 확인해 주세요.
        </Text>
      </VStack>
    );
  }
  if (error) {
    return (
      <ErrorState
        what="발행 캘린더"
        detail={error}
        onRetry={() => void load(ym)}
        retrying={retrying}
      />
    );
  }
  if (!cal || !month) return <LoadingState what="발행 캘린더" />;

  return (
    <HStack gap={2} width="100%" alignItems="stretch" flexGrow={1} minHeight={0}>
      {/* ── 설정 열 ────────────────────────────────────────────────────── */}
      <VStack
        gap={1.5}
        flexShrink={0}
        style={{ width: 'clamp(300px, 20vw, 380px)', overflowY: 'auto', minHeight: 0 }}
      >
        <ControlCard
          title="달"
          aside={
            <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
              {monthTotal.toFixed(2)}조 · {monthCount}건
            </Text>
          }
        >
          <HStack gap={1} alignItems="center">
            <Chip size="xs" accessibilityLabel="이전 달" onClick={() => setYm(ymAdd(ym, -1))}>
              ‹
            </Chip>
            <Text as="span" font="label1" tabularNumbers noWrap>
              {ym}
            </Text>
            <Chip size="xs" accessibilityLabel="다음 달" onClick={() => setYm(ymAdd(ym, 1))}>
              ›
            </Chip>
            <Box style={{ marginInlineStart: 'auto' }}>
              <Chip
                size="xs"
                accessibilityLabel="오늘이 있는 달로"
                onClick={() => setYm(cal.today.slice(0, 7))}
              >
                오늘
              </Chip>
            </Box>
          </HStack>
        </ControlCard>

        {/* 섹터가 0 인 달에도 목록은 자리를 지킨다 — 날마다 늘었다 줄었다 하면
            체크박스가 어디 있었는지 못 찾는다(원본의 규칙). */}
        <ControlCollapsible
          title="섹터"
          summary={off.size === 0 ? '전부' : `${cal.sectors.length - off.size}개`}
        >
          {cal.sectors.map((s) => {
            const on = !off.has(s.k);
            return (
              <HStack key={s.k} gap={1} alignItems="baseline" width="100%">
                <Chip
                  size="xs"
                  accessibilityLabel={`${s.k} ${on ? '끄기' : '켜기'}`}
                  onClick={() =>
                    setOff((prev) => {
                      const n = new Set(prev);
                      if (on) n.add(s.k);
                      else n.delete(s.k);
                      return n;
                    })
                  }
                >
                  {on ? s.k : `${s.k} 끔`}
                </Chip>
                <Box style={{ marginInlineStart: 'auto' }}>
                  <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                    {s.n > 0 ? `${s.v.toFixed(2)}조 · ${s.n}건` : '—'}
                  </Text>
                </Box>
              </HStack>
            );
          })}
          <Text as="p" font="legal" color="fgMuted">
            앞의 일곱이 금융채, 뒤의 셋은 DART 에 같이 올라오는 것들이에요(공사채·
            리츠·기타).
          </Text>
        </ControlCollapsible>

        <ControlCard title="시야">
          <VStack gap={0.5} width="100%">
            <HStack gap={1} alignItems="baseline" width="100%">
              <Text as="span" font="legal" color="fgMuted" noWrap>
                발행 공시
              </Text>
              <Box style={{ marginInlineStart: 'auto' }}>
                <Text as="span" font="legal" tabularNumbers noWrap>
                  {cal.issuanceThrough ?? '—'}
                </Text>
              </Box>
            </HStack>
            <HStack gap={1} alignItems="baseline" width="100%">
              <Text as="span" font="legal" color="fgMuted" noWrap>
                국고채 입찰 결과
              </Text>
              <Box style={{ marginInlineStart: 'auto' }}>
                <Text as="span" font="legal" tabularNumbers noWrap>
                  {cal.auctionThrough ?? '—'}
                </Text>
              </Box>
            </HStack>
            <Text as="p" font="legal" color="fgMuted">
              그 뒤의 빈칸은 «없음» 이 아니라 «아직 공시 안 됨» 이에요. 은행채·여전채에는
              발행계획이라는 게 없어요.
            </Text>
          </VStack>
        </ControlCard>
      </VStack>

      {/* ── 달력 ──────────────────────────────────────────────────────── */}
      <VStack className="sr-card" flexGrow={1} minWidth={0} minHeight={0}>
        {/* 카드 머리는 Main 의 «IRS 커브» 카드와 **같은 해부**다(실측 2026-08-20):
            패딩 16/16/12 · 간격 4 · 제목 label1 **muted** · 아래 한 줄 legal muted,
            둘 다 왼쪽에 쌓인다. 대비는 페이지 h1 이 진다.

            첫 판은 여기에 세 문장짜리 문단을 얹었는데, 앱의 어느 카드도 그러지
            않는다 — 안내는 카드 **바닥**으로 내렸다(Main 이 범례를 두는 자리다). */}
        <VStack gap={0.5} paddingX={2} paddingTop={2} paddingBottom={1.5} width="100%">
          <Text as="h2" font="label1" color="fgMuted" tabularNumbers noWrap>
            {ym.slice(0, 4)}년 {Number(ym.slice(5, 7))}월
          </Text>
          {/* Main 은 이 줄에 `TextCaption`(13px w600)을 쓴다. 그 shorthand 는
              @deprecated 라 새 코드에선 못 쓰고, `font="caption"` 이 같은 것이다
              (CLAUDE.md §4). `legal` 은 w500 이라 반 톤 얇게 붙는다. */}
          <Text as="span" font="caption" color="fgMuted" tabularNumbers noWrap>
            발행 {monthTotal.toFixed(2)}조 · {monthCount}건 · 오늘 {cal.today}
          </Text>
        </VStack>

        <VStack
          gap={1.5}
          paddingX={2}
          paddingBottom={2}
          minWidth={0}
          flexGrow={1}
          minHeight={0}
          style={{ overflowY: 'auto' }}
        >
          {/* 이 줄기가 카드의 남는 높이를 받아 격자에 넘긴다. `minHeight={0}` 이
              없으면 flex 아이템의 기본 최소 높이가 자기 내용이라 안 줄어든다. */}
          <VStack gap={0.5} width="100%" flexGrow={1} minHeight={0}>
            {/* 머리는 `sr-cal-cols` — 열 자리만 공유하고 높이 규칙은 안 받는다. */}
            <Box className="sr-cal-cols">
              {DOW.map((w) => (
                <Box key={w} className="sr-cal-dow">
                  <Text as="span" font="legal" color="fgMuted" noWrap>
                    {w}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box className="sr-cal-grid">
              {Array.from({ length: month.lead }, (_, i) => (
                <Box key={`b${i}`} className="sr-cal-blank" />
              ))}
              {month.days.map((d) => {
                const amt = amountOf(d);
                const n = countOf(d);
                return (
                  <Pressable
                    key={d.iso}
                    as="button"
                    noScaleOnPress
                    className="sr-cal-cell"
                    data-off={d.biz ? '0' : '1'}
                    data-today={d.today ? '1' : '0'}
                    data-sel={sel === d.iso ? '1' : '0'}
                    accessibilityLabel={`${d.iso} 발행 ${amt.toFixed(2)}조 ${n}건${
                      d.ev.length ? `, ${d.ev.map((e) => e.label).join(', ')}` : ''
                    }`}
                    onClick={() => setSel(sel === d.iso ? null : d.iso)}
                  >
                    {/* 칸 안의 모든 것이 **왼쪽 한 줄에** 선다. 토·일을 빼면서 칸이
                        287px 로 넓어졌는데(실측), 건수를 `margin-inline-start:auto`
                        로 반대편 끝에 붙여 뒀더니 날짜와 250px 떨어져 어느 칸에
                        속한 숫자인지가 안 읽혔다 [OWNER «얼라인 개판», 2026-08-20]. */}
                    <Text as="span" font="legal" color={d.biz ? undefined : 'fgMuted'} tabularNumbers>
                      {d.d}
                    </Text>
                    <HStack gap={0.75} alignItems="baseline" minWidth={0}>
                      <Text as="span" font="label2" tabularNumbers noWrap>
                        {jo(amt)}
                      </Text>
                      {n > 0 ? (
                        <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                          {n}건
                        </Text>
                      ) : null}
                    </HStack>
                    {d.ev.length > 0 ? (
                      <Box className="sr-cal-evs">
                        {d.ev.map((e, i) => (
                          <Text
                            key={`${e.lane}${i}`}
                            as="span"
                            className="sr-cal-ev"
                            font="legal"
                            color={e.lane === 'mpc' ? undefined : 'fgMuted'}
                          >
                            {e.label}
                          </Text>
                        ))}
                      </Box>
                    ) : null}
                    {/* 크기는 **칸 바닥**에 눕는다 — 한 줄의 다섯 칸이 같은 바닥을
                        공유하므로 그 주의 요일별 크기가 눈으로 견줘진다. */}
                    <Box style={{ marginBlockStart: 'auto' }} width="100%">
                      {amt > 0 ? (
                        <Box className="sr-cal-track">
                          <Box
                            className="sr-cal-bar"
                            style={{ width: `${Math.max(3, (amt / peak) * 100)}%` }}
                          />
                        </Box>
                      ) : null}
                    </Box>
                  </Pressable>
                );
              })}
            </Box>
          </VStack>

          {sel ? <DayDetail iso={sel} day={day} onClose={() => setSel(null)} /> : null}

          {/* 읽는 법과 한계가 한자리에. Main 이 카드 바닥에 범례를 두는 자리다. */}
          <VStack gap={0.25} width="100%">
            <Text as="span" font="legal" color="fgMuted">
              칸의 숫자는 납입기일 기준 발행액이고, 휴일에 걸린 건 다음 영업일로 밀어요.
              토·일은 뺐고 평일 공휴일은 남겨 뒀어요. 칸을 누르면 그날이 아래에 펴져요.
            </Text>
            <Text as="span" font="legal" color="fgMuted">
              {cal.caveats.map((c) => c.replace(/^[A-Z0-9_]+:\s*/, '')).join(' · ')}
            </Text>
          </VStack>
        </VStack>
      </VStack>
    </HStack>
  );
}

/* ── 그날 하루 ──────────────────────────────────────────────────────────────── */

/** 레인 하나의 머리 — 이름 · 무엇이고 왜 보는지.
 *
 * 문장은 **서버가 준 그대로** 출력한다. 첫 이식에서 이걸 빼먹었더니 «강한 수요/
 * 약한 수요» 라는 판정만 남고 그 판정이 무엇을 잰 것인지가 사라졌다
 * [OWNER 지적, 2026-08-20]. */
function LaneHead({ g }: { g: Gloss }) {
  return (
    <VStack gap={0.25} width="100%" minWidth={0}>
      <Text as="h4" font="label2" noWrap>
        {g.title}
      </Text>
      <Text as="p" font="legal" color="fgMuted">
        {[g.what, g.why].filter(Boolean).join(' ')}
      </Text>
    </VStack>
  );
}

/** 레인 각주 — 이 판정을 어떻게 읽는지. 표 아래에 붙는다. */
function LaneNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Text as="p" font="legal" color="fgMuted">
      {text}
    </Text>
  );
}

/** 그날 하루. 섹션마다 «머리 → 표 → 각주» 다 — Main 이 카드마다 쓰는 문법이고,
 * Coinbase 가 «섹션 제목 + 설명 문단 + 표» 를 쓰는 것과 같은 골격이다. */
function DayDetail({
  iso,
  day,
  onClose,
}: {
  iso: string;
  day: IssuanceDay | null;
  onClose: () => void;
}) {
  return (
    <VStack gap={3} width="100%" minWidth={0}>
      <HStack gap={1} alignItems="baseline" width="100%">
        <Text as="h3" font="label1" tabularNumbers noWrap>
          {iso}
        </Text>
        <Box style={{ marginInlineStart: 'auto' }}>
          <Chip size="xs" accessibilityLabel="닫기" onClick={onClose}>
            닫기
          </Chip>
        </Box>
      </HStack>

      {day === null ? (
        <Text as="span" font="legal" color="fgMuted">
          불러오는 중이에요.
        </Text>
      ) : (
        <>
          {day.mpc ? (
            <VStack gap={1} width="100%" minWidth={0}>
              <LaneHead g={day.gloss.mpc} />
              <Text as="span" font="label2" tabularNumbers>
                {day.mpc.decision
                  ? `${day.mpc.decision.decision ?? '결정'} · ${
                      day.mpc.decision.before ?? '—'
                    }% → ${day.mpc.decision.after ?? '—'}%`
                  : '회의가 있는 날이에요. 결과는 아직이에요.'}
              </Text>
              <LaneNote text={day.gloss.mpc.note} />
            </VStack>
          ) : null}

          {day.auctions.length > 0 ? (
            <VStack gap={1} width="100%" minWidth={0}>
              <LaneHead g={day.gloss.ktb} />
              <VStack gap={0} width="100%" className="sr-scn-deftable">
                {day.auctions.map((a, i) => (
                  <VStack key={`${a.kind}${i}`} gap={0.25} width="100%" paddingY={1}>
                    <HStack gap={1.5} alignItems="baseline" width="100%" flexWrap="wrap">
                      <Text as="span" font="label2" noWrap>
                        {a.kind} {a.name}
                      </Text>
                      <Box style={{ marginInlineStart: 'auto' }}>
                        <Text as="span" font="label2" tabularNumbers noWrap>
                          {eok(a.allotted)}
                        </Text>
                      </Box>
                    </HStack>
                    <Text as="span" font="legal" color="fgMuted" tabularNumbers>
                      응찰률 {pct(a.ratio)} · 가중평균 {pct(a.wavgRate)}
                      {a.dealers != null ? ` · 인수기관 ${a.dealers}개` : ''}
                    </Text>
                    {a.strength ? <StrengthLine s={a.strength} /> : null}
                    {a.gloss.map((g) => (
                      <Text key={g} as="p" font="legal" color="fgMuted">
                        {g}
                      </Text>
                    ))}
                  </VStack>
                ))}
              </VStack>
              <LaneNote text={day.gloss.ktb.note} />
            </VStack>
          ) : null}

          {day.omo.length > 0 ? (
            <VStack gap={1} width="100%" minWidth={0}>
              <LaneHead g={day.gloss.omo} />
              <VStack gap={0} width="100%" className="sr-scn-deftable">
                {day.omo.map((o, i) => (
                  <VStack key={`${o.kind}${i}`} gap={0.25} width="100%" paddingY={1}>
                    <HStack gap={1.5} alignItems="baseline" width="100%" flexWrap="wrap">
                      <Text as="span" font="label2" noWrap>
                        {o.kind}
                        {o.name ? ` ${o.name}` : ''}
                      </Text>
                      <Box style={{ marginInlineStart: 'auto' }}>
                        <Text as="span" font="label2" tabularNumbers noWrap>
                          {eok(o.allotted)}
                          {o.rate != null ? ` · ${pct(o.rate)}` : ''}
                        </Text>
                      </Box>
                    </HStack>
                    {o.gloss.map((g) => (
                      <Text key={g} as="p" font="legal" color="fgMuted">
                        {g}
                      </Text>
                    ))}
                  </VStack>
                ))}
              </VStack>
              <LaneNote text={day.gloss.omo.note} />
            </VStack>
          ) : null}

          <VStack gap={1} width="100%" minWidth={0}>
            <LaneHead g={day.gloss.iss} />
            {day.issuing.length === 0 ? (
              <Text as="span" font="legal" color="fgMuted">
                이 날짜에 공시된 발행이 없어요.
              </Text>
            ) : (
              <VStack gap={0} width="100%" className="sr-scn-deftable">
                {day.issuing.map((r, i) => (
                  <HStack
                    key={`${r.issuer}${r.round}${i}`}
                    gap={1.5}
                    width="100%"
                    alignItems="baseline"
                    paddingY={1}
                    flexWrap="wrap"
                  >
                    <VStack gap={0} minWidth={0}>
                      <Text as="span" font="label2" noWrap>
                        {r.issuer}
                        {r.round ? ` ${r.round}` : ''}
                      </Text>
                      <Text as="span" font="legal" color="fgMuted" noWrap>
                        {r.sector}
                        {r.rating ? ` · ${r.rating}` : ''}
                        {r.maturity ? ` · 만기 ${r.maturity}` : ''}
                        {r.coupon != null ? ` · ${r.coupon.toFixed(3)}%` : ''}
                      </Text>
                    </VStack>
                    <Box style={{ marginInlineStart: 'auto' }}>
                      <Text as="span" font="label2" tabularNumbers noWrap>
                        {eok(r.eok)}
                      </Text>
                    </Box>
                  </HStack>
                ))}
              </VStack>
            )}
            <LaneNote text={day.gloss.iss.note} />
          </VStack>
        </>
      )}
    </VStack>
  );
}

/** 같은 연물 52주와 견준 한 줄. **표본이 모자라면 등급 대신 그렇다고 말한다** —
 * 6회 미만에서 백분위는 계단이라 숫자가 과장된다(원본의 규율). */
function StrengthLine({ s }: { s: Strength }) {
  return (
    <VStack gap={0} width="100%">
      <HStack gap={1} alignItems="baseline" flexWrap="wrap">
        <Text as="span" font="label2" noWrap>
          {s.grade}
        </Text>
        {s.pct !== null ? (
          <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
            {s.label} 최근 1년{' '}
            {s.pct >= 100
              ? '최고 응찰률'
              : s.pct <= 0
                ? '최저 응찰률'
                : `상위 ${100 - s.pct}%`}
            {s.median != null ? ` · 평년 ${s.median}%` : ''}
          </Text>
        ) : (
          <Text as="span" font="legal" color="fgMuted">
            {s.why}
          </Text>
        )}
      </HStack>
      {s.wavgDelta != null ? (
        <Text as="span" font="legal" color="fgMuted" tabularNumbers>
          직전 입찰 대비 {s.wavgDelta > 0 ? '+' : ''}
          {Math.round(s.wavgDelta)}bp
          {s.prevDate ? ` (${s.prevDate.slice(5)})` : ''}
        </Text>
      ) : null}
      {(s.notes ?? []).map((n) => (
        <Text key={n} as="span" font="legal" color="fgMuted">
          {n}
        </Text>
      ))}
    </VStack>
  );
}
