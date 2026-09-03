'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Text } from '@coinbase/cds-web/typography';

import { useMeasure } from '@/ui/useMeasure';

import {
  LINK_LABEL,
  type LinkKind,
  OBJ_GLYPH,
  OBJ_LABEL,
  OBJ_VAR,
  type Ontology,
  otherEnd,
  type TermLink,
  type TermObject,
} from '../ontology';

/**
 * **링크 그래프** — Gotham 의 서명 화면.
 *
 * ── 무엇을 재현하는가 ──────────────────────────────────────────────────────
 * 「하나를 고르고, 거기서 뻗어 나간다」(search-around). 표가 답하지 못하는 질문
 * 하나를 답하기 위해서다 — **「이것과 닿아 있는 것이 무엇인가」**. 원장에서
 * `KTB10Y` 를 아무리 정렬해도 「그 계열이 무엇에서 나왔고 무엇 대비로 재는지」는
 * 안 나오는데, 그래프에서는 그것이 모양이다.
 *
 * ── 왜 물리 시뮬레이션이 아닌가 ────────────────────────────────────────────
 * force-directed 레이아웃은 매 프레임 위치가 바뀌므로 (a) 서버·클라이언트 렌더가
 * 갈리고, (b) **같은 데이터가 매번 다른 그림**이 되어 어제 스크린샷과 비교할 수
 * 없다. 이 리포의 목업 규율(`series.ts` 머리)이 그 둘을 금한다.
 *
 * 그래서 **초점 방사(focus radial)** 다: 고른 객체를 가운데 두고, 1촌을 링크
 * 종류별로 각을 나눠 고리에 앉히고, 2촌은 그 바깥 고리에 앉힌다. 결정론이고,
 * 무엇보다 **읽힌다** — 고리 하나가 곧 「한 다리 건넜다」라서 거리가 뜻을 갖는다.
 * force 그래프의 거리는 뜻이 없다(용수철 상수의 결과일 뿐이다).
 *
 * ── 각도를 링크 종류로 묶는다 ───────────────────────────────────────────────
 * 1촌을 그냥 균등하게 돌리면 발행 스무 개 사이에 구성 하나가 끼어 섞인다. 종류로
 * 부채꼴을 나누면 「이쪽은 구성, 저쪽은 만기」가 각도만으로 읽히고, 그것이
 * 링크에 이름이 있다는 사실을 화면이 쓰는 방법이다.
 *
 * ── 확대·이동 [Shneiderman 의 «zoom», 2026-08-27] ──────────────────────────
 * 일곱 과업 감사에서 zoom 만 «타임라인에만 있음» 으로 남아 있었다. 관계 축에
 * 그것이 없다는 것은 부채꼴을 펼쳐 스물넷을 세운 순간 라벨이 서로를 덮어도
 * 들여다볼 방법이 없다는 뜻이다.
 *
 * 확대는 **레이아웃을 다시 계산하지 않는다** — 좌표는 그대로 두고 화면 변환만
 * 바꾼다(`<g transform>`). 다시 계산하면 확대할 때마다 노드가 자리를 옮겨서,
 * 「같은 데이터는 같은 그림」이라는 이 파일의 첫 결정을 확대가 무너뜨린다.
 *
 * 손잡이는 셋이다: 휠(커서 자리를 중심으로) · 바탕 끌기 · 버튼과 키. 셋을 다
 * 두는 이유는 하나가 남의 것이기 때문이다 — 휠은 마우스의 것, 끌기는 트랙패드의
 * 것, 버튼과 키는 그 둘이 다 없는 사람의 것이다.
 *
 * ── 키보드 [WCAG 2.1.1 · 2026-08-27] ──────────────────────────────────────
 * 첫 판의 그래프는 **마우스 전용**이었다. 노드가 `<g onClick>` 이라 탭으로 닿지
 * 않았고, 그래서 search-around 이라는 이 화면의 주된 동작이 키보드에는 아예 없는
 * 기능이었다(도시에의 링크 목록이 그 대역이었지만, 그건 «그래프를 못 쓰는 사람은
 * 목록을 쓰라» 는 뜻이다).
 *
 * 노드마다 탭 정지를 두지는 않는다 — 부채꼴 하나가 여덟이라 서른 번 탭이 된다.
 * 표와 **같은 문법**을 쓴다(roving): 그래프 전체가 탭 정지 한 칸이고, 그 안에서
 * 화살표가 이웃을 짚는다. 짚기와 고르기가 갈라져 있는 것도 표와 같다 — 짚는
 * 동안에는 화면이 안 움직이고, `Enter` 를 눌러야 그리로 간다.
 */

