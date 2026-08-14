"use client";

/* 커브 표면 — Lab 의 세입자 (2026-08-14).
 *
 * X = 만기, 깊이 = 시간, Y = 금리. 이 배치는 NYT Upshot 의 「A 3-D View of a
 * Chart That Predicts The Economic Future」(2015) 이후 이 도메인의 관례가 됐다.
 * 판정 근거·대안 비교·외부 리서치는 `docs/YIELD_SURFACE.md`, 투영의 상수와
 * 그것을 고른 실측은 `ui/surfaceGeometry.ts` 에 있다.
 *
 * **이 화면이 답하는 질문은 "커브 모양이 언제 어떻게 바뀌었나" 하나다.**
 * "어제 어느 구간이 움직였나" 는 표의 어제 열이 더 빨리 답하고, 그 질문을
 * 다시 답하려던 화면(테너 × 날짜 커브 히트맵)은 이미 한 번 지워졌다
 * (DESIGN §확대뷰). 그래서 여기서는 단면과 역전이 일급 시민이다.
 *
 * ── 3D 를 쓰는 값 ─────────────────────────────────────────────────────────
 * Wilke 「Don't go 3D」가 옳고, 그 조건을 못 맞추는 자리다: 회전이 없다.
 * 그래서 그가 요구하는 보완을 전부 넣는다 —
 *   · **격자선을 지우지 않는다**(그림 26.4: 지우면 해석이 불가능해진다),
 *   · **정확한 값 읽기용 2D 를 옆에 둔다**(hover 한 날짜의 커브 단면),
 *   · 값은 **그림이 아니라 페이로드에서** 읽는다 (§16).
 * 색은 높이를 거들 뿐 대신하지 않으므로 회색조에서 그대로 성립한다 (§5).
 *
 * §16: 이 파일은 좌표만 만든다. 금리도 역전 부호도 백엔드가 정해서 보낸다. */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { PolicyStep, SurfacePayload } from "@/lib/api";
import { fetchSurface } from "@/lib/api";
import { fmtAxis } from "@/lib/format";

import { useMeasure } from "./useMeasure";

import {
  type Box,
  curveAtSlice,
  depthOf,
  domainOf,
  RIDGE_SKEW,
  rateY,
  ridgeAtPoint,
  ridgeBaseY,
  ridgePoints,
  ridgeSpanX,
  segments,
  slicesFor,
  tenorAtPoint,
  tenorX,
} from "./surfaceGeometry";

/* 왼쪽은 연도 라벨(네 자리)이 지형 밖에 서는 자리라 넓다 — 축 눈금과 같은
 * 열을 쓰지 않는다. */
const PAD = { top: 16, right: 56, bottom: 26, left: 52 };
/** 단면 패널 — 표면 오른쪽에 붙는 2D 커브. */
const CUT_W = 190;
const CUT_H = 132;

/** pane 이 아무리 좁아도 이보다 좁으면 표면이 아니라 얼룩이다 — 그 아래로는
 * 가로 스크롤을 내준다(셸의 스크롤 컨테이너가 이미 그렇게 돼 있다). */
const MIN_PLOT_W = 560;
const MIN_PLOT_H = 420;
const MAX_PLOT_H = 680;

/** 능선의 잉크 — 역전인 날은 다른 층위로 그린다.
 *
 * 색이 아니라 **불투명도**로 가른다: §5 는 회색조에서 살아남을 것을 요구하고,
 * 역전은 부호를 가진 방향값이 아니라 상태라 up/down 잉크를 쓸 자리가 아니다.
 *
 * **밀도와 함께 내려갔다** [2026-08-14]. 능선이 픽셀당 한 장이 되자 0.55 는
 * 화면을 통째로 주황으로 칠했다 — 선이 면을 덮으면 지형이 사라진다. 이
 * 작도법에서 형태를 만드는 것은 **채움과 가림**이고 선은 결의 역할이다.
 * 두 값의 비(≈3.5배)는 유지한다: 역전이 층위로 읽혀야 한다. */
