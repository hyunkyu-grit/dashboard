'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Chip } from '@coinbase/cds-web/chips';
import { HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextTitle3 } from '@coinbase/cds-web/typography';

import {
  fetchForwards,
  fetchHealth,
  fetchVolatility,
  fetchWallSummary,
  type ForwardsPayload,
  type Health,
  type VolatilityPayload,
  type WallSummary,
} from '@/lib/api';
import { InstrumentTable } from '@/table/InstrumentTable';
import { buildRows, GROUP_LABEL, type Group, type Row } from '@/table/rows';
import { SCREENERS } from '@/table/screener';
import { fetchUniverse, toRows, type UniversePayload } from '@/table/universeRows';
import { ErrorState, FreshnessChip, LoadingState } from '@/ui/DataState';

/** Swap groups first (v1's), then the live classes P0a found beside them. */
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

/** Which feed each group's freshness comes from. The two close on the same day today,
 * but they are different feeds and must be able to disagree on screen — averaging
 * them away is the silent-staleness defect this product keeps having. */
const SOURCE_OF: Record<Group, 'irs' | 'universe'> = {
  outright: 'irs', spread: 'irs', fly: 'irs', forward: 'irs', vol: 'irs',
  govt: 'universe', bss: 'universe', credit: 'universe', futures: 'universe',
};

const SOURCE_LABEL = { irs: 'IRS 종가', universe: '민평·선물 종가' } as const;

type Loaded = {
  summary: WallSummary;
  forwards: ForwardsPayload;
  vol: VolatilityPayload;
  universe: UniversePayload;
  health: Health;
};

export default function Home() {
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [group, setGroup] = useState<Group>('outright');
  const [screener, setScreener] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    setRetrying(true);
    try {
      const [summary, forwards, vol, universe, health] = await Promise.all([
        fetchWallSummary(), fetchForwards(), fetchVolatility(), fetchUniverse(), fetchHealth(),
      ]);
      setData({ summary, forwards, vol, universe, health });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [
      ...buildRows(data.summary, data.forwards, data.vol),
      ...toRows(data.universe),
    ];
  }, [data]);

  const inGroup = useMemo(() => rows.filter((r) => r.group === group), [rows, group]);

  const active = SCREENERS.find((s) => s.id === screener);
  const shown = useMemo(
    () => (active ? inGroup.filter((r) => active.test(r)) : inGroup),
    [inGroup, active],
  );

  const src = SOURCE_OF[group];
  const fresh =
    src === 'irs'
      ? { asof: data?.health.asof, level: data?.health.freshness?.level }
      : {
          asof: data?.universe.sources[group]?.asof ?? data?.universe.asof,
          level: data?.universe.sources[group]?.level,
        };

  return (
    <VStack background="bg" minHeight="100vh" gap={1.5} padding={3}>
      <HStack alignItems="baseline" gap={2}>
        <TextTitle3 as="h1">KRW Rates Monitor</TextTitle3>
        <FreshnessChip
          asof={fresh.asof}
          level={fresh.level as 'current' | 'behind' | 'stale' | undefined}
          source={SOURCE_LABEL[src]}
        />
      </HStack>

      {/* Asset class. Fixed set, one row, no column picker and nothing user-addable
          (v1 §4 low user freedom, carried). */}
      <HStack gap={1}>
        {GROUPS.map((g) => (
          <Chip
            key={g}
            size="s"
            inverted={g === group}
            className="sr-pill"
            data-active={g === group}
            onClick={() => {
              setGroup(g);
              setScreener(undefined);
            }}
          >
            {GROUP_LABEL[g]}
          </Chip>
        ))}
      </HStack>

      {/* Screener. The predicates are v1's, unchanged — they read the percentile and
          the move percentile the backend already computed. Pressing the active chip
          clears it; there is no "all" chip, because "no filter" is the default state
          and does not need a control of its own. */}
      <VStack gap={0.5}>
        <HStack gap={1}>
          {SCREENERS.map((s) => (
            <Chip
              key={s.id}
              size="s"
              inverted={s.id === screener}
              className="sr-pill"
              data-active={s.id === screener}
              onClick={() => setScreener((cur) => (cur === s.id ? undefined : s.id))}
            >
              {s.label}
            </Chip>
          ))}
        </HStack>
        {active ? (
          <TextCaption as="span" color="fgMuted">
            {active.description}
          </TextCaption>
        ) : null}
      </VStack>

      {error ? (
        <ErrorState what="시장 데이터" detail={error} onRetry={() => void load()} retrying={retrying} />
      ) : !data ? (
        <LoadingState what="시장 데이터" />
      ) : (
        <>
          {shown.length === 0 ? (
            <VStack gap={0.5} paddingY={2}>
              <TextCaption as="span" color="fgMuted">
                {active
                  ? `${GROUP_LABEL[group]} 중에 «${active.label}»에 걸리는 종목이 오늘은 없어요.`
                  : `${GROUP_LABEL[group]}에 아직 데이터가 없어요.`}
              </TextCaption>
            </VStack>
          ) : (
            <InstrumentTable
              rows={shown}
              onSelect={(r: Row) => setSelectedId(r.id)}
              selectedId={selectedId}
              levelHeader={fresh.asof}
              divider={!active}
            />
          )}

          {/* An asset class with no live source says why. Structure without data is a
              fact about the feed; structure that stays silent reads as a bug. */}
          <VStack gap={0.5} paddingY={1}>
            {data.universe.absent.map((a) => (
              <TextCaption key={a.id} as="span" color="fgMuted">
                {a.label} — {a.reason}
              </TextCaption>
            ))}
          </VStack>
        </>
      )}
    </VStack>
  );
}
