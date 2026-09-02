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

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

import { Field, NumField, Segmented } from '@/ui/ControlCard';
import { CONTROL_H } from '@/ui/controlHeight';

import {
  MR_COST_PRESETS,
  MR_ENTRY_MODES,
  MR_STRATEGY_LOOKBACKS,
  MR_STRATEGY_PRESETS,
  fmtSigma,
  type MrStrategyParams,
} from './api';

/* σ 칸의 공통 폭 상수(`SIGMA_W`)는 은퇴했다 [OWNER 2026-09-02 — "칸안에서 빈
 * 부분 축약"]. 셋의 자연폭이 127.4·116.3·118.8 로 달라 공통 폭은 필연적으로
 * 죽은 폭을 낳았다 — 이제 칸마다 제 폭이고 그 수는 호출부에 실측과 함께 있다. */

/* 배타 선택이던 손 알약 `Choice` 는 없다 [OWNER 2026-09-02 — "디자인 구성을
 * Main·Backtest 와 통일"]. 앱의 배타 선택 정본은 `ui/ControlCard` 의
 * `Segmented`(CDS SegmentedTabs + CONTROL_H + .sr-ctlfont)이고, Backtest 방향
 * 칸이 그것을 쓴다(`backtest/BacktestWindow.tsx` 방향 세그먼트). 진입 규칙과
 * 진입 규칙 **한 칸**이 그리로 갔다(실전 규칙 다섯 칸도 세그먼트였으나
 * 2026-09-02 에 화면에서 내렸다 — 아래 그 자리 주석). 값이 숫자·불리언인 칸은
 * Backtest 방향 칸의 판례대로 `String()` 으로 오간다.
 *
 * `SigmaPick` 은 남는다: σ 전용(숫자 포맷 · **폭은 호출부가 실측으로 준다** —
 * `SIGMA_W` 공통 폭은 2026-09-02 에 은퇴했다)이고, **프리셋 밖의
 * 값이면 무선택**으로 서야 한다는 자기 근거가 있다(아래 주석). 룩백·비용의
 * 알약 줄도 남는다 — 자유 입력 칸과 한 줄에 서는 «프리셋 + 자유값» 이지
 * 배타 선택이 아니다(값이 프리셋 밖이면 아무 알약도 안 눌린다). */

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
  width,
}: {
  label: string;
  help: string;
  value: number;
  options: readonly number[];
  onPick: (v: number) => void;
  /** 이 칸의 폭 — **알약 셋의 실측 잉크**다(호출부가 준다). */
  width: number;
}) {
  /* 종전에는 셋이 `SIGMA_W` 하나를 공유했다. 「같은 성격 칸은 같은 폭」이라는
     규율이었는데, 알약 라벨의 자릿수가 「1.5」와 「0」으로 달라 자연폭이
     127.4·116.3·118.8 로 갈리고 그 차가 그대로 **죽은 폭**(11.7·9.2)이 됐다.
     [OWNER 2026-09-02 — "칸안에서 빈 부분 축약해서 깔끔하게"]로 칸마다 제
     내용 폭을 준다 — 상자를 두르는 것 자체는 형제 화면의 규약 그대로다
     (`<Box width={N}><Field>` — 백테스트·시뮬). */
  return (
    <Box width={width}>
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

/* 숫자 칸이던 `NumInput` 은 공용 `NumField`(`ui/ControlCard`)가 됐다
 * [OWNER 2026-09-02 — "공용 부품은 한 벌로 승격"] — 같은 blur/Enter 커밋
 * 기계가 시뮬·rv 에 두 벌 더 있었다. 여기 있던 «음수 거부»(n >= 0)는 공용의
 * `min={0}` 이 지고, 폭은 호출부의 `<Box width={64}>` 이 진다(그 폭의 산술은
 * 각 호출부 주석에 — 56 이던 시절 자기 화면의 프리셋이 안 들어갔다).
 * 라벨은 Field 가 진다 — NumField 의 label 은 접근성 이름이다. */


/** 실행과 노브가 갈렸는가 — **조용한 재계산 금지**의 판정.
 *
 * **여기 서는 것은 엔진에 들어가는 값뿐이다.** 결과를 못 바꾸는 값이 stale 을
 * 세우면 그 노브가 결과를 무효로 만들고 재실행을 요구하게 된다. 2026-08-26 에
 * 「관찰 σ」(`warnZ`)를 이 판정에서 뺐고, 2026-09-02 에 그 값 자체를 화면에서
 * 내렸다(`api.ts` 프리셋 주석에 근거) — 결과를 못 바꾸는 노브의 종착지다.
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
    /* 진입 규칙은 엔진에 들어가고 거래 목록을 바꾼다 — 그래서 여기 선다. */
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

/** 설정 줄 **하나** + 실행 — 원본 PMS 노브 줄이다. 그 위에 얹던 실전 규칙 줄은
 * 2026-09-02 에 화면에서 내렸다(아래 그 자리 주석). */
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
    /* 감싸는 `VStack` 은 **줄이 둘이던 시절의 seam** 이었다(두 줄 사이를 창
       몸통의 gap 16 이 아니라 부품이 6 으로 지게 한 것). 실전 규칙 줄을 내린
       지금은 자식이 하나뿐이라 gap 이 아무 일도 안 하지만, 상자는 남긴다 —
       줄을 되살리면 seam 도 같이 살아야 하고, 그때 이 주석이 그 값을 지킨다. */
    <VStack gap={1} width="100%">
      {/* ── 설정 줄 — 원본 노브 일곱 + 실행. 실행은 사람이 누른다.
          바닥 정렬 행: 블록 높이가 곧 라벨 높이(2026-08-19 얼라인 레인),
          한 행의 컨트롤은 전부 32px 등고(control-parity 의 그 등고)라
          실행도 알약이다(rv 「상세 분석」 자리의 그 컨트롤). */}
      {/* **칸 사이는 어디서나 12px 한 값이다** [OWNER 2026-09-02 — "가로 근접성
          리듬 폐기하고 그냥 동간격으로 배치하기"]. 종전에는 묶음 안 6 · 묶음
          사이 24(`.sr-fgroup`)로 덩어리를 만들었는데, 그 문법이 앱에서 은퇴했다
          (그 클래스 자리의 주석에 근거). 무엇이 한 가족인지는 이제 **라벨**이
          말한다 — 간격은 균일하고, 대신 칸마다 죽은 폭을 0 으로 조인다. */}
      <HStack gap={1.5} alignItems="flex-end" flexWrap="wrap">
        {/* 폭은 감싸는 `Box` 가 준다 — `Field` 규약(`ui/ControlCard` 머리
            주석). 상자 없이 행에 바로 놓으면 그 칸만 자기 내용 폭이 되어
            형제와 어긋난다. **96 = 최장 계열명 「KTB10 내재금리」 92.31px
            (Pretendard 14px/400 어드밴스 합, 실측 2026-09-02) + 여유 4** — 값이
            바뀌어도 뒤 칸이 안 밀리게 최장값으로 잡는다(말줄임 금지). 통합 장부가
            넘기는 실제 문자열은 「BSS 만기 9개」 77.59px 이라 함께 들어간다
            (종전 주석은 코드에 없는 「BSS 통합 · 9만기」를 인용하고 있었다).
            ⚠ 종전 160 은 죽은 폭이 67.7~107.5px 라 이 줄 첫 빈틈이 73.7px 로
            벌어졌다 — 묶음 안(6)이 묶음 사이(24)보다 넓어 근접성이 뒤집혔다. */}
        <Box width={96}>
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
        {/* 208 = 알약 **셋**(20·60·120) + 간격 + 자유 입력 64 = 실측 잉크 207 에
            한 칸 여유. ⚠ 종전 주석은 「알약 **넷**(20·60·120·252)」이라고 적었는데
            이 줄이 그리는 프리셋은 `MR_STRATEGY_LOOKBACKS` **셋**이다 — 넷짜리
            목록은 보드의 `MR_WINDOWS` 다(2026-09-02 감사가 잡았다: 폭은 맞고
            근거 문장만 틀렸었다). */}
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
              {/* 64 — 비용 칸과 같은 성격이라 같은 폭이다. 최장 값은 보드의
                  정식 룩백 「252」 23.03px(실측)이라 종전 56(글자 자리 22px)에서
                  잘렸다. */}
              <Box width={64}>
                <NumField label="룩백(일)" value={knobs.lookback} min={0}
                  onCommit={(v) => set({ lookback: Math.max(2, Math.round(v)) })} />
              </Box>
            </HStack>
          </Field>
        </Box>
        {/* 진입 규칙 — σ 문턱 **앞**에 선다. 문턱은 「얼마나 벌어지면」이고
            이것은 「그때 바로 들어가는가, 돌아올 때까지 기다리는가」라서,
            읽는 순서가 곧 규칙의 순서다. `관찰 σ` 와 달리 **엔진에 들어가고**
            거래 목록을 바꾼다 — 그래서 설정 줄에 있고 stale 을 세운다.
            172 = Segmented 자연폭 168 + 여유 4. 탭 하나 = 라벨 + 좌우 패딩
            16+16(SegmentedTab paddingX={2} = space['2'] 16px)이고, 라벨 「이탈
            즉시」=「밴드 복귀」= 52(Pretendard 14px/600 어드밴스 합 실측
            2026-09-02) → (52+32)×2 = 168. 손 알약이던 시절의 156 은 알약 패딩
            (12+12) 기준이라 세그먼트에는 모자란다 — 말줄임 금지 §3.
            상자는 실측 잉크 167.5 에 한 칸 여유를 더한 169 다(종전 172 는 4.5px
            이 죽어 있었다 — 2026-09-02 얼라인 7 감사). */}
        <Box width={169}>
          <Field
            label="진입 규칙"
            help="이탈 즉시는 밴드를 뚫는 봉에, 밴드 복귀는 밖에 있다가 돌아오는 봉에 들어가요. 방향은 둘 다 나갔던 쪽이 정해요."
          >
            <Segmented
                fill
              label="진입 규칙"
              value={knobs.entryMode}
              options={MR_ENTRY_MODES.map((m) => ({ value: m.v, label: m.label, title: m.help }))}
              onChange={(v) => set({ entryMode: v })}
            />
          </Field>
        </Box>
        {/* 폭은 알약 셋의 실측 잉크 + 1 (Pretendard 14px/600 · `.sr-pillbtn`
            좌우 패딩 12+12 · 알약 사이 4px, 실측 2026-09-02):
              진입 σ  1.5·2·2.5 → 127.4 → 128
              청산 σ  0·0.5·1   → 116.3 → 117
              손절 σ  3·3.5·4   → 118.8 → 120  */}
        <SigmaPick
          width={128}
          label="진입 σ"
          help="볼린저 밴드의 통상 배수예요 — 2σ가 기본, 1.5σ는 민감하게, 2.5σ는 보수적으로 잡아요."
          value={knobs.entryZ}
          options={MR_STRATEGY_PRESETS.entryZ}
          onPick={(v) => set({ entryZ: v })}
        />
        <SigmaPick
          width={117}
          label="청산 σ"
          help="0은 중심선까지 완전히 되돌아올 때 청산이고, 0.5σ가 첫 PMS 기본이에요."
          value={knobs.exitZ}
          options={MR_STRATEGY_PRESETS.exitZ}
          onPick={(v) => set({ exitZ: v })}
        />
        <SigmaPick
          width={120}
          label="손절 σ"
          help="z가 더 벌어지면 접는 발산 손절이에요. 진입의 1.5~2배가 통상이고 3.5σ가 첫 PMS 기본이에요."
          value={knobs.stopZ}
          options={MR_STRATEGY_PRESETS.stopZ}
          onPick={(v) => set({ stopZ: v })}
        />
        {/* ── 비용·명목·실행은 **한 상자에 담는다** [2026-08-28 실측] ──────
            묶음을 만들려는 게 아니라 **감쌈(wrap)을 제어**하는 장치다: 형제로
            늘어놓으면 줄이 넘칠 때 감쌈이 아무 데서나 잘라 비용만 첫 줄에 남고
            명목·실행이 둘째 줄로 갔다(실측 x 1409~1473). 셋을 한 상자에 담으면
            **셋째** 넘어간다. 안쪽 간격도 바깥과 같은 12px 다. */}
        <HStack gap={1.5} alignItems="flex-end">
        {/* 비용에 프리셋이 생겼다 [OWNER 2026-08-28]. 종전에는 「근거 없는
            값을 늘어놓지 않는다」는 이유로 자유 입력만 뒀는데, 그 사이에 근거가
            생겼다 — 국고3Y·IRS3Y 패키지 실제 편도가 ≤0.5bp 라는 오너 답이다.
            **기본이 0.5 다.** 0.05 는 첫 PMS 의 값이지 이 데스크의 호가폭이
            아니고, 싸게 잡은 비용은 결론을 통째로 뒤집는다. 자유 입력은 남긴다 —
            그날 그 종목의 호가폭이 셋 중 어느 것도 아닐 수 있다.
            **폭 220 = 실측**(2026-09-02): 알약 셋 0.05/0.2/0.5 + 간격 + 자유
            입력 64 의 실제 잉크가 219.3px 이고 여유 0.7 이다. (중간에 212 로
            적었던 적이 있는데 그건 자유 입력이 56 이던 때의 수다 — 선언과 코드가
            갈리면 다음 사람이 그 수를 믿고 되돌려 침범이 재발한다.) 종전 주석은 「196 = 알약 셋 +
            자유 입력 56 + 간격」이라고 적었는데 그 산술이 15.3px 모자라, 상자
            선언이 거짓이 되고 내용이 이웃 칸(명목)을 침범했다 — 상자 사이
            간격은 6px 인데 잉크 사이는 −9.3px 이었다(얼라인 7 감사). */}
        <Box width={220}>
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
              {/* 64 = 최장 값 「0.05」 25.91px + CDS TextInput 좌우 패딩 16+16 +
                  테두리 2 = 59.9 에 여유(실측 2026-09-02). 종전 56 은 글자 자리가
                  22px 뿐이라 **자기 화면의 프리셋 0.05(25.9)와 도움말이 말하는
                  동적 비용 0.15(23.1)가 안 들어갔다** — 입력 칸은 말줄임 대신
                  잘라서 스크롤하므로 포커스가 없으면 끝자리가 조용히 사라진다
                  (말줄임 금지 §3 의 잘림과 같은 등급). */}
              <Box width={64}>
                <NumField label="비용(bp)" value={knobs.costBp} min={0} onCommit={(v) => set({ costBp: v })} />
              </Box>
            </HStack>
          </Field>
        </Box>
        {/* 96 — 글자 자리 62px(96 − CDS 좌우 패딩 32 − 테두리 2)이고, 이 데스크가
            넣는 최대 명목 「10000000」(1천만원/bp)이 59.92px 다(13px/500 실측
            2026-09-02). 그 위(1억)는 70.02 라 안 들어간다 — 그때는 폭을 108 로
            올리거나 `NumField` 의 `format` 으로 천 단위를 넣고 다시 잰다. */}
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
            <NumField label="명목(원/bp)" value={knobs.notional} min={0}
              onCommit={(v) => set({ notional: v })} />
          </Field>
        </Box>
        {/* 실행은 이 줄의 유일한 **액션**이라 채움 알약이다(`data-fill` —
            CSS 주석의 «액션 pill = 상시 회색 채움, Backtest secondary 의 look»).
            투명 알약으로 두면 옆의 라벨들과 같은 무게로 읽혀 눌리는 것처럼
            안 보인다(실측). */}
        <button
          type="button"
          className="sr-pillbtn"
          data-fill
          disabled={running}
          onClick={onRun}
        >
          {running ? '계산 중…' : '실행'}
        </button>
        </HStack>
      </HStack>

      {/* ── 실전 운용 규칙 다섯은 **화면에서 내렸다** [OWNER 2026-09-02 —
          "실전 규칙 다섯은 일단 없애서 기억만 해두는 걸로"] ──────────────────
          내린 것: 타임스탑 · 레짐 필터(변동성/추세) · 비용 모델(고정/동적) ·
          역신호 청산 · 미청산 계상. 다섯 다 2026-08-28 에 노브로 세웠던 것이고,
          그날 저녁 긴 표본(2014-06~, OOS 8.9년 · 9계열)에서 **기각**됐다 —
          타임스탑 2/9 개선, 동적비용 0/9, 레짐(변동성) 1/9, 역신호는 8/9 에서
          아무 것도 안 걸렸고, 다섯 전부 켠 포트폴리오는 SR 1.60 → 1.01 로 모든
          축에서 나빠졌다(`docs/MR_LANE_STATE.md` §긴 표본 판정 ①).

          **엔진은 그대로다** — 서버 파라미터(`timeStop`·`regime`·`costModel`·
          `reverseExit`·`countOpen`)도, 그 계약(`MrStrategyParams`)도, 기본값
          (전부 꺼짐)도 안 건드렸다. 화면에서 고르는 손잡이만 없앤 것이라
          되살리려면 이 주석 자리에 줄을 다시 세우면 된다(git 이력: 이 줄을
          지운 커밋 하나). 기각된 노브를 화면에 두면 «이걸 켜 보면 좋아질까»
          라는 질문을 화면이 계속 부른다 — 답은 이미 측정돼 있다. */}
    </VStack>
  );
}
