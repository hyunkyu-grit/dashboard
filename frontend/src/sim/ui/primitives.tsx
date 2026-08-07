"use client";

/**
 * 프리미티브 셋. krw-fi-pms는 이 자리에 Blueprint + lucide를 썼는데, 이 화면이
 * 그로부터 실제로 쓰는 것은 버튼·입력·슬라이더 세 개뿐이었다. 두 라이브러리를
 * 들여오는 대신 여기서 끝낸다 — 번들도 줄지만, 그보다 남의 디자인 시스템의
 * 기본값이 이 프로젝트의 토큰과 조용히 다투는 일이 없어진다.
 *
 * 규율: 방향이 아닌 상호작용 상태는 전부 잉크/회색이다 (docs/DESIGN.md).
 */

import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";

import { AnimatedNumber } from "@/ui/AnimatedNumber";
/* This product's motion, not the simulation's own (2026-08-07). Two tokens the
 * simulation had do not exist here, and both were removed rather than added:
 *
 *   SLIDE  a 520/40 spring for the segmented indicator. EXACTLY ONE SURFACE
 *          MAY OVERSHOOT [OWNER, 2026-08-06] and it is the row reorder — the
 *          tab underline, which is the same widget as this indicator, was
 *          itself demoted from a spring to ENTER in that pass. A segmented
 *          control that springs would put the exception back one surface over.
 *   SPRING on the button press. Same ruling; a press is a state change with
 *          no travel, which is what FAST is for.
 *
 * ENTER and FAST are used below in their place. */
import { ENTER, FAST, instant, PRESS_SCALE } from "@/ui/motion";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON_BASE =
  "inline-flex items-center justify-center text-body font-medium " +
  "transition-colors disabled:cursor-not-allowed";

