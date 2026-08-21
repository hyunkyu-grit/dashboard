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

import { fmtBp } from '@/lib/format';
import { ControlCard, ControlCollapsible } from '@/ui/ControlCard';
import { ErrorState, LoadingState } from '@/ui/DataState';

import {
  type Bias,
  type Dir,
  type Gloss,
  fetchIssuanceCalendar,
  fetchIssuanceDay,
  IssuanceUnavailable,
  type CalDay,
  type EventNote,
  type IssuanceCalendar,
  type IssuanceDay,
  type OmoStrength,
  type Src,
  type Strength,
  type Versus,
  dartUrl,
} from './issuance/api';

/** 다섯 열이다 [OWNER, 2026-08-20] — 토·일은 백엔드가 보내지 않는다. */
const DOW = ['월', '화', '수', '목', '금'];

/* ── 방향 [OWNER, 2026-08-21] ────────────────────────────────────────────────
 *
 * 채권의 «강세» 는 금리가 내리는 것이다. 이 앱에서 파랑이 하락 전용이라 강세가
 * `.sr-down`(파랑), 약세가 `.sr-up`(빨강)이 된다.
 *
 * **칸에는 색을 안 쓴다 — 실측 때문이다.** 달력 칸은 그날 발행액만큼 잉크로
 * 채워져 있고(`--sr-cal-fill`, 상한 10%), 그 위에서 방향색이 바닥을 못 지킨다:
 *
 *     라이트 채움  0%   상승 4.66  하락 4.54   ← 통과
 *     라이트 채움  5%   상승 4.35  하락 4.24   ← **미달**
 *     라이트 채움 10%   상승 4.06  하락 3.95   ← 미달
 *
 * `direction.css` 가 이미 적어 둔 제약("방향색을 회색 면에 올리면 기준 미달")의
 * 이 화면 판본이다. 그래서 칸은 **글리프**로 방향을 나르고, 색은 시트에서만
 * 쓴다 — 시트는 `--sr-popover`(라이트 흰색·다크 bgElevation2) 위라 둘 다 통과다.
 */

const DIR_INK: Record<Dir, string> = {
  강세: 'sr-down',
  약세: 'sr-up',
  중립: 'sr-flat',
  양방향: 'sr-flat',
};

/** 칸의 방향. 화살표는 **금리**의 방향이다 — 강세가 곧 금리 하락이다. */
const DIR_MARK: Record<Dir, string> = {
  강세: '↓',
  약세: '↑',
  중립: '',
  양방향: '↕',
};

