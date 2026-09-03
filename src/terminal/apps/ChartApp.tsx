'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import type { Unit } from '@/lib/api';
import { fmtLevel } from '@/lib/format';
import { universeSeriesUrl } from '@/lib/staticPaths';
import { directionVar } from '@/theme/tint';
import { ErrorState, LoadingState } from '@/ui/DataState';
import { useMeasure } from '@/ui/useMeasure';

import type { TermObject } from '../ontology';

/**
 * **값** 축 — 고른 계열의 실제 시계열.
 *
 * ── 지어낸 시계열을 지웠다 [OWNER 2026-08-26] ──────────────────────────────
 * 앞선 판은 LCG 랜덤워크를 그렸다. 이 백엔드에는 **진짜 시계열이 있다** —
 * `/api/universe/series/{id}` 가 2020-01-02 부터의 일별 값을 준다(BSS-3Y 실측:
 * 1,600여 점). 그래서 그것을 읽는다.
 *
 * ── 이 화면이 CDS 차트가 아닌 이유는 그대로다 ──────────────────────────────
 * 계측 격자·픽셀 발광·축 가장자리 좌표 상자 셋은 CDS `CartesianChart` 가 내주는
 * 표면이 아니다. 손으로 그리는 것은 이 리포의 기존 어휘이고(`ui/useMeasure.ts`
 * 머리의 "hand-rolled charts", `ui/Surface3D.tsx`), 부품은 최대한 그대로 쓴다:
 * 상자 재기 `useMeasure`, 주선 색 `directionVar`, 값 서식 `fmtLevel`,
 * 로딩·에러 표시 `ui/DataState`.
 *
 * ── 커서는 상태가 아니다 ────────────────────────────────────────────────────
 * 십자선 자리는 CSS 변수로, 좌표 상자의 글자는 `textContent` 로 직접 쓴다.
 * `useState` 로 두면 마우스가 1px 움직일 때마다 이 컴포넌트가 다시 그려지고,
 * 1,600점짜리 경로에서 그건 공짜가 아니다. 기법은 `ui/ReadoutCard.tsx` 의
 * `placeReadout` 과 같은 것이다.
 *
 * **키보드 커서는 상태다.** 키는 눌린 횟수만큼만 오므로 다시 그리는 비용이
 * 프레임마다가 아니라 누를 때마다이고, 그 대신 «지금 몇 번째 점을 짚고 있나» 가
 * 렌더에 참여해야 표시와 읽어 주는 문장이 한 곳에서 나온다.
 *
 * ── 키보드와 확대 [WCAG 2.1.1 · Shneiderman «zoom» · 2026-08-27] ───────────
 * 이 축은 **마우스에만** 있었다: 값을 읽는 유일한 길이 십자선이라, 마우스가 없는
 * 사람에게 이 화면은 선 하나였다. 그리고 구간 버튼(1M…ALL)은 «끝에서부터 며칠»
 * 이라 2022년 어느 달을 들여다볼 방법이 없었다.
 *
 * 그래서 둘을 더한다. ←/→ 로 점을 짚으면 그 값이 좌표 상자와 **읽어 주는 줄**에
 * 동시에 서고, 끌어서 고른 구간으로 확대한다(0 으로 되돌린다). 키는 그래프·
 * 시간축과 같은 것을 쓴다.
 */

const INSET = { top: 12, right: 12, bottom: 16, left: 48 };
const GRID_ROWS = 4;

/** 구간 — **점 개수**가 아니라 영업일 수로 자른다. 실제 시계열이라 구간마다
 *  점 밀도가 다르고, 개수로 자르면 「1년」이 계열마다 다른 기간이 된다. */
const SPANS = [
  { key: '1M', days: 22 },
  { key: '3M', days: 66 },
  { key: '6M', days: 132 },
  { key: '1Y', days: 260 },
  { key: 'ALL', days: null },
] as const;

export type SpanKey = (typeof SPANS)[number]['key'];
export const CHART_SPANS = SPANS.map((s) => s.key);

type Point = { t: string; v: number };

