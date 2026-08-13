'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@coinbase/cds-web/buttons';
import { Chip } from '@coinbase/cds-web/chips';
import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextBody, TextCaption, TextTitle3 } from '@coinbase/cds-web/typography';

import {
  fetchForwards,
  fetchVolatility,
  fetchWallSummary,
  type ForwardsPayload,
  type VolatilityPayload,
  type WallSummary,
} from '@/lib/api';
import { InstrumentTable } from '@/table/InstrumentTable';
import { buildRows, GROUP_LABEL, type Group, type Row } from '@/table/rows';
import { fetchUniverse, toRows, type UniversePayload } from '@/table/universeRows';

import { useScheme } from './providers';

/** Swap groups first (v1's), then the live classes P0a found sitting beside them. */
const GROUPS: Group[] = [
  'outright',
  'spread',
  'fly',
  'forward',
  'vol',
  'govt',
  'bss',
  'credit',
  'futures',
];

/** Which feed each group's freshness comes from. IRS and the universe close on the
 * same day today, but they are different feeds and must be able to disagree on screen
 * — averaging them away is the silent-staleness defect this product keeps having. */
const SOURCE_OF: Record<Group, 'irs' | 'universe'> = {
  outright: 'irs',
  spread: 'irs',
  fly: 'irs',
  forward: 'irs',
  vol: 'irs',
  govt: 'universe',
  bss: 'universe',
  credit: 'universe',
  futures: 'universe',
};

export default function Home() {
  const { scheme, toggleScheme } = useScheme();
  const [summary, setSummary] = useState<WallSummary>();
  const [forwards, setForwards] = useState<ForwardsPayload>();
  const [vol, setVol] = useState<VolatilityPayload>();
  const [universe, setUniverse] = useState<UniversePayload>();
  const [error, setError] = useState<string>();
  const [group, setGroup] = useState<Group>('outright');
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    let live = true;
    Promise.all([fetchWallSummary(), fetchForwards(), fetchVolatility(), fetchUniverse()])
      .then(([s, f, v, u]) => {
        if (!live) return;
        setSummary(s);
        setForwards(f);
        setVol(v);
        setUniverse(u);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => {
    const swaps = summary ? buildRows(summary, forwards, vol) : [];
    const rest = universe ? toRows(universe) : [];
    return [...swaps, ...rest];
  }, [summary, forwards, vol, universe]);

  const shown = useMemo(() => rows.filter((r) => r.group === group), [rows, group]);

  const asof = SOURCE_OF[group] === 'irs' ? summary?.asof : universe?.asof;
  const sourceLabel = SOURCE_OF[group] === 'irs' ? 'IRS 종가' : '민평·선물 종가';

  return (
    <VStack background="bg" minHeight="100vh" gap={2} padding={3}>
      <HStack alignItems="baseline" gap={2}>
        <TextTitle3 as="h1">KRW Rates Monitor</TextTitle3>
        <TextCaption as="span" color="fgMuted">
          {asof ? `${asof} · ${sourceLabel}` : ''}
        </TextCaption>
        <Button size="s" variant="secondary" onClick={toggleScheme}>
          {scheme}
        </Button>
      </HStack>

      {/* The screener set is fixed and stays on one row: no column picker and nothing
          user-addable (v1 §4 low user freedom, carried). */}
      <HStack gap={1}>
        {GROUPS.map((g) => (
          <Chip
            key={g}
            size="s"
            inverted={g === group}
            className="sr-pill"
            data-active={g === group}
            onClick={() => setGroup(g)}
          >
            {GROUP_LABEL[g]}
          </Chip>
        ))}
      </HStack>

      {error ? (
        <TextBody as="p" className="sr-up">
          백엔드를 불러오지 못했어요 — {error}
        </TextBody>
      ) : !summary ? (
        <TextBody as="p" color="fgMuted">
          불러오는 중이에요
        </TextBody>
      ) : (
        <>
          <InstrumentTable
            rows={shown}
            onSelect={(r: Row) => setSelectedId(r.id)}
            selectedId={selectedId}
          />

          {/* An asset class with no live source says why. Structure without data is a
              fact about the feed; structure that stays silent reads as a bug. */}
          {universe && universe.absent.length > 0 ? (
            <VStack gap={0.5} paddingY={1}>
              {universe.absent.map((a) => (
                <TextCaption key={a.id} as="span" color="fgMuted">
                  {a.label} — {a.reason}
                </TextCaption>
              ))}
            </VStack>
          ) : null}
        </>
      )}
    </VStack>
  );
}
