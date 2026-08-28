'use client';

/* 전략 실험 창 — 첫 PMS(krw-fi-pms) entry-signals 워크스페이스의 기술적 구성을
 * v2 문법으로 재현한 것 [OWNER 2026-08-25 — "맨처음 만들었던 PMS 에서 볼린저
 * 밴드 활용한 트레이딩 전략 했던 창 참고해서 기술적 구성 구현하기"].
 *
 * ── 원본에서 가져온 것 ──────────────────────────────────────────────────────
 * · 노브 일곱(룩백 프리셋 20/60/120 + 자유값·진입σ·관찰σ·청산σ·손절σ·비용bp·
 *   명목 원/bp)과 그 기본값(s16) — 밴드 배수가 곧 진입σ라는 «노브 하나, 뜻 둘»
 *   까지 그대로.
 * · z-문턱 레벨 규칙(진입 |z|≥entryσ 역행·청산 |z|≤exitσ·손절 |z|≥stopσ 우선·
 *   당일 종가 체결·편도 비용) — 산술은 서버가 끝낸다(§16, mrbacktest.py 가
 *   원본과 적합성 벡터로 잠금).
 * · 패널 넷: 가격+SMA+밴드 / z 오실레이터(가이드 5줄 + 진입 마커) / 에쿼티
 *   커브 / KPI 타일+거래 표.
 * · «실행 시점 고정(pinned)» 규율: 노브를 실행 없이 바꾸면 숫자를 조용히
 *   재계산하지 않는다 — stale 문구가 서고 오실레이터 마커가 숨는다.
 * · 실행은 사람이 누른다 — v2 백테스트 창과 원본 staged flow 가 같은 규칙이다.
 *
 * ── v2 로 옮기며 바꾼 것(문법 충돌 자리) ────────────────────────────────────
 * · 차트는 lightweight-charts 가 아니라 CDS CartesianChart — 리드아웃·스크러버
 *   는 이 리포 공용 기구(ReadoutCard)를 쓴다.
 * · 진입/청산 마커는 원형/사각 심볼 대신 ReferenceLine 세로선 — LinkedCharts 의
 *   마커 문법이다. 거래별 정밀값은 거래 표가 진다.
 * · Jade/Berry 방향색 대신 이 리포의 방향색(--sr-up/--sr-down) — 색은 방향만
 *   나른다는 규칙 그대로.
 *
 * **명구 의무**: 이 창은 재현 도구다. 당일 종가 체결 규약은 원본 그대로이며
 * 체결 가능성을 담보하지 않는다(연구 레인의 «즉시체결판은 상한» 실측 — 창이
 * 그 사실을 말한다). 신호 검증(NO-GO)과 딴 물건임도 aside 가 말한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { TextInput } from '@coinbase/cds-web/controls';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import { TimeChart, useStackedScales, type TimeLine, type TimeMarker } from '@/chart/TimeChart';
import type { ScalePriceLine } from '@/chart/ScaleChart';
import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtBp, fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';
import { Field } from '@/ui/ControlCard';
import { CONTROL_H } from '@/ui/controlHeight';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutFact, ReadoutLevel, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';
import { Stat, StatColumn } from '@/ui/Stat';

import {
  MR_COST_MODELS,
  MR_ENTRY_MODES,
  MR_REGIMES,
  MR_STRATEGY_DEFAULTS,
  MR_STRATEGY_LOOKBACKS,
  MR_STRATEGY_PRESETS,
  MR_TIME_STOPS,
  fetchMrStrategy,
  fmtSigma,
  type MrStrategyParams,
  type MrStrategyRun,
  type MrStrategyTrade,
} from './api';

/* 얼라인 규칙 [OWNER 2026-08-25 — CLAUDE.md «얼라인» 절]. 첫 판은 라벨을
 * 컨트롤 **옆**에 붙였고, 라벨 폭이 제각각이라 컨트롤 시작점이 계단이 졌다
 * ("아주 얼라인이 개판이야"). 백테스트·시뮬 창의 Field 문법(라벨 위·바닥 정렬·
 * 등고 32px)으로 다시 세운다. */
/* `Field` 는 여기서 정의하지 않는다 — 앱에 하나뿐인 것을 임포트한다
   (`ui/ControlCard`). 이 파일이 갖고 있던 `help`(값의 출처를 라벨이 진다)는
   그 공용 것으로 올라갔다 [OWNER 2026-08-25]. */

/** σ 알약 칸 넷의 공통 폭. 가장 넓은 것(진입 σ = 1.5·2·2.5)의 자연폭 127 을
 * 담고 한 칸 여유 — 넷이 같아야 알약 열이 세로로 맞는다. */
const SIGMA_W = 132;

/** 값 몇 개 중 하나 — 라벨 아래 알약 묶음.
 *
 * `SigmaPick` 은 σ 전용(숫자 포맷·고정폭)이고 이것은 **아무 값**이나 받는다.
 * 하나로 합치지 않은 이유는 σ 칸 넷이 서로 폭을 맞춰야 하기 때문이다(SIGMA_W).
 * 대신 이 컴포넌트가 생기면서 진입 규칙·레짐·비용모델·타임스탑·스위치 둘이
 * **한 정의**를 쓴다 — CLAUDE.md 얼라인 8(«같은 것은 한 번만 만든다»). */
function Choice<T extends string | number | boolean>({
  label,
  help,
  width,
  value,
  options,
  onPick,
  group,
}: {
  label: string;
  help: string;
  width: number;
  value: T;
  options: readonly { v: T; label: string; help?: string }[];
  onPick: (v: T) => void;
  group?: boolean;
}) {
  return (
    <Box width={width} className={group ? 'sr-fgroup' : undefined}>
      <Field label={label} help={help}>
        <HStack gap={0.5} alignItems="center" height={CONTROL_H}>
          {options.map((o) => (
            <button
              key={String(o.v)}
              type="button"
              className="sr-pillbtn"
              data-on={value === o.v || undefined}
              aria-pressed={value === o.v}
              aria-label={`${label} ${o.label}`}
              title={o.help}
              onClick={() => onPick(o.v)}
            >
              {o.label}
            </button>
          ))}
        </HStack>
      </Field>
    </Box>
  );
}

/** σ 문턱 하나 — 근거 있는 셋 중 고른다(`MR_STRATEGY_PRESETS`).
 *
 * 자유 입력을 안 두는 이유는 보드와 같다: 근거 없는 조합을 화면이 권하는 셈이
 * 되고, 재현 도구가 원본에 없던 조합을 그럴듯하게 만들어 준다. 프리셋 밖의
 * 값이 들어오면(딥링크 등) **아무 알약도 안 눌린 상태**로 선다 — 원본 PMS 의
 * `SegmentedButtons` 가 하던 그 처리다. */
function SigmaPick({
  label,
  help,
  value,
  options,
  onPick,
  group,
}: {
  label: string;
  help: string;
  value: number;
  options: readonly number[];
  onPick: (v: number) => void;
  /** 새 묶음이 여기서 시작한다 — `.sr-fgroup`(`theme/type.css` 의 그 규칙). */
  group?: boolean;
}) {
  /* 넷이 같은 폭이어야 눈이 격자로 읽는다 — 자연폭은 113~127 로 제각각이었고
     (실측 2026-08-25) 그만큼 알약 열이 칸마다 어긋나 있었다. 상자를 두르는 것은
     형제 화면의 규약이기도 하다(`<Box width={N}><Field>` — 백테스트·시뮬). */
  return (
    <Box width={SIGMA_W} className={group ? 'sr-fgroup' : undefined}>
      <Field label={label} help={help}>
      <HStack gap={0.5} alignItems="center" height={CONTROL_H}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className="sr-pillbtn"
            data-on={value === o || undefined}
            aria-pressed={value === o}
            aria-label={`${label} ${fmtSigma(o)}`}
            onClick={() => onPick(o)}
          >
            {/* σ 는 **라벨이 진다** — 알약마다 붙이면 넷이 한 줄에 안 서고
                「실행」이 혼자 다음 줄로 밀린다(실측). 접근성 이름에는 남는다. */}
            {Number(o.toFixed(1))}
          </button>
        ))}
      </HStack>
      </Field>
    </Box>
  );
}

/** 숫자 칸 — blur/Enter 커밋(시뮬 NumField·rv BpField 의 규율: onChange 즉시
 * 파싱은 "-"·"1." 을 삼킨다). 라벨은 Field 가 진다 — 여기는 32px 상자뿐이다. */
