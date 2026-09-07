'use client';

/* MR 두 창이 같이 쓰는 조각들 — 패널 상자·청산 사유의 우리말·짧은 날짜
 * [2026-09-01, 통합 밴드 워치].
 *
 * 낱개 창(`StrategyWindow`)과 통합 장부 창(`BookWindow`)이 같은 사건을 같은
 * 낱말로 불러야 한다. 「손절」을 한 창은 「손절」, 다른 창은 「스톱」이라 적으면
 * 두 표를 나란히 놓고 읽을 수 없다 — CLAUDE.md 얼라인 8(«같은 것은 한 번만
 * 만든다»)의 어휘 판이다.
 */

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TableCell } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import { fmtKrw } from '@/lib/krw';
import { Stat, StatColumn } from '@/ui/Stat';

import type { MrPerf, MrStrategyTrade } from './api';

/** 청산 사유의 우리말 — 서버의 어휘를 화면에서 **한 번만** 옮긴다.
 *  우선순위가 곧 이름이다: 손절 > 청산 > 역신호 > 타임스탑. `미청산` 은 판정이
 *  아니라 상태다(팔지 않았고, 그래서 청산 비용도 안 물었다). */
export const WHY_WORD: Record<MrStrategyTrade['why'], string> = {
  stop: '손절',
  exit: '청산',
  reverse: '역신호',
  time: '타임스탑',
  open: '미청산',
};

/** 표 머리의 활자를 고른다 — **소문자가 들어 있으면 `legal`, 아니면 `caption`**.
 *
 *  이 리포가 이미 정해 둔 기준이다(`StrategyWindow` 대사표 머리 주석·
 *  `BookWindow` 만기별 표 주석): CDS 기본 테마의 `textTransform.caption =
 *  'uppercase'` 가 「z」를 「Z」로, 「bp」를 「BP」로 만든다. 둘은 크기가 같고
 *  (0.8125rem) 중량·대문자화만 다르므로, **기호와 단위가 든 머리**만 `legal` 이다.
 *
 *  기준이 사람의 눈대중에 걸리지 않게 함수로 둔다 — 2026-09-02 감사에서 거래 표
 *  머리 넷(`#`·`진입 IRS`·`진입 CD`·`이탈 최대`)이 소문자가 없는데도 `legal` 로
 *  서 있었다. 대문자화가 망칠 글자가 없으니 화면은 안 틀렸지만, 같은 행의 머리가
 *  두 중량으로 갈렸다. */
export const headFont = (label: string): 'caption' | 'legal' =>
  /[a-z]/.test(label) ? 'legal' : 'caption';

/** 짧은 날짜 — 구간 라벨용. `2020-01-02` → `20-01`. 칸이 좁아 연·월만 남긴다. */
export const ym = (iso: string): string => `${iso.slice(2, 4)}-${iso.slice(5, 7)}`;

