'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { useSortableCell } from '@coinbase/cds-web/tables/hooks/useSortableCell';
import { HStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';

import type { BasisKey } from '@/lib/api';
import { fmtDelta } from '@/lib/format';

import { levelText } from './cells';
import { colSpecs, colStyle } from './colgroup';
import { ALL_COLUMNS, visibleColumns, type VisibleColumns } from './columns';
import type { Row } from './rows';
import { byAbsChange, byTenor, unmappedRows } from './sortKey';
import { directionClass, tintStyle } from './tint';
import { ROW_ATTR, ROW_SELECTOR, useFlipReorder } from './useFlipReorder';

/** Header labels. 종목 and 현재 always render; the rest are ladder rungs. */
const BASIS_LABEL: Record<BasisKey, string> = { d1: '1D', mtd: 'MTD', ytd: 'YTD' };

/** The sticky header's surface. MUST be fully opaque — a translucent sticky
 * header lets body rows read through it while scrolling, which is the one
 * thing a sticky header exists to prevent. `guards/sticky-opaque.test.ts`
 * asserts the token has alpha 1 in both schemes. */
export const STICKY_SURFACE = 'bg' as const;

/** Measure the table font's '0' advance once. Widths derive from format maxima
 * × this number (v1 §4), so it has to be the real advance, not an assumption. */
function useChPx(ref: React.RefObject<HTMLElement | null>): number {
  const [ch, setCh] = useState(8);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(10);
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:pre;font-variant-numeric:tabular-nums';
    host.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 10;
    host.removeChild(probe);
    if (w > 0) setCh(w);
  }, [ref]);
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

/* Presentational only. No refs, no per-row listeners: interaction is delegated
 * from the container (see `InstrumentTable`), which is both the only path CDS
 * leaves open — `TableRow` has no `forwardRef` — and the right architecture at
 * a thousand rows [OWNER ruling].
 *
 * MEASURED: `TableRow` DOES forward `data-*`, `tabIndex`, `role` and
 * `aria-selected` to the `<tr>` (guards/cds-tablerow-dom.test.tsx), so focus
 * stays on the row. Only `ref` is missing. */
function BodyRow({
  row,
  cols,
  selected,
}: {
  row: Row;
  cols: VisibleColumns;
  selected: boolean;
}) {
  return (
    <TableRow {...{ [ROW_ATTR]: row.id }} tabIndex={0} aria-selected={selected}>
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
          <TextLabel2 as="span" tabularNumbers noWrap className={directionClass(row.changes[b])}>
            {fmtDelta(row.changes[b], row.unit)}
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
}

export function InstrumentTable({
  rows,
  onSelect,
  selectedId,
  maxHeight = '70vh',
  compact = false,
}: {
  rows: Row[];
  onSelect: (row: Row) => void;
  selectedId?: string;
  maxHeight?: string;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chPx = useChPx(hostRef);
  const width = useContainerWidth(hostRef);

  const [sortCol, setSortCol] = useState<BasisKey | null>(null);
  const [asc, setAsc] = useState(false);
  const flip = useFlipReorder(hostRef);

  const cols = useMemo<VisibleColumns>(
    () => (width > 0 ? visibleColumns(width, chPx, sortCol) : ALL_COLUMNS),
    [width, chPx, sortCol],
  );

  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort(sortCol ? byAbsChange(sortCol, asc) : byTenor);
    return copy;
  }, [rows, sortCol, asc]);

  const unmapped = useMemo(() => unmappedRows(rows), [rows]);

  /* The header affordance comes from CDS; the COMPARATOR does not (see
   * sortKey.ts). `useSortableCell` gives the click target, the sort glyph and
   * `aria-sort`; what a click means is still ours. */
  const sortable = useSortableCell<BasisKey>({
    sortBy: sortCol ?? ('' as BasisKey),
    sortDirection: sortCol == null ? undefined : asc ? 'ascending' : 'descending',
    onChange: (key) => {
      flip.snapshot();
      if (key === sortCol) setAsc((v) => !v);
      else {
        setSortCol(key);
        setAsc(false);
      }
    },
  });

  const specs = colSpecs(cols, chPx);

  /* ONE listener each, on the container. Resolving the row with `closest()`
   * costs one walk per event; a listener per row costs a thousand registrations
   * per render. */
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
      e.preventDefault(); // Space would scroll the table under the cursor
      onSelect(row);
    },
    [rowFromEvent, onSelect],
  );

  return (
    <div
      ref={hostRef}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ width: '100%' }}
    >
      <Table
        variant="ruled"
        bordered
        tableLayout="fixed"
        maxHeight={maxHeight}
        compact={compact}
        accessibilityLabel="종목"
      >
        {/* THE single width source. Nothing else in v2 declares a column width;
            guards/colgroup-single-source.test.ts enforces it. */}
        <colgroup>
          {specs.map((s) => (
            <col key={s.key} style={colStyle(s)} />
          ))}
        </colgroup>

        <TableHeader sticky>
          <TableRow backgroundColor={STICKY_SURFACE}>
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
          {ordered.map((row) => (
            <BodyRow key={row.id} row={row} cols={cols} selected={row.id === selectedId} />
          ))}
        </TableBody>
      </Table>

      {/* Quiet, and it stays quiet: this is a note, not a control. There is no
          column picker — v1 withheld one deliberately (§4 low user freedom). */}
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
