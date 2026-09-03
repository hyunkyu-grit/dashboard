'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import { useMeasure } from '@/ui/useMeasure';

import { OBJ_GLYPH, OBJ_LABEL, OBJ_VAR, type ObjType, type TermObject } from '../ontology';

/**
 * **타임라인** — 시간이 축인 화면.
 *
 * ── 왜 이 화면이 따로 있어야 하는가 ────────────────────────────────────────
 * 그래프는 「무엇과 닿아 있나」를 답하지만 **「언제」를 못 답한다** — 같은 그림이
 * 어제 것인지 석 달 치인지 알 수 없다. Gotham 이 그래프·타임라인·지도를 한
 * 프레임의 형제 애플리케이션으로 두는 이유가 그것이다: 같은 객체 집합을 세 축
 * (관계·시간·공간)에서 본다. 이 데스크에 공간 축은 없으므로 둘만 만든다.
 *
 * ── 레인 ───────────────────────────────────────────────────────────────────
 * 종류마다 한 줄. 한 줄에 다 쏟으면 금통위 세 개가 체결 600개에 묻힌다 —
 * 레인이 있어야 «드문 사건» 이 눈에 남고, 드문 사건이야말로 이 축에서 찾는
 * 것이다. 체결처럼 빽빽한 레인은 개별 점이 아니라 **시간 버킷의 막대**로
 * 그린다(점 600개는 선 하나로 뭉쳐서 아무것도 안 말한다).
 *
 * ── 초점 + 맥락 (focus + context) ──────────────────────────────────────────
 * 첫 판은 한 축에 전부 얹었고, **체결 레인이 마지막 한 칸으로 뭉갰다**(실측):
 * 금통위·발행은 석 달에 걸쳐 있는데 체결 600건은 이틀 안에 있어서, 선형 축에서
 * 이틀은 1.5% 폭이다. 「분포를 보라」고 만든 레인이 선 하나가 된 것이다.
 *
 * 축을 하나 더 두는 것이 이 문제의 표준 해법이고 Gotham 도 그렇게 한다:
 *
 *     위(초점)  지금 보고 있는 구간만. 브러시가 이 축의 범위를 정한다.
 *     아래(맥락) **언제나 전체 범위.** 지금 어디를 보고 있는지가 여기 표시된다.
 *
 * 맥락 띠가 없으면 확대한 순간 「전체 중 어디인지」를 잃는다 — 그러면 확대가
 * 길을 잃게 만드는 기능이 된다. 끌기는 맥락 띠에서만 받는다(초점 축에서도
 * 받으면 사건을 누르려다 확대가 걸린다).
 *
 * ── 키보드 [WCAG 2.1.1 · 2026-08-27] ──────────────────────────────────────
 * 확대가 **끌기에만** 있었다. 끌기는 마우스나 트랙패드의 동작이라, 그 둘이 없는
 * 사람에게 이 축은 «전체를 한 번 보는» 화면 이상이 못 됐다 — 그리고 이 화면의
 * 요점은 확대다(발행 분포가 이틀에 몰려 있어서 확대하지 않으면 선 하나다).
 *
 * 그래서 셋을 더한다: 사건 사이를 화살표로 짚기 · `+`/`−`/`0` 으로 확대·되돌리기 ·
 * `Shift+←/→` 로 창을 옆으로 밀기. 전부 **그래프 축과 같은 키**다 — 축마다 다른
 * 키를 쓰면 축을 바꿀 때마다 새로 배워야 한다.
 */

/** 레인 순서 — 드문 것이 위. 아래로 갈수록 빽빽해지므로 눈이 위에서부터 훑으면
 *  «사건 → 흐름» 순으로 읽힌다. */
/** 시간축에 서는 실제 종류 셋. 드문 것이 위 — 아래로 갈수록 빽빽해지므로 눈이
 *  위에서부터 훑으면 «사건 → 흐름» 순으로 읽힌다.
 *
 *  `event`(금통위·공개시장운영·지준) → `auction`(국고채 입찰) → `issue`(발행)
 *  순이고, 마지막 것만 개수가 많아 분포로 그린다. */