/* ── 상태 모델 — macOS 킷 실측 (Content Area/{Light,Dark}/01·04) ─────────────
 *
 * 킷에서 배운 것 셋:
 *
 * 1. **Bordered 버튼에 테두리가 없다.** 이름과 달리 낮은 알파의 채움 하나로
 *    끝난다(라이트 8% / 다크 7%). 테두리로 그리면 조밀한 화면에서 선이 하나 더
 *    늘어 표의 헤어라인과 경쟁한다.
 *
 * 2. **비활성의 방식이 변형마다 다르다.** Bordered는 채움을 4%로 내리고 글자를
 *    Tertiary(25%)로 따로 내린다. 그런데 Bordered Default(주 동작)는 채움을
 *    안 바꾸고 **요소 전체를 opacity 0.4**로 흐린다. 처음에 이걸 "킷은 전체
 *    불투명도를 안 쓴다"로 잘못 일반화해서 주 버튼의 opacity를 걷어냈었다.
 *    변형마다 다른 게 답이다.
 *
 * 3. **눌림의 방향이 테마마다 반대다.** 라이트에서 clicked는 검정 10%를 덧대
 *    어두워지고, 다크에서는 흰색 10%를 덧대 밝아진다. 다크에서 더 어둡게 하면
 *    눌림이 아니라 사라짐이다.
 *
 * hover는 사실상 **킷에 없다**. 아트보드는 4개 있는데(Over-glass / 1 Mn) 값이
 * idle과 완전히 같다 — 자리만 있고 정의가 없다. Content Area에는 아트보드조차
 * 없다. 웹에서는 필요하므로 idle과 clicked 사이에 넣었다(--bw-ctl-hover).
 *
 * 안 가져온 것: 02 Bordered Tinted, 03/05 Destructive. 전자는 강조 파랑,
 * 후자는 빨강 기반인데 이 제품에서 그 두 색은 부호 전용이고, 파괴적 동작도
 * 없다 (시뮬레이션은 아무것도 지우지 않는다).
 */
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  /* 04 Prominent = 액센트 [OWNER, 2026-08-07]. 앞 주석은 "킷은 #0088FF를 쓰지만
   * 이 제품은 잉크다 — 파란 실행 버튼 옆에 파란 −25.1억이 놓이면 한 색이 두
   * 가지를 뜻한다" 였다. 그 논리는 그대로 맞고, 답이 잉크에서 액센트로 바뀐다:
   * 주황은 부호가 아니므로 무엇과도 충돌하지 않는다.
   *
   * 라벨은 `text-on-accent`다. `text-page`가 아니다 — 채움 주황 위의 흰 글자는
   * 2.31:1이고 킷 Labels/1 Primary(검정 85%)는 7.61:1이다. 잉크 채움이던
   * 시절에는 page가 맞는 답이었고(잉크 위 흰 글자), 채움이 바뀌면 라벨도 같이
   * 바뀌어야 한다. */
  primary:
    "bg-prominent text-on-accent hover:bg-prominent-hover active:bg-prominent-active " +
    // 킷 그대로: Bordered Default의 비활성은 채움 교체가 아니라 opacity 0.4다
    // (Light/Content Area/Bordered Default/3 Rg/Active, Off, 4 Disabled → op=0.4).
    // 채움을 물리면 주 버튼이 보조 버튼의 비활성과 구별되지 않아, 무엇이 꺼져
    // 있는지가 아니라 무엇이 있었는지가 사라진다.
    "disabled:bg-prominent-active disabled:opacity-40",
  // 01 Bordered — 이름과 달리 테두리 없음.
  secondary:
    "bg-ctl text-ink-1 hover:bg-ctl-hover active:bg-ctl-active " +
    "disabled:bg-ctl-disabled disabled:text-ink-3",
  // 킷의 **Borderless (on = bezel)**다. 처음엔 주석에 "킷의 Plain"이라고 적었는데
  // 그런 변형은 킷에 없다 — 이름을 지어내고 근거처럼 써 둔 것이다.
  //
  // 실제 Borderless는 idle·clicked·disabled 어디에도 채움이 없고 라벨이
  // **강조색**이다(#0088FF, 세 상태가 색까지 같고 불투명도만 다르다). 우리는
  // 강조색을 부호에 쓰므로 라벨을 잉크 2단계로 내렸다 — 그래서 이건 옮긴 것이
  // 아니라 **바꾼 것**이고, 그 사실이 여기 적혀 있어야 한다.
  //
  // hover 채움도 킷에 없다(Borderless는 어느 상태에도 면이 없다). 웹에서
  // 커서가 얹힌 곳을 말해 줄 다른 수단이 없어서 넣었다.
  ghost:
    "text-ink-2 hover:bg-ctl-hover hover:text-ink-1 active:bg-ctl-active " +
    "disabled:bg-transparent disabled:text-ink-3",
};

/* 높이/라운드/여백은 킷 실측: 사다리 16 / 20 / 24 / 28 / 36, 가로 여백은
 * 24 이상에서 16. 킷이 붙인 이름은 1 Mn / 2 Sm / **3 Rg** / 4 Lg / 5 XL이고,
 * 아래 셋이 각각 24 / 28 / 36이다 (macOS Regular는 24다).
 *
 * **라운드는 28에서 알약으로 넘어간다.** 마스터의 style.corners를 직접 읽으면
 * 버튼과 세그먼티드가 16→4 · 20→5 · 24→6 · **28→∞ · 36→∞**다. 입력 필드만
 * 끝까지 높이÷4를 지킨다(28→7, 36→9). 한동안 그 비율을 버튼에도 적용해서
 * 28·36을 7px·9px로 그리고 있었는데 킷에 없는 모양이었다.
 *
 * 앞 커밋이 이걸 적용했다고 적었지만 실제로는 BUTTON_BASE에서 라운드를 떼기만
 * 했고 여기는 손대지 않아서, 버튼이 각진 채로 있었다. guards/scale.test.ts에
 * "모든 크기가 높이와 라운드를 함께 말한다"를 추가해 다시 새지 않게 한다. */