const INK_NORMAL = 0.16;
const INK_INVERTED = 0.55;

/* Exported for guards/lab-tab.test.ts — 투영은 순수 모듈이 검사하지만,
 * 렌더 자체가 도는지는 실제로 그려 봐야 안다. */
export function SurfacePlot({
  payload,
  policy,
  width,
  height,
}: {
  payload: SurfacePayload;
  policy?: PolicyStep;
  width: number;
  height: number;
}) {
  const [hover, setHover] = useState<{ k: number; i: number } | null>(null);

  const box: Box = {
    x: PAD.left,
    y: PAD.top,
    w: width - PAD.left - PAD.right,
    h: height - PAD.top - PAD.bottom,
  };
  const { tenors, dates, z, inversionBp } = payload;
  /* 못 그릴 상자인지는 **훅을 다 지난 뒤에** 판정한다 (`degenerate` 아래).
   * 여기서 일찍 돌아가면 `ridgeLayer` 의 useMemo 가 조건부 훅이 되고, 창이
   * 좁았다 넓어지는 첫 순간에 훅 순서가 바뀐다. */
  const degenerate =
    box.w <= 0 || box.h <= 0 || !tenors.length || !dates.length;

  /* 그릴 능선은 상자 높이가 정한다 — 열보다 촘촘하면 **사이를 보간해** 채운다
     [OWNER, 2026-08-14]. 페이로드는 주별 그대로이고 hover 는 전부를 짚는다. */
  const slices = slicesFor(dates.length, box.h);
  const n = slices.length;
  const domain = domainOf(z, [policy?.latest]);

  /** 슬라이스가 서 있는 실측 열 — 날짜와 역전 부호는 여기서 읽는다. 보간은
   * 면을 만들 뿐이고, 날짜에는 소수 자리가 없다. */
  const columnOf = (k: number) => Math.round(slices[k].at);

  /* 바닥 격자 — 연이 바뀌는 첫 능선마다 뒤로 물러나는 눈금. Wilke 가 지우지
   * 말라고 한 그것이고, 이 그림에서 시간축이 축으로 읽히는 유일한 근거다. */
  const yearMarks: { k: number; year: string }[] = [];
  let prevYear = "";
  slices.forEach((_, k) => {
    const year = dates[columnOf(k)].slice(0, 4);
    if (year !== prevYear) {
      yearMarks.push({ k, year });
      prevYear = year;
    }
  });

  /* 세로 눈금 둘과 연도 라벨은 **같은 왼쪽 열**을 쓴다 — 연도는 물러나는
   * 왼쪽 모서리를 따라가야 하고(그것이 깊이 축이다), 눈금은 맨 앞 평면의
   * 것이라 둘 다 거기 선다. 그래서 부딪히는 자리가 반드시 생긴다. 규칙은
   * 하나다: **눈금이 이긴다** — 눈금이 없으면 높이가 아무 값도 아니게 되고,
   * 연도는 한 장 빠져도 위아래가 읽힌다. */
  const tickValues = [
    domain.min + (domain.max - domain.min) * 0.15,
    domain.max - (domain.max - domain.min) * 0.15,
  ];
  const tickYs = tickValues.map((v) => rateY(box, 0, v, domain));
  const collides = (y: number) => tickYs.some((t) => Math.abs(t - y) < 12);

  const hoverCol = hover ? columnOf(hover.k) : null;
  const hoverRates =
    hoverCol == null ? null : tenors.map((_, i) => z[i][hoverCol]);

  const ridgeLayer = useMemo(
    () =>
      slices.map(({ at }, k) => {
        const d = depthOf(k, n);
        const pts = ridgePoints(curveAtSlice(z, at), box, d, domain);
        const segs = segments(pts);
        if (!segs.length) return null;
        const inverted = (inversionBp[Math.round(at)] ?? 0) < 0;
        const base = ridgeBaseY(box, d);
        const first = pts.find(Boolean) as { x: number; y: number };
        const last = [...pts].reverse().find(Boolean) as { x: number; y: number };
        return (
          <g key={at}>
            <polygon
              points={`${first.x},${base} ${segs[0]} ${last.x},${base}`}
              className="fill-tile"
            />
            {segs.map((sg, si) => (
              <polyline
                key={si}
                points={sg}
                fill="none"
                stroke="currentColor"
                strokeWidth={inverted ? 1.2 : 1}
                strokeOpacity={inverted ? INK_INVERTED : INK_NORMAL}
                strokeLinejoin="round"
              />
            ))}
          </g>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [z, inversionBp, box.x, box.y, box.w, box.h, n, domain.min, domain.max],
  );

  if (degenerate) return null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    setHover({
      k: ridgeAtPoint(box, px, py, n),
      i: tenorAtPoint(box, px, py, tenors.length),
    });
  };

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="text-line"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`커브 표면 — ${tenors[0]}부터 ${tenors[tenors.length - 1]}까지, ${dates[0]}부터 ${payload.asof}까지`}
      >
        {/* 세로 눈금 두 개 — CurveView 와 같은 자리, 같은 문법(fmtAxis 는
            레벨보다 거친 축 전용 반올림이다). 맨 앞 능선의 축이다. */}
        {tickValues.map((v) => (
          <text
            key={v}
            x={PAD.left - 6}
            y={rateY(box, 0, v, domain) + 4}
            textAnchor="end"
            className="fill-ink"
            style={{ fontSize: 11, opacity: 0.5 }}
          >
            {fmtAxis(v, payload.unit)}
          </text>
        ))}

        {/* 바닥 — 연이 바뀌는 능선의 바닥선. 능선보다 **먼저** 그린다: 이 선은
            지형에 덮여야 맞다(덮이는 것이 깊이 단서다). 라벨은 반대로 덮이면
            안 되므로 능선 뒤에서 따로 그린다 — Wilke 가 지우지 말라고 한 격자는
            여기 있고, 안 보이는 격자는 지운 것과 같다. */}
        {yearMarks.map(({ k, year }) => {
          const d = depthOf(k, n);
          const { left } = ridgeSpanX(box, d);
          const y = ridgeBaseY(box, d);
          return (
            <line
              key={`floor-${year}`}
              x1={left}
              x2={left + box.w * (1 - RIDGE_SKEW)}
              y1={y}
              y2={y}
              className="stroke-edge"
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          );
        })}

        {/* 능선 — **먼 것부터**. 가까운 열이 자기 아래를 타일 색으로 채우며
            덮는다(floating horizon): 가림이 곧 깊이 단서라 흑백에서 그대로
            성립한다 (§5).

            hover 와 무관하므로 메모한다. 픽셀당 한 장이면 능선이 수백이고,
            마우스가 움직일 때마다 그걸 다시 만들면 지형이 아니라 슬라이드쇼가
            된다. */}
        {ridgeLayer}

        {/* 연도 — 능선 **뒤에** 그린다. 앞에 그리면 가까운 능선의 불투명
            채움이 덮어 버리고(2026-08-14 실측: 전부 사라졌다), 시간축이 축으로
            읽히는 유일한 근거가 함께 사라진다. 왼쪽 모서리 밖에 세워 지형과
            겹치지 않게 한다. */}
        {yearMarks.map(({ k, year }) => {
          const d = depthOf(k, n);
          const y = ridgeBaseY(box, d) + 3;
          if (collides(y)) return null;
          return (
            <text
              key={`year-${year}`}
              x={ridgeSpanX(box, d).left - 5}
              y={y}
              textAnchor="end"
              className="fill-ink"
              style={{ fontSize: 10, opacity: 0.5 }}
            >
              {year}
            </text>
          );
        })}

        {/* 정책금리 — 맨 앞 평면의 기준선 하나. 표면 위에 계단을 얹으면 능선
            수백 개 위에 수직 사건선이 서서 잡음이 되므로, CurveView 가 하는
            것과 같은 판정을 한다: 시간축이 아니라 **지금 수준**으로 그린다. */}
        {policy?.latest != null && (
          <>
            <line
              x1={box.x}
              x2={box.x + box.w * (1 - RIDGE_SKEW)}
              y1={rateY(box, 0, policy.latest, domain)}
              y2={rateY(box, 0, policy.latest, domain)}
              className="stroke-ref-policy"
              strokeWidth={1}
              strokeOpacity={0.35}
            />
            <text
              x={box.x + box.w * (1 - RIDGE_SKEW)}
              y={rateY(box, 0, policy.latest, domain) - 4}
              textAnchor="end"
              className="fill-ref-policy"
              style={{ fontSize: 10, opacity: 0.75 }}
            >
              기준금리 {policy.latest.toFixed(2)}
            </text>
          </>
        )}

        {/* 테너 라벨 — 맨 앞 능선의 아래. */}
        {tenors.map((t, i) => (
          <text
            key={t}
            x={tenorX(box, 0, i, tenors.length)}
            y={height - 8}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 10, opacity: 0.5 }}
          >
            {t}
          </text>
        ))}

        {/* 짚은 능선 — 표면 위의 단면. 옆의 2D 패널과 같은 날짜다. */}
        {hoverCol != null && hoverRates && (
          <>
            {segments(
              ridgePoints(hoverRates, box, depthOf(hover!.k, n), domain),
            ).map((s, si) => (
              <polyline
                key={si}
                points={s}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}
            {hoverRates[hover!.i] != null && (
              <circle
                cx={tenorX(box, depthOf(hover!.k, n), hover!.i, tenors.length)}
                cy={rateY(box, depthOf(hover!.k, n), hoverRates[hover!.i]!, domain)}
                r={3}
                fill="currentColor"
              />
            )}
          </>
        )}
      </svg>

      {/* 정확한 값 읽기용 2D — 표면은 모양을 보는 도구이지 숫자를 읽는
          도구가 아니다. 짚기 전에는 as-of 커브를 보여 준다(빈 자리가 생기면
          레이아웃이 hover 마다 흔들린다). */}
      <CutPanel
        payload={payload}
        col={hoverCol ?? dates.length - 1}
        tenorIndex={hover?.i ?? null}
        live={hoverCol != null}
      />
    </div>
  );
}