function NumInput({
  label,
  value,
  onCommit,
}: {
  /** 접근성 이름 — 같은 모양의 칸이 일곱 개 서므로 각자 이름이 있어야 한다. */
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const shown = String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  if (!editing && text !== shown) setText(shown);
  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n >= 0) onCommit(n);
    else setText(shown);
  };
  return (
    <TextInput
      size="s"
      fontSize="legal"
      height={CONTROL_H}
      accessibilityLabel={label}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function Panel({
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
  return (
    <VStack gap={0.5} flexBasis="50%" flexGrow={1} minWidth={0}>
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

/** 패널 머리에 눕는 알약 한 줄 — 라벨이 옆에 붙는 납작한 형태다.
 *
 *  설정 줄의 `SigmaPick`(라벨 위·32px 등고·상자 폭 고정)과 **일부러 다른 물건**
 *  이다. 저기는 「실행」을 기다리는 노브들의 격자고, 여기는 지금 이 그림에만
 *  듣는 손잡이다. 같은 모양으로 만들면 둘이 같은 규율을 따른다고 거짓말을 한다. */
function InlineSigma({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: number;
  options: readonly number[];
  onPick: (v: number) => void;
}) {
  return (
    <HStack gap={0.5} alignItems="center">
      <Text font="legal" as="span" color="fgMuted" noWrap>
        {label}
      </Text>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="sr-pillbtn"
          data-on={value === o || undefined}
          aria-pressed={value === o}
          aria-label={`${label} ${fmtSigma(o)}`}
          onClick={() => onPick(o)}
        >
          {Number(o.toFixed(1))}
        </button>
      ))}
    </HStack>
  );
}


/** 이웃 칸 — 노브를 프리셋 안에서 옮겼을 때 결과가 얼마나 달라지는가.
 *
 * ## 왜 이게 성과 카드 바로 밑에 서는가 [OWNER 2026-08-26]
 *
 * 창은 고른 칸 하나만 보여 줬다. 그래서 손절 3.5 의 **+2,605만·승률 80%** 는
 * 보이고 손절 3.0 의 **+1,120만·승률 57%** 는 노브를 눌러 보기 전까지 안
 * 보였다. 한 칸 차이가 결과를 절반으로 만드는데 화면은 그 사실을 감췄고, 감춘
 * 채로 보여 준 80% 는 발견처럼 읽혔다.
 *
 * 실측으로 그 차이는 2022-12 거래 **한 짝**이었다: 손절 3.0 이면 z 3.22 에
 * 들어간 다리가 다음 봉에 −139만으로 잘리고, 3.5 면 살아남아 +1,005만 = 표본
 * 최대 승리가 된다. 「어느 칸이 옳은가」 를 화면이 답할 수는 없다. 답할 수 있는
 * 것은 **이 결과가 칸 하나에 얼마나 매달려 있는가** 뿐이고, 재현 도구가 그것을
 * 감추면 재현이 아니라 주장이 된다.
 *
 * ## 부품
 *
 * 바로 위 성과 스트립과 **같은 것**을 쓴다(`ui/Stat` 의 StatColumn·Stat, 칸
 * 사이는 여백이 아니라 헤어라인). 이 창이 제 표를 또 만들면 두 벌이 되고 한쪽만
 * 낡는다 — 형제의 부품을 임포트하는 것이 이 리포의 규칙이다. 칸을 누르면 그
 * 노브가 옮겨 가되 숫자는 안 바뀐다(pinned 규율: 핀은 「실행」이 옮긴다). */
function Sensitivity({
  run,
  onPick,
}: {
  run: MrStrategyRun;
  onPick: (patch: Partial<MrStrategyParams>) => void;
}) {
  if (run.neighbors.length === 0) return null;
  return (
    <VStack gap={0.5} width="100%">
      <HStack gap={1} alignItems="baseline" justifyContent="space-between">
        <Text font="label2" as="h3" noWrap>
          이웃 칸
        </Text>
        {/* 이 줄이 늘어난 이유 [OWNER 2026-08-28 — "전체 기간 Grid Search(이웃 칸
            최적화)를 폐기하십시오"]. 이 표는 **견고성 보기**이지 파라미터를
            고르는 도구가 아니다. 전진분석으로 실측했더니(BSS-3Y·훈련 3년 →
            시험 1년 · 27칸) 훈련 창 Sharpe 순위와 다음 해 순위의 상관이
            +0.85 / −0.10 / −0.21 / +0.17 로 **넷 중 셋이 0 근처거나 음수**였고,
            규칙대로 고른 칸의 다음 해 순위는 4/15 · 16/21 · 13/21 · **24/24**
            였다. 즉 「제일 좋은 칸」을 고르는 행위 자체가 값을 안 더한다 —
            화면이 그 사실을 말하지 않으면 이 표가 최적화를 권하는 것으로 읽힌다.
            근거와 재현: `backend/scripts/mr_live_report.py`. */}
        <Text font="legal" as="span" color="fgMuted">
          노브 하나만 옮기고 나머지는 지금 값 고정 · 누르면 그 값으로 바뀌어요(숫자는 실행해야 바뀌어요) ·
          견고성을 보는 표예요 — 제일 좋은 칸을 고르는 데는 쓰지 마세요(전진분석에서 그 선택은 다음 해를 못 맞혔어요)
        </Text>
      </HStack>
      <HStack className="sr-stats" alignItems="stretch" width="100%">
        {run.neighbors.map((row) => (
          <StatColumn key={row.knob} title={row.label}>
            {row.cells.map((c) => (
              <button
                key={c.v}
                type="button"
                /* 알약(`.sr-pillbtn`)이 아니다 — 그건 32px 단행이고 선택 시 잉크
                   반전이라 방향색 손익이 그 위에서 안 읽힌다. 여기서 필요한 것은
                   누를 수 있는 «Stat 한 칸» 뿐이라 버튼의 기본 껍데기만 벗긴다. */
                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                aria-label={`${row.label} ${c.v}${row.suffix} — 총손익 ${fmtKrw(c.totalPnl)}`}
                aria-pressed={c.current}
                onClick={() => onPick({ [row.knob]: c.v } as Partial<MrStrategyParams>)}
              >
                <Stat
                  /* 단위는 열 제목이 진다 — 여기 붙이면 caption 의 대문자 변환이
                     σ 를 Σ 로 만든다(실측). 칸에는 숫자와 「지금」만 남는다. */
                  label={`${Number(c.v.toFixed(1))}${c.current ? ' · 지금' : ''}`}
                  value={fmtKrw(c.totalPnl)}
                  tone={c.totalPnl > 0 ? 'up' : c.totalPnl < 0 ? 'down' : undefined}
                  note={`SR ${c.sharpe == null ? '—' : c.sharpe.toFixed(2)} · ${c.numTrades}거래`}
                />
              </button>
            ))}
          </StatColumn>
        ))}
      </HStack>
    </VStack>
  );
}

const CHART_H = 200;

/* ── 사건 어휘 ──────────────────────────────────────────────────────────────
 * 거래 하나를 가리키는 열쇠는 «진입-청산» 이다 — 실행이 바뀌면 자연히 안 맞고,
 * 그때 화면은 목록으로 돌아간다(펴 놓은 대사가 딴 실행의 숫자를 이고 있는
 * 것보다 낫다). 문자열을 두 곳에서 짓지 않으려고 함수로 둔다. */
export const tradeKey = (t: { entryT: string; exitT: string }): string =>
  `${t.entryT}-${t.exitT}`;

/** 미청산 다리의 열쇠 — 청산일이 없으므로 거래와 같은 모양을 쓸 수 없다. */
const OPEN_KEY = 'open';

/** 청산 사유의 우리말 — 서버의 어휘를 화면에서 **한 번만** 옮긴다.
 *  우선순위가 곧 이름이다: 손절 > 청산 > 역신호 > 타임스탑. `미청산` 은 판정이
 *  아니라 상태다(팔지 않았고, 그래서 청산 비용도 안 물었다). */
const WHY_WORD: Record<MrStrategyTrade['why'], string> = {
  stop: '손절',
  exit: '청산',
  reverse: '역신호',
  time: '타임스탑',
  open: '미청산',
};

type MrEvent = {
  kind: 'entry' | 'exit' | 'stop';
  /** 나간 사유 원본 — 진입 사건에서는 없다. */
  why?: MrStrategyTrade['why'];
  /** 엔진 부호. 미청산 다리는 0 으로 두어 방향색을 안 갖는다. */
  dir: number;
  /** 거래 순번(1부터) — 세로선의 라벨이 이걸 적는다. */
  n: number;
  key: string;
};

/** 그날 사건의 한 마디 — 판독과 대사표의 「구분」 칸이 같은 말을 쓴다. */
function eventWord(e: MrEvent | undefined, holding: boolean): string {
  if (!e) return holding ? '보유' : '—';
  return e.kind === 'entry' ? '진입' : (e.why ? WHY_WORD[e.why] : '청산');
}

/** 진입 사건의 수 — 거래 + (아직 목록에 없는) 미청산 다리.
 *
 * `countOpen` 이 켜져 있으면 미청산이 **이미 거래로 들어와 있으므로** 또 세면
 * 안 된다. 종전에는 무조건 더해서 「진입 15 · 거래 14」가 화면에 같이 서 있었다
 * (실측 2026-08-28). */
function entryCount(run: MrStrategyRun): number {
  return run.trades.length + (run.open && !run.params.countOpen ? 1 : 0);
}

/** 나간 사유의 집계 한 마디 — **0 인 사유는 안 적는다**.
 *
 * 종전에는 청산과 손절만 셌다. 나가는 문이 넷으로 늘어난 뒤에도 그대로 두었더니
 * 「청산 10 · 손절 0」이 서 있는데 거래는 14였다 — 타임스탑 2·역신호 1·미청산 1이
 * 화면에서 사라져 있었다. 사유를 하나라도 빠뜨리면 그 줄은 거짓이 된다. */
function exitTally(run: MrStrategyRun): string {
  const order: MrStrategyTrade['why'][] = ['exit', 'stop', 'time', 'reverse', 'open'];
  const n = (w: MrStrategyTrade['why']) => run.trades.filter((t) => t.why === w).length;
  const parts = order.filter((w) => n(w) > 0).map((w) => `${WHY_WORD[w]} ${n(w)}`);
  return parts.length ? parts.join(' · ') : '거래 없음';
}

/** 진입 규칙의 이름 — 목록이 어휘의 주인이라 여기서 다시 짓지 않는다. */
const entryWord = (mode: string): string =>
  MR_ENTRY_MODES.find((m) => m.v === mode)?.label ?? mode;

/** 그 봉의 포지션 한 마디 — 「보유 6봉째 · 거래 3」 또는 「무포지션」.
 *
 * `hold`(그 봉을 통과해서 들고 있던 것)로 판정한다. 청산 봉은 `pos` 가 이미 0
 * 이지만 그날 하루는 들고 있었으므로 무포지션이라고 말하면 거짓이다. */
function posWord(run: MrStrategyRun, i: number): string {
  const p = run.points[i];
  if (!p) return '—';
  const t = run.trades.find((q) => q.entryT <= p.t && p.t <= q.exitT);
  const open = !t && run.open && p.t >= run.open.entryT ? run.open : null;
  const from = t?.entryT ?? open?.entryT;
  if (from == null) return p.hold === 0 && p.pos === 0 ? '무포지션' : '보유';
  const e = run.points.findIndex((q) => q.t === from);
  const day = e < 0 ? null : i - e;
  const who = t ? `거래 ${run.trades.indexOf(t) + 1}` : '미청산';
  return day === 0 ? `진입일 · ${who}` : `보유 ${day}봉째 · ${who}`;
}

/** 대사표의 숫자 열 — 머리와 몸통이 **같은 목록**을 읽는다. 두 벌이면 열이
 * 어긋나고, 어긋난 대사표는 대사표가 아니다. */
const RECON_COLS = [
  { k: 'z' }, { k: 'Δ (bp)' }, { k: '감도' },
  { k: '평가' }, { k: '캐리' }, { k: '비용' }, { k: '그날' }, { k: '누적' },
] as const;

/** 대사표의 숫자 한 칸.
 *
 * `tone` 은 **손익 두 열에만** 준다 — 방향색은 「번 돈인가 잃은 돈인가」를
 * 나르는 채널이라, 감도·Δ 처럼 부호가 방향을 뜻하는 열에 같은 색을 쓰면 색이
 * 두 가지 뜻을 갖게 된다(`theme/tint.ts` 의 「한 셀 한 채널」).
 * 0 은 `—` 로 적는다: 「그날 그 항이 없었다」와 「0원이었다」는 같은 말이고,
 * 그 자리에 0 을 찍으면 눈이 자릿수를 세게 된다. */
function ReconNum({
  v,
  kind,
  tone,
  head,
}: {
  v: number | null;
  kind: 'sigma' | 'bp' | 'won';
  tone?: boolean;
  /** 합계 줄 — 굵기가 한 단계 올라간다. */
  head?: boolean;
}) {
  const text =
    v == null ? '—'
    : kind === 'sigma' ? `${v.toFixed(2)}σ`
    : kind === 'bp' ? fmtBp(v, 2)
    : v === 0 ? '—'
    : fmtKrw(v);
  return (
    <TableCell className="sr-num" justifyContent="flex-end">
      <Text
        font={head ? 'label1' : 'label2'}
        as="span"
        tabularNumbers
        noWrap
        color={text === '—' ? 'fgMuted' : undefined}
        className={tone && v ? (v > 0 ? 'sr-up' : 'sr-down') : undefined}
      >
        {text}
      </Text>
    </TableCell>
  );
}

/** 대사표 머리의 한 줄 — 「무엇을 보고 들어가 어떻게 나왔나」.
 *
 * 이탈 구간을 여기서 말하는 이유: 「밴드 복귀」 판에서는 진입 z 가 밴드 선
 * 언저리라, 그 수만 보면 4σ 까지 갔다 온 거래와 살짝 넘었다 온 거래가 같은
 * 줄이다. 무엇을 보고 들어갔는지는 진입 z 가 아니라 **그 구간**이 진다. */
function reconSub(t: MrStrategyTrade, run: MrStrategyRun): string {
  const legs = (t.dir > 0 ? run.dirs.plus : run.dirs.minus).legs;
  const out =
    t.outFrom == null || t.outDays == null
      ? ''
      : ` · ${t.outFrom}부터 밖 ${t.outDays}일` +
        (t.peakZ == null ? '' : `(최대 ${t.peakZ.toFixed(2)}σ)`);
  return `${t.entryT} → ${t.exitT} · ${t.bars}봉 · ${legs}${out} · ${WHY_WORD[t.why]}`;
}

/** 밴드 상태 한 마디 — 측정 보드의 어휘(`MrState`)와 같은 말이다. */
function bandWord(out: number, run: number): string {
  if (out === 0) return '밴드 안';
  return `밴드 ${out > 0 ? '위' : '아래'} 밖 ${run}일째`;
}

export function StrategyWindow({
  id,
  label,
  onClose,
}: {
  id: string;
  label: string;
  onClose: () => void;
}) {
  const [knobs, setKnobs] = useState<MrStrategyParams>(MR_STRATEGY_DEFAULTS);
  const [run, setRun] = useState<MrStrategyRun>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [idx, setIdx] = useState<{ chart: 'price' | 'z' | 'eq'; i: number } | null>(null);
  /* 눌러서 편 거래 — 그 구간의 **일별 대사**를 연다 [OWNER 2026-08-27 — "개별
     거래 눌러보면 대사도 가능하게 해주고,, 원래 우리가 그렇게 해왔듯이"].
     백테스트 창의 「일별 대사」와 같은 문법이다: 하루씩 펴 놓고, 가로합이
     그날 손익이 되고, 세로합이 거래 손익이 된다. 실행할 때마다 닫는다 —
     다른 실행의 거래를 펴 놓고 있으면 그 표가 거짓이 된다. */
  const [openTrade, setOpenTrade] = useState<string | null>(null);

  /* 종목이 바뀌면 지난 실행은 딴 종목의 숫자다 — 남겨 두지 않는다. */
  useEffect(() => {
    setRun(undefined);
    setError(undefined);
  }, [id]);

  const exec = useCallback(() => {
    /* 다른 실행의 거래를 펴 놓고 있으면 그 대사가 거짓이 된다. */
    setOpenTrade(null);
    setError(undefined);
    setRunning(true);
    fetchMrStrategy(id, knobs)
      .then(setRun)
      .catch((e: unknown) => {
        if (e instanceof BacktestUnavailable) setError('실행 중인 백엔드(:8200)가 필요해요.');
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setRunning(false));
  }, [id, knobs]);

  /* pinned 규율 — 실행 시점 파라미터와 지금 노브가 갈리면 stale.
   *
   * **`warnZ` 는 여기 없다** [2026-08-26]. 그 값은 엔진에 안 들어간다
   * (`main.py::mr_strategy` 가 시뮬에 안 넘긴다 — 오실레이터 가이드선 전용).
   * 그런데도 stale 을 세우고 있었으므로, 결과를 바꾸지 못하는 노브가 결과를
   * 무효로 만들고 재실행을 요구했다. 이제 가이드선은 `knobs.warnZ` 를 바로
   * 읽고(핀 안 걸림), 성과 숫자는 그 값과 무관하다는 사실이 화면에서 참이 된다. */
  const stale = useMemo(() => {
    if (!run) return false;
    const p = run.params;
    return (
      p.lookback !== knobs.lookback ||
      p.entryZ !== knobs.entryZ ||
      p.exitZ !== knobs.exitZ ||
      p.stopZ !== knobs.stopZ ||
      p.costBp !== knobs.costBp ||
      p.notional !== knobs.notional ||
      /* 진입 규칙은 `warnZ` 와 반대다 — 이건 엔진에 들어가고 거래 목록을 바꾼다. */
      p.entryMode !== knobs.entryMode ||
      /* 실전 규칙 다섯도 전부 엔진에 들어간다. `countOpen` 은 총손익을 안 바꾸지만
         승률·거래 수를 바꾸므로 조용히 재계산하면 안 되는 것은 같다. */
      p.timeStop !== knobs.timeStop ||
      p.costModel !== knobs.costModel ||
      p.regime !== knobs.regime ||
      p.reverseExit !== knobs.reverseExit ||
      p.countOpen !== knobs.countOpen
    );
  }, [run, knobs]);

  const dates = useMemo(() => run?.points.map((p) => p.t) ?? [], [run]);

  /* 세 패널(값·z·누적)이 **같은 값-축 폭**을 쓴다 — 라벨이 `2.55`·`-1.85`·
     `+1.2억` 으로 제각각이라 그냥 두면 셋의 플롯이 서로 다른 폭이 되고, 같은
     날짜가 세 패널에서 다른 가로 자리에 선다(CLAUDE.md 「얼라인」 7). */
  const stack = useStackedScales();
  /* 봉마다의 **사건** — 마커·세로선·판독이 이 하나를 같이 읽는다
     [OWNER 2026-08-28 — "언제 진입했고 그런걸 알 수 있게"].
     종전에는 진입 순번만 있었고(세로선 하나) 그래서 화면이 「들어갔다」만
     말하고 「어떻게 나왔다」는 안 말했다 — 청산과 손절이 같은 그림이었다.
     청산 봉 재진입 금지 규약 덕에 한 봉에 사건이 둘일 수 없으므로 Map 이다. */
  const events = useMemo(() => {
    const m = new Map<number, MrEvent>();
    if (!run) return m;
    const at = new Map(dates.map((t, i) => [t, i]));
    run.trades.forEach((t, k) => {
      const key = tradeKey(t);
      const e = at.get(t.entryT);
      const x = at.get(t.exitT);
      if (e != null) m.set(e, { kind: 'entry', dir: t.dir, n: k + 1, key });
      /* 손절만 하락색으로 갈라 세운다 — 나머지 셋(청산·역신호·타임스탑)은
         「계획대로 나왔다」는 같은 종류라 같은 뮤트다. 정확한 사유는 표가 진다. */
      if (x != null)
        m.set(x, { kind: t.why === 'stop' ? 'stop' : 'exit', why: t.why,
                   dir: t.dir, n: k + 1, key });
    });
    /* 미청산 다리도 사건이다 — 표본 끝에 열려 있는 포지션이 차트에서만
       사라지면, 승률 옆의 「미청산 1건」이 어디 것인지 화면이 못 가리킨다. */
    if (run.open) {
      const e = at.get(run.open.entryT);
      if (e != null && !m.has(e))
        m.set(e, { kind: 'entry', dir: run.open.dir, n: run.trades.length + 1, key: OPEN_KEY });
    }
    return m;
  }, [run, dates]);

  const unit = (run?.unit ?? 'bp') as Unit;
  const set = (patch: Partial<MrStrategyParams>) => setKnobs((k) => ({ ...k, ...patch }));

  /* 이 계열에서 실제로 할 수 있는 거래 [OWNER 2026-08-25 — "BSS에서 숏은 없는거야,,
     현물대차매도는 안할거거든"]. 한 방향뿐이면 그 사실을 숫자 옆에서 말한다 —
     노브가 아니므로 설정 줄이 아니라 「조건」과 거래 표의 머리에 선다. */
  const only = run && run.dirs.allowed.length === 1
    ? (run.dirs.allowed[0]! > 0 ? run.dirs.plus : run.dirs.minus)
    : null;
  const dirSub = only ? `${only.legs} 한 방향이에요` : undefined;

  /* 펴 놓은 거래와 그 구간의 봉들 — 대사표의 재료. 키는 «진입-청산» 이라
     실행이 바뀌면 자연히 안 맞고, 그때는 목록으로 돌아간다. */
  const sel = run?.trades.find((t) => tradeKey(t) === openTrade) ?? null;
  const reconRows = useMemo(
    () =>
      sel && run
        ? run.points
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.t >= sel.entryT && p.t <= sel.exitT)
        : [],
    [sel, run],
  );
  const dirStat = !run ? '—' : only ? only.legs : '양방향';

  /* 켜져 있는 실전 규칙의 이름들 — 바닥 각주가 읽는다. */
  const liveOn = !run ? [] : [
    run.params.timeStop ? `타임스탑 ${run.params.timeStop}일` : null,
    run.params.regime !== 'none'
      ? `레짐필터(${MR_REGIMES.find((r) => r.v === run.params.regime)?.label})` : null,
    run.params.costModel === 'dynamic' ? '동적비용' : null,
    run.params.reverseExit ? '역신호청산' : null,
    run.params.countOpen ? '미청산 계상' : null,
  ].filter((x): x is string => x !== null);

  /* 가격 주선 색 = 구간 순변화 방향(Main 미리보기의 규칙). */
  const priceHue = useMemo(() => {
    if (!run || run.points.length < 2) return 'var(--color-fgMuted)';
    const net = run.points[run.points.length - 1]!.v - run.points[0]!.v;
    return net === 0 ? 'var(--color-fgMuted)' : net > 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  }, [run]);

  /* 주선 = 구간 방향색 + 점선 면(Main 미리보기·MR 상세 카드와 같은 문법 — 같은
     값+밴드 그림이 두 결이면 안 된다), 보조선 뮤트. **밴드가 먼저** = 아래에 깔린다.
     캔버스에는 불투명도 손잡이가 없어 색 자체를 흐리게 만든다(`palette.dim`). */
  const priceLines: TimeLine[] = !run ? [] : [
    { id: 'up', values: run.points.map((p) => p.up), color: (pa) => pa.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'lo', values: run.points.map((p) => p.lo), color: (pa) => pa.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'ma', values: run.points.map((p) => p.ma), color: (pa) => pa.dim('var(--color-fgMuted)', 70), width: 1 },
    {
      id: 'v',
      values: run.points.map((p) => p.v),
      color: (pa) => pa.resolve(priceHue),
      area: 'dots',
      format: (v: number) => fmtLevel(v, unit),
    },
  ];

  /* 사건의 **점**(오실레이터·손익 곡선)과 **세로선**(세 패널 공통).
     stale 이면 둘 다 숨는다 — 노브가 실행과 갈린 판에서 마커만 옛 자리에 남으면
     화면이 「이 설정으로 여기서 들어갔다」고 거짓말한다(원본 규율). */
  const evList = stale ? [] : [...events.entries()];
  const evMarkers: TimeMarker[] = evList.map(([i, e]) => ({
    index: i,
    /* 진입은 **방향색**(그 다리가 무엇을 사는지), 청산은 뮤트, 손절은 하락색.
       청산과 손절이 같은 점이면 「어떻게 끝났나」를 표에서만 알 수 있다. */
    color: (pa) =>
      e.kind === 'stop' ? pa.down
      : e.kind === 'exit' ? pa.fgMuted
      : e.dir === 0 ? pa.fgMuted
      : e.dir > 0 ? pa.up : pa.down,
  }));
  /* 세로선은 **진입**만 긋는다 — 거래마다 둘씩 그으면 15거래에 30줄이라 200px
     패널이 빗금이 된다. 펴 놓은 거래 하나만 청산선까지 잉크로 세운다.
     라벨도 그 하나에만 붙인다: 겹침 회피는 호출부의 몫인데(verticalLines 머리),
     열다섯 개를 다 적으면 회피할 수 없는 밀도가 된다. */
  const evLines = evList
    .filter(([, e]) => e.kind === 'entry' || e.key === openTrade)
    .map(([i, e]) => ({
      index: i,
      label: e.key === openTrade ? (e.kind === 'entry' ? '진입' : eventWord(e, false)) : undefined,
      tone: e.key === openTrade ? ('ink' as const) : ('muted' as const),
    }));

  const zLines: TimeLine[] = !run ? [] : [
    {
      id: 'z',
      values: run.points.map((p) => p.z),
      color: (pa) => pa.fg,
      format: (v: number) => `${v.toFixed(1)}σ`,
    },
  ];

  /* 0선·진입 문턱·경고 문턱. 경고는 **핀이 아니라 지금 값**이다 — 이 선은
     실행과 무관하다. */
  const zBands: ScalePriceLine[] = !run ? [] : [
    { value: 0, color: (pa) => pa.line },
    { value: run.params.entryZ, color: (pa) => pa.lineHeavy },
    { value: -run.params.entryZ, color: (pa) => pa.lineHeavy },
    { value: knobs.warnZ, color: (pa) => pa.line, dash: true },
    { value: -knobs.warnZ, color: (pa) => pa.line, dash: true },
  ];

  /* 손익 곡선은 부호가 색을 정한다 — LinkedCharts 누적 손익의 그 문법. */
  const eqHue = (run?.summary.totalPnl ?? 0) >= 0 ? 'var(--sr-up)' : 'var(--sr-down)';
  const eqLines: TimeLine[] = !run ? [] : [
    {
      id: 'cum',
      values: run.points.map((p) => p.cum),
      color: (pa) => pa.resolve(eqHue),
      area: 'solid',
      areaColor: (pa) => pa.dim(eqHue, 14),
      format: (v: number) => fmtKrw(v),
    },
  ];
  const zeroLine: ScalePriceLine[] = [{ value: 0, color: (pa) => pa.line }];

  return (
    <FloatingWindow
      windowKey="mrstrategy"
      title="전략 실험"
      width={1120}
      aside={
        <Text font="legal" as="span" color="fgMuted" noWrap>
          첫 PMS 의 z-스코어 규칙 재현이에요 — 투자판단이 아니에요.
        </Text>
      }
      onClose={onClose}
    >
      <VStack gap={1.5} paddingX={2} paddingY={1.5} width="100%">
        {/* ── 설정 줄 — 원본 노브 일곱 + 실행. 실행은 사람이 누른다.
            바닥 정렬 행: 블록 높이가 곧 라벨 높이(2026-08-19 얼라인 레인),
            한 행의 컨트롤은 전부 32px 등고(control-parity 의 그 등고)라
            실행도 알약이다(rv 「상세 분석」 자리의 그 컨트롤). */}
        {/* 묶음 안은 좁게, 묶음 사이는 넓게 — 백테스트 설정 줄과 **같은 리듬**
            이다(`theme/type.css` 의 `.sr-fgroup` 주석에 근거). 종전에는 노브
            여덟이 전부 12px 등간격이라 σ 셋이 한 가족인지 각자인지 화면이 말하지
            않았다(실측 2026-08-27). 읽히는 묶음은 넷이다 —
            [종목·룩백] · [진입σ·청산σ·손절σ] · [비용·명목] · [실행]. */}
        <HStack gap={1} alignItems="flex-end" flexWrap="wrap">
          {/* 폭은 감싸는 `Box` 가 준다 — `Field` 규약(`ui/ControlCard` 머리
              주석). 상자 없이 행에 바로 놓으면 그 칸만 자기 내용 폭이 되어
              형제와 어긋난다. 160 은 최장 계열명(「KTB10 내재금리」)이 안 잘리는
              폭이다 — 말줄임 금지. */}
          <Box width={160}>
            <Field label="종목">
              {/* 컨트롤이 아닌 값도 같은 32px 상자에 담는다 — 백테스트 「진입
                  레벨」 칸의 판례(안 담으면 이 블록만 바닥에서 어긋난다). */}
              <HStack height={CONTROL_H} alignItems="center">
                <Text font="label2" as="span" noWrap>
                  {label}
                </Text>
              </HStack>
            </Field>
          </Box>
          {/* 208 = 알약 넷(20·60·120·252) + 자유 입력 56 + 간격. 자연폭 199 에
              한 칸 여유. */}
          <Box width={208}>
            <Field label="룩백 (일)">
              <HStack gap={0.5} alignItems="center">
                {MR_STRATEGY_LOOKBACKS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="sr-pillbtn"
                    data-on={knobs.lookback === w || undefined}
                    aria-pressed={knobs.lookback === w}
                    onClick={() => set({ lookback: w })}
                  >
                    {w}
                  </button>
                ))}
                <Box width={56}>
                  <NumInput label="룩백(일)" value={knobs.lookback}
                    onCommit={(v) => set({ lookback: Math.max(2, Math.round(v)) })} />
                </Box>
              </HStack>
            </Field>
          </Box>
          {/* 진입 규칙 — σ 문턱 **앞**에 선다. 문턱은 「얼마나 벌어지면」이고
              이것은 「그때 바로 들어가는가, 돌아올 때까지 기다리는가」라서,
              읽는 순서가 곧 규칙의 순서다. `관찰 σ` 와 달리 **엔진에 들어가고**
              거래 목록을 바꾼다 — 그래서 설정 줄에 있고 stale 을 세운다.
              156 = 알약 둘(「이탈 즉시」·「밴드 복귀」)의 자연폭 + 한 칸 여유. */}
          <Choice
            group
            label="진입 규칙"
            help="이탈 즉시는 밴드를 뚫는 봉에, 밴드 복귀는 밖에 있다가 돌아오는 봉에 들어가요. 방향은 둘 다 나갔던 쪽이 정해요."
            width={156}
            value={knobs.entryMode}
            options={MR_ENTRY_MODES.map((m) => ({ v: m.v, label: m.label, help: m.help }))}
            onPick={(v) => set({ entryMode: v })}
          />
          <SigmaPick
            group
            label="진입 σ"
            help="볼린저 밴드의 통상 배수예요 — 2σ가 기본, 1.5σ는 민감하게, 2.5σ는 보수적으로 잡아요."
            value={knobs.entryZ}
            options={MR_STRATEGY_PRESETS.entryZ}
            onPick={(v) => set({ entryZ: v })}
          />
          <SigmaPick
            label="청산 σ"
            help="0은 중심선까지 완전히 되돌아올 때 청산이고, 0.5σ가 첫 PMS 기본이에요."
            value={knobs.exitZ}
            options={MR_STRATEGY_PRESETS.exitZ}
            onPick={(v) => set({ exitZ: v })}
          />
          <SigmaPick
            label="손절 σ"
            help="z가 더 벌어지면 접는 발산 손절이에요. 진입의 1.5~2배가 통상이고 3.5σ가 첫 PMS 기본이에요."
            value={knobs.stopZ}
            options={MR_STRATEGY_PRESETS.stopZ}
            onPick={(v) => set({ stopZ: v })}
          />
          {/* ── 마지막 묶음은 **제 상자에 담는다** [2026-08-28 실측] ─────────
              진입 규칙 칸이 들어오면서 줄이 넘쳐 감쌈이 생겼는데, 형제로
              늘어놓으면 감쌈이 묶음을 아무 데서나 자른다 — 실측에서 비용(x
              1409~1473)만 첫 줄에 남고 명목·실행이 둘째 줄로 갔다. 이 파일의
              머리가 «읽히는 묶음은 넷» 이라고 적어 놓고 화면은 그 묶음을
              쪼개고 있었던 셈이다. 셋을 한 상자에 담으면 **묶음째** 넘어간다.
              (묶음 사이 여백 `.sr-fgroup` 은 이제 상자가 진다.) */}
          <HStack gap={1} alignItems="flex-end" className="sr-fgroup">
          {/* 비용·명목은 **프리셋이 아니라 실제 값**이다 — 그날 그 종목의
              호가폭이고 이 데스크의 포지션 크기다(api.ts 의 근거 주석). */}
          <Box width={64}>
            <Field label="비용 (bp)" help="왕복이 아니라 편도예요. 그날 그 종목의 호가폭을 넣으세요.">
              <NumInput label="비용(bp)" value={knobs.costBp} onCommit={(v) => set({ costBp: v })} />
            </Field>
          </Box>
          <Box width={96}>
            {/* 「원」은 한글이다 [OWNER 2026-08-28 — "이게 표기가 왜 이런식으로
                되는거지?"]. 종전에는 `₩`(U+20A9)를 썼는데, 이 앱의 본문 폰트
                **Pretendard SR 의 그 글리프가 「W + 가는 가로줄 둘」**이다 —
                40px 래스터 대조에서 `₩` 와 `W` 의 차이가 202픽셀(같은 폰트의
                「원」 대 「W」는 684)이었고, 13px 다크에서는 그 두 줄이 사라져
                화면에 **「명목 (W/bp)」** 로 섰다(실측 2026-08-28). Malgun Gothic
                에서는 652픽셀로 제대로 갈린다 — 폰트가 없어서가 아니라 이 폰트의
                U+20A9 가 반각 표기라서다.
                기호를 바꾸는 대신 한글로 적는다: 이 화면의 돈은 전부 `fmtKrw`
                가 「+100만원」으로 쓰고 있어서, 「원」이 오히려 같은 어휘다. */}
            <Field label="명목 (원/bp)" help="1bp 움직일 때의 손익이에요. 포지션 크기라 프리셋이 없어요.">
              <NumInput label="명목(원/bp)" value={knobs.notional}
                onCommit={(v) => set({ notional: v })} />
            </Field>
          </Box>
          {/* 실행은 이 줄의 유일한 **액션**이라 채움 알약이다(`data-fill` —
              CSS 주석의 «액션 pill = 상시 회색 채움, Backtest secondary 의 look»).
              투명 알약으로 두면 옆의 라벨들과 같은 무게로 읽혀 눌리는 것처럼
              안 보인다(실측). */}
          <button
            type="button"
            className="sr-pillbtn sr-fgroup"
            data-fill
            disabled={running}
            onClick={exec}
          >
            {running ? '계산 중…' : '실행'}
          </button>
          </HStack>
        </HStack>

        {/* ── 실전 운용 규칙 [OWNER 2026-08-28 — "일단 민평 기준으로"] ───────────
            윗줄과 **다른 줄**에 세운다. 윗줄은 원본 PMS 재현의 노브이고 이 줄은
            그 위에 얹는 실전 규칙이라, 한 줄에 섞으면 화면이 「둘이 같은 종류」
            라고 말하는 셈이 된다. 전부 끄면 윗줄만의 수와 정확히 같다.

            기여가 균등하지 않다는 사실을 라벨의 help 가 진다 — 표본외 실측에서
            타임스탑이 단독 최대(SR 0.63→0.95)이고, 동적 비용은 유일하게 깎는
            항이며, 변동성 필터는 검증 창에서 한 건도 안 막았다. */}
        <VStack gap={0.5} width="100%">
          <Text font="legal" as="span" color="fgMuted">
            실전 운용 규칙 — 전부 끄면 위 줄만의 수예요(원본 PMS 재현).
            근거는 전진분석 리포트에 있어요.
          </Text>
          <HStack gap={1} alignItems="flex-end" flexWrap="wrap">
            <Choice
              label="타임스탑 (일)"
              help="진입 후 이 영업일이 지나면 손익 불문 청산해요. 표본외 실측에서 단독 기여가 가장 컸어요(SR 0.63→0.95)."
              width={172}
              value={knobs.timeStop}
              options={MR_TIME_STOPS.map((v) => ({ v: v as number, label: v === 0 ? '끔' : String(v) }))}
              onPick={(v) => set({ timeStop: v })}
            />
            <Choice
              group
              label="레짐 필터"
              help="진입만 막아요. 청산·손절은 필터를 안 봐요 — 나가는 문까지 조건을 달면 조건이 꺼진 동안 포지션이 갇혀요."
              width={168}
              value={knobs.regime}
              options={MR_REGIMES}
              onPick={(v) => set({ regime: v })}
            />
            <Choice
              group
              label="비용 모델"
              help="동적은 변동성 백분위에 연동해 편도 0.15~0.25bp를 물려요. 유일하게 성과를 깎는 항이에요."
              width={128}
              value={knobs.costModel}
              options={MR_COST_MODELS}
              onPick={(v) => set({ costModel: v })}
            />
            <Choice
              group
              label="역신호 청산"
              help="반대 방향 진입 신호를 나가는 문으로 써요. 그 방향으로 들어가지는 않아요(현물 대차매도 불가)."
              width={116}
              value={knobs.reverseExit}
              options={[{ v: false, label: '끔' }, { v: true, label: '켬' }]}
              onPick={(v) => set({ reverseExit: v })}
            />
            <Choice
              group
              label="미청산 계상"
              help="표본 끝의 열린 다리를 거래로 세요. 총손익·MDD는 원래부터 이걸 지고 있어서 안 바뀌고, 승률·거래 수·보유기간만 바뀌어요."
              width={132}
              value={knobs.countOpen}
              options={[{ v: false, label: '제외' }, { v: true, label: '포함' }]}
              onPick={(v) => set({ countOpen: v })}
            />
          </HStack>
        </VStack>
        {stale ? (
          /* 조용한 재계산 금지 — 원본의 stale 배너 + 마커 숨김 규율 그대로. */
          <Text font="legal" as="span" color="fgMuted">
            설정이 실행과 달라요 — 실행을 눌러야 아래 숫자에 반영돼요. 진입 마커는 숨겼어요.
          </Text>
        ) : null}
        {error ? (
          <Text font="legal" as="span">
            실행하지 못했어요 — {error}
          </Text>
        ) : null}

        {!run ? (
          <Text font="legal" as="span" color="fgMuted">
            실행을 누르면 이 종목의 과거 전체(2020~)를 원본 규칙으로 재현해요. 당일 종가
            체결 규약이라 체결 가능성은 담보하지 않아요.
          </Text>
        ) : (
          <>
            {/* ── 성과 — 원본 KPI 다섯, 부품은 이 앱의 스트립(`ui/Stat.tsx`).
                   첫 판은 같은 모양을 손으로 다시 만들었다(중복). 표기는 이 리포
                   문법(억/만), 방향색은 손익에만 — 낙폭은 늘 음수라 색이 정보를
                   더하지 않는다. */}
            <HStack className="sr-stats" alignItems="stretch" width="100%">
              <StatColumn title="성과">
                <Stat
                  label="총손익"
                  value={fmtKrw(run.summary.totalPnl)}
                  tone={
                    run.summary.totalPnl > 0 ? 'up' : run.summary.totalPnl < 0 ? 'down' : undefined
                  }
                />
                <Stat label="최대 낙폭" value={fmtKrw(-run.summary.maxDrawdown)} />
                <Stat
                  label="승률"
                  value={run.summary.winRate == null ? '—' : `${Math.round(run.summary.winRate * 100)}%`}
                  /* 분모를 여기서 말한다 [OWNER 2026-08-26]. 미청산 다리는 원본
                     규약대로 거래·승률에 안 들어가는데(총손익에는 들어간다),
                     카드가 그 사실을 안 적으면 열려 있는 손실 포지션이 승률에서
                     조용히 사라진다 — 실측 80% 는 15건 중 12건이었고 빠진 한
                     건은 표본 두 번째로 나쁜 −600만이었다. */
                  /* 분모가 무엇인지 한 줄로. 「포함」이면 그 다리가 승패를
                     이미 갈랐다는 뜻이고, 「제외」면 열린 손실이 승률에서 빠져
                     있다는 뜻이다 — 둘 다 말해야 숫자가 읽힌다. */
                  note={!run.open ? undefined
                    : run.params.countOpen ? '미청산 1건 포함' : '미청산 1건 제외'}
                />
                <Stat
                  label="Sharpe"
                  value={run.summary.sharpe == null ? '—' : run.summary.sharpe.toFixed(2)}
                  note="전 봉 기준"
                />
                <Stat label="거래" value={String(run.summary.numTrades)} />
                {run.open ? (
                  <Stat
                    label="미청산"
                    value={fmtKrw(run.open.pnl)}
                    tone={run.open.pnl > 0 ? 'up' : run.open.pnl < 0 ? 'down' : undefined}
                    note={`${run.open.entryT} 진입`}
                  />
                ) : null}
              </StatColumn>
              <StatColumn title="조건">
                {/* 비용이 봉마다 다르면 「편도 몇 bp」가 한 숫자로 안 나온다 —
                    실제로 문 범위와 중앙값을 적는다. 상수 하나로 뭉개면 화면이
                    실제로 낸 비용을 감추게 된다. */}
                <Stat
                  label="비용"
                  value={run.cost.model === 'flat'
                    ? `편도 ${run.cost.bp}bp`
                    : `편도 ${run.cost.lo}~${run.cost.hi}bp`}
                  note={run.cost.model === 'dynamic' ? `동적 · 중앙 ${run.cost.mid}bp` : undefined}
                />
                {/* 손익분기 — 노브를 돌려 0 을 찾는 대신 닫힌형으로 답한다
                    (`mrbacktest.breakeven_cost_bp`). 「이 구성이 얼마짜리
                    호가폭까지 견디는가」 는 비용 노브의 값보다 먼저 알아야 하는
                    사실이고, 그걸 모르면 비용 기본값이 곧 결론이 된다. */}
                {run.summary.breakevenCostBp != null ? (
                  <Stat
                    label="손익분기 비용"
                    value={`편도 ${run.summary.breakevenCostBp.toFixed(2)}bp`}
                    tone={run.summary.breakevenCostBp <= run.params.costBp ? 'down' : undefined}
                    note={
                      run.summary.breakevenCostBp <= run.params.costBp
                        ? '지금 비용에서 이미 손실'
                        : `여유 ${(run.summary.breakevenCostBp - run.params.costBp).toFixed(2)}bp`
                    }
                  />
                ) : run.summary.breakevenCostMult != null ? (
                  /* 동적 비용 판 — 「몇 bp」가 아니라 «이 경로의 몇 배» 다.
                     여기가 비어 있으면 비용 모델을 바꾸는 순간 손익분기가
                     화면에서 사라진다(실측 2026-08-28). */
                  <Stat
                    label="손익분기 비용"
                    value={`지금 경로의 ${run.summary.breakevenCostMult.toFixed(1)}배`}
                    tone={run.summary.breakevenCostMult <= 1 ? 'down' : undefined}
                    note={run.summary.breakevenCostMult <= 1
                      ? '지금 비용에서 이미 손실'
                      : `편도 ${(run.cost.model === 'dynamic'
                          ? run.cost.mid * run.summary.breakevenCostMult
                          : run.params.costBp * run.summary.breakevenCostMult).toFixed(2)}bp 중앙 기준`}
                  />
                ) : null}
                <Stat label="명목" value={`${run.params.notional.toLocaleString()}원/bp`} />
                <Stat label="종가" value={run.asof ?? '—'} />
                {/* 방향은 노브가 아니라 사실이라 「조건」에 선다 — 이 데스크가
                    실제로 할 수 있는 거래가 무엇인지가 성과의 전제다. */}
                <Stat label="방향" value={dirStat} />
                {run.dirs.why ? (
                  <Stat label="막힌 진입" value={`${run.dirs.blocked.spells}회`} />
                ) : null}
                {/* 필터가 지운 신호는 **따로** 센다 — 방향은 데스크의 제약이고
                    필터는 우리가 고른 것이라, 한 숫자로 합치면 선택의 대가가
                    제약 뒤에 숨는다. 필터를 켰는데 0 이면 그것도 사실이다
                    (실측: 변동성 상위 10% 는 검증 창에서 한 건도 안 막았다). */}
                {run.params.regime !== 'none' ? (
                  <Stat
                    label="필터가 지운 진입"
                    value={`${run.gated.spells}회`}
                    note={run.gated.spells === 0 ? '한 건도 안 막았어요' : `${run.gated.days}일`}
                  />
                ) : null}
              </StatColumn>
            </HStack>

            {/* 견고성은 고른 칸이 아니라 이웃과의 차이다 — 성과 숫자를 읽은
                바로 그 자리에서 말한다. */}
            <Sensitivity run={run} onPick={set} />

            {/* ── 2×2 패널 — 원본 결과 그리드의 배치. ───────────────────── */}
            <HStack gap={2} width="100%" alignItems="stretch" flexWrap="wrap">
              <Panel title="가격 · SMA · 밴드" sub={`밴드 = 평균 ±${run.params.entryZ}σ`}>
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel={`${label} 가격과 밴드`}
                    dates={dates}
                    lines={priceLines}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'price', i })}
                    {...stack}
                  />
                  {idx?.chart === 'price' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="값" v={run.points[idx.i]!.v} unit={unit} />
                      <ReadoutLevel k="중심선" v={run.points[idx.i]!.ma} unit={unit} />
                      <ReadoutLevel k="상단" v={run.points[idx.i]!.up} unit={unit} />
                      <ReadoutLevel k="하단" v={run.points[idx.i]!.lo} unit={unit} />
                      {/* 밴드에 대해 지금 어디인지 — 진입 규칙이 보는 바로 그 사실.
                          「밴드 복귀」 판에서는 이 줄이 신호의 전제다. */}
                      <ReadoutFact
                        k="상태"
                        v={bandWord(run.points[idx.i]!.out, run.points[idx.i]!.outRun)}
                      />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="z 오실레이터"
                sub={
                  stale
                    ? `진입 ±${run.params.entryZ}σ · 마커 숨김`
                    : `진입 ±${run.params.entryZ}σ · ${entryWord(run.params.entryMode)}` +
                      ` · 진입 ${entryCount(run)} · ${exitTally(run)}`
                }
                /* 관찰 σ 는 설정 줄에서 여기로 내려왔다 [OWNER 2026-08-26]. 이
                   값은 엔진에 안 들어가고 이 패널의 가이드선만 옮긴다 — 성과
                   숫자를 못 바꾸는 노브가 성과 카드 옆에 서 있으면 화면이
                   «이것도 결과를 바꾼다» 고 거짓말한다. 노브의 자리가 곧 그
                   노브가 무엇인지에 대한 주장이다. */
                aside={
                  <InlineSigma
                    label="관찰"
                    value={knobs.warnZ}
                    options={MR_STRATEGY_PRESETS.warnZ}
                    onPick={(v) => set({ warnZ: v })}
                  />
                }
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel={`${label} z-스코어`}
                    dates={dates}
                    lines={zLines}
                    priceLines={zBands}
                    markers={evMarkers}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'z', i })}
                    {...stack}
                  />
                  {idx?.chart === 'z' && run.points[idx.i] ? (
                    /* 종전에는 z 한 줄뿐이었다 — 「이 봉에 무슨 일이 있었나」를
                       차트가 말하지 못해 거래 표와 눈으로 대조해야 했다. */
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="z" v={run.points[idx.i]!.z} unit={'ratio' as Unit} />
                      <ReadoutFact
                        k="상태"
                        v={bandWord(run.points[idx.i]!.out, run.points[idx.i]!.outRun)}
                      />
                      <ReadoutFact k="포지션" v={posWord(run, idx.i)} />
                      <ReadoutMoney k="그날" v={run.points[idx.i]!.pnl} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>
            </HStack>

            <HStack gap={2} width="100%" alignItems="stretch" flexWrap="wrap">
              <Panel
                title="누적 손익"
                sub={`${run.summary.numTrades} 거래 · 순 ${fmtKrw(run.summary.totalPnl)}`}
              >
                <Box
                  className="sr-plot"
                  width="100%"
                  onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => placeReadout(e.currentTarget, e.clientX)}
                  onMouseLeave={() => setIdx(null)}
                >
                  <TimeChart
                    height={CHART_H}
                    accessibilityLabel={`${label} 누적 손익`}
                    dates={dates}
                    lines={eqLines}
                    priceLines={zeroLine}
                    markers={evMarkers}
                    markLines={evLines}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'eq', i })}
                    {...stack}
                  />
                  {idx?.chart === 'eq' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutMoney k="누적" v={run.points[idx.i]!.cum} />
                      <ReadoutMoney k="그날" v={run.points[idx.i]!.pnl} />
                      <ReadoutFact k="포지션" v={posWord(run, idx.i)} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              {/* 거래 하나의 **일별 대사** — 백테스트 창의 그 문법이다.

                  ── 2026-08-28 다시 세움 [OWNER — "대사가 너무 허술하게"] ──
                  종전 표는 평가·캐리·비용·그날 넉 줄이었다. 가로합은 닫혔지만
                  **평가가 어디서 왔는지**를 표가 말하지 않았다 — 그래서 그
                  숫자가 옳은지 아닌지 화면만 보고는 알 수 없었다. 백테스트
                  대사표가 「전일 KRD × Δbp = 추정」을 한 줄 안에 두는 이유가
                  정확히 그것이다(`ui/window/ReconStack.tsx` 머리).

                  여기의 그 곱셈은 **감도 × Δ = 평가** 다. 감도는 그 봉을
                  통과해서 들고 있던 포지션 × 명목(`hold` — 봉이 끝난 뒤의
                  포지션이 아니다: 진입 봉은 0, 청산 봉은 ±1). 그 열을 세우자
                  선물 계열의 단위 오류가 **첫 줄에서** 드러났다(Δ 0.157 을
                  ₩/bp 명목에 곱하고 있었다 — 서버 주석에 경위).

                  가로합 = 그날 · 세로합 = 거래 손익. 「누적」 열이 세로합을
                  줄마다 적으므로 마지막 줄이 합계 줄과 같아야 하고, 표는
                  «맞다» 고 주장하는 대신 **맞는지 보인다**. */}
              <Panel
                title={sel ? '일별 대사' : '거래'}
                sub={sel ? reconSub(sel, run) : run.trades.length === 0 ? '이 창에 거래가 없어요' : dirSub}
                aside={sel ? (
                  <button type="button" className="sr-pillbtn" onClick={() => setOpenTrade(null)}>
                    거래 목록
                  </button>
                ) : undefined}
              >
                {sel ? (
                  <Box style={{ position: 'relative', height: CHART_H, overflow: 'auto' }} width="100%">
                    <Table bordered={false}>
                      <TableHeader sticky>
                        <TableRow>
                          <TableCell as="th" scope="col">
                            <Text font="caption" as="span" color="fgMuted">날짜</Text>
                          </TableCell>
                          <TableCell as="th" scope="col">
                            <Text font="caption" as="span" color="fgMuted">구분</Text>
                          </TableCell>
                          {RECON_COLS.map((c) => (
                            <TableCell key={c.k} as="th" scope="col" className="sr-num" justifyContent="flex-end">
                              {/* `caption` 이 아니라 `legal` 이다 — CDS 기본 테마의
                                  `textTransform.caption = 'uppercase'` 가 「z」를 「Z」로,
                                  「bp」를 「BP」로 만든다(실측 2026-08-28). 둘은 크기가
                                  같고(0.8125rem) 중량·대문자화만 다르므로, **기호와
                                  단위가 든 머리**는 `legal` 이 맞다 — `rv/SectorLane`
                                  이 같은 근거로 정한 판례다. 이 표는 단위가 곧 검산의
                                  전제라(감도 ₩/bp × Δbp) 대문자 BP 는 오식이다. */}
                              <Text font="legal" as="span" color="fgMuted" noWrap>{c.k}</Text>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconRows.map(({ p, i }) => (
                          <TableRow key={p.t}>
                            <TableCell>
                              <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text>
                            </TableCell>
                            <TableCell>
                              <Text font="label2" as="span" color="fgMuted" noWrap>
                                {eventWord(events.get(i), p.hold !== 0)}
                              </Text>
                            </TableCell>
                            <ReconNum v={p.z} kind="sigma" />
                            <ReconNum v={p.dv} kind="bp" />
                            {/* 감도 — 이 줄의 곱셈이 곱한 바로 그 수. 무포지션
                                봉(진입일)은 0 이라 평가도 0 이다. */}
                            <ReconNum v={p.hold * run.params.notional} kind="won" />
                            <ReconNum v={p.mtm} kind="won" />
                            <ReconNum v={p.carry} kind="won" />
                            <ReconNum v={p.cost} kind="won" />
                            <ReconNum v={p.pnl} kind="won" tone />
                            <ReconNum v={p.tradePnl} kind="won" tone />
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell>
                            <Text font="label1" as="span" noWrap>합계</Text>
                          </TableCell>
                          <TableCell>
                            <Text font="label1" as="span" color="fgMuted" noWrap>{sel.bars}봉</Text>
                          </TableCell>
                          {/* z 는 더할 수 있는 양이 아니다 — 진입 → 청산으로 적는다. */}
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label1" as="span" tabularNumbers noWrap>
                              {`${sel.entryZ.toFixed(2)}→${sel.exitZ.toFixed(2)}`}
                            </Text>
                          </TableCell>
                          <ReconNum v={sel.dv} kind="bp" head />
                          <ReconNum v={null} kind="won" head />
                          <ReconNum v={sel.mtm} kind="won" head />
                          <ReconNum v={sel.carry} kind="won" head />
                          <ReconNum v={sel.cost} kind="won" head />
                          <ReconNum v={sel.pnl} kind="won" tone head />
                          <ReconNum v={sel.pnl} kind="won" tone head />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Box>
                ) : (
                /* 표는 Main/Backtest 방언 — CDS Table, 숫자는 label2 tabular
                   우측, 손익만 방향색 글자 [OWNER 2026-08-25 «기준을 Backtest 에»]. */
                <Box style={{ position: 'relative', height: CHART_H, overflow: 'auto' }} width="100%">
                  <Table bordered={false}>
                    {/* 거래가 수십 줄이라 머리가 따라와야 한다(Main 규칙). */}
                    <TableHeader sticky>
                      <TableRow>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">진입</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">청산</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">방향</Text>
                        </TableCell>
                        {/* 이탈 구간은 **「밴드 복귀」 판에서만** 열이 선다.
                            「이탈 즉시」 판에서는 진입 봉이 곧 이탈 첫 봉이라
                            최대 z 가 진입 z 와 같은 수다 — 같은 수를 두 열에
                            적으면 표가 없는 정보를 있는 척한다. */}
                        {run.params.entryMode === 'touch' ? (
                          <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                            <Text font="legal" as="span" color="fgMuted" noWrap>이탈 최대</Text>
                          </TableCell>
                        ) : null}
                        {/* z 는 소문자다 — `caption` 은 대문자로 세운다(위 판례). */}
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="legal" as="span" color="fgMuted">진입 z</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="legal" as="span" color="fgMuted">청산 z</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="caption" as="span" color="fgMuted">손익</Text>
                        </TableCell>
                        <TableCell as="th" scope="col">
                          <Text font="caption" as="span" color="fgMuted">사유</Text>
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.trades.map((t) => (
                        /* 줄을 누르면 그 거래의 일별 대사가 열린다 — rv 랭킹 표의
                           그 문법(«줄을 누르면 이력이 열려요»)이다. */
                        <TableRow
                          key={tradeKey(t)}
                          onClick={() => setOpenTrade(tradeKey(t))}
                          style={{ cursor: 'pointer' }}>
                          <TableCell>
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.entryT}</Text>
                          </TableCell>
                          <TableCell>
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.exitT}</Text>
                          </TableCell>
                          <TableCell>
                            {/* 「롱/숏」이 아니라 **다리를 적는다** — BSS 에서 스프레드
                                롱은 국고 매도라 부호말은 정확히 반대로 읽힌다(북의
                                `directionLabel` 이 플라이에서 내린 그 판단). 이름은
                                서버가 계열마다 짓는다(§16). */}
                            <Text font="label2" as="span" noWrap>
                              {(t.dir > 0 ? run.dirs.plus : run.dirs.minus).short}
                            </Text>
                          </TableCell>
                          {run.params.entryMode === 'touch' ? (
                            <TableCell className="sr-num" justifyContent="flex-end">
                              <Text font="label2" as="span" tabularNumbers noWrap>
                                {t.peakZ == null ? '—' : `${t.peakZ.toFixed(2)}σ`}
                                {t.outDays == null ? '' : ` · ${t.outDays}일`}
                              </Text>
                            </TableCell>
                          ) : null}
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.entryZ.toFixed(2)}σ</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text font="label2" as="span" tabularNumbers noWrap>{t.exitZ.toFixed(2)}σ</Text>
                          </TableCell>
                          <TableCell className="sr-num" justifyContent="flex-end">
                            <Text
                              font="label2"
                              as="span"
                              tabularNumbers
                              noWrap
                              className={t.pnl > 0 ? 'sr-up' : t.pnl < 0 ? 'sr-down' : undefined}
                            >
                              {fmtKrw(t.pnl)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <Text font="label2" as="span" color="fgMuted" noWrap>
                              {WHY_WORD[t.why]}
                            </Text>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                )}
              </Panel>
            </HStack>

            <Text font="legal" as="span" color="fgMuted">
              {fmtLevel(run.points.at(-1)?.v ?? null, unit)}
              {unitSuffix(unit)} 기준 ·{' '}
              {run.params.entryMode === 'touch'
                ? '밖에 있다가 밴드 선으로 돌아오는 봉에 들어가요 — 방향은 나갔던 쪽이 정해요.'
                : '|z|가 진입σ를 넘는 봉에 들어가요 — 밴드를 뚫는 그 봉이에요.'}{' '}
              거래 줄을 누르면 일별 대사가 열려요(감도 × Δ = 평가 · 가로합 = 그날 ·
              세로합 = 거래 손익). 표본 끝의 미청산 포지션은 누적에는 있고 거래 수에는
              없어요(원본 규약).
              {run.dirs.why
                ? ` ${run.dirs.why} 그래서 못 들어간 진입 신호가 ${run.dirs.blocked.spells}회(${run.dirs.blocked.days}일) 있어요.`
                : ''}
              {/* 캐리가 무엇인지 화면이 말한다 — 부호 기준이 한 방향이라 정의가
                  없으면 읽는 사람이 자기 방향으로 읽는다. 원본 PMS 산술에는 이
                  항이 없었다는 사실도 같이 적는다(재현 도구의 명구 의무). */}
              {run.carry.on && run.carry.defn
                ? ` 캐리는 ${run.carry.defn}이고 조달은 ${run.carry.funding} 이에요 — 원본 PMS 산술에는 없던 항이에요.`
                : ''}
              {/* 실전 규칙이 켜져 있으면 화면이 그것을 말한다 — 안 적으면 같은
                  종목의 두 숫자가 왜 다른지 화면만 보고는 알 수 없다. */}
              {liveOn.length
                ? ` 실전 규칙 ${liveOn.join(' · ')}이 켜져 있어요 — 끄면 원본 PMS 재현 그대로예요.`
                : ''}
              {' '}국고 다리는 민평(평가사 고시) 기준이에요 — 체결가로 재면 성과가 낮아질 수 있어요.
            </Text>
          </>
        )}
      </VStack>
    </FloatingWindow>
  );
}