const BUTTON_SIZE = {
  sm: "h-6 px-4 rounded-control-sm", // 3 Rg — 기본 크기
  md: "h-7 px-4 rounded-full", // 4 Lg — 28부터 알약. 주 동작도 이 칸이다
  // 5 XL(36)은 뺐다. 킷에서 XL이 쓰이는 자리는 큰 창의 강조 동작인데, 이
  // 화면의 주 동작은 폼 아래 붙은 실행 버튼이다 — Alerts의 Cancel/Save가
  // 228×28인 것과 같은 자리다. 36은 킷에 있지만 이 화면에 있을 자리가 아니다.
  // 글리프 하나짜리 버튼(스테퍼의 −/+)은 정사각이다. 가로 여백 16을 그대로
  // 주면 한 글자에 40px가 붙어 두 개가 입력칸보다 넓어진다.
  // shrink-0이 없으면 정사각이 아니다: 스테퍼가 들어가는 행이 flex라 24×24가
  // 24×18로 눌린다(측정값). 정사각을 말했으면 정사각이어야 한다.
  icon: "size-6 shrink-0 rounded-control-sm",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZE;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", disabled, ...rest },
  ref,
) {
  const reduced = useReducedMotion() === true;
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      // 눌린 순간 살짝 들어간다 — 클릭이 접수됐다는 유일한 즉각 신호다.
      // 비활성일 때는 반응하지 않는다: 눌리는 시늉을 하면 "먹었는데 느린가"로
      // 읽혀 한 번 더 누르게 된다.
      whileTap={disabled ? undefined : { scale: PRESS_SCALE }}
      transition={instant(FAST, reduced)}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          // 입력은 **3 Rg(24)** 다 — macOS의 기본 크기이고, 킷의 Text Fields
          // 사다리에서 13pt 본문이 처음 앉는 칸이다. 한동안 4 Lg(28)로 두었는데
          // 그건 한 칸 위이고, 조밀한 표를 지향하는 화면에서 폼만 헐거웠다.
          // 좌우 여백 6도 그 칸의 실측값이다(28은 8, 36은 10).
          "h-6 w-full rounded-control-sm border border-field bg-tile px-1.5 text-body text-ink-1",
          "placeholder:text-ink-3",
          className,
        )}
        {...rest}
      />
    );
  },
);

/** 숫자 입력. 오른쪽 정렬 + 단위 접미. 값은 문자열로 다룬다 — 포트 계약이
 * 자유 입력을 문자열로 들고 있고(사용자가 "-"만 친 순간이 있다), 요청 조립
 * 시점에 숫자로 바뀐다. 여기서 미리 숫자로 바꾸면 그 중간 상태가 사라져
 * 입력 중에 커서가 튄다. */
export function NumberField({
  value,
  onChange,
  suffix,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-right"
        {...rest}
      />
      {suffix && <span className="shrink-0 text-body text-ink-2">{suffix}</span>}
    </div>
  );
}

