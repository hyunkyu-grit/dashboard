'use client';

import { useEffect, useMemo, useState } from 'react';

import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextTitle3 } from '@coinbase/cds-web/typography';

import { BUILD_ROWS, synthRows } from '@/dev/synth';
import {
  fetchForwards,
  fetchVolatility,
  fetchWallSummary,
  type ForwardsPayload,
  type VolatilityPayload,
  type WallSummary,
} from '@/lib/api';
import { InstrumentTable } from '@/table/InstrumentTable';
import type { Row } from '@/table/rows';

/**
 * PASS A MEASUREMENT HARNESS. Not product surface, not linked from anywhere.
 *
 * It exists so the scale question is answered against the real table, the real
 * builder and the real comparator. Row count comes from `?n=`; with no query it
 * uses the compile-time constant, which is what the A4 bundle comparison varies.
 *
 * Density comes from `?d=dense`, because Pass A must run A1 and A5 at CDS
 * default AND at dense+compact — 1,000 rows is ~24,000 px of document either
 * way, and which one is a different document.
 */
export default function ScaleHarness() {
  const [summary, setSummary] = useState<WallSummary>();
  const [forwards, setForwards] = useState<ForwardsPayload>();
  const [vol, setVol] = useState<VolatilityPayload>();
  const [n, setN] = useState(BUILD_ROWS);
  const [dense, setDense] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const parsed = Number(q.get('n'));
    if (Number.isFinite(parsed) && parsed > 0) setN(parsed);
    setDense(q.get('d') === 'dense');
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([fetchWallSummary(), fetchForwards(), fetchVolatility()]).then(([s, f, v]) => {
      if (!live) return;
      setSummary(s);
      setForwards(f);
      setVol(v);
    });
    return () => {
      live = false;
    };
  }, []);

  const rows: Row[] = useMemo(
    () => (summary ? synthRows(summary, forwards, vol, n) : []),
    [summary, forwards, vol, n],
  );

  return (
    <VStack background="bg" minHeight="100vh" gap={1} padding={2}>
      <HStack alignItems="baseline" gap={2}>
        <TextTitle3 as="h1">scale harness</TextTitle3>
        <TextCaption as="span" color="fgMuted" data-sr-probe="meta">
          {`rows=${rows.length} requested=${n} density=${dense ? 'dense+compact' : 'default'}`}
        </TextCaption>
      </HStack>
      {rows.length > 0 ? (
        <InstrumentTable
          rows={rows}
          onSelect={() => undefined}
          height="80vh"
          compact={dense}
        />
      ) : (
        <TextCaption as="span" color="fgMuted">
          loading
        </TextCaption>
      )}
    </VStack>
  );
}
