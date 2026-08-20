'use client';

/* 조달금리 — Setting 탭이 정하고 **Cash Bond 백테스트와 Strategy(RV)** 가 읽는
 * 값 [OWNER, 2026-08-14; RV 는 그 뒤에 합류].
 *
 * v1 `state/funding.ts`(zustand + localStorage)의 이식. v2 는 상태 라이브러리가
 * 없으므로 [세션 규칙] `BottomStrip.useStripCollapsed` 와 같은 관례로 간다 —
 * `useSyncExternalStore` + localStorage + 모듈 리스너. 저장 매체가 localStorage
 * 인 것도 그쪽과 같은 이유다: 좌표가 아니라 취향(계산 규약)이고 어느 화면에서도
 * 같은 뜻이라, 창 자리의 "다른 모니터" 문제가 없다.
 *
 * ## 적용 범위 — 둘이다 (한때 하나였다)
 *
 * 처음 규약은 "Cash Bond 전용" 이었다 [OWNER, 2026-08-14]. 그 뒤 RV 가 조달을
 * 경유하게 되면서 소비처가 둘이 됐고, **IRS 백테스트만 여전히 안 읽는다**
 * (그 숫자는 이 기능이 생기기 전과 같아야 한다는 규약 그대로다).
 *
 * 소비처: `/api/settings/funding` · `/api/cashbond/backtest` · `/api/rv/analysis`.
 *
 * **2026-08-20 부터 RV 쪽 민감도가 커졌다.** 전에는 크레딧 RV 의 버퍼가
 * 국고 헤지 페어(스프레드축)라 조달이 두 다리에서 소거됐는데, 축이 아웃라이트로
 * 옮겨 가면서 조달이 캐리에 그대로 남는다 — 여기서 10bp 를 움직이면 RV 의 모든
 * 캐리·버퍼·Score 가 따라 움직인다. Setting 화면의 안내 문구가 그 사실을 적는다.
 */

import { useSyncExternalStore } from 'react';

/** 조달 기준 시계열. 백엔드 `app/funding.py:BASIS_LABEL` 의 키와 같아야 한다. */
export type FundingBasis = 'base' | 'call';

/** 기본값 [OWNER, 2026-08-20 — "조달 기본값은 한은 기준금리"]. v1 과 같은 자리다.
 *
 * 한때 call 이었던 것은 취향이 아니라 기준금리 **출처가 멈춰 있었기** 때문이다
 * (SQL `infomax.기준금리` 가 2026-03-21 에서 정지, 7/16 인상 누락). 출처를
 * 한국은행 ECOS 로 옮겨 그 이유가 없어졌다 — `backend/app/funding.py` 의 V2 절. */
export const FUNDING_DEFAULT = { basis: 'base' as FundingBasis, spreadBp: 10 };

const KEY = 'sr-funding';

/** 백엔드의 검증과 **같은 범위**다 (`FundingSpec.validated`). 화면에서 먼저
 * 막는 이유는 422 를 왕복시키지 않으려는 것뿐이고, 판정의 주인은 서버다. */
export const SPREAD_MIN = -500;
export const SPREAD_MAX = 500;

export interface FundingSpec {
  basis: FundingBasis;
  spreadBp: number;
}

function load(): FundingSpec {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return FUNDING_DEFAULT;
    const v = JSON.parse(raw) as Partial<FundingSpec>;
    const basis = v.basis === 'call' || v.basis === 'base' ? v.basis : FUNDING_DEFAULT.basis;
    const n = Number(v.spreadBp);
    const spreadBp =
      Number.isFinite(n) && n >= SPREAD_MIN && n <= SPREAD_MAX ? n : FUNDING_DEFAULT.spreadBp;
    return { basis, spreadBp };
  } catch {
    // 저장소가 막혔거나 옛 모양이 남아 있다 — 기본값이 안전하다
    return FUNDING_DEFAULT;
  }
}

const listeners = new Set<() => void>();

/* `useSyncExternalStore` 의 getSnapshot 은 **같은 값이면 같은 참조**를 돌려줘야
 * 한다 — 매번 새 객체를 만들면 무한 리렌더가 난다. 그래서 스냅샷을 캐시하고
 * 쓰기에서만 갈아끼운다. */
let snapshot: FundingSpec | null = null;

function read(): FundingSpec {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

function write(next: FundingSpec) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장소가 막힌 환경 — 선택이 기억되지 않을 뿐이다 */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 조달 스펙과 그 조작. 서버 스냅샷은 **항상 기본값**이고 하이드레이션에서
 * 교정된다 — 서버는 이 취향을 알 방법이 없다 (`useStripCollapsed` 와 같은 처리). */
export function useFunding(): [
  FundingSpec,
  {
    setBasis: (b: FundingBasis) => void;
    setSpreadBp: (bp: number) => void;
    reset: () => void;
  },
] {
  const spec = useSyncExternalStore(subscribe, read, () => FUNDING_DEFAULT);
  return [
    spec,
    {
      setBasis: (basis) => write({ ...read(), basis }),
      setSpreadBp: (bp) =>
        write({ ...read(), spreadBp: Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, bp)) }),
      reset: () => write(FUNDING_DEFAULT),
    },
  ];
}