const LANES: ObjType[] = ['event', 'auction', 'issue'];
const LANE_H = 32;
const AXIS_H = 24;
const PAD_X = 12;
/** 오른쪽 인셋 — **확대 손잡이가 앉는 자리**를 축에서 미리 빼 둔다.
 *
 * 처음엔 손잡이를 그림 위에 그냥 띄웠고, 축의 마지막 눈금(구간 끝 날짜)이 그
 * 아래로 들어가 반쯤 가려졌다(실측 2026-08-27). 이 리포는 **글자 겹침을 잘림과
 * 같은 등급의 결함**으로 다룬다(CLAUDE.md 「말줄임 절대 금지」 3). 그래서 겹치는
 * 것을 옮기는 대신 **자리를 비운다** — 축이 짧아진 만큼이 손잡이의 폭이고,
 * 비어 있는 오른쪽이 «저기까지가 축» 이라고 말한다.
 *
 * 144 = 버튼 셋(각 40) + 테두리 + `right: 8`. `.sr-term-zoom` 의 폭이 바뀌면 이
 * 수도 같이 바뀌어야 한다 — 그 결합을 여기 적어 둔다. */
const PAD_R = 144;
/** 맥락 띠의 높이(축 라벨 포함). 초점 축과 헷갈리지 않을 만큼 낮고, 미니 분포가
 *  형태를 유지할 만큼은 높다. */
const CTX_H = 40;

/** ── 체결 레인은 **남는 높이를 전부 쓴다** (실측 2026-08-26) ────────────────
 *
 * 첫 판은 세 레인이 다 32px 이었고, 776px 짜리 상자에서 **100px 만 쓰고
 * 676px 이 비었다**. 빈 공간이 문제가 아니라, 그 상태에서 체결 분포가 18px
 * 높이라 봉우리 차이가 안 읽혔다는 것이 문제였다 — 「분포를 보라」고 만든
 * 레인이 화면에서 제일 작았다.
 *
 * 사건 레인(금통위·발행)은 32 로 둔다. 그것들은 «있다/없다» 라서 높이가 뜻을
 * 갖지 않고, 오히려 낮아야 드문 사건이 한눈에 세어진다. 높이가 뜻을 갖는 것은
 * 체결 하나뿐이고, 그래서 남는 높이도 그쪽으로 간다. */
const TRADE_MIN_H = 96;
/** 체결 레인의 버킷 수. 폭을 이걸로 나눈다 — 화면이 넓어지면 더 잘게 보이도록
 *  픽셀 기준으로 잡는 대신 고정한 이유는, 버킷 수가 창 크기마다 바뀌면 같은
 *  데이터가 창을 줄일 때 다른 모양이 되기 때문이다. */
const BUCKETS = 72;

