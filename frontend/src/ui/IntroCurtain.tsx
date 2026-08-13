"use client";

/* 인트로 커튼 — 첫 로딩 동안만 덮는 전체 화면 (DESIGN §14 「인트로」).
 * [OWNER, 2026-08-13 — "시작할 때 멋있는 웹사이트처럼 뒤에 영상같은 거"]
 *
 * 오너가 고른 형태: **인트로에만**, 영상 파일이 아니라 **앱 자기 데이터로 그린
 * 생성 애니메이션**. 작업 화면(표·차트)에는 아무것도 얹지 않는다 — §14 의
 * "모션은 상태 변화, 크롬에만, 장식 금지" 는 그 화면에서 그대로 살아 있다.
 * 커튼은 그 규칙의 예외가 아니라 그 규칙이 적용되는 화면의 **바깥**이다.
 *
 * 영상 파일을 쓰지 않은 이유 셋. (1) 스톡 영상은 이 시장과 아무 관계가 없다.
 * (2) 3~10MB 다운로드가 시작을 실제로 느리게 만든다 — 빨라 보이려고 넣은 것이
 * 느리게 만드는 셈이다. (3) 라이트/다크 두 벌이 필요하다. 그린 것은 셋 다
 * 해당이 없고, 색이 테마 브릿지를 지나므로 테마가 저절로 따라온다.
 *
 * ── 그림이 제품의 문법을 그대로 쓴다 ─────────────────────────────────────
 * 아홉 장을 똑같은 농도로 겹치면 얼룩이 된다. 여기서는 §9 의 **시간 램프**를
 * 그대로 쓴다 — 오래된 커브일수록 옅고 가늘게, 최근일수록 짙고 굵게. §5 의
 * "잉크 농도 = 시간 축" 이 이 그림에서도 같은 뜻이라, 부채가 곧 10년의 깊이가
 * 된다. 마디의 점(§5 「Marker dot = live-quoted node」), 지표선 아래의 테너
 * 라벨(timeAxis.ts 의 "축이 아니라 방향표" 규칙, 넷만) 도 같은 이유로 있다.
 * 배경의 어떤 잉크도 前景 램프의 가장 옅은 칸(ytd)을 넘지 않는다.
 *
 * ── AnimatePresence 를 쓰지 않는다 ────────────────────────────────────────
 * 이 리포에는 exit 완료 보고가 유실되어 창이 영영 안 닫힌 전례가 둘 있다
 * (ba2c1e0, a344fb2e — 라우터 리렌더와 rAF 기아). 그때는 창 하나가 남았지만
 * 여기서 같은 일이 나면 **앱 전체가 덮인 채로 남는다**. 그래서 사라지는 것은
 * 애니메이션 완료 콜백이 아니라 타이머가 결정한다. 백그라운드 탭에서 rAF 는
 * 멈추지만 setTimeout 은 (느려질 뿐) 반드시 온다. 페이드는 CSS 트랜지션이라
 * globals.css 의 reduced-motion 담요가 그대로 덮는다.
 *
 * ── 실패는 커튼을 걷는다 ──────────────────────────────────────────────────
 * `ready` 에 isError 가 포함된다. 백엔드가 죽었을 때 커튼이 계속 떠 있으면
 * 안정화 세션이 고쳤던 바로 그 결함 — "실패가 대기처럼 보인다" — 을 더 나쁜
 * 형태로 되살리게 된다. guards/intro-curtain.test.ts 가 이것을 잡는다.
 */

import { useEffect, useRef, useState } from "react";

import {
  onThemeChange,
  resolveFont,
  resolveInk,
  resolveLine,
  resolveTheme,
  withAlpha,
} from "@/theme/bridge";
import { RAMP_OPACITY, RAMP_WIDTH } from "@/theme/ramp";

