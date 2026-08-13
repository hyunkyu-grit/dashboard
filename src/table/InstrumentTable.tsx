'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HStack } from '@coinbase/cds-web/layout';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { useSortableCell } from '@coinbase/cds-web/tables/hooks/useSortableCell';
import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { BasisKey } from '@/lib/api';
import { fmtDelta } from '@/lib/format';

import { levelText } from './cells';
import { colSpecs, colStyle } from './colgroup';
import { ALL_COLUMNS, visibleColumns, type VisibleColumns } from './columns';
import type { Row } from './rows';
import { HEADER_H, OVERSCAN, ROW_H } from './rowHeight';
import { byAbsChange, byTenor, unmappedRows } from './sortKey';
import { directionClass, directionGlyph, tintStyle, unsignedDelta } from './tint';
import { ROW_ATTR, ROW_SELECTOR, useFlipReorder } from './useFlipReorder';

const BASIS_LABEL: Record<BasisKey, string> = { d1: '1D', mtd: 'MTD', ytd: 'YTD' };

/** The sticky header's surface. MUST be fully opaque — guarded. */
export const STICKY_SURFACE = 'bg' as const;

/** The selector for the element the probe must be measured INSIDE. */
export const CH_PROBE_HOST = 'tbody tr[data-sr-row] td span';

/**
 * Measure the '0' advance IN THE CONTEXT THAT RENDERS THE TEXT.
 *
 * Column widths come from format maxima × this number, so it has to be the advance
 * the cells actually draw with. The first version measured on the table's host `div`,
 * whose inherited face is not the cell's: after the Pretendard change the host still
 * resolved to CDS's face at 8.881 px while cells rendered at 8.813 px. 0.77% is small;
 * the structure is what is wrong. It is the same defect class the `<colgroup>` removed
 * — a width derived in one font context and applied in another — and P3 multiplied the
 * surface it corrupts.
 *
 * So the probe is appended to a real cell's text span. Before any row exists there is
 * nothing to measure, and the ladder falls back to `ALL_COLUMNS` on a zero width
 * anyway, so the initial value is only ever used for a frame.
 *
 * `guards/ch-context.test.tsx` fails if this selector stops matching what the cells
 * render, which is the only way the two contexts can silently diverge again.
 */
function useChPx(ref: React.RefObject<HTMLElement | null>, ready: boolean): number {
  const [ch, setCh] = useState(0);
  useEffect(() => {
    const host = ref.current?.querySelector<HTMLElement>(CH_PROBE_HOST);
    if (!host) return;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(20);
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:pre;font-variant-numeric:tabular-nums';
    host.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 20;
    host.removeChild(probe);
    if (w > 0) setCh(w);
  }, [ref, ready]);
  return ch;
}

function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * CDS owns the scrolling element and hands out no ref to it — the same gap as
 * `TableRow`. It is found by walking up from the `<table>` to the first ancestor
 * that actually scrolls. This fails LOUDLY (the virtualizer gets nothing and
 * renders no rows) rather than silently, which is why it is acceptable.
 */
function useScrollElement(hostRef: React.RefObject<HTMLElement | null>, ready: boolean) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ready) return;
    const table = hostRef.current?.querySelector('table');
    let node: HTMLElement | null = table?.parentElement ?? null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      node = node.parentElement;
    }
    setEl(node);
  }, [hostRef, ready]);
  return el;
}