/** 세그먼트 선택. 라디오 그룹의 시각적 형태.
 *
 * ── 구조는 킷의 심볼 트리 그대로다 ────────────────────────────────────────
 * `Segmented Controls/Light/Content Area/Duo/Active, 3 Rg` (60×24):
 *
 *   컨테이너 60×24   채움 #000/0.08 · 라운드 6 · **패딩 없음**
 *     Segment 1   x=0   30×24   ← 컨테이너 높이를 꽉 채운다. 각짐.
 *     Separator   x=29.5 y=5  1×14   채움 #e6e6e6 · 라운드 1
 *     Segment 2   x=30  30×24
 *
 * 배운 것 셋:
 *
 * 1. **컨테이너에 패딩이 없다.** 세그먼트가 x=0에서 시작해 높이를 꽉 채운다.
 *    나는 p-0.5 안쪽에 둥근 알약을 띄우고 있었다.
 * 2. **세그먼트 자체는 각졌다.** 라운드는 컨테이너만 갖고 세그먼트는 잘린다.
 *    선택 표시를 따로 둥글릴 이유가 없다.
 * 3. **사이에 1px 구분선이 있다.** 상하로 파여 있고 그 여백이 크기마다 다르다:
 *    16→3 · 20→4 · 24→5 · 28→5 · 36→8. 구분선 마스터에 On/Off 두 변형이 있고
 *    Off는 비어 있다 — 선택된 칸에 붙은 구분선은 사라진다.
 *
 * 킷에 **글자 라벨 세그먼트는 없다**. 전부 SF Symbol 글리프 한 자이고 툴바
 * 세그먼티드는 항목당 27px 고정이다. 우리 라벨("1Y", "1.5Y", "커브")의 좌우
 * 여백은 킷에 근거가 없는 우리 값이다.
 *
 * 선택 표시는 **미끄러진다**: 배경을 각 칸이 따로 켜고 끄면 선택이 한 칸에서
 * 사라지고 다른 칸에서 나타나는 두 사건이 되는데, 실제로 일어난 일은 하나다 —
 * 선택이 옮겨간 것. 킷에는 없는 우리 것이고, reduced-motion에서는 끄는 게
 * 아니라 즉시 끝나게 한다(globals.css). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  // layoutId는 문서 전역이라 세그먼트가 둘 이상 있으면 서로의 표시를 훔쳐간다
  // (결과 화면에 정렬/상하위 두 개가 나란히 있다). 그룹마다 고유해야 한다.
  const groupId = useId();
  const reduced = useReducedMotion() === true;
  const selected = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // 컨테이너가 Bordered 채움이고, 라운드는 여기만 갖는다. overflow-hidden이
      // 각진 세그먼트를 잘라 준다 — 킷이 그렇게 조립되어 있다.
      className="inline-flex h-6 overflow-hidden rounded-control-sm bg-ctl"
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative px-2 text-body transition-colors",
              // 선택된 칸은 액센트 채움이므로 라벨도 on-accent다 (BUTTON_VARIANT
              // primary와 같은 이유 — 주황 위 흰 글자는 2.31:1).
              active ? "text-on-accent" : "text-ink-2 hover:text-ink-1",
            )}
          >
            {/* 구분선: 1×14, 상하 5씩 파임 (24 칸의 실측). 선택된 칸에 붙은
                쪽은 사라진다 — 킷의 Separator/Off 변형이 비어 있는 이유다. */}
            {i > 0 && i !== selected && i - 1 !== selected && (
              <span
                aria-hidden
                className="absolute left-0 top-[5px] h-3.5 w-px rounded-[1px] bg-ink-4"
              />
            )}
            {active && (
              <motion.span
                layoutId={`segmented-${groupId}`}
                aria-hidden
                // 칸 전체를 채운다. 세그먼트는 각지고 라운드는 컨테이너의 몫이다.
                className="absolute inset-0 bg-prominent"
                // ENTER, matching the tab underline — the same widget one
                // level up, and the one the overshoot pass demoted first.
                transition={instant(ENTER, reduced)}
              />
            )}
            {/* 글자는 배경 위에 — 배경이 absolute라 명시적으로 쌓아 올린다. */}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 값을 한 칸씩 올리고 내리는 컨트롤. **킷의 구조 그대로** —
 * `Steppers/Light/􀻃/Content Area/3 Rg/Button - {Up,Down}/1 - Idle`:
 *
 *   Button - Up     20×12   채움 #000/0.08   글리프 􀆇 13pt, 잉크 85%
 *   Button - Down   20×12   채움 #000/0.08   글리프 􀆈
 *
 * 즉 **한 덩어리를 반씩 나눈 것**이다. 두 개의 정사각 버튼이 아니다 — 나는
 * −/+ 를 24×24 두 개로 만들어 입력칸 양옆에 세워 뒀었는데, 그러면 한 행에서
 * 40px를 더 먹고 "둘은 한 쌍"이라는 사실도 사라진다.
 *
 * ── 크기는 **옆에 선 필드와 같은 칸**이어야 한다 ─────────────────────────
 * 스테퍼의 사다리는 (No Field 기준) 13×16 · 17×20 · **20×24** · **23×28** ·
 * 30×36이고, 라운드는 높이÷4다 — 버튼처럼 28에서 알약이 되지 않는다.
 * 입력 필드와 같은 규칙이고, 같은 규칙을 쓰는 이유는 나란히 서기 때문이다.
 *
 * 한때 스테퍼 20×24 옆에 입력 28을 세워 둬서 두 컨트롤의 윗변·아랫변이 2px씩
 * 어긋난 적이 있다. 지금은 **둘 다 3 Rg**다 — 입력을 킷의 기본 칸으로 내리면서
 * 스테퍼도 같은 칸으로 돌아왔다. 맞춰야 하는 것은 절대 크기가 아니라 **같은
 * 칸에 있다는 사실**이다.
 *
 * 위/아래가 −/+ 보다 나은 이유가 하나 더 있다: 부호가 붙는 값(−25bp)에서
 * "−" 버튼과 값의 "−"가 같은 줄에 두 번 나온다.
 *
 * 글리프는 SF Symbols(􀆇/􀆈)라 실을 수 없어서 같은 모양을 SVG로 그린다. */
