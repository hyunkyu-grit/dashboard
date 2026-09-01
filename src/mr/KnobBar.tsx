'use client';

/* 전략 노브 한 벌 — 낱개 창(`StrategyWindow`)과 통합 장부 창(`BookWindow`)이
 * **같은 것**을 쓴다 [OWNER 2026-09-01, 통합 밴드 워치].
 *
 * 갈라 낸 이유는 CLAUDE.md 얼라인 8(«같은 것은 한 번만 만든다»)이다. 두 창이
 * 노브를 따로 그리면 프리셋 하나만 바뀌어도 화면이 둘로 갈리고, 그때 「낱개로는
 * 벌고 통합으로는 잃는다」가 규칙 탓인지 노브 탓인지 읽는 사람이 구분할 수
 * 없다. 서버도 같은 자리를 하나로 두었다(`main._mr_leg` — 준비·시뮬 한 벌).
 *
 * 여기 있는 것은 **모양뿐**이다. 값의 뜻·근거·기본값은 전부 `api.ts` 의 상수가
 * 지고(그 파일 주석에 출처), 산술은 서버가 진다(§16).
 *
 * 「종목」 칸만 창마다 다르다 — `lead` 로 받는다(낱개는 계열명, 통합은
 * 「BSS 통합」과 만기 수).
 */

import { useState } from 'react';

import { TextInput } from '@coinbase/cds-web/controls';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import { Field } from '@/ui/ControlCard';
import { CONTROL_H } from '@/ui/controlHeight';

import {
  MR_COST_MODELS,
  MR_COST_PRESETS,
  MR_ENTRY_MODES,
  MR_REGIMES,
  MR_STRATEGY_LOOKBACKS,
  MR_STRATEGY_PRESETS,
  MR_TIME_STOPS,
  fmtSigma,
  type MrStrategyParams,
} from './api';

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


/** 실행과 노브가 갈렸는가 — **조용한 재계산 금지**의 판정.
 *
 * `warnZ` 는 **여기 없다** [2026-08-26]. 그 값은 엔진에 안 들어가고(오실레이터
 * 가이드선 전용) 결과를 못 바꾼다 — 그런데도 stale 을 세우면 결과를 못 바꾸는
 * 노브가 결과를 무효로 만들고 재실행을 요구하게 된다.
 *
 * 두 창이 같은 판정을 쓴다: 낱개와 통합이 다른 조건으로 stale 을 세우면 같은
 * 노브를 돌렸을 때 한 창만 낡은 숫자를 그대로 들고 있게 된다.
 */
export function mrKnobsStale(p: MrStrategyParams, k: MrStrategyParams): boolean {
  return (
    p.lookback !== k.lookback ||
    p.entryZ !== k.entryZ ||
    p.exitZ !== k.exitZ ||
    p.stopZ !== k.stopZ ||
    p.costBp !== k.costBp ||
    p.notional !== k.notional ||
    /* 진입 규칙은 `warnZ` 와 반대다 — 이건 엔진에 들어가고 거래 목록을 바꾼다. */
    p.entryMode !== k.entryMode ||
    /* 실전 규칙 다섯도 전부 엔진에 들어간다. `countOpen` 은 총손익을 안 바꾸지만
       승률·거래 수를 바꾸므로 조용히 재계산하면 안 되는 것은 같다. */
    p.timeStop !== k.timeStop ||
    p.costModel !== k.costModel ||
    p.regime !== k.regime ||
    p.reverseExit !== k.reverseExit ||
    p.countOpen !== k.countOpen
  );
}

/** 설정 줄 두 개 + 실행 — 원본 PMS 노브 줄과 그 위에 얹는 실전 규칙 줄. */
export function MrKnobBar({
  lead,
  leadLabel = '종목',
  knobs,
  onChange,
  onRun,
  running,
}: {
  /** 「종목」 칸에 설 값. 낱개는 계열명, 통합은 「BSS 통합」이다. */
  lead: string;
  leadLabel?: string;
  knobs: MrStrategyParams;
  onChange: (patch: Partial<MrStrategyParams>) => void;
  onRun: () => void;
  running: boolean;
}) {
  const set = onChange;
  return (
    <>
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
            폭이다 — 말줄임 금지. 통합 장부의 「BSS 통합 · 9만기」도 들어간다. */}
        <Box width={160}>
          <Field label={leadLabel}>
            {/* 컨트롤이 아닌 값도 같은 32px 상자에 담는다 — 백테스트 「진입
                레벨」 칸의 판례(안 담으면 이 블록만 바닥에서 어긋난다). */}
            <HStack height={CONTROL_H} alignItems="center">
              <Text font="label2" as="span" noWrap>
                {lead}
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
        {/* 비용에 프리셋이 생겼다 [OWNER 2026-08-28]. 종전에는 「근거 없는
            값을 늘어놓지 않는다」는 이유로 자유 입력만 뒀는데, 그 사이에 근거가
            생겼다 — 국고3Y·IRS3Y 패키지 실제 편도가 ≤0.5bp 라는 오너 답이다.
            **기본이 0.5 다.** 0.05 는 첫 PMS 의 값이지 이 데스크의 호가폭이
            아니고, 싸게 잡은 비용은 결론을 통째로 뒤집는다. 자유 입력은 남긴다 —
            그날 그 종목의 호가폭이 셋 중 어느 것도 아닐 수 있다.
            196 = 알약 셋 + 자유 입력 56 + 간격. */}
        <Box width={196}>
          <Field
            label="비용 (bp)"
            help="왕복이 아니라 편도예요. 0.5는 오너 실측(국고3Y·IRS3Y 패키지)이고 0.05는 첫 PMS 값이에요."
          >
            <HStack gap={0.5} alignItems="center">
              {MR_COST_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="sr-pillbtn"
                  data-on={knobs.costBp === v || undefined}
                  aria-pressed={knobs.costBp === v}
                  aria-label={`비용 편도 ${v}bp`}
                  onClick={() => set({ costBp: v })}
                >
                  {v}
                </button>
              ))}
              <Box width={56}>
                <NumInput label="비용(bp)" value={knobs.costBp} onCommit={(v) => set({ costBp: v })} />
              </Box>
            </HStack>
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
          onClick={onRun}
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
    </>
  );
}