export function InstrumentTable({
  rows,
  onSelect,
  selectedId,
  height = 560,
  compact = false,
}: {
  rows: Row[];
  onSelect: (row: Row) => void;
  selectedId?: string;
  /** PIXELS, and it must be a number — see the comment on the `height` prop below. */
  height?: number;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const width = useContainerWidth(hostRef);

  const [sorting, setSorting] = useState<SortingState>([]);
  const sortCol = (sorting[0]?.id ?? null) as BasisKey | null;
  const asc = sorting[0]?.desc === false;

  /**
   * OUR comparator, verbatim. TanStack owns the sorting STATE (which column,
   * which direction) and the header affordance; it does not own the ordering.
   *
   * `manualSorting` rather than a registered `sortingFn`, and the reason is the
   * contract: a row with no print keeps tenor order BEHIND the ones that have one,
   * in both directions. TanStack inverts a `sortingFn` wholesale for the
   * descending pass, which would float the no-print rows to the top; its
   * `sortUndefined` escape hatch keys on `undefined` and these are `null`.
   * The comparator is not reimplemented in TanStack's vocabulary — it is the same
   * function this table has always used.
   */
  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort(sortCol ? byAbsChange(sortCol, asc) : byTenor);
    return copy;
  }, [rows, sortCol, asc]);

  const unmapped = useMemo(() => unmappedRows(rows), [rows]);

  /* Stable and ladder-independent. TanStack needs a column list; the ladder decides
   * what is DRAWN, and every cell is rendered by hand below. Keeping this constant
   * breaks a dependency cycle — the ch probe must wait for a rendered cell, which
   * means the virtualizer has to run before it, which it cannot do if the table's
   * columns depend on the ladder that depends on the probe. */
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: 'label', accessorKey: 'label' },
      { id: 'level', accessorKey: 'now' },
      { id: 'd1', accessorFn: (r: Row) => r.changes.d1 },
      { id: 'mtd', accessorFn: (r: Row) => r.changes.mtd },
      { id: 'ytd', accessorFn: (r: Row) => r.changes.ytd },
      { id: 'range52', accessorKey: 'pct' },
    ],
    [],
  );

  const table = useReactTable({
    data: ordered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const modelRows = table.getRowModel().rows;

  const scrollEl = useScrollElement(hostRef, rows.length > 0);
  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  // Only once a cell is actually on the page can the probe measure the face the cells
  // draw with. Before that `chPx` is 0 and the colgroup declares nothing.
  const chPx = useChPx(hostRef, items.length > 0);

  /* The ladder, once the probe has a real advance. Until then ALL_COLUMNS: the header
   * draws every column and the colgroup declares nothing, which is a truthful
   * "not measured yet" rather than a guess. */
  const cols = useMemo<VisibleColumns>(
    () => (width > 0 && chPx > 0 ? visibleColumns(width, chPx, sortCol) : ALL_COLUMNS),
    [width, chPx, sortCol],
  );
  const totalSize = virtualizer.getTotalSize();
  const padTop = items.length > 0 ? items[0].start : 0;
  const padBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0;

  const flip = useFlipReorder(hostRef);

  const sortable = useSortableCell<BasisKey>({
    sortBy: (sortCol ?? '') as BasisKey,
    sortDirection: sortCol == null ? undefined : asc ? 'ascending' : 'descending',
    onChange: (key) => {
      flip.snapshot();
      setSorting((prev) =>
        prev[0]?.id === key ? [{ id: key, desc: !prev[0].desc }] : [{ id: key, desc: true }],
      );
    },
  });

  /* ── delegation, unchanged in kind ──────────────────────────────────────── */
  const rowFromEvent = useCallback(
    (target: EventTarget | null): Row | undefined => {
      const tr = (target as HTMLElement | null)?.closest?.(ROW_SELECTOR);
      const id = tr?.getAttribute(ROW_ATTR);
      return id ? rows.find((r) => r.id === id) : undefined;
    },
    [rows],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const row = rowFromEvent(e.target);
      if (row) onSelect(row);
    },
    [rowFromEvent, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = rowFromEvent(e.target);
      if (!row) return;
      e.preventDefault();
      onSelect(row);
    },
    [rowFromEvent, onSelect],
  );

  /**
   * Focus survival across virtualization.
   *
   * A focused row can scroll out of the window and unmount, which drops focus to
   * `<body>` — the keyboard user loses their place with nothing on screen saying
   * so. The row identity is remembered on focus; when that row re-mounts, focus
   * returns to it. While it is unmounted the CONTAINER holds focus, so the
   * delegated key handler still has somewhere to fire and Tab order does not jump
   * to the end of the document.
   */
  const focusedId = useRef<string | null>(null);
  const onFocusCapture = useCallback((e: React.FocusEvent) => {
    const tr = (e.target as HTMLElement).closest?.(ROW_SELECTOR);
    const id = tr?.getAttribute(ROW_ATTR);
    if (id) focusedId.current = id;
  }, []);

  useEffect(() => {
    const want = focusedId.current;
    if (!want) return;
    const host = hostRef.current;
    if (!host) return;
    const active = document.activeElement;
    if (active && active !== document.body && host.contains(active)) return;
    const el = host.querySelector<HTMLTableRowElement>(
      `${ROW_SELECTOR}[${ROW_ATTR}="${CSS.escape(want)}"]`,
    );
    if (el) el.focus({ preventScroll: true });
    else host.focus({ preventScroll: true });
  }, [items]);

  // 0 would collapse every fixed width; before the first measurement the
  // colgroup declares nothing and the browser lays the table out on content.
  const specs = chPx > 0 ? colSpecs(cols, chPx) : [];

  return (
    <div
      ref={hostRef}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocusCapture={onFocusCapture}
      style={{ width: '100%' }}
    >
      <Table
        variant="ruled"
        bordered
        tableLayout="fixed"
        /* CDS GAP — the type lies about this prop.
           `TableProps.height` is typed `React.CSSProperties['height']`, so a
           string like '70vh' type-checks. The implementation does
           `'--table-height': \`${height}px\`` unconditionally, producing
           `70vhpx` — an invalid value, which resolves to `none` and leaves the
           scroll container unconstrained. The virtualiser then has no viewport
           and windows against the whole document.
           It must be a NUMBER of pixels. Measured, not inferred. */
        height={height}
        compact={compact}
        accessibilityLabel="종목"
      >
        {/* THE single width source — unchanged by virtualization. A spacer row
            consumes no width authority under `table-layout: fixed`; measured in D0. */}
        {specs.length > 0 ? (
          <colgroup>
            {specs.map((s) => (
              <col key={s.key} style={colStyle(s)} />
            ))}
          </colgroup>
        ) : null}

        <TableHeader sticky>
          <TableRow backgroundColor={STICKY_SURFACE} style={{ height: HEADER_H }}>
            <TableCell as="th" scope="col">
              <TextCaption as="span">종목</TextCaption>
            </TableCell>
            <TableCell as="th" scope="col" justifyContent="flex-end">
              <TextCaption as="span">현재</TextCaption>
            </TableCell>
            {cols.bases.map((b) => {
              const { end, ...cell } = sortable(b);
              return (
                <TableCell key={b} as="th" scope="col" justifyContent="flex-end" {...cell} end={end}>
                  <TextCaption as="span">{BASIS_LABEL[b]}</TextCaption>
                </TableCell>
              );
            })}
            <TableCell as="th" scope="col" justifyContent="flex-end">
              <TextCaption as="span">{cols.range52 ? '52주' : ''}</TextCaption>
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody>
          {padTop > 0 ? (
            <tr data-sr-spacer="top" aria-hidden>
              <td colSpan={6} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          ) : null}

          {items.map((vi) => {
            const row = modelRows[vi.index]?.original;
            if (!row) return null;
            return (
              <TableRow
                key={row.id}
                {...{ [ROW_ATTR]: row.id }}
                tabIndex={0}
                aria-selected={row.id === selectedId}
                style={{ height: ROW_H }}
              >
                <TableCell>
                  <TextLabel2 as="span" noWrap>
                    {row.label}
                  </TextLabel2>
                </TableCell>
                <TableCell justifyContent="flex-end">
                  <TextLabel2 as="span" tabularNumbers noWrap>
                    {levelText(row)}
                  </TextLabel2>
                </TableCell>
                {cols.bases.map((b) => (
                  <TableCell key={b} justifyContent="flex-end" style={tintStyle(row.changes[b])}>
                    <TextLabel2
                      as="span"
                      tabularNumbers
                      noWrap
                      className={directionClass(row.changes[b])}
                    >
                      {directionGlyph(row.changes[b])}
                      {directionGlyph(row.changes[b]) ? ' ' : ''}
                      {unsignedDelta(fmtDelta(row.changes[b], row.unit))}
                    </TextLabel2>
                  </TableCell>
                ))}
                <TableCell justifyContent="flex-end">
                  <TextLabel2 as="span" tabularNumbers noWrap>
                    {cols.range52 && row.pct != null ? `${Math.round(row.pct)}%` : ''}
                  </TextLabel2>
                </TableCell>
              </TableRow>
            );
          })}

          {padBottom > 0 ? (
            <tr data-sr-spacer="bottom" aria-hidden>
              <td colSpan={6} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </TableBody>
      </Table>

      <HStack justifyContent="space-between" paddingY={0.5}>
        <TextCaption as="span" color="fgMuted">
          {cols.hidden > 0 ? `${cols.hidden}개 열이 폭에 맞춰 숨었어요` : ''}
        </TextCaption>
        {unmapped.length > 0 ? (
          <TextCaption as="span" className="sr-up">
            정렬 키가 없는 종목 {unmapped.length}개
          </TextCaption>
        ) : null}
      </HStack>
    </div>
  );
}
