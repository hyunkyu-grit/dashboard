'use client';

/**
 * 온톨로지를 **실제 백엔드에서** 읽어 온다.
 *
 * ── 세 번 부르고 한 번 더 [실제 엔드포인트] ────────────────────────────────
 *     /api/universe                 계열 122
 *     /api/mr/board                 밴드 13
 *     /api/rv/analysis              크레딧 RV 42 — Score·순위·앵커
 *     /api/issuance/calendar        두 달 일정·섹터 합계
 *     /api/issuance/day/{iso} × N   그날의 **원문**(발행 건·입찰 결과·출처)
 *
 * 마지막 하나가 비싸다 — 하루에 한 번씩이라 43일이면 43번이다. 그래서 **최근
 * 며칠만** 읽고, 몇 날을 읽었는지를 온톨로지의 `notes` 가 화면에 말한다. 조용히
 * 자르면 화면이 「이게 전부」라고 거짓말을 한다(이 리포의 no-silent-caps 규율).
 *
 * ── 실패는 등급이 있다 ─────────────────────────────────────────────────────
 * 유니버스가 없으면 화면이 없다 — 그건 에러다. 밴드·캘린더가 없으면 **화면은
 * 서고 그 부분만 빈다** — 백엔드가 CSV 를 못 찾는 흔한 경우가 그것이고
 * (`lab/issuance/api.ts::IssuanceUnavailable`), 그때 전체를 죽이면 계열 122개를
 * 볼 수 있는데도 못 보게 된다.
 */

import { useEffect, useMemo, useState } from 'react';

import { fetchIssuanceCalendar, fetchIssuanceDay, type IssuanceCalendar, type IssuanceDay } from '@/lab/issuance/api';
import { fetchMrBoard, type MrBoard } from '@/mr/api';
import { fetchRv, type RvPayload } from '@/rv/api';
import { FUNDING_DEFAULT } from '@/state/funding';
import { fetchUniverse, type UniversePayload } from '@/table/universeRows';

import { buildOntology, type Ontology } from './ontology';

/** 원문을 읽어 오는 날 수. 12 는 «최근 두 주 남짓» 이고, 그 안에 국고채 입찰이
 *  보통 두세 번 들어온다 — 입찰이 하나도 없는 창을 뽑으면 입찰 객체가 0 이 되어
 *  그 종류가 화면에서 통째로 사라진다. */
const DAY_WINDOW = 12;

/** RV 를 부를 때 쓰는 조달 규약.
 *
 * ── 왜 Setting 의 값이 아니라 기본값인가 ───────────────────────────────────
 * `state/funding.ts` 는 사람이 Setting 화면에서 정해 둔 값을 localStorage 에
 * 들고 있고, RV 화면은 그것을 읽는다. 이 화면은 **안 읽는다** — 이 목업의 주장은
 * 「같은 객체를 여러 축에서 본다」이지 「조달 규약을 실험한다」가 아니라서,
 * 사람마다 다른 저장값이 들어오면 같은 화면이 사람마다 다른 Score 를 보여 준다.
 * 그래서 백엔드의 기본값 한 벌로 고정하고, 그 사실을 도시에의 출처 줄이 적는다.
 * (조달을 만지려면 Strategy 의 RV 화면이 그 자리다.) */
const RV_PARAMS = {
  window: '52w' as const,
  basis: FUNDING_DEFAULT.basis,
  spreadBp: FUNDING_DEFAULT.spreadBp,
};

export type TermData =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; ontology: Ontology; partial: string[] };

export function useTermData(): TermData {
  const [universe, setUniverse] = useState<UniversePayload | null>(null);
  const [mr, setMr] = useState<MrBoard | null>(null);
  const [calendar, setCalendar] = useState<IssuanceCalendar | null>(null);
  const [rv, setRv] = useState<RvPayload | null>(null);
  const [days, setDays] = useState<IssuanceDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    const soft: string[] = [];

    (async () => {
      /* 유니버스는 **필수**. 없으면 화면이 없다. */
      let u: UniversePayload;
      try {
        u = await fetchUniverse();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!alive) return;
      setUniverse(u);

      /* 나머지는 **있으면 좋은 것**. 각자 실패하고 각자 그 사실을 남긴다. */
      const board = await fetchMrBoard({ window: 20, k: 2 }).catch((e: unknown) => {
        soft.push(`밴드(/api/mr/board)를 못 읽었어요: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!alive) return;
      setMr(board);

      /* RV 는 라이브 전용이다(민평이 SQL 에만 있다 — `rv/api.ts` 머리). 백엔드가
         없으면 404 → `BacktestUnavailable` 이고, 그때도 나머지 화면은 선다. */
      const rvBody = await fetchRv(RV_PARAMS).catch((e: unknown) => {
        soft.push(`RV 랭킹(/api/rv/analysis)을 못 읽었어요: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!alive) return;
      setRv(rvBody);

      const ym = (u.asof ?? '').slice(0, 7);
      const cal = await fetchIssuanceCalendar(ym || '2026-08', 2).catch((e: unknown) => {
        soft.push(`발행 캘린더를 못 읽었어요: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!alive) return;
      setCalendar(cal);

      if (cal) {
        /* 원문을 읽을 날 고르기 — **뭔가 일어난 날**만. 아무 일도 없는 날의
           원문은 빈 배열이라 요청이 낭비다. 최신부터 세어 `DAY_WINDOW` 개. */
        const candidates: string[] = [];
        for (const ym2 of cal.order) {
          for (const d of cal.months[ym2]?.days ?? []) {
            const hasIssue = Object.keys(d.isec ?? {}).length > 0;
            const hasAuction = (d.ev ?? []).some((e) => e.lane === 'ktb');
            if (d.past && (hasIssue || hasAuction)) candidates.push(d.iso);
          }
        }
        const pick = candidates.slice(-DAY_WINDOW);
        const got = await Promise.all(
          pick.map((iso) => fetchIssuanceDay(iso).catch(() => null)),
        );
        if (!alive) return;
        const ok = got.filter((d): d is IssuanceDay => d != null);
        if (ok.length < pick.length) {
          soft.push(`원문 ${pick.length}일 중 ${pick.length - ok.length}일은 못 읽었어요.`);
        }
        setDays(ok);
      }

      if (!alive) return;
      setPartial(soft);
      setDone(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const ontology = useMemo(
    () => (universe ? buildOntology({ universe, mr, calendar, days, rv }) : null),
    [universe, mr, calendar, days, rv],
  );

  if (error) return { state: 'error', message: error };
  if (!ontology || !done) return { state: 'loading' };
  return { state: 'ready', ontology, partial };
}