export function TimelineApp({
  objects,
  focusId,
  onFocus,
  range,
  onRange,
}: {
  /** 필터를 통과한 객체 — 시간이 있는 것만 여기서 걸러 쓴다. */
  objects: TermObject[];
  focusId: string | null;
  onFocus: (id: string) => void;
  /** 브러시 구간. `null` 이면 전체. */
  range: [number, number] | null;
  onRange: (r: [number, number] | null) => void;
}) {
  const [boxRef, w, h] = useMeasure<HTMLDivElement>();
  const dragRef = useRef<{ x0: number } | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  /** 화살표가 짚고 있는 사건. 그래프와 같은 문법이다 — 짚기와 고르기가 갈라져
   *  있어야 훑어볼 수 있다. `-1` 은 «아직 안 짚음». */
  const [cursor, setCursor] = useState(-1);

  /* ⚠ **인라인 화살표 ref 를 쓰면 안 된다** (실측 2026-08-26: 브라우저가 얼었다).
   *
   * 이 상자는 `useMeasure` 의 콜백 ref 와 드래그용 `plotRef` 둘 다 받아야 해서
   * 처음엔 `ref={(n) => { boxRef(n); plotRef.current = n; }}` 로 합쳤다. 인라인
   * 화살표는 **렌더마다 새 함수**이고, React 는 ref 함수가 바뀌면 이전 것을
   * `null` 로 부르고 새 것을 노드로 부른다. `useMeasure` 는 그때마다
   * ResizeObserver 를 끊었다 다시 붙이고 즉시 한 번 측정하는데(그 파일이 «즉시
   * 한 번 재는» 이유를 적어 둔 그 동작), 그 측정이 `setState` 라 다시 렌더가
   * 돌고, 다시 새 ref 가 만들어진다 — 멈추지 않는다.
   *
   * `useCallback` 으로 고정하면 ref 는 마운트에 한 번만 불린다. 이건
   * `useMeasure` 머리 주석이 «늦게 생기는 요소를 재려면 콜백 ref» 라고 말하는
   * 그 규칙의 뒷면이다: 콜백이어야 하되 **안정된** 콜백이어야 한다. */
  const setBox = useCallback(
    (n: HTMLDivElement | null) => {
      boxRef(n);
      plotRef.current = n;
    },
    [boxRef],
  );

  const timed = useMemo(() => objects.filter((o) => o.t != null), [objects]);

  /** 전체 범위 — 맥락 띠와 브러시 좌표의 기준. 필터가 바뀌어도 이 축은 «지금
   *  결과의 전체» 를 뜻하므로 `timed` 를 따라간다. */
  const ctx = useMemo(() => {
    const ts = timed.map((o) => o.t!);
    const lo = ts.length ? Math.min(...ts) : 0;
    const hi = ts.length ? Math.max(...ts) : 1;
    const iw = Math.max(1, w - PAD_X - PAD_R);
    return {
      lo,
      hi,
      iw,
      xOf: (t: number) => PAD_X + ((t - lo) / (hi - lo || 1)) * iw,
      tOf: (x: number) => lo + ((x - PAD_X) / iw) * (hi - lo || 1),
    };
  }, [timed, w]);

  /** 초점 범위 — 브러시가 있으면 그 구간, 없으면 전체. 레인이 이 축에 선다. */
  const geo = useMemo(() => {
    const lo = range ? range[0] : ctx.lo;
    const hi = range ? range[1] : ctx.hi;
    const iw = ctx.iw;
    return {
      lo,
      hi,
      iw,
      xOf: (t: number) => PAD_X + ((t - lo) / (hi - lo || 1)) * iw,
      tOf: (x: number) => lo + ((x - PAD_X) / iw) * (hi - lo || 1),
    };
  }, [ctx, range]);

  /** 사건 레인 — 높이가 고정. `LANES` 의 순서를 지킨다(드문 것이 위). */
  const eventLanes = useMemo(
    () =>
      LANES.filter((t) => t !== 'issue')
        .map((type) => ({ type, items: timed.filter((o) => o.type === type) }))
        .filter((l) => l.items.length > 0),
    [timed],
  );

  const trades = useMemo(() => timed.filter((o) => o.type === 'issue'), [timed]);

  /** 버킷 히스토그램. 초점축과 맥락축이 **같은 함수**를 쓴다 — 두 벌로 두면
   *  둘이 다른 규칙으로 세는 날이 온다. 범위 밖은 세지 않는다(초점축에서
   *  확대했을 때 밖의 것이 가장자리 칸에 쌓이면 없는 봉우리가 생긴다). */
  const histo = useCallback(
    (lo: number, hi: number) => {
      if (trades.length === 0) return [];
      const counts = new Array(BUCKETS).fill(0);
      for (const o of trades) {
        const f = (o.t! - lo) / (hi - lo || 1);
        if (f < 0 || f > 1) continue;
        counts[Math.min(BUCKETS - 1, Math.floor(f * BUCKETS))] += 1;
      }
      const max = Math.max(1, ...counts);
      return counts.map((n, i) => ({ i, n, f: n / max }));
    },
    [trades],
  );

  const tradeBars = useMemo(() => histo(geo.lo, geo.hi), [histo, geo]);
  const ctxBars = useMemo(() => histo(ctx.lo, ctx.hi), [histo, ctx]);
  /** 축에 눈금을 안 그리는 대신 **최대값을 라벨로 적는다**. 막대 높이가 상대값
   *  이라 이 수가 없으면 「크다」만 알고 「얼마나」를 모른다. */
  const maxPerBucket = useMemo(
    () => tradeBars.reduce((m, b) => Math.max(m, b.n), 0),
    [tradeBars],
  );

  /* 끌기는 **맥락 띠에서만** 받는다. 초점 축에서도 받으면 사건 표시를 누르려다
     확대가 걸린다(그리고 그 실수는 되돌리기가 두 단계다). */
  const onDown = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      const box = plotRef.current?.getBoundingClientRect();
      if (!box) return;
      dragRef.current = { x0: e.clientX - box.left };
      onRange(null);
    },
    [onRange],
  );

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      const box = plotRef.current?.getBoundingClientRect();
      if (!d || !box) return;
      const x1 = e.clientX - box.left;
      /* 8px 미만은 끌기가 아니라 클릭이다 — 안 거르면 누를 때마다 폭 0 구간이
         걸려서 화면이 비어 버린다. */
      if (Math.abs(x1 - d.x0) < 8) return;
      /* 축 밖으로 끌고 나가도 구간은 축 안에 머문다 — 밖은 시간이 없는 자리다. */
      const a = Math.max(ctx.lo, ctx.tOf(Math.min(d.x0, x1)));
      const b = Math.min(ctx.hi, ctx.tOf(Math.max(d.x0, x1)));
      if (b <= a) return;
      onRange([a, b]);
    },
    [ctx, onRange],
  );

  const onUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  /* ── 키보드 ───────────────────────────────────────────────────────────────
     짚을 수 있는 것은 **사건**이다(금통위·공개시장운영·입찰). 발행은 개별 점이
     아니라 버킷 막대라 짚을 자리가 없다 — 그림에 없는 것을 키보드에만 만들면
     둘이 다른 화면이 된다. */
  const marks = useMemo(
    () => timed.filter((o) => o.type !== 'issue').sort((a, b) => a.t! - b.t!),
    [timed],
  );

  useEffect(() => {
    setCursor((c) => (c >= marks.length ? marks.length - 1 : c));
  }, [marks.length]);

  /** 초점 구간을 배율만큼 좁히거나 넓힌다. **전체보다 넓어지면 `null`** 로
   *  되돌린다 — 「전체」와 「전체와 같은 크기의 구간」이 둘 다 있으면 칩이
   *  걸렸다 안 걸렸다 하면서 같은 화면을 두 상태로 만든다. */
  const zoom = useCallback(
    (factor: number) => {
      const lo = range ? range[0] : ctx.lo;
      const hi = range ? range[1] : ctx.hi;
      const mid = (lo + hi) / 2;
      const half = ((hi - lo) / 2) * factor;
      if (half * 2 >= ctx.hi - ctx.lo) {
        onRange(null);
        return;
      }
      /* 하루보다 좁게는 안 간다 — 이 축의 값이 전부 UTC 자정이라 그보다 좁히면
         아무것도 안 남는 창이 된다. */
      const h2 = Math.max(half, 43_200_000);
      onRange([Math.max(ctx.lo, mid - h2), Math.min(ctx.hi, mid + h2)]);
    },
    [range, ctx, onRange],
  );

  /** 창을 그대로 두고 옆으로 민다. 확대해 놓고 다음 주를 보려면 이것이 필요한데,
   *  없으면 확대를 풀었다가 다시 걸어야 한다. */
  const pan = useCallback(
    (dir: number) => {
      if (!range) return;
      const span = range[1] - range[0];
      const step = span * 0.5 * dir;
      let lo = range[0] + step;
      let hi = range[1] + step;
      /* 가장자리에서는 **밀리지 않고 멈춘다** — 넘어가면 창이 줄어들어서, 미는
         동작이 확대가 되어 버린다. */
      if (lo < ctx.lo) {
        lo = ctx.lo;
        hi = lo + span;
      }
      if (hi > ctx.hi) {
        hi = ctx.hi;
        lo = hi - span;
      }
      onRange([lo, hi]);
    },
    [range, ctx, onRange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = marks.length;
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        pan(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (n > 0) setCursor((c) => (c < 0 ? 0 : (c + 1) % n));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (n > 0) setCursor((c) => (c < 0 ? n - 1 : (c - 1 + n) % n));
          break;
        case 'Home':
          e.preventDefault();
          if (n > 0) setCursor(0);
          break;
        case 'End':
          e.preventDefault();
          if (n > 0) setCursor(n - 1);
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const m = marks[cursor];
          if (m) onFocus(m.id);
          break;
        }
        case '+':
        case '=':
          e.preventDefault();
          zoom(1 / 1.5);
          break;
        case '-':
          e.preventDefault();
          zoom(1.5);
          break;
        case '0':
          e.preventDefault();
          onRange(null);
          break;
        default:
          break;
      }
    },
    [marks, cursor, onFocus, zoom, pan, onRange],
  );

  const at = cursor >= 0 ? marks[cursor] : undefined;

  const laneTop = (i: number) => AXIS_H + i * LANE_H;
  const tradeTop = AXIS_H + eventLanes.length * LANE_H;
  const tradeH = Math.max(TRADE_MIN_H, h - CTX_H - tradeTop);

  return (
    <div
      className="sr-term-plot"
      ref={setBox}
      role="application"
      aria-label="시간축 — 화살표로 사건을 짚고, Enter 로 그리로 갑니다. 더하기·빼기로 구간을 좁히고 넓히며, Shift+화살표로 창을 옮깁니다."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      <div className="sr-term-dotgrid" />
      {w > 0 && h > 0 ? (
        <svg width={w} height={h} style={{ display: 'block' }}>
          {/* 축 — 눈금 다섯. 그 이상은 20% 폭에서 라벨이 붙는다. */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const x = PAD_X + f * geo.iw;
            return (
              <g key={f}>
                <line className="sr-term-gridline" x1={x} y1={AXIS_H} x2={x} y2={h - CTX_H} />
                <text className="sr-term-tick" x={x} y={14} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                  {ymd(geo.lo + (geo.hi - geo.lo) * f)}
                </text>
              </g>
            );
          })}

          {eventLanes.map((lane, li) => {
            const top = laneTop(li);
            return (
              <g key={lane.type} style={{ color: OBJ_VAR[lane.type] }}>
                <text className="sr-term-lanelabel" x={PAD_X} y={top + 10}>
                  {OBJ_LABEL[lane.type]} · {lane.items.length.toLocaleString('ko-KR')}
                </text>
                {lane.items.map((o) => (
                  <g
                    key={o.id}
                    className="sr-term-tlmark"
                    data-on={o.id === focusId}
                    data-cursor={at?.id === o.id || undefined}
                    onClick={() => onFocus(o.id)}
                  >
                    <line
                      className="sr-term-tlstem"
                      x1={geo.xOf(o.t!)}
                      y1={top + 12}
                      x2={geo.xOf(o.t!)}
                      y2={top + LANE_H - 2}
                    />
                    <text
                      className="sr-term-tlglyph"
                      x={geo.xOf(o.t!)}
                      y={top + LANE_H - 2}
                      textAnchor="middle"
                    >
                      {OBJ_GLYPH[o.type]}
                    </text>
                    {/* 판정 넓히기 — 줄기는 1px 이라 그대로 두면 «못 누르는
                        화면» 이다(WCAG 2.2 §2.5.8). 보이는 것과 닿는 것을 따로
                        둔다: 그래프의 판정 원과 같은 규칙이다. */}
                    <rect
                      className="sr-term-hit"
                      x={geo.xOf(o.t!) - 12}
                      y={top}
                      width={24}
                      height={LANE_H}
                    />
                  </g>
                ))}
              </g>
            );
          })}

          {/* 체결 — 남는 높이를 전부 쓰는 분포. 여기서만 높이가 뜻을 갖는다. */}
          {trades.length > 0 ? (
            <g style={{ color: OBJ_VAR.issue }}>
              <text className="sr-term-lanelabel" x={PAD_X} y={tradeTop + 10}>
                발행 · {trades.length.toLocaleString('ko-KR')} · 버킷당 최대 {maxPerBucket}건
              </text>
              <line
                className="sr-term-gridline"
                x1={PAD_X}
                y1={tradeTop + tradeH - 2}
                x2={PAD_X + geo.iw}
                y2={tradeTop + tradeH - 2}
              />
              {tradeBars.map((b) => {
                const bw = geo.iw / BUCKETS;
                const bh = Math.max(b.n > 0 ? 1 : 0, b.f * (tradeH - 18));
                return (
                  <rect
                    key={b.i}
                    className="sr-term-tlbar"
                    x={PAD_X + b.i * bw}
                    y={tradeTop + tradeH - 2 - bh}
                    width={Math.max(1, bw - 1)}
                    height={bh}
                  />
                );
              })}
            </g>
          ) : null}

          {/* ── 맥락 띠 ─────────────────────────────────────────────────────
              언제나 **전체 범위**. 미니 분포 + 지금 보고 있는 구간. 끌기를 받는
              투명 rect 가 맨 위에 깔린다. */}
          <g transform={`translate(0, ${h - CTX_H})`}>
            <line className="sr-term-gridline" x1={0} y1={0} x2={w} y2={0} />
            <text className="sr-term-lanelabel" x={PAD_X} y={11}>
              전체 · 끌어서 구간
            </text>
            {ctxBars.map((b) => {
              const bw = ctx.iw / BUCKETS;
              const bh = Math.max(1, b.f * 12);
              return (
                <rect
                  key={b.i}
                  className="sr-term-tlbar"
                  style={{ color: OBJ_VAR.issue }}
                  x={PAD_X + b.i * bw}
                  y={CTX_H - 4 - bh}
                  width={Math.max(1, bw - 1)}
                  height={bh}
                />
              );
            })}
            {range ? (
              <rect
                className="sr-term-brush"
                x={ctx.xOf(range[0])}
                y={2}
                width={Math.max(2, ctx.xOf(range[1]) - ctx.xOf(range[0]))}
                height={CTX_H - 4}
              />
            ) : null}
            {/* 끌기를 받는 자리는 **축이 있는 만큼**이다. 예전에는 상자 전체
                (`x=0, width=w`)였고, 그러면 축 밖에서 끌기 시작한 좌표가 축의
                범위를 벗어난 시각으로 환산됐다 — 화면에 없는 구간이 걸린다. */}
            <rect
              className="sr-term-ctxhit"
              x={PAD_X}
              y={0}
              width={ctx.iw}
              height={CTX_H}
              onMouseDown={onDown}
            />
          </g>
        </svg>
      ) : null}

      {/* 확대 손잡이 — 그래프 축과 **같은 자리·같은 모양**이다. 축을 바꿨을 때
          컨트롤이 옮겨 다니면 그때마다 눈이 다시 찾는다. */}
      <div className="sr-term-zoom" role="group" aria-label="구간">
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={() => zoom(1 / 1.5)}
          aria-label="구간 좁히기"
          title="좁히기 (+)"
        >
          +
        </button>
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={() => zoom(1.5)}
          disabled={!range}
          aria-label="구간 넓히기"
          title="넓히기 (−)"
        >
          −
        </button>
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={() => onRange(null)}
          disabled={!range}
          title="전체로 (0)"
        >
          전체
        </button>
      </div>

      {/* 짚은 사건을 소리로 읽는다 — 그림 안의 표시는 눈에만 있다. */}
      <span className="sr-a11y-only" aria-live="polite">
        {at ? `${OBJ_LABEL[at.type]} · ${at.title} · ${at.subtitle}` : ''}
      </span>

      {timed.length === 0 ? (
        <div className="sr-term-empty">
          <Text font="label2" color="fgMuted">
            지금 필터에는 시간이 있는 객체가 없습니다
          </Text>
          <span className="sr-term-eyebrow">발행 · 입찰 · 일정만 시간축에 섭니다</span>
        </div>
      ) : null}
    </div>
  );
}

const p2 = (n: number) => String(n).padStart(2, '0');

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