/** 고리 반지름 비율. 상자의 짧은 변에 곱한다 — 창이 넓어져도 그래프가 옆으로만
 *  늘어나 납작해지지 않는다. */
const R1 = 0.3;
const R2 = 0.46;
/** 한 링크 종류의 부채꼴에 세우는 최대 개수.
 *
 * ── 실측으로 정한 수 (2026-08-26) ──────────────────────────────────────────
 * 첫 판은 28 이었고, 고차수 노드를 고르면 서른 몇 개가 한 부채꼴에 꽉 차서
 * **라벨이 서로를 완전히 덮었다**. 다 그리는 것이 덜 보여주는 것이 되는 지점이
 * 있고, 여기서는 그게 열 개 근처였다.
 *
 * 그래서 Gotham 이 고차수 노드에 하는 것을 그대로 한다: **묶음 노드로 접고,
 * 누르면 펼친다.** 접힌 상태가 기본인 이유는 「이 계열에 발행이 32건 있다」가
 * 32개의 점보다 먼저 알아야 하는 사실이기 때문이다. */
const MAX_FAN = 8;

/** 확대 범위와 한 걸음. 0.6 아래로는 라벨이 안 읽히고, 4 위로는 부채꼴 하나가
 *  화면을 넘어 «어디에 있는지» 를 잃는다(실측). 한 걸음 1.25 는 휠 한 칸과
 *  버튼 한 번이 같은 크기로 움직이게 하려고 한 값으로 맞춘 것이다. */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

/** 눌러야 하는 것은 **최소 24px** 이어야 한다(WCAG 2.2 §2.5.8 Target Size).
 *  1촌 점의 반지름은 5px 이라 지름이 10px 밖에 안 됐다 — 손이 떨리는 사람에게는
 *  그게 «못 누르는 화면» 이다. 그림은 그대로 두고 **투명한 판정 원**을 덧댄다:
 *  보이는 것과 닿는 것을 따로 두는 것이 이 지침의 표준 해법이다. */
const HIT_R = 12;

type Placed = {
  o: TermObject;
  x: number;
  y: number;
  ring: 0 | 1 | 2;
  via?: TermLink;
};

/** 접힌 묶음 하나. 노드처럼 그려지지만 객체가 아니다 — 누르면 펼쳐진다. */
type Cluster = { kind: LinkKind; n: number; x: number; y: number };

/** 화살표가 짚고 다니는 자리 하나. 노드이거나 묶음이다 — 묶음도 «누를 수 있는
 *  것» 이라 키보드에서 빠지면 접힌 서른 개로 가는 길이 마우스에만 있게 된다. */