import { Z_CURTAIN } from "./layers";
import { MOTION, prefersReducedMotion } from "./motion";
import {
  bloomAt,
  BLOOM_END_MS,
  brightAt,
  INTRO_CURVES,
  INTRO_MAX_MS,
  INTRO_MIN_MS,
  INTRO_TENORS,
  NEWEST,
  polyline,
  revealed,
  type Box,
  type Point,
} from "./introCurves";

/** 걷히는 데 걸리는 시간 — §14 의 EXIT 그대로. 나가는 것은 들어오는 것보다
 * 짧다는 규칙이 전체 화면이라고 달라지지 않는다. */
const LIFT_MS = MOTION.exit * 1000;

/** 가장 오래된 장이 가장 최근 장 대비 갖는 농도. 부채의 깊이를 정하는 값이다. */
const GHOST_FLOOR = 0.4;

/** 방향표로 쓸 테너 — 넷. timeAxis.ts 가 날짜에 대해 정한 규칙("3~4개, 축이
 * 아니라 방향표")을 가로축에 그대로 적용한 것이다. 앞·중간·뒤가 하나씩. */
const LABEL_NODES = [0, 4, 7, 12];

/** 지표선 아래로 테너 방향표와 「불러오는 중이에요」 가 들어갈 자리. 둘이
 * 한 덩어리로 붙어 보이지 않을 만큼은 되어야 한다 — 96px 이던 첫 값에서 둘
 * 사이가 14px 까지 좁아졌다(짧은 창에서). */
const FOOT_PX = 132;

/** 부채가 시작하는 높이. 위쪽은 로크업 몫이다. */
const FAN_TOP = 0.3;

/** 부채의 가로 상한. **이 값이 이 그림의 성패를 쥐고 있다** — 화면 폭을 그대로
 * 따라가게 두면 초광폭에서 열세 마디가 1,300px 로 늘어나 모든 커브가 수평선이
 * 된다(첫 시안이 그랬다). 폭을 묶어야 커브가 커브로 읽힌다. */
const FAN_MAX_W = 980;

interface Layout {
  box: Box;
  /** 부채가 앉는 수평선의 y. */
  baseline: number;
  /** 테너 방향표의 기준선 y. */
  labelY: number;
}

/** 커브 부채가 차지하는 자리. 세로는 화면을 그대로 따라가고(위는 로크업, 아래는
 * 라벨), 가로만 묶는다. 그래서 창이 커질수록 부채는 **가팔라진다** — 커브가
 * 커브로 보이는 쪽이다. */
function layout(w: number, h: number): Layout {
  const baseline = h - FOOT_PX;
  const top = h * FAN_TOP;
  const width = Math.min(w * 0.72, FAN_MAX_W);
  return {
    box: { x: (w - width) / 2, y: top, w: width, h: baseline - top },
    baseline,
    labelY: baseline + 20,
  };
}

type Phase = "up" | "lifting" | "gone";

interface Props {
  /** 뒤의 앱이 보여 줄 것을 갖췄는가 — 데이터가 왔거나, **실패했거나**. */
  ready: boolean;
}

