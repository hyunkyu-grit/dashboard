'use client';

/* 전략 실험 창 — 첫 PMS(krw-fi-pms) entry-signals 워크스페이스의 기술적 구성을
 * v2 문법으로 재현한 것 [OWNER 2026-08-25 — "맨처음 만들었던 PMS 에서 볼린저
 * 밴드 활용한 트레이딩 전략 했던 창 참고해서 기술적 구성 구현하기"].
 *
 * ── 원본에서 가져온 것 ──────────────────────────────────────────────────────
 * · 노브 일곱(룩백 프리셋 20/60/120 + 자유값·진입σ·관찰σ·청산σ·손절σ·비용bp·
 *   명목 ₩/bp)과 그 기본값(s16) — 밴드 배수가 곧 진입σ라는 «노브 하나, 뜻 둘»
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

import { TimeChart, useStackedScales, type TimeLine } from '@/chart/TimeChart';
import type { ScalePriceLine } from '@/chart/ScaleChart';
import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';
import { Field } from '@/ui/ControlCard';
import { CONTROL_H } from '@/ui/controlHeight';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { ReadoutCard, ReadoutLevel, ReadoutMoney, placeReadout } from '@/ui/ReadoutCard';
import { Stat, StatColumn } from '@/ui/Stat';

import {
  MR_STRATEGY_DEFAULTS,
  MR_STRATEGY_LOOKBACKS,
  MR_STRATEGY_PRESETS,
  fetchMrStrategy,
  fmtSigma,
  type MrStrategyParams,
  type MrStrategyRun,
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
        <Text font="legal" as="span" color="fgMuted">
          노브 하나만 옮기고 나머지는 지금 값 고정 · 누르면 그 값으로 바뀌어요(숫자는 실행해야 바뀌어요)
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
      p.notional !== knobs.notional
    );
  }, [run, knobs]);

  const dates = useMemo(() => run?.points.map((p) => p.t) ?? [], [run]);

  /* 세 패널(값·z·누적)이 **같은 값-축 폭**을 쓴다 — 라벨이 `2.55`·`-1.85`·
     `+1.2억` 으로 제각각이라 그냥 두면 셋의 플롯이 서로 다른 폭이 되고, 같은
     날짜가 세 패널에서 다른 가로 자리에 선다(CLAUDE.md 「얼라인」 7). */
  const stack = useStackedScales();
  const entryIdx = useMemo(() => {
    if (!run) return [];
    const at = new Map(dates.map((t, i) => [t, i]));
    return run.trades
      .map((t) => ({ i: at.get(t.entryT) ?? -1, dir: t.dir }))
      .filter((m) => m.i >= 0);
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
  const sel = run?.trades.find((t) => `${t.entryT}-${t.exitT}` === openTrade) ?? null;
  const reconRows = useMemo(
    () => (sel && run ? run.points.filter((p) => p.t >= sel.entryT && p.t <= sel.exitT) : []),
    [sel, run],
  );
  const dirStat = !run ? '—' : only ? only.legs : '양방향';

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
          {/* 비용·명목은 **프리셋이 아니라 실제 값**이다 — 그날 그 종목의
              호가폭이고 이 데스크의 포지션 크기다(api.ts 의 근거 주석). */}
          <Box width={64} className="sr-fgroup">
            <Field label="비용 (bp)" help="왕복이 아니라 편도예요. 그날 그 종목의 호가폭을 넣으세요.">
              <NumInput label="비용(bp)" value={knobs.costBp} onCommit={(v) => set({ costBp: v })} />
            </Field>
          </Box>
          <Box width={96}>
            <Field label="명목 (₩/bp)" help="1bp 움직일 때의 손익이에요. 포지션 크기라 프리셋이 없어요.">
              <NumInput label="명목(₩/bp)" value={knobs.notional}
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
                  note={run.open ? '미청산 1건 제외' : undefined}
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
                <Stat label="비용" value={`편도 ${run.params.costBp}bp`} />
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
                ) : null}
                <Stat label="명목" value={`₩${run.params.notional.toLocaleString()}/bp`} />
                <Stat label="종가" value={run.asof ?? '—'} />
                {/* 방향은 노브가 아니라 사실이라 「조건」에 선다 — 이 데스크가
                    실제로 할 수 있는 거래가 무엇인지가 성과의 전제다. */}
                <Stat label="방향" value={dirStat} />
                {run.dirs.why ? (
                  <Stat label="막힌 진입" value={`${run.dirs.blocked.spells}회`} />
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
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'price', i })}
                    {...stack}
                  />
                  {idx?.chart === 'price' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="값" v={run.points[idx.i]!.v} unit={unit} />
                      <ReadoutLevel k="중심선" v={run.points[idx.i]!.ma} unit={unit} />
                      <ReadoutLevel k="상단" v={run.points[idx.i]!.up} unit={unit} />
                      <ReadoutLevel k="하단" v={run.points[idx.i]!.lo} unit={unit} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              <Panel
                title="z 오실레이터"
                sub={`진입 ±${run.params.entryZ}σ · 진입 마커 ${stale ? '숨김' : `${entryIdx.length}`}`}
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
                    markLines={stale ? [] : entryIdx.map((m) => ({ index: m.i }))}
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'z', i })}
                    {...stack}
                  />
                  {idx?.chart === 'z' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutLevel k="z" v={run.points[idx.i]!.z} unit={'ratio' as Unit} />
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
                    onHoverIndex={(i) => setIdx(i == null ? null : { chart: 'eq', i })}
                    {...stack}
                  />
                  {idx?.chart === 'eq' && run.points[idx.i] ? (
                    <ReadoutCard title={run.points[idx.i]!.t}>
                      <ReadoutMoney k="누적" v={run.points[idx.i]!.cum} />
                    </ReadoutCard>
                  ) : null}
                </Box>
              </Panel>

              {/* 거래 하나의 **일별 대사** — 백테스트 창의 그 문법이다.
                  가로합이 그날 손익이고 세로합이 거래 손익이다. 바닥 줄이 그
                  항등을 그대로 적는다 — 대사표는 «맞다» 고 주장하는 것이 아니라
                  **맞는지 보이는** 표다. */}
              <Panel
                title={sel ? '일별 대사' : '거래'}
                sub={sel
                  ? `${sel.entryT} → ${sel.exitT} · ${sel.bars}봉 · ${(sel.dir > 0 ? run.dirs.plus : run.dirs.minus).legs}`
                  : run.trades.length === 0 ? '이 창에 거래가 없어요' : dirSub}
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
                          {(['평가', '캐리', '비용', '그날'] as const).map((h) => (
                            <TableCell key={h} as="th" scope="col" className="sr-num" justifyContent="flex-end">
                              <Text font="caption" as="span" color="fgMuted">{h}</Text>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconRows.map((p) => (
                          <TableRow key={p.t}>
                            <TableCell>
                              <Text font="label2" as="span" tabularNumbers noWrap>{p.t}</Text>
                            </TableCell>
                            {([p.mtm, p.carry, p.cost, p.pnl] as const).map((v, k) => (
                              <TableCell key={k} className="sr-num" justifyContent="flex-end">
                                <Text
                                  font="label2"
                                  as="span"
                                  tabularNumbers
                                  noWrap
                                  color={v === 0 ? 'fgMuted' : undefined}
                                  className={k === 3 && v !== 0 ? (v > 0 ? 'sr-up' : 'sr-down') : undefined}
                                >
                                  {v === 0 ? '—' : fmtKrw(v)}
                                </Text>
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell>
                            <Text font="label1" as="span" noWrap>합계</Text>
                          </TableCell>
                          {([sel.mtm, sel.carry, sel.cost, sel.pnl] as const).map((v, k) => (
                            <TableCell key={k} className="sr-num" justifyContent="flex-end">
                              <Text
                                font="label1"
                                as="span"
                                tabularNumbers
                                noWrap
                                className={k === 3 && v !== 0 ? (v > 0 ? 'sr-up' : 'sr-down') : undefined}
                              >
                                {fmtKrw(v)}
                              </Text>
                            </TableCell>
                          ))}
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
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="caption" as="span" color="fgMuted">진입 z</Text>
                        </TableCell>
                        <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                          <Text font="caption" as="span" color="fgMuted">청산 z</Text>
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
                          key={`${t.entryT}-${t.exitT}`}
                          onClick={() => setOpenTrade(`${t.entryT}-${t.exitT}`)}
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
                              {t.why === 'stop' ? '손절' : '청산'}
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
              {unitSuffix(unit)} 기준 · 표본 끝의 미청산 포지션은 누적에는 있고 거래 수에는
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
            </Text>
          </>
        )}
      </VStack>
    </FloatingWindow>
  );
}