type Stop =
  | { kind: 'node'; id: string; ring: 0 | 1 | 2; angle: number; label: string; what: string }
  | { kind: 'cluster'; id: string; ring: 1; angle: number; label: string; what: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function GraphApp({
  ontology,
  focusId,
  onFocus,
  visible,
  onClearFilters,
}: {
  /** 온톨로지는 **주입받는다** — 모듈 상수였을 때는 지어낸 데이터였고, 이제는
   *  백엔드에서 온 것이라 컴포넌트가 그것을 만들 수 없다. */
  ontology: Ontology;
  focusId: string | null;
  onFocus: (id: string) => void;
  /** 필터를 통과한 객체 id — 그래프도 Object Explorer 를 따른다. 안 따르면
   *  왼쪽에서 거른 것이 가운데에 그대로 남아 두 패널이 서로를 부정한다. */
  visible: Set<string>;
  /** 필터에 가려 이웃이 안 보일 때 빠져나갈 문. 아래 「막다른 길」 주석 참조. */
  onClearFilters: () => void;
}) {
  const [measureRef, w, h] = useMeasure<HTMLDivElement>();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  /* ⚠ 인라인 화살표 ref 금지 — `TimelineApp` 머리에 이 리포가 브라우저를 얼려
     본 실측이 적혀 있다. 콜백이되 **안정된** 콜백이어야 한다. */
  const setBox = useCallback(
    (n: HTMLDivElement | null) => {
      measureRef(n);
      plotRef.current = n;
    },
    [measureRef],
  );

  /** 펼친 링크 종류. 초점이 바뀌면 접힌 상태로 되돌린다 — 앞 객체에서 펼친
   *  것이 다음 객체에도 펼쳐져 있으면 «이 객체는 원래 이렇게 크다» 로 읽힌다. */
  const [expanded, setExpanded] = useState<Set<LinkKind>>(new Set());

  /** 화면 변환. 레이아웃이 아니라 **보는 자리**다(머리 주석). */
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });

  /** 화살표가 짚고 있는 자리. `-1` 이면 아직 아무것도 안 짚었다 — 마우스만 쓰는
   *  사람의 화면에 초점 테두리가 뜨지 않게 하는 값이다. */
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    setExpanded(new Set());
    /* 초점이 바뀌면 방사가 통째로 다시 그려진다. 확대를 그대로 두면 새 그림의
       엉뚱한 구석을 보고 있게 되므로 같이 되돌린다 — 「어디로 갔는지 모르겠다」의
       흔한 원인이 이것이다. */
    setView({ k: 1, tx: 0, ty: 0 });
    setCursor(-1);
  }, [focusId]);

  const layout = useMemo(() => {
    const empty = {
      nodes: [] as Placed[],
      edges: [] as Placed[],
      clusters: [] as Cluster[],
      labels: [] as { kind: LinkKind; x: number; y: number }[],
      stops: [] as Stop[],
      /* 이른 반환에도 같은 모양을 준다 — 두 갈래가 다른 모양을 내면 읽는 쪽이
         둘 다 다뤄야 하고, 그 분기는 화면 코드가 질 일이 아니다. */
      hidden: 0,
    };
    if (!focusId || w === 0 || h === 0) return empty;
    const focus = ontology.byId.get(focusId);
    if (!focus) return empty;

    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h);

    /* 1촌 — 링크 종류로 묶는다. */
    const first = (ontology.adj.get(focusId) ?? [])
      .map((l) => ({ l, o: ontology.byId.get(otherEnd(l, focusId)) }))
      .filter((x): x is { l: TermLink; o: TermObject } => !!x.o && visible.has(x.o.id));

    const groups = new Map<string, { l: TermLink; o: TermObject }[]>();
    for (const x of first) {
      if (!groups.has(x.l.kind)) groups.set(x.l.kind, []);
      groups.get(x.l.kind)!.push(x);
    }

    const nodes: Placed[] = [{ o: focus, x: cx, y: cy, ring: 0 }];
    const clusters: Cluster[] = [];
    const labels: { kind: LinkKind; x: number; y: number }[] = [];
    const angleOf = new Map<string, number>();
    const kinds = [...groups.keys()] as LinkKind[];
    /* 부채꼴을 종류 수로 나누고, 각 부채꼴 안에서 균등. 위(−90°)에서 시작하는
       이유는 첫 종류가 화면 위에 서야 목록처럼 읽히기 때문이다. */
    kinds.forEach((kind, gi) => {
      const all = groups.get(kind)!;
      const open = expanded.has(kind);
      const cap = open ? Math.min(all.length, 24) : MAX_FAN;
      const items = all.slice(0, cap);
      const rest = all.length - items.length;
      const span = (Math.PI * 2) / kinds.length;
      const a0 = -Math.PI / 2 + span * gi;
      /* 묶음 노드가 붙으면 그것도 한 자리를 먹는다. */
      const slots = items.length + (rest > 0 ? 1 : 0);
      const at = (i: number) => {
        /* 부채꼴 양끝에 여백(0.08)을 남긴다 — 안 남기면 이웃 종류의 첫 노드와
           마지막 노드가 붙어서 경계가 안 보인다. */
        const f = slots === 1 ? 0.5 : 0.08 + (i / (slots - 1)) * 0.84;
        return a0 + span * f;
      };
      items.forEach((x, i) => {
        const a = at(i);
        angleOf.set(x.o.id, a);
        nodes.push({
          o: x.o,
          x: cx + Math.cos(a) * base * R1,
          y: cy + Math.sin(a) * base * R1,
          ring: 1,
          via: x.l,
        });
      });
      if (rest > 0) {
        const a = at(slots - 1);
        angleOf.set(`cluster:${kind}`, a);
        clusters.push({
          kind,
          n: rest,
          x: cx + Math.cos(a) * base * R1,
          y: cy + Math.sin(a) * base * R1,
        });
      }
      /* 링크 이름은 **부채꼴당 한 번**. 스포크마다 적었더니 서른 두 개가 가운데
         에서 겹쳐 글자 덩어리가 됐다(실측). 이름은 그 부채꼴 전체를 설명하는
         것이지 선 하나를 설명하는 것이 아니다. */
      const am = a0 + span * 0.5;
      labels.push({
        kind,
        x: cx + Math.cos(am) * base * R1 * 0.55,
        y: cy + Math.sin(am) * base * R1 * 0.55,
      });
    });

    /* 2촌 — 1촌 각각에서 하나씩만. 전부 그리면 이웃의 이웃이 폭발한다.
       「한 다리 더 있다」를 보여주는 것이 목적이지 전수 열거가 아니다. */
    const seen = new Set(nodes.map((n) => n.o.id));
    const ring1 = nodes.filter((n) => n.ring === 1);
    ring1.forEach((n, i) => {
      const cand = (ontology.adj.get(n.o.id) ?? [])
        .map((l) => ({ l, o: ontology.byId.get(otherEnd(l, n.o.id)) }))
        .find((x) => x.o && !seen.has(x.o.id) && visible.has(x.o.id));
      if (!cand?.o) return;
      seen.add(cand.o.id);
      const a = Math.atan2(n.y - cy, n.x - cx) + (i % 2 === 0 ? 0.06 : -0.06);
      angleOf.set(cand.o.id, a);
      nodes.push({
        o: cand.o,
        x: cx + Math.cos(a) * base * R2,
        y: cy + Math.sin(a) * base * R2,
        ring: 2,
        via: cand.l,
      });
    });

    /* 필터에 가려진 이웃 수 — 아래 「막다른 길」이 읽는다. */
    const allNeighbours = new Set(
      (ontology.adj.get(focusId) ?? []).map((l) => otherEnd(l, focusId)),
    );
    const hidden = [...allNeighbours].filter((id) => !visible.has(id)).length;

    /* 화살표가 도는 순서 — **고리 안에서 각도순**이다. 배열에 담긴 순서(=종류별
       부채꼴 순서)로 돌면 화면에서 오른쪽 노드로 갔는데 커서는 왼쪽으로 뛴다.
       눈이 보는 것과 키가 하는 것이 같아야 한다. */
    const stops: Stop[] = [
      ...nodes
        .filter((n) => n.ring === 0)
        .map<Stop>((n) => ({
          kind: 'node',
          id: n.o.id,
          ring: 0,
          angle: 0,
          label: n.o.title,
          what: `${OBJ_LABEL[n.o.type]} · 지금 초점`,
        })),
      ...nodes
        .filter((n) => n.ring === 1)
        .map<Stop>((n) => ({
          kind: 'node',
          id: n.o.id,
          ring: 1,
          angle: angleOf.get(n.o.id) ?? 0,
          label: n.o.title,
          what: `${OBJ_LABEL[n.o.type]} · ${LINK_LABEL[n.via!.kind]} · 1촌`,
        })),
      ...clusters.map<Stop>((c) => ({
        kind: 'cluster',
        id: `cluster:${c.kind}`,
        ring: 1,
        angle: angleOf.get(`cluster:${c.kind}`) ?? 0,
        label: `${LINK_LABEL[c.kind]} ${c.n}개 더`,
        what: '펼치면 이 부채꼴에 더 섭니다',
      })),
      ...nodes
        .filter((n) => n.ring === 2)
        .map<Stop>((n) => ({
          kind: 'node',
          id: n.o.id,
          ring: 2,
          angle: angleOf.get(n.o.id) ?? 0,
          label: n.o.title,
          what: `${OBJ_LABEL[n.o.type]} · 2촌`,
        })),
    ];
    stops.sort((a, b) => a.ring - b.ring || a.angle - b.angle);

    return { nodes, edges: nodes.filter((n) => n.ring > 0), clusters, labels, stops, hidden };
  }, [ontology, focusId, w, h, visible, expanded]);

  const posOf = useCallback(
    (id: string) => layout.nodes.find((n) => n.o.id === id),
    [layout.nodes],
  );

  /* 짚은 자리가 범위를 벗어나면 되돌린다(부채꼴을 펼쳐 자리 수가 바뀔 때). */
  useEffect(() => {
    setCursor((c) => (c >= layout.stops.length ? layout.stops.length - 1 : c));
  }, [layout.stops.length]);

  const expand = useCallback((kind: LinkKind) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(kind);
      return next;
    });
  }, []);

  /* ── 확대 ─────────────────────────────────────────────────────────────── */

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      if (k === v.k) return v;
      const r = k / v.k;
      /* 커서 아래의 점이 **제자리에 남는다**. 그래서 「이걸 키운다」가 되고,
         화면 한가운데를 키우면 보고 있던 것이 밖으로 밀려난다. */
      return { k, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r };
    });
  }, []);

  const zoomCentre = useCallback(
    (factor: number) => zoomAt(factor, w / 2, h / 2),
    [zoomAt, w, h],
  );

  const resetView = useCallback(() => setView({ k: 1, tx: 0, ty: 0 }), []);

  /* React 의 `onWheel` 은 **passive** 로 붙는다 — 그 안에서 `preventDefault()`
     가 무시되고 페이지가 같이 스크롤된다. 이 리포가 이미 한 번 밟은 자리라
     (`sauron-v2 레인6` 의 그 함정) 네이티브로 붙인다. */
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /** 바탕 끌기. 노드에서 시작한 끌기는 여기 안 온다 — 판정 원이 위에 있고,
   *  그 위의 `mousedown` 은 이 rect 에 닿지 않기 때문이다. */
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const onPanStart = useCallback(
    (e: React.MouseEvent) => {
      panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    },
    [view.tx, view.ty],
  );

  const onPanMove = useCallback((e: React.MouseEvent) => {
    const p = panRef.current;
    if (!p) return;
    setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }));
  }, []);

  const onPanEnd = useCallback(() => {
    panRef.current = null;
  }, []);

  /* ── 키보드 ───────────────────────────────────────────────────────────── */

  const move = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const n = layout.stops.length;
        if (n === 0) return -1;
        if (c < 0) return delta > 0 ? 0 : n - 1;
        return (c + delta + n) % n;
      });
    },
    [layout.stops.length],
  );

  /** 고리를 바꾼다 — **각도를 지키며**. 위/아래는 「한 다리 안쪽/바깥쪽」이고,
   *  그때 화면에서 엉뚱한 방향으로 튀지 않으려면 지금 각도에 제일 가까운 자리로
   *  가야 한다. */
  const moveRing = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const stops = layout.stops;
        if (stops.length === 0) return -1;
        if (c < 0) return 0;
        const here = stops[c];
        const want = clamp(here.ring + delta, 0, 2);
        if (want === here.ring) return c;
        let best = -1;
        let bestGap = Infinity;
        stops.forEach((s, i) => {
          if (s.ring !== want) return;
          /* 각도 차이는 원 위의 거리다 — 359°와 1°는 2° 떨어져 있다. */
          const raw = Math.abs(s.angle - here.angle) % (Math.PI * 2);
          const gap = Math.min(raw, Math.PI * 2 - raw);
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        });
        return best < 0 ? c : best;
      });
    },
    [layout.stops],
  );

  const activate = useCallback(() => {
    const s = layout.stops[cursor];
    if (!s) return;
    if (s.kind === 'cluster') expand(s.id.slice('cluster:'.length) as LinkKind);
    else onFocus(s.id);
  }, [cursor, layout.stops, expand, onFocus]);

  /* 이 키들은 **그래프에 초점이 있을 때만** 듣는다. `+`·`−`·`0` 은 글자 키
     하나라 전역이면 WCAG 2.1.4 의 대상이 되는데, 초점 안에서만 듣는 것은 그
     기준이 명시한 예외다("Active only on focus"). */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          move(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          move(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveRing(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveRing(-1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          activate();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomCentre(ZOOM_STEP);
          break;
        case '-':
          e.preventDefault();
          zoomCentre(1 / ZOOM_STEP);
          break;
        case '0':
          e.preventDefault();
          resetView();
          break;
        default:
          break;
      }
    },
    [move, moveRing, activate, zoomCentre, resetView],
  );

  const showTip = useCallback((e: React.MouseEvent, o: TermObject) => {
    const tip = tipRef.current;
    if (!tip) return;
    const box = tip.parentElement!.getBoundingClientRect();
    tip.style.setProperty('--sr-term-cx', `${e.clientX - box.left}px`);
    tip.style.setProperty('--sr-term-cy', `${e.clientY - box.top}px`);
    tip.dataset.on = 'true';
    tip.textContent = `${OBJ_LABEL[o.type]} · ${o.title} — ${o.subtitle}`;
  }, []);

  const hideTip = useCallback(() => {
    if (tipRef.current) tipRef.current.dataset.on = 'false';
  }, []);

  const at = cursor >= 0 ? layout.stops[cursor] : undefined;

  if (!focusId) {
    return (
      <div className="sr-term-plot" ref={setBox}>
        <div className="sr-term-dotgrid" />
        <div className="sr-term-empty">
          <Text font="label2" color="fgMuted">
            객체를 하나 고르면 거기서 뻗어 나갑니다
          </Text>
          <span className="sr-term-eyebrow">Search-around · 1촌 · 2촌</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="sr-term-plot"
      ref={setBox}
      /* `application` 은 «여기서는 화살표가 브라우저 것이 아니라 이 위젯 것» 을
         보조기술에 알리는 역할이다. 라벨이 그 문법을 한 줄로 적는다 — 규칙을
         안 적으면 화살표를 눌러 볼 이유가 없다. */
      role="application"
      aria-label="관계 그래프 — 화살표로 이웃을 짚고, Enter 로 그리로 갑니다. 더하기·빼기로 확대, 0 으로 되돌립니다."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={onPanMove}
      onMouseUp={onPanEnd}
      onMouseLeave={() => {
        onPanEnd();
        hideTip();
      }}
    >
      <div className="sr-term-dotgrid" />
      {w > 0 && h > 0 ? (
        <svg width={w} height={h} style={{ display: 'block' }}>
          {/* 바탕 — 끌기를 받는다. 맨 아래에 깔려 노드의 판정 원에 안 가린다. */}
          <rect
            className="sr-term-panhit"
            x={0}
            y={0}
            width={w}
            height={h}
            onMouseDown={onPanStart}
          />

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {/* 선 먼저 — 노드가 그 위에 앉아야 선이 노드를 가리지 않는다. */}
            {layout.edges.map((n) => {
              const from = n.ring === 1 ? posOf(focusId) : posOf(otherEnd(n.via!, n.o.id));
              if (!from) return null;
              return (
                <line
                  key={`e-${n.o.id}`}
                  className="sr-term-edge"
                  data-ring={n.ring}
                  x1={from.x}
                  y1={from.y}
                  x2={n.x}
                  y2={n.y}
                />
              );
            })}

            {/* 부채꼴 이름 — 종류당 하나. */}
            {layout.labels.map((l) => (
              <text
                key={'l-' + l.kind}
                className="sr-term-edgelabel"
                x={l.x}
                y={l.y}
                textAnchor="middle"
              >
                {LINK_LABEL[l.kind]}
              </text>
            ))}

            {/* 묶음 — 누르면 펼친다. 접힌 것이 기본인 이유는 「32건 있다」가
                32개의 점보다 먼저 알아야 하는 사실이기 때문이다. */}
            {layout.clusters.map((c) => (
              <g
                key={'c-' + c.kind}
                className="sr-term-cluster"
                data-cursor={at?.id === `cluster:${c.kind}` || undefined}
                onClick={() => expand(c.kind)}
              >
                <circle className="sr-term-cluster-dot" cx={c.x} cy={c.y} r={11} />
                <text className="sr-term-cluster-n" x={c.x} y={c.y + 3} textAnchor="middle">
                  {c.n > 99 ? '99+' : c.n}
                </text>
                <text className="sr-term-node-label" x={c.x} y={c.y + 24} textAnchor="middle">
                  펼치기
                </text>
                <circle className="sr-term-hit" cx={c.x} cy={c.y} r={HIT_R / view.k} />
              </g>
            ))}

            {layout.nodes.map((n) => (
              <g
                key={n.o.id}
                className="sr-term-node"
                data-ring={n.ring}
                data-cursor={at?.id === n.o.id || undefined}
                style={{ color: OBJ_VAR[n.o.type] }}
                onClick={() => onFocus(n.o.id)}
                onMouseMove={(e) => showTip(e, n.o)}
              >
                <circle className="sr-term-node-dot" cx={n.x} cy={n.y} r={n.ring === 0 ? 9 : 5} />
                <text
                  className="sr-term-node-glyph"
                  x={n.x}
                  y={n.y + (n.ring === 0 ? 4 : 3)}
                  textAnchor="middle"
                >
                  {OBJ_GLYPH[n.o.type]}
                </text>
                {/* 이름은 1촌까지. 2촌은 점만 — 「더 있다」가 그 고리의 전부다. */}
                {n.ring <= 1 ? (
                  <text
                    className="sr-term-node-label"
                    x={n.x}
                    y={n.y + (n.ring === 0 ? 26 : 18)}
                    textAnchor="middle"
                  >
                    {n.o.title}
                  </text>
                ) : null}
                {/* 판정 원 — 확대해도 **화면에서 24px** 이도록 배율로 나눈다.
                    안 나누면 축소했을 때 판정이 같이 작아져서, 작아 보일수록
                    더 정확히 눌러야 하는 화면이 된다. */}
                <circle className="sr-term-hit" cx={n.x} cy={n.y} r={HIT_R / view.k} />
              </g>
            ))}
          </g>
        </svg>
      ) : null}

      {/* ── 확대 손잡이 ─────────────────────────────────────────────────
          휠과 키가 이미 있는데 버튼도 두는 이유: 휠은 마우스에만 있고, 키는
          그래프에 초점이 있을 때만 듣는다. 버튼은 둘 다 아닌 사람의 길이고,
          동시에 «이 화면은 확대된다» 는 사실을 화면에 적는 유일한 자리다. */}
      <div className="sr-term-zoom" role="group" aria-label="확대">
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={() => zoomCentre(ZOOM_STEP)}
          disabled={view.k >= ZOOM_MAX}
          aria-label="확대"
          title="확대 (+)"
        >
          +
        </button>
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={() => zoomCentre(1 / ZOOM_STEP)}
          disabled={view.k <= ZOOM_MIN}
          aria-label="축소"
          title="축소 (−)"
        >
          −
        </button>
        <button
          type="button"
          className="sr-term-seg-btn"
          onClick={resetView}
          disabled={view.k === 1 && view.tx === 0 && view.ty === 0}
          title="처음 자리로 (0)"
        >
          {`${view.k.toFixed(1)}×`}
        </button>
      </div>

      {/* ── 막다른 길을 막는다 ───────────────────────────────────────────
          초점만 남고 사방이 빈 그래프는 «고장» 으로 읽힌다. 실제로는 필터가
          이웃을 전부 가린 것이고, 그건 되돌릴 수 있는 상태다.

          Nielsen Norman Group 의 필터 지침이 «zero-results dead end 를 만들지
          말라 / 지금 무엇이 걸려 있는지와 빠져나갈 길을 같이 주라» 고 하는 그
          자리다. 숫자를 적는 이유도 같다 — «몇 개가 가려졌나» 를 알아야
          필터를 풀지 좁힐지 정할 수 있다. */}
      {layout.nodes.length === 1 && layout.hidden > 0 ? (
        <div className="sr-term-deadend">
          <Text font="legal" color="fgMuted">
            {`이웃 ${layout.hidden.toLocaleString('ko-KR')}개가 지금 필터에 가려져 있어요`}
          </Text>
          <button type="button" className="sr-term-seg-btn sr-term-clear" onClick={onClearFilters}>
            필터 비우기
          </button>
        </div>
      ) : null}

      <div className="sr-term-tip" ref={tipRef} data-on="false" />

      {/* 짚은 자리를 **소리로** 읽는다. 그림 안의 초점 테두리는 눈에만 보이고,
          그래프는 이 화면에서 가장 «보이는 것에만 있는» 정보다. */}
      <span className="sr-a11y-only" aria-live="polite">
        {at ? `${at.label} — ${at.what}` : ''}
      </span>
    </div>
  );
}
