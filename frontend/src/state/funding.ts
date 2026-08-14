"use client";

/* 조달금리 — Setting 탭이 정하고 Cash Bond 백테스트가 읽는 값 [OWNER, 2026-08-14].
 *
 * `useUiStore` 와 같은 성질의 상태다: 읽는 사람의 환경설정이고, 기억되며, 이
 * 값을 쓰는 화면들이 자기 사본을 갖지 않는다. 그래서 같은 자리(Zustand +
 * localStorage)에 같은 모양으로 둔다.
 *
 * **별도 스토어인 이유**는 수명이 다르기 때문이다. `ui.ts` 는 테마·차트종류처럼
 * 화면을 어떻게 그릴지에 대한 것이고, 이것은 **숫자를 어떻게 계산할지**에 대한
 * 것이다. 조달을 잘못 두면 손익이 틀리지 화면이 틀리지 않는다.
 *
 * 적용 범위는 Cash Bond 뿐이다 [OWNER, 2026-08-14 — "Cash Bond 전용"]. IRS
 * 백테스트는 이 값을 읽지 않고, 그 숫자는 이 기능이 생기기 전과 같아야 한다.
 */

import { create } from "zustand";

/** 조달 기준 시계열. 백엔드 `app/funding.py:BASIS_LABEL` 의 키와 같아야 한다. */
export type FundingBasis = "base" | "call";

/** 기본값 — 시뮬레이션 레인이 오래 써 온 "기준금리 + 10bp" 와 같은 자리에서
 * 출발한다 (`irs_pricer/services/funding_basis.py`). */
export const FUNDING_DEFAULT = { basis: "base" as FundingBasis, spreadBp: 10 };

const KEY = "bw-funding";

/** 백엔드의 검증과 **같은 범위**다 (`FundingSpec.validated`). 화면에서 먼저
 * 막는 이유는 422 를 왕복시키지 않으려는 것뿐이고, 판정의 주인은 서버다. */
export const SPREAD_MIN = -500;
export const SPREAD_MAX = 500;

export interface FundingSpec {
  basis: FundingBasis;
  spreadBp: number;
}

function load(): FundingSpec {
  if (typeof window === "undefined") return FUNDING_DEFAULT; // SSR
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return FUNDING_DEFAULT;
    const v = JSON.parse(raw) as Partial<FundingSpec>;
    const basis = v.basis === "call" || v.basis === "base" ? v.basis : FUNDING_DEFAULT.basis;
    const n = Number(v.spreadBp);
    const spreadBp =
      Number.isFinite(n) && n >= SPREAD_MIN && n <= SPREAD_MAX ? n : FUNDING_DEFAULT.spreadBp;
    return { basis, spreadBp };
  } catch {
    // 저장소가 막혔거나 옛 모양이 남아 있다 — 기본값이 안전하다
    return FUNDING_DEFAULT;
  }
}

function save(spec: FundingSpec) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(spec));
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

interface FundingState extends FundingSpec {
  setBasis: (b: FundingBasis) => void;
  setSpreadBp: (bp: number) => void;
  reset: () => void;
  /** 저장소에서 읽어 스토어를 맞춘다. SSR 과 첫 페인트의 마크업을 같게 두려고
   * 초기값은 상수이고, 마운트 뒤에 한 번 부른다 — `syncUiFromDom` 과 같은 수법. */
  hydrate: () => void;
}

export const useFundingStore = create<FundingState>()((set, get) => ({
  ...FUNDING_DEFAULT,
  setBasis: (basis) => {
    const next = { basis, spreadBp: get().spreadBp };
    save(next);
    set(next);
  },
  setSpreadBp: (spreadBp) => {
    const clamped = Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, spreadBp));
    const next = { basis: get().basis, spreadBp: clamped };
    save(next);
    set(next);
  },
  reset: () => {
    save(FUNDING_DEFAULT);
    set(FUNDING_DEFAULT);
  },
  hydrate: () => set(load()),
}));
