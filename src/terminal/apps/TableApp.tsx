'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { useVirtualizer } from '@tanstack/react-virtual';

import { OBJ_GLYPH, OBJ_LABEL, OBJ_VAR, type TermObject } from '../ontology';
import { TERM_LOG_H, TERM_LOG_HEAD_H, TERM_OVERSCAN } from '../rows';
import type { SortSpec } from '../urlState';

/**
 * **표** 축 — 지금 필터를 통과한 객체를 고밀도 그리드로.
 *
 * ── 지어낸 체결 원장을 지웠다 [OWNER 2026-08-26] ───────────────────────────
 * 앞선 판은 BUY/SELL·명목·신뢰도 600행을 지어냈다. **이 백엔드에 체결 로그는
 * 없다.** 그래서 그 표는 사라지고, 대신 Object Explorer 의 결과를 그대로 세운다 —
 * Gotham 의 «같은 객체 집합을 다른 축에서 본다» 가 원래 그 뜻이고, 표는 그중
 * 한 축이지 다른 데이터가 아니다.
 *
 * ── 밀도는 팔란티어에서 재 온 것을 그대로 ──────────────────────────────────
 * 행 20px · 셀 패딩 `0 8px` · 12/20 타입 · 경계는 `box-shadow: inset` 흰색 20%.
 * 근거와 실측은 `theme/terminal.css` 의 `.sr-term-log` 절에 있다.
 *
 * ── 정렬 ───────────────────────────────────────────────────────────────────
 * 열 머리를 누르면 그 열로 정렬한다. **수는 수로 정렬한다** — 화면 문자열로
 * 정렬하면 "1.5Y" 가 "10Y" 앞에 오고 "−8.0" 이 "+4.9" 뒤에 온다. 그래서 객체가
 * `num` 을 따로 든다(`ontology.ts`).
 *
 * 정렬 **상태는 여기 없다.** 셸이 주소에서 유도해 넘긴다 — 「z 로 내림차순 정렬한
 * 표」가 공유되지 않으면 정렬은 나 혼자만 아는 사실이 된다(`urlState.ts`).
 *
 * ── 키보드 [WCAG 2.1.1 · 2026-08-27] ──────────────────────────────────────
 * 첫 판은 행마다 `tabIndex={0}` 이었다. 필터를 안 건 상태에서 그건 **탭 348번**
 * 이고, 표를 지나 다음 패널로 가려는 사람에게는 표가 함정이었다. 게다가 가상
 * 스크롤이라 탭이 아직 그려지지 않은 행에는 닿지도 못한다 — 즉 탭만으로는
 * 348개 중 스물 몇 개만 닿는 «반쪽 키보드» 였다.
 *
 * 그래서 표준 문법으로 바꾼다(**roving tabindex**): 표 전체가 탭 정지 **한 칸**
 * 이고, 그 안에서는 화살표로 움직인다. 파일 관리자·메일 목록이 쓰는 그 문법이고,
 * WAI-ARIA Authoring Practices 의 grid 패턴이 요구하는 것이기도 하다. 가상
 * 스크롤과도 맞는다 — 움직이는 것은 «몇 번째 행» 이라는 수여서, 그 행이 아직
 * 안 그려졌으면 그리로 스크롤한 다음 초점을 준다.
 *
 * Enter·Space 는 CDS `TableRow` 가 이미 `onClick` 으로 잇는다
 * (`useTableRowListener`) — 그 위에 같은 것을 또 만들지 않는다.
 */

export type TableSortKey = 'title' | 'type' | 'now' | 'd1' | 'pct1y' | 'z' | 'score';

/** 주소가 되돌려 주는 값을 검증하는 목록. 모르는 키가 오면 기본 정렬로 떨어진다
 *  (`urlState.decodeSort`). */
export const TABLE_SORT_KEYS: readonly TableSortKey[] = [
  'title',
  'type',
  'now',
  'd1',
  'pct1y',
  'z',
  'score',
];