export function Panel({
  title,
  sub,
  aside,
  children,
}: {
  title: string;
  sub?: string;
  /** 그 패널**만** 바꾸는 컨트롤이 서는 자리. 결과를 바꾸는 노브는 여기 오면
   *  안 된다 — 설정 줄에 있어야 「실행」이 그것을 삼킨다. 반대로 그림만 바꾸는
   *  것을 설정 줄에 두면 실행을 기다리게 만들고 stale 을 거짓으로 세운다. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  /* **한 줄에 하나** [OWNER 2026-09-02 — 「세로 스택 정본화」]. 종전 값은
     `flexBasis: 50%` 였는데 gap 을 더하면 한 줄에 둘이 안 들어가 실제로는
     세로로 섰다 — 화면은 세로였고 주석만 「2×2 격자」라고 말하고 있었다
     (2026-09-02 디자인 감사가 그 어긋남을 잡았다). 정본을 화면 쪽으로
     맞춘다: Backtest 창의 세로 결(북 → 답 → 차트 쌍 → 서랍)과 같은 흐름이고,
     12년 시계열은 풀폭이 아니면 못 읽는다. */
  return (
    <VStack gap={0.5} width="100%" minWidth={0}>
      <HStack gap={1} alignItems="center" justifyContent="space-between" minHeight={24}>
        <Text font="label2" as="h3" noWrap>
          {title}
        </Text>
        <HStack gap={1} alignItems="center" minWidth={0}>
          {sub ? (
            <Text font="legal" as="span" color="fgMuted" noWrap>
              {sub}
            </Text>
          ) : null}
          {aside}
        </HStack>
      </HStack>
      {children}
    </VStack>
  );
}

/** 위험조정 비율 — **두 자리 고정**이고 못 잰 값은 «—» 다 [OWNER 2026-09-04].
 *
 *  `null` 은 「그 구간에서 그 지표가 안 선다」이지 「0 이다」가 아니다(낙폭이
 *  0 이라 Calmar 가 없는 칸, 손실 월이 없어 GPR 이 없는 칸). 0 으로 적으면
 *  화면이 「최악」이라고 말하는데 사실은 「최선이라 분모가 없다」인 경우가
 *  섞인다 — 그래서 카드의 note 가 왜 없는지를 같이 적는다.
 *
 *  두 자리인 이유는 이 수들이 **원/원**이라서다. 셋째 자리는 Delta 하나만 바꿔도
 *  움직이는 자리가 아니지만(비율은 Delta 에 불변) 칸 폭만 늘린다.
 *
 *  ⚠ 두 창이 같이 쓴다 [2026-09-07] — 낱개 창에 있던 것을 여기로 옮겼다.
 *  통합 장부도 같은 일곱을 세우게 되면서 두 벌이 될 자리였다(얼라인 8). */
export const fmtRatio = (v: number | null | undefined): string =>
  v == null ? '—' : v.toFixed(2);

/** 비율 한 칸 — 못 잰 값은 «—» 다(0 이 아니다 — `fmtRatio` 머리의 그 근거). */
export function NumCell({ v }: { v: number | null }) {
  return (
    <TableCell className="sr-num" justifyContent="flex-end">
      <Text font="label1" as="span" tabularNumbers noWrap>
        {fmtRatio(v)}
      </Text>
    </TableCell>
  );
}

/** **절대수익형 일곱** — 두 창이 같은 카드를 세운다 [OWNER 2026-09-04 · 2026-09-07].
 *
 *  분모가 저마다 다른 것이 이 열의 요점이다. 하나가 나쁘고 하나가 좋으면
 *  «어느 축에서» 를 묻게 되고, 그게 절대수익형 평가가 샤프 한 칸으로는 못
 *  하던 일이다.
 *
 *  못 잰 값은 «—» 이고 **왜 없는지**를 note 가 적는다 — 「손실 난 달이 없어요」
 *  와 「월 버킷이 모자라요」는 다른 사실인데 둘 다 null 이다.
 *
 *  단위는 **원/원**이다(AUM 이 없다) — 문헌의 수익률 기반 값과 크기를 직접
 *  비교하면 안 되고, 그 사실은 이 열을 감싸는 화면의 각주가 말한다. */
export function RiskAdjusted({ perf }: { perf: MrPerf }) {
  return (
    <StatColumn title="위험조정">
      <Stat
        label="Sortino"
        value={fmtRatio(perf.sortino)}
        note={perf.sortino == null ? '손실 난 날이 없어요' : '하방편차 · 연'}
      />
      <Stat
        label="Calmar"
        value={fmtRatio(perf.calmar)}
        note={perf.calmar == null ? '낙폭이 없었어요' : '연환산 ÷ 최대낙폭'}
      />
      <Stat
        label="Martin"
        value={fmtRatio(perf.martin)}
        note={perf.martin == null ? '낙폭이 없었어요' : '연환산 ÷ Ulcer'}
      />
      <Stat label="Ulcer" value={fmtKrw(-perf.ulcer)} note="RMS 낙폭" />
      {/* GPR 이 없는 이유가 둘이라 화면이 가른다 — 월 버킷이 모자란 것과
          손실 월이 하나도 없는 것은 다른 사실이다. */}
      <Stat
        label="GPR"
        value={fmtRatio(perf.gpr)}
        note={perf.gpr != null ? '월 버킷 · Schwager'
          : perf.gprMonths < 2 ? `월 버킷 ${perf.gprMonths}개라 못 세요`
          : '손실 난 달이 없어요'}
      />
      <Stat
        label="Omega"
        value={fmtRatio(perf.omega)}
        note={perf.omega == null ? '손실 난 날이 없어요' : 'θ=0 · 일별'}
      />
      <Stat
        label="Profit Factor"
        value={fmtRatio(perf.profitFactor)}
        note={perf.profitFactor == null
          ? (perf.numTrades ? '진 거래가 없어요' : '거래가 없어요')
          : '거래 기준'}
      />
    </StatColumn>
  );
}