export function Stepper({
  onStep,
  label,
  disabled,
}: {
  /** +1 / −1 */
  onStep: (delta: 1 | -1) => void;
  /** 무엇을 조절하는지 — 스크린리더가 읽는다. */
  label: string;
  disabled?: boolean;
}) {
  // 24 ÷ 2 = 12, 가운데 1px 구분선을 빼면 각 반쪽이 11.5다 — 킷의
  // Button - Up / Down 마스터가 정확히 20×12다.
  const half =
    "flex h-full w-full items-center justify-center bg-ctl text-ink-1 transition-colors " +
    "hover:bg-ctl-hover active:bg-ctl-active disabled:bg-ctl-disabled disabled:text-ink-3";
  return (
    // 3 Rg = 20×24, 라운드 6. 옆의 Input과 같은 칸이다.
    <span className="inline-flex h-6 w-5 shrink-0 flex-col overflow-hidden rounded-control-sm">
      <button type="button" className={half} disabled={disabled} aria-label={`${label} 올리기`} onClick={() => onStep(1)}>
        <Chevron up />
      </button>
      {/* 두 칸을 가르는 선. 킷은 두 마스터를 맞대어 두는 것으로 끝나지만,
          같은 채움 둘이 붙으면 웹에서는 한 덩어리로 보인다. */}
      <span aria-hidden className="h-px w-full bg-edge" />
      <button type="button" className={half} disabled={disabled} aria-label={`${label} 내리기`} onClick={() => onStep(-1)}>
        <Chevron />
      </button>
    </span>
  );
}

/** 킷의 disclosure 글리프(􀆇/􀆈)와 같은 모양. SF Symbols는 실을 수 없어서
 * 직접 그린다 — 폰트에 있는 "⌄" 같은 문자를 쓰면 글꼴마다 크기와 굵기가
 * 달라지고, 그건 우리가 정한 값이 아니다. */