/** 한 날짜의 커브, 2D. 표면의 세로 축과 **같은 도메인**을 쓰지 않는다 —
 * 이쪽은 그 하루의 모양을 크게 보는 자리이고, 10년 레인지에 맞추면 하루치
 * 커브가 납작한 선이 된다. 대신 날짜를 크게 적어 어느 날인지 못 박는다. */
function CutPanel({
  payload,
  col,
  tenorIndex,
  live,
}: {
  payload: SurfacePayload;
  col: number;
  tenorIndex: number | null;
  live: boolean;
}) {
  const { tenors, dates, z, inversionBp, unit } = payload;
  const rates = tenors.map((_, i) => z[i][col]);
  const seen = rates.filter((v): v is number => v != null);
  if (!seen.length) return null;
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  const pad = (hi - lo) * 0.15 || 0.05;
  const box: Box = { x: 8, y: 22, w: CUT_W - 16, h: CUT_H - 46 };
  const domain = { min: lo - pad, max: hi + pad };
  const segs = segments(ridgePoints(rates, box, 0, domain));
  const inv = inversionBp[col];

  return (
    <div
      className="absolute right-0 top-0 rounded-control border border-edge bg-tile"
      style={{ width: CUT_W, height: CUT_H }}
    >
      <div className="flex items-baseline justify-between px-2 pt-1.5">
        <span className="text-[12px] tabular-nums">{dates[col]}</span>
        <span className="text-[11px] opacity-45">{live ? "짚은 날" : "현재"}</span>
      </div>
      <svg width={CUT_W} height={CUT_H - 18} className="text-line">
        {segs.map((s, i) => (
          <polyline
            key={i}
            points={s}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        ))}
        {rates.map((v, i) =>
          v == null ? null : (
            <circle
              key={tenors[i]}
              cx={tenorX(box, 0, i, tenors.length)}
              cy={rateY(box, 0, v, domain)}
              r={i === tenorIndex ? 3 : 1.8}
              fill="currentColor"
            />
          ),
        )}
      </svg>
      <div className="flex items-baseline justify-between px-2 pb-1 text-[11px]">
        <span className="opacity-55">
          {tenorIndex != null && rates[tenorIndex] != null
            ? `${tenors[tenorIndex]} ${fmtAxis(rates[tenorIndex]!, unit)}`
            : `${tenors[0]}~${tenors[tenors.length - 1]}`}
        </span>
        {/* 역전은 **서버가 준 부호**를 읽을 뿐이다 — 여기서 10Y − 2Y 를 빼면
            표의 스프레드 행과 표시 정밀도에서 어긋난다 (§16). */}
        <span className="tabular-nums opacity-55">
          {inv == null
            ? "—"
            : inv < 0
              ? `역전 ${payload.inversionPair} ${inv.toFixed(1)}bp`
              : `${payload.inversionPair} ${inv.toFixed(1)}bp`}
        </span>
      </div>
    </div>
  );
}