const COLS: {
  key: TableSortKey;
  label: string;
  /** 열 머리에 붙는 한 줄. `title` 속성이라 마우스에도 뜨고, `aria-label` 로도
   *  쓰여 스크린 리더가 「z」 대신 뜻을 읽는다 — 한 글자 열 머리는 소리로는
   *  아무것도 아니다. */
  what: string;
  width: string;
  num: boolean;
}[] = [
  { key: 'type', label: '종류', what: '객체 종류', width: '54px', num: false },
  { key: 'title', label: '이름', what: '이름', width: 'auto', num: false },
  { key: 'now', label: '현재', what: '현재 값', width: '62px', num: true },
  { key: 'd1', label: '1D', what: '하루 변화', width: '48px', num: true },
  { key: 'pct1y', label: '1Y%', what: '1년 범위 안 위치(%)', width: '46px', num: true },
  { key: 'z', label: 'z', what: '볼린저 밴드 z', width: '44px', num: true },
  /* RV Score 는 크레딧 계열에만 있다 — 나머지 행은 «—» 다. 열을 조건부로
     감추지 않는 이유: 열이 나타났다 사라지면 같은 표가 필터마다 다른 모양이
     되고, 「없다」는 사실도 정보다(`ontology.ts` 의 RV 절). */
  { key: 'score', label: 'Score', what: 'RV Score(크레딧만)', width: '52px', num: true },
];