export function IntroCurtain({ ready }: Props) {
  const [phase, setPhase] = useState<Phase>("up");
  const [label, setLabel] = useState(INTRO_CURVES[NEWEST].label);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bornRef = useRef<number | null>(null);

  /* ── 그리기 ──────────────────────────────────────────────────────────────
   * canvas 는 CSS 를 상속하지 않는다. 색도 서체도 전부 테마 브릿지를 지나고
   * (§9 의 규칙), 테마가 바뀌면 다시 풀어 온다. */
  useEffect(() => {
    if (phase === "gone") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    if (bornRef.current === null) bornRef.current = performance.now();

    /** 테마에 매인 값 한 벌. onThemeChange 가 오면 통째로 다시 만든다. */
    const readPalette = () => {
      const mode =
        document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const ink = resolveInk();
      /* 부채의 천장은 前景 램프의 중간 칸(mtd)이다. 첫 시안은 가장 옅은 칸
         (ytd)에 맞췄는데, 아홉 장이 전부 얼룩처럼 보였다 — 이 화면에서 부채는
         뒤에 깔리는 배경이 아니라 **그림 자체**라 그 칸이 바닥이 아니라
         천장이어야 했다. 표의 잉크(now)까지 올라가지 않는 것은 그대로다. */
      const ceiling = RAMP_OPACITY[mode].mtd;
      return {
        ink,
        accent: resolveLine(),
        edge: resolveTheme().border,
        font: resolveFont(),
        ghost: (age: number) =>
          withAlpha(ink, ceiling * (GHOST_FLOOR + (1 - GHOST_FLOOR) * age)),
      };
    };

    let paint = readPalette();
    let css = { w: 0, h: 0 };

    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      css = { w: window.innerWidth, h: window.innerHeight };
      canvas.width = Math.round(css.w * dpr);
      canvas.height = Math.round(css.h * dpr);
      canvas.style.width = `${css.w}px`;
      canvas.style.height = `${css.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const stroke = (pts: Point[], color: string, width: number) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };

    /** 한 프레임. reduced 면 elapsed 를 끝값으로 넣어 완성된 그림 한 장만 그린다. */
    const draw = (elapsed: number): string => {
      const { box, baseline, labelY } = layout(css.w, css.h);
      ctx.clearRect(0, 0, css.w, css.h);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      /* 부채가 앉는 지표선. 첫 커브와 함께 왼쪽에서 자라 나온다 — 선이 먼저
         놓이고 그 위에 커브가 얹히는 순서라야 그림에 바닥이 생긴다. */
      const ground = bloomAt(elapsed, 0);
      stroke(
        [
          { x: box.x, y: baseline },
          { x: box.x + box.w * ground, y: baseline },
        ],
        paint.edge,
        1,
      );

      /* 아홉 장. 오래된 것이 먼저 나오고 더 옅다 (§9 시간 램프). */
      INTRO_CURVES.forEach((curve, i) => {
        const age = i / (INTRO_CURVES.length - 1);
        stroke(
          revealed(polyline(curve.rates, box), bloomAt(elapsed, i)),
          paint.ghost(age),
          1 + 0.4 * age,
        );
      });

      /* 지금 읽히는 한 장. 아래로 아주 옅게 깔아 무게를 주고, 마디마다 점을
         찍는다 — 이 열세 개가 실제로 호가되는 자리다 (§5 marker dot). */
      const state = brightAt(elapsed);
      const pts = polyline(state.rates, box);
      const shown = revealed(pts, state.reveal);
      if (shown.length >= 2) {
        const wash = ctx.createLinearGradient(0, box.y, 0, baseline);
        wash.addColorStop(0, withAlpha(paint.accent, 0.055));
        wash.addColorStop(1, withAlpha(paint.accent, 0));
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.moveTo(shown[0].x, baseline);
        for (const p of shown) ctx.lineTo(p.x, p.y);
        ctx.lineTo(shown[shown.length - 1].x, baseline);
        ctx.closePath();
        ctx.fill();
      }
      stroke(shown, paint.accent, RAMP_WIDTH.now);

      ctx.fillStyle = paint.accent;
      const settled = Math.floor(state.reveal * (pts.length - 1));
      for (let i = 0; i <= settled; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 테너 방향표. 부채가 다 펴지는 것에 맞춰 같이 들어온다. */
      const labelIn = bloomAt(elapsed, INTRO_CURVES.length - 1);
      if (labelIn > 0) {
        ctx.fillStyle = withAlpha(paint.ink, 0.3 * labelIn);
        ctx.font = `12px ${paint.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const i of LABEL_NODES) {
          ctx.fillText(INTRO_TENORS[i], pts[i].x, labelY);
        }
      }
      return state.label;
    };

    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - (bornRef.current ?? 0);
      const next = draw(elapsed);
      setLabel((prev) => (prev === next ? prev : next));
      frame = requestAnimationFrame(tick);
    };

    measure();
    if (reduced) {
      /* [OWNER, 2026-08-06 — "문자 그대로 전부 instant"]. 움직임 없이 다 그려진
       * 상태 한 장. 빈 화면을 주는 것은 답이 아니다 — 선호는 "애니메이션을 빼
       * 달라" 이지 "그림을 빼 달라" 가 아니다. */
      draw(BLOOM_END_MS);
    } else {
      frame = requestAnimationFrame(tick);
    }

    const onResize = () => {
      measure();
      if (reduced) draw(BLOOM_END_MS);
    };
    window.addEventListener("resize", onResize);
    const offTheme = onThemeChange(() => {
      paint = readPalette();
      if (reduced) draw(BLOOM_END_MS);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      offTheme();
    };
  }, [phase]);

  /* ── 걷기 ────────────────────────────────────────────────────────────────
   * 타이머는 **언제나** 걸려 있다. 데이터가 왔으면 최소 노출을 채운 만큼만
   * 기다리고, 안 왔으면 상한에서 걷는다 — `ready` 가 영영 안 와도 커튼은
   * 나간다(INTRO_MAX_MS 의 주석에 그 82초짜리 실측이 있다). 조건 안에 걷는
   * 경로가 하나뿐이면 그 조건이 안 오는 날 앱이 잠긴다. */
  useEffect(() => {
    if (phase !== "up") return;
    const reduced = prefersReducedMotion();
    const elapsed = performance.now() - (bornRef.current ?? performance.now());
    const delay = ready
      ? reduced
        ? 0
        : Math.max(0, INTRO_MIN_MS - elapsed)
      : Math.max(0, INTRO_MAX_MS - elapsed);
    const toLift = window.setTimeout(() => setPhase("lifting"), delay);
    return () => window.clearTimeout(toLift);
  }, [ready, phase]);

  useEffect(() => {
    if (phase !== "lifting") return;
    const reduced = prefersReducedMotion();
    const toGone = window.setTimeout(() => setPhase("gone"), reduced ? 0 : LIFT_MS);
    return () => window.clearTimeout(toGone);
  }, [phase]);

  if (phase === "gone") return null;

  const lifting = phase === "lifting";

  return (
    <div
      role="status"
      aria-live="polite"
      /* 걷히기 시작한 순간부터 클릭이 통과한다. 페이드가 어떤 이유로 끝나지
         않더라도 앱은 이미 쓸 수 있다 — 덮인 채 남는 최악을 두 겹으로 막는다. */
      className={`fixed inset-0 overflow-hidden bg-page ${Z_CURTAIN} ${
        lifting ? "pointer-events-none" : ""
      }`}
      style={{
        opacity: lifting ? 0 : 1,
        transitionProperty: "opacity",
        transitionDuration: `${MOTION.exit}s`,
        transitionTimingFunction: "var(--bw-ease-out)",
      }}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0" />

      {/* 로크업은 부채 **위**에 앉는다. 가운데 놓고 선을 지워 가며 읽히게 하는
          것보다, 애초에 겹치지 않는 자리를 주는 편이 그림도 글자도 산다. */}
      <div className="absolute inset-x-0 top-[12%] flex flex-col items-center gap-2">
        <p className="text-[40px] font-medium leading-none tracking-[0.34em] text-ink">
          SAURON
        </p>
        <p className="text-[13px] tracking-[0.22em] opacity-40">KRW IRS</p>
        {/* 지금 그려지는 커브의 날짜. 배경이 장식이 아니라 **이 시장의 실측치**
            라는 것을 말하는 한 줄이라, 그림에 붙여 둔다. */}
        <p className="mt-5 text-[13px] tabular-nums opacity-35">{label}</p>
      </div>

      <p className="absolute inset-x-0 bottom-10 text-center text-[13px] opacity-45">
        불러오는 중이에요
      </p>
    </div>
  );
}