export function YieldSurface({ policy }: { policy?: PolicyStep }) {
  const q = useQuery({ queryKey: ["surface"], queryFn: fetchSurface });

  if (q.isPending) {
    return <p className="px-1 py-3 text-[13px] opacity-55">표면을 불러오는 중이에요.</p>;
  }
  if (q.isError || !q.data) {
    return (
      <p className="px-1 py-3 text-[13px] opacity-55">
        표면을 불러오지 못했어요. 백엔드가 떠 있는지 확인해 주세요.
      </p>
    );
  }

  const p = q.data;
  return <SurfaceBody payload={p} policy={policy} />;
}

/** 표면은 **pane 폭에 맞춘다**. 940 을 박아 뒀더니 좁은 좌측 pane 에서 단면
 * 패널이 통째로 잘렸다(2026-08-14 실측) — 이 탭은 오른쪽 아이들 커브 pane 과
 * 셸을 나눠 쓰므로 가용 폭이 창 폭이 아니다. `useMeasure` 는 이 리포의 다른
 * 수제 차트가 같은 이유로 쓰는 것이다.
 *
 * 높이는 폭에서 **유도**한다. 사다리가 세로의 0.70 이라 세로가 곧 시간축의
 * 해상도이고(능선 한 장이 픽셀 하나), 가로만 넓히면 지형이 납작해진다. */