export function TableApp({
  objects,
  focusId,
  onFocus,
  sort,
  onSort,
}: {
  objects: TermObject[];
  focusId: string | null;
  onFocus: (id: string) => void;
  sort: SortSpec<TableSortKey>;
  onSort: (s: SortSpec<TableSortKey>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /** 화살표가 짚고 있는 행. **초점과 다른 것**이다 — 짚기만 하고 아직 안 고른
   *  상태가 있어야 훑어볼 수 있다(고르는 순간 오른쪽 도시에와 그래프가 전부
   *  움직이므로, 훑기와 고르기가 같은 동작이면 훑을 수가 없다). */
  const [active, setActive] = useState(0);
  /** 다음 렌더에서 그 행에 실제로 초점을 줄지. 마우스로 눌러 `active` 가 바뀐
   *  경우까지 초점을 뺏어 오면 스크롤이 튄다. */
  const wantFocus = useRef(false);
  /** 그 «다음 렌더» 를 몇 번까지 기다릴지.
   *
   *  아래 효과는 의존성 배열이 없어 **매 렌더 돈다**. 찾을 때까지 다시 시도하게
   *  두면, 못 찾는 경우(결과가 0행이거나 스크롤이 더 못 가는 경우)에 렌더가
   *  멈추지 않는다 — 이 리포는 그 모양의 무한 루프로 브라우저를 한 번 얼려
   *  봤다(`TimelineApp` 의 인라인 ref 주석). 상한을 둔다. */
  const tries = useRef(0);

  const rows = useMemo(() => {
    const val = (o: TermObject): number | string | null => {
      if (sort.key === 'title') return o.title;
      if (sort.key === 'type') return OBJ_LABEL[o.type];
      return o.num?.[sort.key] ?? null;
    };
    const out = [...objects];
    out.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      /* **없는 값은 언제나 뒤로.** 정렬 방향을 뒤집을 때 빈칸이 위로 올라오면
         첫 화면이 빈칸 스무 줄이 되고, 그건 정렬이 아니라 숨기기다. */
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c =
        typeof x === 'string' ? x.localeCompare(y as string, 'ko-KR') : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
    return out;
  }, [objects, sort]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TERM_LOG_H,
    overscan: TERM_OVERSCAN,
  });

  /* 결과가 바뀌면 짚은 자리를 범위 안으로 되돌린다. 348행에서 9행으로 좁혀
     졌는데 `active` 가 200 이면 화살표가 아무 데도 안 간다. */
  useEffect(() => {
    setActive((i) => Math.min(Math.max(0, i), Math.max(0, rows.length - 1)));
  }, [rows.length]);

  /* 짚은 행이 아직 안 그려졌으면 그리로 스크롤하고, 그 다음 초점을 준다.
     가상 스크롤에서 «초점을 준다» 는 두 걸음이라는 것이 이 효과의 전부다. */
  useEffect(() => {
    if (!wantFocus.current) return;
    if (rows.length === 0 || tries.current > 4) {
      wantFocus.current = false;
      return;
    }
    tries.current += 1;
    virtualizer.scrollToIndex(active, { align: 'auto' });
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-rowidx="${active}"]`);
    if (el) {
      el.focus();
      wantFocus.current = false;
      tries.current = 0;
    }
    /* 못 찾았으면 다음 렌더에서 다시 시도한다 — 스크롤이 방금 새 행을 만들었을
       테고, 그 렌더가 이 효과를 다시 부른다. 위 상한이 그 되풀이를 닫는다. */
  });

  const move = useCallback(
    (to: number) => {
      wantFocus.current = true;
      tries.current = 0;
      setActive(Math.min(Math.max(0, to), Math.max(0, rows.length - 1)));
    },
    [rows.length],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement | null;
      /* 열 머리의 정렬 버튼 위에서는 화살표를 안 먹는다 — 거기서 아래 화살표는
         «다음 컨트롤» 이 아니라 아무 뜻도 없어야 한다. */
      if (el?.tagName === 'BUTTON') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(active - 1);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        move(active + 10);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        move(active - 10);
      } else if (e.key === 'Home') {
        e.preventDefault();
        move(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        move(rows.length - 1);
      } else if (e.key === ' ') {
        /* Space 는 CDS 가 이미 «고르기» 로 쓴다(`useTableRowListener`). 기본
           동작인 «한 화면 스크롤» 까지 같이 일어나면 고른 행이 화면 밖으로
           나가 버린다. */
        e.preventDefault();
      }
    },
    [active, move, rows.length],
  );

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? total - items[items.length - 1].end : 0;

  const cell = (o: TermObject, key: TableSortKey): string => {
    if (key === 'type') return OBJ_LABEL[o.type];
    if (key === 'title') return o.title;
    const n = o.num?.[key];
    if (n == null) return '—';
    if (key === 'd1') return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
    if (key === 'pct1y') return n.toFixed(0);
    if (key === 'z') return n.toFixed(2);
    if (key === 'score') return n.toFixed(1);
    return String(n);
  };

  return (
    <div className="sr-term-body sr-term-log" ref={scrollRef} onKeyDown={onKeyDown}>
      <Table tableLayout="fixed" accessibilityLabel="객체 표">
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>

        <TableHeader sticky>
          <TableRow style={{ height: TERM_LOG_HEAD_H }}>
            {COLS.map((c) => (
              <TableCell
                key={c.key}
                as="th"
                scope="col"
                className={c.num ? 'sr-term-r' : undefined}
                aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              >
                <button
                  type="button"
                  className="sr-term-sortbtn"
                  /* 소리로 읽히는 이름은 «z» 가 아니라 «볼린저 밴드 z 로 정렬».
                     보이는 라벨(z)이 접근 이름 안에 들어 있으므로 WCAG 2.5.3
                     (Label in Name)도 지킨다. */
                  aria-label={`${c.what} 로 정렬`}
                  title={c.what}
                  onClick={() =>
                    onSort(
                      sort.key === c.key
                        ? { key: c.key, desc: !sort.desc }
                        : { key: c.key, desc: true },
                    )
                  }
                >
                  {c.label}
                  {sort.key === c.key ? (sort.desc ? ' ▼' : ' ▲') : ''}
                </button>
              </TableCell>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {padTop > 0 ? (
            <tr data-sr-spacer="top" aria-hidden>
              <td colSpan={COLS.length} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          ) : null}

          {items.map((vi) => {
            const o = rows[vi.index];
            if (!o) return null;
            return (
              <TableRow
                key={o.id}
                data-rowidx={vi.index}
                /* roving tabindex — 표 전체가 탭 정지 한 칸이다(머리 주석). */
                tabIndex={vi.index === active ? 0 : -1}
                aria-current={focusId === o.id ? 'true' : undefined}
                onClick={() => {
                  setActive(vi.index);
                  onFocus(o.id);
                }}
                style={{ height: TERM_LOG_H }}
              >
                <TableCell>
                  {/* 글리프와 라벨은 **한 덩어리**여야 한다. 따로 두면 CDS 셀의
                      마지막 겹이 세로 flex 라 둘이 위아래로 쌓이고, 20px 행이
                      31px 로 벌어진다(실측 2026-08-26). 이 리포가 세 번째로
                      만나는 그 함정이다 — `.sr-num` 주석과 우측 정렬 수리에
                      같은 원인이 적혀 있다. */}
                  <span className="sr-term-typecell">
                    <span
                      className="sr-term-objglyph"
                      style={{ color: OBJ_VAR[o.type] }}
                      aria-hidden
                    >
                      {OBJ_GLYPH[o.type]}
                    </span>
                    {OBJ_LABEL[o.type]}
                  </span>
                </TableCell>
                <TableCell>{o.title}</TableCell>
                {COLS.slice(2).map((c) => (
                  <TableCell key={c.key} className="sr-term-r">
                    {cell(o, c.key)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}

          {padBottom > 0 ? (
            <tr data-sr-spacer="bottom" aria-hidden>
              <td colSpan={COLS.length} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