export function Chevron({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 10 6" width="9" height="5.4" aria-hidden fill="none">
      <path
        d={up ? "M1 5L5 1L9 5" : "M1 1L5 5L9 1"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 라벨 + 내용. 폼 행의 유일한 형태 — 라벨이 위, 컨트롤이 아래. 좌우 배치는
 * 라벨 길이가 제각각인 한국어에서 컨트롤의 왼쪽 모서리를 들쭉날쭉하게 만든다. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-body text-ink-2">{label}</span>
        {hint && <span className="text-callout text-ink-2">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** 구획. **카드가 아니다** — 라운드도 테두리도 없고, 위쪽 헤어라인 하나로
 * 앞 구획과 갈린다.
 *
 * 왜 카드를 버렸나: 사우론의 셸은 떠 있는 카드의 모자이크가 아니라 **끊기지
 * 않는 한 장의 표면**이다(docs/DESIGN.md). 처음엔 구획마다 라운드 카드를
 * 얹었는데, 그건 사우론이 Session 16에서 폐기한 바로 그 그림이었다 — 회색
 * 페이지 위에 흰 카드가 떠 있는 배치. 라이트 테마에서 `--bw-page`는 이제
 * 캔버스 픽셀을 거의 칠하지 않는다.
 *
 * 라운드와 테두리는 **실제로 떠 있는 것**에만 쓴다 → FloatingCard. */
export function Section({
  title,
  aside,
  children,
  className,
  first,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 첫 구획은 위 헤어라인을 생략한다 — 헤더의 경계선과 겹쳐 두 줄이 된다. */
  first?: boolean;
}) {
  return (
    <section className={cn(!first && "border-t border-edge", className)}>
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-3 pb-1 pt-5">
          {/* Headline은 킷에서 **Default가 이미 Bold**다 (Emphasized는 Heavy).
              다른 단계는 Regular가 기본이라 Headline만 다르다. */}
          {title && <h2 className="text-headline font-bold tracking-tight">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** 진짜로 떠 있는 면 — 실행 중 인터스티셜, 오류 패널. 여기에만 라운드와
 * 테두리를 쓴다. 셸의 기반 표면은 Section이 진다.
 *
 * ── 이건 카드가 아니라 킷의 **Alert**다 ──────────────────────────────────
 * 두 쓰임 다 화면을 가로막고, 제목과 설명이 있고, 한쪽엔 취소가 있다. 킷의
 * `Alerts/Light/Stacked`(260×238)를 열어서 잰 값:
 *
 *   컨테이너 260×238   안쪽 여백 **16** (제목·버튼 그룹이 전부 x=16, w=228)
 *   제목 y=20 → 설명 +26
 *   버튼 228×**28**, 세로로 34씩 (28 + 간격 6)
 *
 * 그래서 셋을 고친다:
 *
 * 1. **라운드 16 → 26.** `--radius-sheet`는 Dialogs·Alerts 값으로 정의해
 *    놓고 아무 데서도 안 쓰이던 죽은 토큰이었다. 여기가 그 자리다.
 * 2. **여백 20 → 16.** 킷 값이다.
 * 3. **그림자를 넣는다.** 지금까지 없었고, 그래서 "떠 있는 면"이 페이지와
 *    같은 색(bg-tile) 위에 헤어라인 하나로만 서 있었다 — 실행 중 화면에서
 *    카드가 거의 안 보였다. 셸의 규율("그림자는 실제로 떠 있는 면에만")이
 *    허락하는 바로 그 자리인데 정작 비어 있었다.
 *
 * 그림자 토큰은 팝오버 것을 그대로 쓴다. 이름이 좁아 보이지만 **킷에서 두
 * 마스터의 첫 겹이 글자 그대로 같다** — Alerts/Light/Background와
 * Popovers/Light/North-Center 둘 다 `0 18 46 #000/0.25`로 시작한다. 뒤에
 * 붙는 여덟 겹은 유리 가장자리 처리라 이 셸이 안 가져오는 것들이다.
 *
 * 폭도 킷 값 **260**이다. macOS의 알럿은 내용이 길든 짧든 폭이 같고 세로로만
 * 자란다 — 그래서 여기서도 부르는 쪽이 폭을 정하지 않는다. 안쪽 폭은 228이
 * 되고, 킷의 알럿 버튼이 정확히 228인 것과 맞아떨어진다.
 *
 * 채움은 킷과 다르다: 킷의 알럿은 유리(#FFF/0.7 + #BFBFBF/0.1)인데 이 셸은
 * 불투명한 한 장이라 머티리얼을 안 쓴다 (globals.css). 옮긴 게 아니라 바꾼
 * 것이고, 그 사실이 여기 적혀 있어야 한다. */
export function FloatingCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[260px] rounded-sheet border border-edge bg-tile p-4 shadow-popover",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 값 하나를 라벨과 함께 보여주는 칩. 라벨 칸과 값 칸의 배경 차이가 경계다 —
 * 테두리를 하나 더 그리지 않는다. */
export function Chip({
  label,
  value,
  valueColor,
  animated,
}: {
  label: string;
  value: string;
  valueColor?: string;
  /** 값이 바뀔 때 교차 페이드. 조건을 고치면 칩 숫자가 소리 없이 달라지는데,
   * 바뀐 걸 못 보면 방금 누른 게 먹혔는지 알 수 없어 한 번 더 누르게 된다. */
  animated?: boolean;
}) {
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-control-sm text-callout">
      <span className="bg-ink-4 px-2 py-1 text-ink-2">{label}</span>
      <span className="bg-ink-6 px-2 py-1 font-medium" style={valueColor ? { color: valueColor } : undefined}>
        {animated ? <AnimatedNumber value={value} /> : value}
      </span>
    </span>
  );
}