export function ChartApp({
  target,
  span,
  onSpan,
  note,
}: {
  /** 그릴 계열. 계열이 아닌 객체를 고른 채 이 축으로 오면 셸이 그 객체와 닿은
   *  계열을 넘긴다 — 축을 바꿨다고 보고 있던 대상이 사라지면 안 된다. */
  target: TermObject | null;
  span: SpanKey;
  onSpan: (s: SpanKey) => void;
  note?: string;
}) {
  const [boxRef, w, h] = useMeasure<HTMLDivElement>();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const xBoxRef = useRef<HTMLDivElement | null>(null);
  const yBoxRef = useRef<HTMLDivElement | null>(null);

  /** 끌어서 고른 확대 구간 — 구간 버튼이 자른 **뒤**의 점 배열에 대한 첨자다.
   *  값이 아니라 첨자인 이유: 점 간격이 고르지 않아(휴일) 값으로 자르면 같은
   *  픽셀 폭이 계열마다 다른 개수를 담는다. */
  const [zoomIdx, setZoomIdx] = useState<[number, number] | null>(null);
  /** 키보드가 짚고 있는 점. `-1` 이면 안 짚음 — 마우스만 쓰는 화면에 표시가
   *  뜨지 않게 하는 값이다. */
  const [kb, setKb] = useState(-1);
  const dragRef = useRef<{ x0: number } | null>(null);

  const [raw, setRaw] = useState<{ id: string; unit: Unit; points: Point[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 재시도 — `ErrorState` 가 요구하는 손잡이다(이 리포의 에러 화면은 **되돌릴
   *  방법 없이** 서지 않는다). 세는 수를 바꿔 효과를 다시 돌린다. */
  const [attempt, setAttempt] = useState(0);

  const id = target?.type === 'instrument' ? target.id : null;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setBusy(true);
    setErr(null);
    fetch(universeSeriesUrl(id))
      .then((r) => {
        if (!r.ok) throw new Error(`series ${id}: HTTP ${r.status}`);
        return r.json();
      })
      .then((body: { id: string; unit: Unit; points: Point[] }) => {
        if (alive) setRaw(body);
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const spanPoints = useMemo(() => {
    const all = (raw?.points ?? []).filter((p) => p.v != null);
    const days = SPANS.find((s) => s.key === span)?.days ?? null;
    return days == null ? all : all.slice(-days);
  }, [raw, span]);

  const points = useMemo(() => {
    if (!zoomIdx) return spanPoints;
    const [a, b] = zoomIdx;
    return spanPoints.slice(a, b + 1);
  }, [spanPoints, zoomIdx]);

  /* 계열이나 구간이 바뀌면 확대와 짚은 자리를 되돌린다 — 다른 계열의 첨자를
     그대로 들고 있으면 «엉뚱한 데를 확대한 채로» 열린다. */
  useEffect(() => {
    setZoomIdx(null);
    setKb(-1);
  }, [id, span]);

  const unit: Unit = raw?.unit ?? '%';

  const geo = useMemo(() => {
    const iw = Math.max(1, w - INSET.left - INSET.right);
    const ih = Math.max(1, h - INSET.top - INSET.bottom);
    const vs = points.map((p) => p.v);
    const lo = vs.length ? Math.min(...vs) : 0;
    const hi = vs.length ? Math.max(...vs) : 1;
    const pad = (hi - lo) * 0.05 || 0.01;
    const y0 = lo - pad;
    const y1 = hi + pad;
    const stepX = points.length > 1 ? iw / (points.length - 1) : 0;
    return {
      iw,
      ih,
      y0,
      y1,
      stepX,
      xOf: (i: number) => INSET.left + i * stepX,
      yOf: (v: number) => INSET.top + ih - ((v - y0) / (y1 - y0)) * ih,
    };
  }, [w, h, points]);

  const path = useMemo(() => {
    if (w === 0 || points.length === 0) return { line: '', area: '' };
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${geo.xOf(i).toFixed(2)} ${geo.yOf(p.v).toFixed(2)}`)
      .join(' ');
    const floor = (INSET.top + geo.ih).toFixed(2);
    return {
      line: d,
      area: `${d} L${geo.xOf(points.length - 1).toFixed(2)} ${floor} L${geo.xOf(0).toFixed(2)} ${floor} Z`,
    };
  }, [geo, points, w]);

  /* 주선 색 = **보이는 구간의 순변화** 방향색 [캐논 차트 문법]. */
  const net = points.length > 1 ? points[points.length - 1].v - points[0].v : 0;
  const ink = directionVar(net);

  /** 화면 x → 지금 그려진 점의 첨자. 십자선과 확대가 **같은 함수**를 쓴다 —
   *  두 벌이면 끌어서 고른 구간이 십자선이 짚던 점과 한 칸씩 어긋난다. */
  const indexAt = useCallback(
    (x: number) =>
      Math.max(0, Math.min(points.length - 1, Math.round((x - INSET.left) / (geo.stepX || 1)))),
    [points.length, geo.stepX],
  );

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = plotRef.current;
      if (!el || points.length === 0) return;
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const i = indexAt(x);
      const cx = geo.xOf(i);
      const cy = Math.max(INSET.top, Math.min(INSET.top + geo.ih, y));
      const value = geo.y1 - ((cy - INSET.top) / geo.ih) * (geo.y1 - geo.y0);
      el.style.setProperty('--sr-term-cx', `${cx.toFixed(1)}px`);
      el.style.setProperty('--sr-term-cy', `${cy.toFixed(1)}px`);
      el.style.setProperty('--sr-term-snapy', `${geo.yOf(points[i].v).toFixed(1)}px`);
      el.dataset.on = 'true';
      if (xBoxRef.current) xBoxRef.current.textContent = points[i].t;
      if (yBoxRef.current) yBoxRef.current.textContent = fmtLevel(value, unit);
    },
    [geo, points, unit, indexAt],
  );

  /** 짚은 점을 십자선과 좌표 상자에 세운다. 마우스가 쓰는 것과 **같은 자리**에
   *  쓴다 — 키보드용 표시를 따로 만들면 같은 화면에 커서가 둘이 된다. */
  const paintKb = useCallback(() => {
    const el = plotRef.current;
    if (!el) return false;
    const p = kb >= 0 ? points[kb] : undefined;
    if (!p) return false;
    el.style.setProperty('--sr-term-cx', `${geo.xOf(kb).toFixed(1)}px`);
    el.style.setProperty('--sr-term-cy', `${geo.yOf(p.v).toFixed(1)}px`);
    el.style.setProperty('--sr-term-snapy', `${geo.yOf(p.v).toFixed(1)}px`);
    el.dataset.on = 'true';
    if (xBoxRef.current) xBoxRef.current.textContent = p.t;
    if (yBoxRef.current) yBoxRef.current.textContent = fmtLevel(p.v, unit);
    return true;
  }, [kb, points, geo, unit]);

  /** 마우스가 나가면 십자선을 거둔다 — **키보드가 짚고 있으면 그 자리로
   *  되돌린다.** 안 되돌리면 마우스가 스쳐 지나간 자리에 표시가 남아, 키보드로
   *  읽던 값과 화면의 값이 갈린다. */
  const onLeave = useCallback(() => {
    dragRef.current = null;
    if (!paintKb() && plotRef.current) plotRef.current.dataset.on = 'false';
  }, [paintKb]);

  const onDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box) return;
    dragRef.current = { x0: e.clientX - box.left };
  }, []);

  const onUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      dragRef.current = null;
      const box = plotRef.current?.getBoundingClientRect();
      if (!d || !box || points.length < 3) return;
      const x1 = e.clientX - box.left;
      /* 8px 미만은 끌기가 아니라 클릭이다 — 타임라인 브러시와 같은 문턱이다.
         안 거르면 십자선을 세우려고 누를 때마다 폭 0 짜리 확대가 걸린다. */
      if (Math.abs(x1 - d.x0) < 8) return;
      const a = indexAt(Math.min(d.x0, x1));
      const b = indexAt(Math.max(d.x0, x1));
      /* 세 점보다 적게 남기지 않는다 — 두 점짜리 차트는 선분 하나라 볼 것이 없고,
         거기서 더 확대할 방법도 없다(되돌리기밖에). */
      if (b - a < 2) return;
      const base = zoomIdx ? zoomIdx[0] : 0;
      setZoomIdx([base + a, base + b]);
      setKb(-1);
    },
    [indexAt, points.length, zoomIdx],
  );

  useEffect(() => {
    if (kb < 0 && plotRef.current) plotRef.current.dataset.on = 'false';
    else paintKb();
  }, [kb, paintKb]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = points.length;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (n > 0) setKb((c) => Math.min(n - 1, (c < 0 ? n - 1 : c) + step));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (n > 0) setKb((c) => Math.max(0, (c < 0 ? n - 1 : c) - step));
          break;
        case 'Home':
          e.preventDefault();
          if (n > 0) setKb(0);
          break;
        case 'End':
          e.preventDefault();
          if (n > 0) setKb(n - 1);
          break;
        case '+':
        case '=': {
          /* 짚은 자리를 가운데 두고 좁힌다. 안 짚었으면 지금 창의 가운데다. */
          e.preventDefault();
          if (n < 6) break;
          const mid = kb >= 0 ? kb : Math.floor(n / 2);
          const half = Math.max(2, Math.floor(n / 4));
          const base = zoomIdx ? zoomIdx[0] : 0;
          setZoomIdx([base + Math.max(0, mid - half), base + Math.min(n - 1, mid + half)]);
          setKb(-1);
          break;
        }
        case '-': {
          /* 넓히기 — 지금 창의 두 배. 원본 전체를 덮으면 확대를 아예 푼다.
             («전체와 같은 크기의 확대» 를 남기지 않는 것은 시간축과 같은 규칙.) */
          e.preventDefault();
          if (!zoomIdx) break;
          const [a, b] = zoomIdx;
          const grow = Math.max(1, Math.floor((b - a) / 2));
          const a2 = a - grow;
          const b2 = b + grow;
          if (a2 <= 0 && b2 >= spanPoints.length - 1) setZoomIdx(null);
          else setZoomIdx([Math.max(0, a2), Math.min(spanPoints.length - 1, b2)]);
          setKb(-1);
          break;
        }
        case '0':
          e.preventDefault();
          setZoomIdx(null);
          setKb(-1);
          break;
        default:
          break;
      }
    },
    [points.length, kb, zoomIdx, spanPoints.length],
  );

  const ticks = useMemo(() => {
    const out: { y: number; label: string }[] = [];
    for (let k = 0; k <= GRID_ROWS; k++) {
      const v = geo.y0 + ((geo.y1 - geo.y0) * k) / GRID_ROWS;
      out.push({ y: geo.yOf(v), label: fmtLevel(v, unit) });
    }
    return out;
  }, [geo, unit]);

  const hi = points.length ? Math.max(...points.map((p) => p.v)) : 0;
  const lo = points.length ? Math.min(...points.map((p) => p.v)) : 0;
  const last = points.length ? points[points.length - 1] : null;

  return (
    <>
      <div className="sr-term-appbar">
        <div className="sr-term-seg" role="group" aria-label="구간">
          {SPANS.map((sp) => (
            <button
              key={sp.key}
              type="button"
              className="sr-term-seg-btn"
              data-on={sp.key === span}
              aria-pressed={sp.key === span}
              onClick={() => onSpan(sp.key)}
            >
              {sp.key}
            </button>
          ))}
        </div>
        {/* 확대 중이라는 사실은 **화면에 있어야 한다.** 없으면 「1Y 인데 왜
            석 달만 보이지」가 답이 없는 질문이 된다(조용한 절단 금지). */}
        {zoomIdx ? (
          <button
            type="button"
            className="sr-term-seg-btn sr-term-clear"
            onClick={() => {
              setZoomIdx(null);
              setKb(-1);
            }}
            title="구간 확대를 되돌립니다 (0)"
          >
            {`구간 확대 중 · 되돌리기`}
          </button>
        ) : null}

        <Text font="legal" color="fgMuted" noWrap>
          {note ? `${note} · ` : ''}
          {target ? target.title : '계열 없음'}
          {points.length > 0 ? ` · ${points.length.toLocaleString('ko-KR')}점` : ''}
          {last ? ` · ${last.t}` : ''}
        </Text>
      </div>

      <div className="sr-term-body" ref={boxRef} style={{ overflow: 'hidden', display: 'flex' }}>
        <div
          className="sr-term-plot"
          ref={plotRef}
          data-on="false"
          role="application"
          aria-label="시계열 — 화살표로 점을 짚고(Shift 로 열 칸씩), 끌어서 그 구간으로 확대합니다. 0 으로 되돌립니다."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseDown={onDown}
          onMouseUp={onUp}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          <div className="sr-term-dotgrid" />

          {!id ? (
            <div className="sr-term-empty">
              <Text font="label2" color="fgMuted">
                계열을 고르면 그 계열의 실제 시계열이 섭니다
              </Text>
              <span className="sr-term-eyebrow">/api/universe/series</span>
            </div>
          ) : err ? (
            <div className="sr-term-empty">
              <ErrorState what="시계열" detail={err} onRetry={() => setAttempt((n) => n + 1)} />
            </div>
          ) : busy && points.length === 0 ? (
            <div className="sr-term-empty">
              <LoadingState what="시계열" />
            </div>
          ) : w > 0 && h > 0 && points.length > 0 ? (
            <svg width={w} height={h} style={{ display: 'block', color: ink }} aria-hidden>
              {ticks.map((t) => (
                <g key={`${t.label}-${t.y}`}>
                  <line
                    className="sr-term-gridline"
                    x1={INSET.left}
                    x2={w - INSET.right}
                    y1={t.y}
                    y2={t.y}
                  />
                  <text className="sr-term-tick" x={2} y={t.y + 3}>
                    {t.label}
                  </text>
                </g>
              ))}
              <path className="sr-term-area" d={path.area} />
              <path className="sr-term-line" d={path.line} />
            </svg>
          ) : null}

          <div className="sr-term-cross sr-term-cross-x" />
          <div className="sr-term-cross sr-term-cross-y" />
          <div className="sr-term-cursordot" />
          <div className="sr-term-axisbox sr-term-axisbox-x" ref={xBoxRef} />
          <div className="sr-term-axisbox sr-term-axisbox-y" ref={yBoxRef} />

          {/* 짚은 점을 소리로 읽는다. 좌표 상자는 `textContent` 로 쓰이는
              그림의 일부라 스크린 리더가 알아서 읽지 않는다 — CLAUDE.md 규칙 7
              이 «읽을 DOM 이 없으면 `.sr-a11y-only` 의 aria-live 줄이 진다» 고
              적어 둔 그 자리다. 키보드로 짚은 것만 읽는다(마우스로 스치는 것을
              전부 읽으면 문장이 끊이지 않는다). */}
          <span className="sr-a11y-only" aria-live="polite">
            {kb >= 0 && points[kb]
              ? `${points[kb].t} · ${fmtLevel(points[kb].v, unit)}`
              : ''}
          </span>
        </div>
      </div>

      {points.length > 0 ? (
        <div className="sr-term-facts sr-term-sep">
          <Fact
            label="구간 순변화"
            value={`${net > 0 ? '↗' : net < 0 ? '↘' : ''} ${fmtLevel(Math.abs(net), unit)}`}
            ink={ink}
          />
          <Fact label="최고" value={fmtLevel(hi, unit)} />
          <Fact label="최저" value={fmtLevel(lo, unit)} />
          <Fact label="최근" value={last ? fmtLevel(last.v, unit) : '—'} />
        </div>
      ) : null}
    </>
  );
}

/** 값이 크고 라벨이 그 아래 작게 서는 문법. `ui/Stat.tsx` 와 같은 것의 더 작은
 *  판이다 — 캐논 `Stat` 은 카드 안 두 줄(caption + title3)이라 이 높이에 안 든다. */
function Fact({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <div className="sr-term-fact">
      <Text font="label2" tabularNumbers noWrap style={ink ? { color: ink } : undefined}>
        {value}
      </Text>
      <span className="sr-term-eyebrow">{label}</span>
    </div>
  );
}
