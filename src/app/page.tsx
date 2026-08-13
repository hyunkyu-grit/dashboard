'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@coinbase/cds-web/buttons';
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

import { useScheme } from './providers';

const GROUPS: Group[] = ['outright', 'spread', 'fly', 'forward', 'vol'];

export default function Home() {
  const { scheme, toggleScheme } = useScheme();
  const [summary, setSummary] = useState<WallSummary>();
  const [forwards, setForwards] = useState<ForwardsPayload>();
  const [vol, setVol] = useState<VolatilityPayload>();
  const [error, setError] = useState<string>();
  const [group, setGroup] = useState<Group>('outright');
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    let live = true;
    Promise.all([fetchWallSummary(), fetchForwards(), fetchVolatility()])
      .then(([s, f, v]) => {
        if (!live) return;
        setSummary(s);
        setForwards(f);
        setVol(v);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () => (summary ? buildRows(summary, forwards, vol) : []),
    [summary, forwards, vol],
  );

  const shown = useMemo(() => rows.filter((r) => r.group === group), [rows, group]);

  return (
    <VStack background="bg" minHeight="100vh" gap={2} padding={3}>
      <HStack alignItems="center" gap={2}>
        <TextTitle3 as="h1">KRW IRS Monitor</TextTitle3>
        <TextCaption as="span" color="fgMuted">
          {summary ? `${summary.asof} 종가` : ''}
        </TextCaption>
        <Button size="s" variant="secondary" onClick={toggleScheme}>
          {scheme}
        </Button>
      </HStack>

      {/* The screener set is fixed and stays on one row — no column picker and
          nothing user-addable (v1 §4 low user freedom, carried). */}
      <HStack gap={1}>
        {GROUPS.map((g) => (
          <Button
            key={g}
            size="s"
            variant={g === group ? 'primary' : 'secondary'}
            onClick={() => setGroup(g)}
          >
            {GROUP_LABEL[g]}
          </Button>
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
        <InstrumentTable
          rows={shown}
          onSelect={(r: Row) => setSelectedId(r.id)}
          selectedId={selectedId}
        />
      )}
    </VStack>
  );
}