function SurfaceBody({
  payload,
  policy,
}: {
  payload: SurfacePayload;
  policy?: PolicyStep;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const width = Math.max(MIN_PLOT_W, w);
  const height = Math.round(Math.min(MAX_PLOT_H, Math.max(MIN_PLOT_H, width * 0.66)));
  const p = payload;
  return (
    <div>
      <h2 className="text-[16px] font-semibold">커브 표면</h2>
      <p className="mt-1 text-[13px] leading-relaxed opacity-55">
        가로가 만기, 뒤로 물러나는 쪽이 시간, 높이가 금리예요. 능선 하나가{" "}
        {p.stride}영업일이고, 맨 앞이 {p.asof}예요. 커브가 역전된 날은 진하게
        그려요.
      </p>
      <p className="mt-1 text-[12px] opacity-40">
        Lab 의 실험 기능이에요. 피드백에 따라 본 탭으로 옮기거나 내려요.
      </p>
      {p.missingNodes.length > 0 && (
        <p className="mt-1 text-[12px] opacity-55">
          빠진 노드: {p.missingNodes.join(", ")}
        </p>
      )}
      <div className="mt-3 border-t border-edge pt-3" ref={ref}>
        {w > 0 && (
          <SurfacePlot
            payload={p}
            policy={policy}
            width={width}
            height={height}
          />
        )}
      </div>
    </div>
  );
}
