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
  fetchIssuanceCalendar,
  fetchIssuanceDay,
  IssuanceUnavailable,
  type CalDay,
  type IssuanceCalendar,
  type IssuanceDay,
  type Strength,
} from './issuance/api';

const DOW = ['월', '화', '수', '목', '금', '토', '일'];

/* 칸의 일정 점은 색도 글리프도 안 쓴다 — 색은 방향만 나르고, 레인이 무엇인지는
 * 누른 뒤 상세가 말한다. 칸 안에서 레인을 구분하려 들면 여섯 칸짜리 격자에
 * 범례가 하나 더 붙는다. */

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
        <VStack gap={1} paddingX={2} paddingTop={2} paddingBottom={1.5}>
          <HStack gap={1} alignItems="baseline" width="100%" flexWrap="wrap">
            <Text as="h2" font="label1" noWrap>
              발행 캘린더
            </Text>
            <Box style={{ marginInlineStart: 'auto' }}>
              <Text as="span" font="legal" color="fgMuted" noWrap>
                {ym} · 오늘 {cal.today}
              </Text>
            </Box>
          </HStack>
          <Text as="span" font="legal" color="fgMuted">
            칸의 숫자는 납입기일 기준 발행액이고, 휴일에 걸린 건 다음 영업일로 밀어요.
            점은 그날의 일정이에요 — 누르면 아래에 펴져요.
          </Text>
        </VStack>

        <VStack
          gap={2}
          paddingX={2}
          paddingBottom={2}
          minWidth={0}
          flexGrow={1}
          minHeight={0}
          style={{ overflowY: 'auto' }}
        >
          <VStack gap={0.5} width="100%">
            <Box className="sr-cal-grid">
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
                    <HStack gap={1} alignItems="baseline" width="100%">
                      <Text as="span" font="legal" color={d.biz ? undefined : 'fgMuted'} tabularNumbers>
                        {d.d}
                      </Text>
                      <Box style={{ marginInlineStart: 'auto' }}>
                        <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                          {n > 0 ? `${n}건` : ''}
                        </Text>
                      </Box>
                    </HStack>
                    <Text as="span" font="label2" tabularNumbers noWrap>
                      {jo(amt)}
                    </Text>
                    {d.ev.length > 0 ? (
                      <Box className="sr-cal-dots">
                        {d.ev.map((e, i) => (
                          <Box key={`${e.lane}${i}`} className="sr-cal-dot" />
                        ))}
                      </Box>
                    ) : null}
                    <Box style={{ marginBlockStart: 'auto' }} width="100%">
                      {amt > 0 ? (
                        <Box
                          className="sr-cal-bar"
                          style={{ width: `${Math.max(4, (amt / peak) * 100)}%` }}
                        />
                      ) : null}
                    </Box>
                  </Pressable>
                );
              })}
            </Box>
          </VStack>

          {sel ? <DayDetail iso={sel} day={day} onClose={() => setSel(null)} /> : null}

          <Text as="span" font="legal" color="fgMuted">
            {cal.caveats.map((c) => c.replace(/^[A-Z0-9_]+:\s*/, '')).join(' · ')}
          </Text>
        </VStack>
      </VStack>
    </HStack>
  );
}

/* ── 그날 하루 ──────────────────────────────────────────────────────────────── */

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
    <VStack gap={1.5} width="100%" minWidth={0}>
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
            <VStack gap={0.25} width="100%">
              <Text as="span" font="caption" color="fgMuted">
                금통위
              </Text>
              <Text as="span" font="legal">
                {day.mpc.decision
                  ? `${day.mpc.decision.decision ?? '결정'} · ${
                      day.mpc.decision.before ?? '—'
                    }% → ${day.mpc.decision.after ?? '—'}%`
                  : '회의가 있는 날이에요. 결과는 아직이에요.'}
              </Text>
            </VStack>
          ) : null}

          {day.auctions.length > 0 ? (
            <VStack gap={1} width="100%" className="sr-scn-deftable">
              <Text as="span" font="caption" color="fgMuted">
                국고채 입찰
              </Text>
              {day.auctions.map((a, i) => (
                <VStack key={`${a.kind}${i}`} gap={0.25} width="100%" paddingY={1}>
                  <HStack gap={1} alignItems="baseline" flexWrap="wrap">
                    <Text as="span" font="label2" noWrap>
                      {a.kind} {a.name}
                    </Text>
                    <Text as="span" font="legal" color="fgMuted" tabularNumbers noWrap>
                      낙찰 {eok(a.allotted)} · 응찰률 {pct(a.ratio)} · 가중평균{' '}
                      {pct(a.wavgRate)}
                    </Text>
                  </HStack>
                  {a.strength ? <StrengthLine s={a.strength} /> : null}
                </VStack>
              ))}
            </VStack>
          ) : null}

          {day.omo.length > 0 ? (
            <VStack gap={0.25} width="100%">
              <Text as="span" font="caption" color="fgMuted">
                공개시장운영
              </Text>
              {day.omo.map((o, i) => (
                <Text key={`${o.kind}${i}`} as="span" font="legal" tabularNumbers>
                  {o.kind}
                  {o.name ? ` ${o.name}` : ''} · 낙찰 {eok(o.allotted)}
                  {o.rate != null ? ` · ${pct(o.rate)}` : ''}
                </Text>
              ))}
            </VStack>
          ) : null}

          <VStack gap={0.5} width="100%" minWidth={0}>
            <Text as="span" font="caption" color="fgMuted">
              발행 {day.issuing.length}건
            </Text>
            {day.issuing.length === 0 ? (
              <Text as="span" font="legal" color="fgMuted">
                이 날짜에 공시된 발행이 없어요 — 아직 안 나온 것일 수도 있어요.
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
                    <Box style={{ marginInlineStart: 'auto' }}>
                      <Text as="span" font="label2" tabularNumbers noWrap>
                        {eok(r.eok)}
                      </Text>
                    </Box>
                  </HStack>
                ))}
              </VStack>
            )}
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