/** 방향 한 글자. `null` 은 «중립» 이 아니라 «잰 것이 없다» 라서 아무것도 안 적는다. */
function mark(dir: Dir | null): string {
  return dir ? DIR_MARK[dir] : '';
}


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

  /* 시트는 Esc 로도 닫힌다 — 이 앱의 다른 떠 있는 것들과 같은 규약이다. */
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

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
  /** 그날이 **공시가 닿는 끝** 뒤인가. 발행과 입찰은 지평이 다르므로 둘 중
   * 이른 쪽을 넘으면 이미 «전부는 아니다» — 발행 쪽을 잣대로 쓴다(칸의 숫자가
   * 발행이라서). */
  const beyond = useCallback(
    (iso: string) => !!cal?.issuanceThrough && iso > cal.issuanceThrough,
    [cal],
  );
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
        {/* 이 화면의 **주 필터**라 펴 둔다 — 접힌 것만 쌓아 두면 설정 열이 위에
            뭉치고 아래가 340px 빈다(Simulation 의 설정 열은 꽉 찬다). */}
        <ControlCollapsible
          defaultOpen
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

        {/* 페이로드가 처음부터 싣고 있었는데 화면이 한 번도 안 그렸다. **접어
            둔다** — 855 창에서 설정 열이 넘치지 않는 유일한 모양이고, 이건
            날마다 읽을 것이 아니라 «왜 비어 있지» 를 물을 때 펴는 것이다. */}
        <ControlCollapsible title="이 화면이 못 보는 것" summary={`${cal.caveats.length}건`}>
          {cal.caveats.map((c) => (
            <Text key={c} as="p" font="legal" color="fgMuted">
              {c.replace(/^[A-Z][A-Z_0-9]+:\s*/, '')}
            </Text>
          ))}
        </ControlCollapsible>

      </VStack>

      {/* ── 달력 ──────────────────────────────────────────────────────── */}
      <VStack className="sr-card sr-cal-card" flexGrow={1} minWidth={0} minHeight={0}>
        {/* **히어로가 없다.** 백테스트의 종목 카드는 display3 숫자를 세우지만,
            거기는 차트가 남는 높이를 아무렇게나 받아도 되는 화면이다. 달력은
            내용이 곧 격자라 48px 히어로 하나가 다섯 주를 전부 눌러 **칸이 자기
            내용보다 짧아지고 행끼리 겹쳤다**(실측 2026-08-20: 필요 110px, 실제
            77px). 이 달의 합계는 아래 통계 블록이 진다.

            그래서 머리는 Main 의 «IRS 커브» 카드와 같은 두 줄이다 — 이름 muted,
            그 아래 메타 한 줄. */}
        <VStack gap={0.5} paddingX={2} paddingTop={2} paddingBottom={1} width="100%">
          <Text as="h2" font="label1" color="fgMuted" tabularNumbers noWrap>
            {ym.slice(0, 4)}년 {Number(ym.slice(5, 7))}월
          </Text>
          {/* 화살표가 무엇인지 **여기서** 말한다. 시트에 있는 온전한 단서는
              칸을 눌러야 보이는데, 칸을 안 누르고 색만 보고 가는 사람이 이
              화면의 다수다. 머리 줄은 이미 서 있어서 높이를 안 먹는다 —
              설정 열에 카드를 하나 더 세우면 855 창에서 그 열이 넘친다
              (실측 2026-08-21: 열 664, 쓴 높이 590). */}
          <Text as="span" font="caption" color="fgMuted" tabularNumbers noWrap>
            납입기일 기준 · 오늘 {cal.today} · 칸을 누르면 그날이 펴져요 ·
            {' '}↓↑ 는 그 재료가 금리를 미는 쪽이에요
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
                    /* 지평 밖의 빈칸은 «없음» 이 아니라 «아직 모름» 이다.
                       그 둘은 반대 뜻이라 화면이 갈라 그려야 한다. */
                    data-beyond={beyond(d.iso) ? '1' : '0'}
                    /* 크기는 **칸의 채움**이 진다 — Main 이 변화 열에 크기 틴트를
                       까는 그 문법이다. 바닥의 막대였는데, 그건 한 줄을 더 먹어서
                       세 일정이 있는 날의 칸을 넘치게 했다. */
                    style={{ ['--sr-cal-fill' as string]: amt > 0 ? (amt / peak).toFixed(3) : '0' }}
                    /* 읽어 주는 말에는 화살표가 아니라 **방향의 이름**이 간다 —
                       스크린 리더가 «↑» 를 «위쪽 화살표» 라고 읽는다. */
                    accessibilityLabel={`${d.iso} ${
                      beyond(d.iso) ? '아직 공시 안 됨' : `발행 ${amt.toFixed(2)}조 ${n}건`
                    }${
                      d.ev.length
                        ? `, ${d.ev
                            .map((e) => (e.dir ? `${e.label} ${e.dir} 요인` : e.label))
                            .join(', ')}`
                        : ''
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
                    {/* 두 줄까지만 적고 나머지는 «+N» 이다 — 달력의 관례이고
                        (구글 캘린더가 그렇다), 셋을 다 적으면 칸이 18px 더 필요해
                        다섯 주가 카드에 안 들어간다. 전부는 누르면 나온다. */}
                    {d.ev.length > 0 ? (
                      <Box className="sr-cal-evs">
                        {d.ev.slice(0, 2).map((e, i) => (
                          <Text
                            key={`${e.lane}${i}`}
                            as="span"
                            className="sr-cal-ev"
                            font="legal"
                            color={e.lane === 'mpc' ? undefined : 'fgMuted'}
                          >
                            {mark(e.dir)}
                            {mark(e.dir) ? ' ' : ''}
                            {e.label}
                          </Text>
                        ))}
                        {d.ev.length > 2 ? (
                          <Text as="span" className="sr-cal-ev" font="legal" color="fgMuted">
                            +{d.ev.length - 2}
                          </Text>
                        ) : null}
                      </Box>
                    ) : null}

                  </Pressable>
                );
              })}
            </Box>
            {/* ── 지평 [2026-08-21] ────────────────────────────────────────
                **빈칸에는 두 가지 뜻이 있고 그 둘은 반대다.** 지평 안은 «그날
                아무 일도 없었다», 지평 밖은 «아직 모른다». 백엔드가 경계를
                처음부터 보내고 있었는데 화면이 안 그리고 있었다 — 9월로 넘기면
                22칸이 통째로 비고 어디에도 이유가 없었다(실측 2026-08-21).

                설정 열이 아니라 **여기** 두는 이유는 높이다. 그쪽에 카드를 하나
                더 세우면 855 창에서 그 열이 넘친다(실측: 열 664, 쓴 높이 590). */}
            <Text as="p" font="legal" color="fgMuted" tabularNumbers>
              발행 공시는 {cal.issuanceThrough ?? '—'}, 국고채 입찰 결과는{' '}
              {cal.auctionThrough ?? '—'} 까지 닿아 있어요. 그 뒤 빗금 친 칸의
              빈자리는 «없음» 이 아니라 «아직 공시 안 됨» 이에요.
            </Text>
          </VStack>

        </VStack>

        {/* ── 그날 하루 — 카드 위로 **떠오르는 시트** [OWNER, 2026-08-20] ─────
            흐름 안에 두었더니 격자 바로 아래 같은 평면에 서서 «글자가 달력이랑
            겹쳐서 거의 안 보이는 수준» 이 됐다. 덮개가 없으면 패널이 패널로 안
            읽힌다는 것은 이 앱이 메가 패널에서 이미 겪은 일이다(type.css 의
            `.sr-megascrim` 주석).

            바탕은 `--sr-popover` — 라이트는 흰색, 다크는 카드보다 한 칸 위. 뒤는
            `--sr-scrim` 이 덮는다. */}
        {sel ? (
          <>
            <Box
              className="sr-cal-scrim"
              aria-hidden
              onClick={() => setSel(null)}
            />
            <VStack className="sr-cal-sheet" role="dialog" aria-label={`${sel} 발행 상세`}>
              <DayDetail iso={sel} day={day} off={off} onClose={() => setSel(null)} />
            </VStack>
          </>
        ) : null}

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
function LaneHead({ g, bias = true }: { g: Gloss; bias?: boolean }) {
  return (
    <VStack gap={0.25} width="100%" minWidth={0}>
      <HStack gap={1} alignItems="baseline" width="100%" minWidth={0}>
        <Text as="h4" font="label2" noWrap>
          {g.title}
        </Text>
        {/* 그날 아무 일도 없었으면 방향 낱말을 안 단다. 이 태그는 레인의
            성질이지만 머리에 붙으면 «오늘» 의 판정으로 읽힌다 — 발행이 0 건인
            날에 «약세 요인» 이 서 있었다(실측 2026-08-21, 8/20). */}
        {bias && g.bias ? (
          <Box style={{ marginInlineStart: 'auto' }}>
            <DirTag dir={g.bias.dir} />
          </Box>
        ) : null}
      </HStack>
      <Text as="p" font="legal" color="fgMuted">
        {[g.what, g.why, g.bias?.why].filter(Boolean).join(' ')}
      </Text>
    </VStack>
  );
}

/** 방향 한 낱말. **시트에서만 색을 쓴다** — 달력 칸은 발행량만큼 채워져 있어
 * 방향색이 대비 바닥을 못 지킨다(파일 머리의 실측표).
 *
 * «중립» 과 «양방향» 은 잉크다. 둘 다 어느 쪽도 아니라서 색을 받을 자격이 없고,
 * 색을 주면 화면에 방향이 넷이 된다. */
function DirTag({ dir }: { dir: Dir }) {
  return (
    <Text as="span" className={DIR_INK[dir]} font="legal" noWrap>
      {dir === '양방향' ? '결과가 정해요' : `${dir} 요인`}
    </Text>
  );
}

/** 성격 설명 하나 — 방향 낱말이 그 문단의 머리에 붙는다.
 *
 * **한 문단이다.** 설명과 방향을 두 문단으로 그렸더니 둘이 같은 사실을 말해
 * 같은 글이 두 번 찍혔다(실측 2026-08-21, 비경쟁인수 줄). */
function EventNoteLine({ e }: { e: EventNote }) {
  return (
    <Text as="p" font="legal" color="fgMuted">
      {e.dir && e.dir !== '중립' ? (
        <>
          <Text as="span" className={DIR_INK[e.dir]} font="legal">
            {e.dir === '양방향' ? '결과가 정해요' : `${e.dir} 요인`}
          </Text>
          {' · '}
        </>
      ) : null}
      {e.text}
    </Text>
  );
}

/** 근거까지 딸린 방향 한 줄. 방향만 있고 근거가 없으면 그건 점괘다. */
function BiasLine({ b }: { b: Bias | null | undefined }) {
  if (!b) return null;
  return (
    <HStack gap={1} alignItems="baseline" flexWrap="wrap" minWidth={0}>
      <DirTag dir={b.dir} />
      <Text as="span" font="legal" color="fgMuted">
        {b.why}
      </Text>
    </HStack>
  );
}

/** 발행 당시 민평 대비 한 줄.
 *
 * **잣대 이름을 늘 적는다.** 이 «민평» 은 등급 커브지 개별종목 민평이 아니고,
 * 이름을 빼면 화면이 없는 것을 있는 척한다.
 *
 * 부호 있는 숫자만 색을 받는다(v1 §4, 이 리포가 이어받은 규칙). 여기 색은
 * 강세·약세가 아니라 «민평보다 높다/낮다» 다 — 그게 이 앱에서 빨강·파랑이
 * 뜻하는 바 그대로다. */
function MpLine({ m }: { m: Versus | null }) {
  if (!m) return null;
  if (m.bp == null) {
    return m.why ? (
      <Text as="span" font="legal" color="fgMuted">
        {m.why}
      </Text>
    ) : null;
  }
  const ink = m.bp > 0.5 ? 'sr-up' : m.bp < -0.5 ? 'sr-down' : 'sr-flat';
  return (
    <VStack gap={0} width="100%" minWidth={0}>
      <HStack gap={1} alignItems="baseline" flexWrap="wrap" minWidth={0}>
        <Text as="span" className={ink} font="label2" noWrap>
          {m.side ?? '민평 대비'} {fmtBp(m.bp)}bp
        </Text>
        {/* 잣대 이름에 등급이 박혀 있어서, 종목의 등급과 나란히 놓으면 갈린
            것이 그 자리에서 보인다. 문장으로 또 적지 않는다 — 하루에 다섯
            줄이 등급 불일치면 같은 35자가 다섯 번 찍힌다(실측 2026-08-21,
            8/13 현대캐피탈 넷 + 하나카드). 문장은 레인 각주 한 벌이다. */}
        <Text as="span" font="legal" color="fgMuted" tabularNumbers>
          {m.curve} {m.years?.toFixed(1)}Y {pct(m.rate)}
          {m.asof ? ` (${m.asof.slice(5)})` : ''}
        </Text>
      </HStack>
      {m.note ? (
        <Text as="span" font="legal" color="fgMuted">
          {m.note}
        </Text>
      ) : null}
      {m.why ? (
        <Text as="span" font="legal" color="fgMuted">
          {m.why}
        </Text>
      ) : null}
    </VStack>
  );
}

/** 레인 바닥의 출처 한 줄 — **어디서 온 숫자인가**.
 *
 * 원본이 화면 바닥에 레인마다 적던 것이고, v2 는 그걸 빼먹은 채로 판정만
 * 보여 주고 있었다. «약한 수요» 라는 말은 있는데 그 숫자가 어느 공고에서
 * 왔는지가 화면에 없었다 — 오너가 첫 이식에서 지적한 병의 다른 판본이다. */
function SrcLine({ s }: { s: Src }) {
  return (
    <Text as="p" font="legal" color="fgMuted">
      {s.what} 출처{' '}
      <a href={s.url} target="_blank" rel="noreferrer noopener">
        {s.who} ↗
      </a>
    </Text>
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
  off,
  onClose,
}: {
  iso: string;
  day: IssuanceDay | null;
  off: Set<string>;
  onClose: () => void;
}) {
  /* **섹터 필터가 여기에도 먹는다** [2026-08-21]. 캐피탈을 끄면 칸은 2.21조에서
     0.44조로 줄었는데 그 날을 열면 현대캐피탈 넷이 그대로 다 나왔다(실측) —
     필터가 달력만 바꾸고 시트는 무시하고 있었다.

     **금액 큰 순으로 정렬한다.** 원본 순서는 공시 접수 순이라 500억·2,400억·
     1,500억·500억·2,700억 처럼 섞여 나와서, 그날 무엇이 큰지가 안 보였다. */
  const rows = (day?.issuing ?? [])
    .filter((r) => !off.has(r.sector))
    .sort((a, b) => b.eok - a.eok);
  const hidden = (day?.issuing.length ?? 0) - rows.length;
  const issJo = rows.reduce((a, r) => a + r.eok, 0) / 1e4;

  return (
    <VStack gap={3} width="100%" minWidth={0}>
      <VStack gap={0.25} width="100%" minWidth={0}>
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
        {/* 열자마자 그날 규모가 보이게. 흡수와 공급은 **상계하지 않는다** —
            순액으로 누르면 «3조 흡수 + 3조 공급» 이 «0» 이 된다. */}
        {day ? (
          <Text as="span" font="legal" color="fgMuted" tabularNumbers>
            {[
              rows.length ? `발행 ${issJo.toFixed(2)}조 ${rows.length}건` : null,
              day.sum.ktbN ? `국고채 ${eok(day.sum.ktbWon)} ${day.sum.ktbN}건` : null,
              day.sum.omoAbsorb ? `흡수 ${eok(day.sum.omoAbsorb)}` : null,
              day.sum.omoSupply ? `공급 ${eok(day.sum.omoSupply)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '이 날짜에는 아무것도 없어요.'}
          </Text>
        ) : null}
      </VStack>

      {day === null ? (
        <Text as="span" font="legal" color="fgMuted">
          불러오는 중이에요.
        </Text>
      ) : (
        <>
          {day.mpc ? (
            <VStack gap={1} width="100%" minWidth={0}>
              <LaneHead g={day.gloss.mpc} />
              <VStack gap={0.25} width="100%" minWidth={0}>
                <Text as="span" font="label2" tabularNumbers>
                  {day.mpc.decision
                    ? `${day.mpc.decision.decision ?? '결정'} · ${
                        day.mpc.decision.before ?? '—'
                      }% → ${day.mpc.decision.after ?? '—'}%`
                    : '회의가 있는 날이에요. 결과는 아직이에요.'}
                </Text>
                {/* 결정이 아직이면 방향도 아직이다 — 열린 회의와 안 열린
                    회의는 다른 사실이다. */}
                <BiasLine b={day.mpc.bias} />
                {/* 결정문의 요지. 페이로드가 처음부터 싣고 있었는데 화면이 안
                    썼다 — «약세 요인» 의 근거가 한국은행 자기 말로 여기 있다. */}
                {day.mpc.decision?.gist ? (
                  <Text as="p" font="legal" color="fgMuted">
                    {day.mpc.decision.gist}
                  </Text>
                ) : null}
              </VStack>
              <LaneNote text={day.gloss.mpc.note} />
              <SrcLine s={day.src.mpc} />
            </VStack>
          ) : null}

          {/* 지준 — 오너가 지시에 짚은 레인. 설명과 방향은 처음부터 있었는데
              **데이터가 없어** 한 번도 뜬 적이 없었다. */}
          {day.res ? (
            <VStack gap={1} width="100%" minWidth={0}>
              <LaneHead g={day.res.gloss} />
              <VStack gap={0.25} width="100%" minWidth={0}>
                <Text as="span" font="label2" tabularNumbers>
                  {day.res.kind} · {day.res.start.slice(5)}~{day.res.end.slice(5)}
                  {' '}({day.res.days}일)
                </Text>
                <Text as="span" font="legal" color="fgMuted" tabularNumbers>
                  {day.res.month.slice(0, 4)}년 {Number(day.res.month.slice(5))}월
                  {' '}계산기간에 대응해요 ·{' '}
                  {day.res.leftDays > 0
                    ? `마감까지 ${day.res.leftDays}일 남았어요`
                    : '오늘이 마감이라 평균으로 메울 다음 날이 없어요'}
                </Text>
              </VStack>
              {day.res.gloss.extra.map((t) => (
                <Text key={t} as="p" font="legal" color="fgMuted">
                  {t}
                </Text>
              ))}
              <LaneNote text={day.res.gloss.note} />
              <SrcLine s={day.src.res} />
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
                      {[
                        a.offered != null ? `입찰 ${eok(a.offered)}` : null,
                        a.bid != null ? `응찰 ${eok(a.bid)}` : null,
                        a.ratio != null ? `응찰률 ${pct(a.ratio)}` : null,
                        a.wavgRate != null ? `가중평균 ${pct(a.wavgRate)}` : null,
                        a.dealers != null ? `인수기관 ${a.dealers}개` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {/* 원본이 갖고 있었는데 v2 가 안 그리던 칸들. 낙찰금리 폭은
                        낙찰된 응찰이 얼마나 흩어졌는가고(실측 95%가 폭 0 이라
                        벌어진 날만 뜻이 있다), 부분낙찰률은 평년과 견줘야 읽힌다. */}
                    {a.lowRate != null || a.partial != null || a.issueDate ? (
                      <Text as="span" font="legal" color="fgMuted" tabularNumbers>
                        {[
                          // 폭이 0 인 날에 «3.780%~3.780%» 는 글자만 먹는다.
                          // 실측 95%가 폭 0 이라 **벌어진 날만** 뜻이 있다.
                          a.lowRate != null &&
                          a.highRate != null &&
                          a.highRate !== a.lowRate
                            ? `낙찰금리 ${pct(a.lowRate)}~${pct(a.highRate)}`
                            : null,
                          // 부분낙찰률은 비율이라 소수 첫째 자리면 족하다 —
                          // `pct` 는 10 미만을 셋째 자리까지 찍어서 평년(1자리)과
                          // 자릿수가 어긋난다.
                          a.partial != null
                            ? `부분낙찰 ${a.partial.toFixed(1)}%${
                                a.strength?.partMed != null
                                  ? ` (평년 ${a.strength.partMed}%)`
                                  : ''
                              }`
                            : null,
                          a.issueDate ? `발행일 ${a.issueDate}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                    {/* 시장 대비와 지난번 대비는 다른 질문이라 둘 다 적는다 —
                        민평 대비가 여기, 직전 입찰 대비가 `StrengthLine` 안에. */}
                    <MpLine m={a.mp} />
                    {a.strength ? <StrengthLine s={a.strength} bias={a.bias} /> : null}
                    {a.events.map((e) => (
                      <EventNoteLine key={e.key} e={e} />
                    ))}
                  </VStack>
                ))}
              </VStack>
              <LaneNote text={day.gloss.ktb.note} />
              <SrcLine s={day.src.ktb} />
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
                          {o.rate != null
                            ? ` · ${pct(o.rate)}${
                                o.rateHigh != null && o.rateHigh !== o.rate
                                  ? `~${pct(o.rateHigh)}`
                                  : ''
                              }`
                            : ''}
                        </Text>
                      </Box>
                    </HStack>
                    {/* 응찰도 낙찰도 없던 종목 — 카드 한 줄을 차지할 내용이
                        없다. 그렇다고 빼면 그날 공고가 있었다는 사실이 사라진다. */}
                    {!o.bid && !o.allotted ? (
                      <Text as="span" font="legal" color="fgMuted">
                        응찰이 없었어요{o.stage && o.stage !== '결과' ? ` (${o.stage})` : ''}.
                      </Text>
                    ) : (
                      <Text as="span" font="legal" color="fgMuted" tabularNumbers>
                        {[
                          o.planned != null ? `예정 ${eok(o.planned)}` : null,
                          o.bid != null ? `응찰 ${eok(o.bid)}` : null,
                          o.code ? o.code : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                    {o.events.map((e) => (
                      <EventNoteLine key={e.key} e={e} />
                    ))}
                    <OmoScale s={o.strength} />
                  </VStack>
                ))}
              </VStack>
              <LaneNote text={day.gloss.omo.note} />
              <SrcLine s={day.src.omo} />
            </VStack>
          ) : null}

          <VStack gap={1} width="100%" minWidth={0}>
            <LaneHead g={day.gloss.iss} bias={rows.length > 0} />
            {rows.length === 0 ? (
              <Text as="span" font="legal" color="fgMuted">
                {hidden > 0
                  ? `이 날짜의 발행 ${hidden}건은 지금 끈 섹터예요.`
                  : '이 날짜에 공시된 발행이 없어요.'}
              </Text>
            ) : (
              <VStack gap={0} width="100%" className="sr-scn-deftable">
                {rows.map((r, i) => (
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
                      {/* «그래서 비싸게 찍었나 싸게 찍었나» — 이 화면이 «누가
                          얼마를» 다음에 답해야 하는 하나. */}
                      <MpLine m={r.mp} />
                    </VStack>
                    <Box style={{ marginInlineStart: 'auto' }}>
                      <VStack gap={0} alignItems="flex-end">
                        <Text as="span" font="label2" tabularNumbers noWrap>
                          {eok(r.eok)}
                        </Text>
                        {/* 이 화면의 모든 숫자가 거기서 나왔다. 접수번호는
                            페이로드가 처음부터 싣고 있었는데 길이 없었다. */}
                        {r.rcept ? (
                          <Text as="span" font="legal" noWrap>
                            <a
                              href={dartUrl(r.rcept)}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              신고서 ↗
                            </a>
                          </Text>
                        ) : null}
                      </VStack>
                    </Box>
                  </HStack>
                ))}
              </VStack>
            )}
            {/* 필터가 시트에도 먹는다. 몇 건을 감췄는지는 말해야 «이 날은
                발행이 적었다» 로 오독되지 않는다. */}
            {hidden > 0 && rows.length > 0 ? (
              <Text as="span" font="legal" color="fgMuted">
                끈 섹터 {hidden}건은 안 보여요.
              </Text>
            ) : null}
            {/* 등급이 잣대와 갈린 종목이 있으면 **레인에 한 번** 말한다.
                줄마다 적었더니 8/13 하루에 같은 35자가 다섯 번 찍혔다. */}
            {rows.some((r) => r.mp?.match === false) ? (
              <LaneNote text="등급이 잣대와 다른 종목은 «오버·언더» 대신 «민평 대비» 로만 적었어요 — 그 차이엔 가격이 아니라 등급 몫이 섞여 있어요." />
            ) : null}
            <LaneNote text={day.gloss.iss.note} />
            <SrcLine s={day.src.iss} />
          </VStack>

          {/* 시트 바닥 한 벌. **레인마다 안 적는다** — 네 레인이 같은 문장을
              네 번 되풀이하면 그건 각주가 아니라 소음이다. */}
          <VStack gap={0.25} width="100%" minWidth={0}>
            <LaneNote text={day.gloss.ktb.biasCaveat} />
            <LaneNote text={day.mp.caveat} />
            <LaneNote text={day.mp.note} />
          </VStack>
        </>
      )}
    </VStack>
  );
}

/** 같은 연물 52주와 견준 한 줄. **표본이 모자라면 등급 대신 그렇다고 말한다** —
 * 6회 미만에서 백분위는 계단이라 숫자가 과장된다(원본의 규율). */
function StrengthLine({ s, bias }: { s: Strength; bias: Bias | null }) {
  return (
    <VStack gap={0} width="100%">
      <HStack gap={1} alignItems="baseline" flexWrap="wrap">
        <Text as="span" font="label2" noWrap>
          {s.grade}
        </Text>
        {/* 등급 말이 «수요» 에서 멈춘 것은 그 모듈의 규율이었다("응찰률은
            수요÷공급이라는 산수라 거기까지가 정의") — 마지막 한 칸을 잇는
            것이 오너의 지시고, 이 태그가 그 자리다. */}
        {bias ? <DirTag dir={bias.dir} /> : null}
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
      {/* 지표종목 교체기에는 두 종목이 같은 날 나오고, 판정은 **그 둘을 합쳐**
          과거와 견준 것이다. 합계를 안 적으면 판정의 근거가 화면에서 사라진다
          — 원본이 «이날 합계» 행으로 적던 것이다. */}
      {(s.legs ?? 1) > 1 && s.tot != null ? (
        <Text as="span" font="legal" color="fgMuted" tabularNumbers>
          이날 합계 {eok(s.tot)}
          {s.ratio != null ? ` · 응찰률 ${s.ratio.toFixed(1)}%` : ''} ({s.legs}종목)
        </Text>
      ) : null}
      {s.totMed != null ? (
        <Text as="span" font="legal" color="fgMuted" tabularNumbers>
          평년 물량 {eok(s.totMed)}
        </Text>
      ) : null}
      {s.wavgDelta != null ? (
        <Text as="span" font="legal" color="fgMuted" tabularNumbers>
          직전 입찰 대비 {fmtBp(s.wavgDelta)}bp
          {s.prevDate ? ` (${s.prevDate.slice(5)})` : ''}
        </Text>
      ) : null}
      {bias ? (
        <Text as="span" font="legal" color="fgMuted">
          {bias.why}
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

/** 공개시장운영의 규모 — 방향 다음의 사실.
 *
 * 방향만 있고 규모가 없으면 흡수 1천억과 흡수 3조가 화면에서 같은 무게로
 * 읽힌다. `annotate_omo` 는 이식할 때 같이 왔지만 첫 판에서 안 불렀다.
 *
 * **수치는 서버가 필드로만 준다** — 그쪽 규율이 "화면이 행으로 그린다" 라서,
 * 문장 조립은 여기 몫이다. */
function OmoScale({ s }: { s: OmoStrength | null }) {
  if (!s) return null;
  const bits: string[] = [];
  if (s.size) {
    bits.push(
      s.sizeMed != null ? `${s.size} · 평년 ${eok(s.sizeMed)}` : s.size,
    );
  }
  if (s.cover != null) {
    bits.push(
      `응찰배율 ${s.cover.toFixed(2)}배${
        s.coverMed != null ? ` (평년 ${s.coverMed.toFixed(2)})` : ''
      }`,
    );
  }
  if (s.spread != null) {
    // «기준금리 0.0bp» 는 «기준금리가 0» 으로 읽힌다. 이건 수준이 아니라
    // 스프레드라서 «대비» 가 있어야 문장이 된다.
    bits.push(`기준금리 대비 ${fmtBp(s.spread)}bp`);
  }
  if (bits.length === 0) return null;
  return (
    <Text as="span" font="legal" color="fgMuted" tabularNumbers>
      {bits.join(' · ')}
    </Text>
  );
}
