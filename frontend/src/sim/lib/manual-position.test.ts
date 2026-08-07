import { describe, expect, it } from "vitest";

import {
  addYearsIso,
  isLive,
  newManualPosition,
  parRatePct,
  positionError,
  toEnginePosition,
  withStartDate,
  withTenor,
  type ManualPosition,
} from "./manual-position";

const row = (over: Partial<ManualPosition> = {}): ManualPosition => ({
  ...newManualPosition("2026-07-16", 1),
  ...over,
});

describe("만기일 산술", () => {
  it("같은 월·일에 연수를 더한다", () => {
    expect(addYearsIso("2026-07-16", 3)).toBe("2029-07-16");
    expect(addYearsIso("2026-07-16", 10)).toBe("2036-07-16");
  });

  it("2월 29일은 평년의 2월 28일로 내린다 — 3월 1일로 굴러가지 않는다", () => {
    // Date(2027, 1, 29)는 3/1로 넘친다. 만기가 다음 달로 새면 스케줄 전체와
    // 잔존일수가 하루씩 어긋난다.
    expect(addYearsIso("2024-02-29", 3)).toBe("2027-02-28");
    // 윤년 → 윤년은 그대로 29일
    expect(addYearsIso("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("월말이 아닌 날은 손대지 않는다", () => {
    expect(addYearsIso("2026-01-31", 1)).toBe("2027-01-31");
  });
});

describe("시장 par 조회", () => {
  // 실제 스냅샷(2026-07-16)의 앞부분: 1년 미만이 tenor_years=1로 오고
  // tenor_months로만 구분된다.
  const quotes = [
    { tenor_years: 1, tenor_months: 6, rate: 0.030675 },
    { tenor_years: 1, tenor_months: 9, rate: 0.032625 },
    { tenor_years: 1, tenor_months: null, rate: 0.034225 },
    { tenor_years: 3, tenor_months: null, rate: 0.0345 },
  ];

  it("1Y는 6M/9M 호가가 아니라 진짜 1Y를 집는다", () => {
    // 이 함정을 한 번 밟은 적이 있다 — 백테스트에서 1년 미만 만기가 1Y로
    // 가격됐다. tenor_months를 먼저 걸러내지 않으면 6M이 1Y 자리에 앉는다.
    expect(parRatePct(quotes, "1Y")).toBeCloseTo(3.4225, 6);
  });

  it("퍼센트로 돌려준다 — 스냅샷은 소수다", () => {
    expect(parRatePct(quotes, "3Y")).toBeCloseTo(3.45, 6);
  });

  it("그날 호가가 없는 테너는 null", () => {
    expect(parRatePct(quotes, "20Y")).toBeNull();
  });
});

describe("테너가 만기의 주인이다", () => {
  it("테너를 바꾸면 만기가 따라간다", () => {
    expect(withTenor(row(), "10Y").maturityDate).toBe("2036-07-16");
  });

  it("시작일을 바꾸면 만기도 테너만큼 다시 밀린다", () => {
    const p = withStartDate(row({ tenor: "5Y" }), "2020-03-02");
    expect(p.maturityDate).toBe("2025-03-02");
  });
});

describe("실행 가능성", () => {
  it("만기가 시작일보다 앞서면 막는다", () => {
    expect(positionError(row({ maturityDate: "2020-01-01" }), 3.4)).toMatch(/만기일/);
  });

  it("명목 0은 막는다", () => {
    expect(positionError(row({ notionalEok: 0 }), 3.4)).toMatch(/명목/);
  });

  it("금리를 비웠는데 그날 par도 없으면, 직접 넣으라고 말한다", () => {
    const err = positionError(row({ tenor: "20Y" }), null);
    expect(err).toMatch(/20Y/);
    expect(err).toMatch(/직접/);
  });

  it("금리를 직접 적었으면 par가 없어도 통과한다", () => {
    expect(positionError(row({ tenor: "20Y", fixedRatePct: 3.9 }), null)).toBeNull();
  });
});

describe("엔진 페이로드 변환", () => {
  it("빈 금리는 시장 par로 채운다 — 진입 MtM 0인 신규 거래", () => {
    expect(toEnginePosition(row(), 3.4225, "2026-07-16").couponRate).toBeCloseTo(3.4225, 6);
  });

  it("직접 적은 금리는 par가 있어도 그대로 존중한다", () => {
    // 기존 포지션은 par에 있지 않다. 여기서 par로 덮으면 사용자가 넣은
    // 포지션이 아닌 다른 포지션을 평가하게 된다.
    expect(toEnginePosition(row({ fixedRatePct: 1.91 }), 3.4225, "2026-07-16").couponRate).toBe(
      1.91,
    );
  });

  it("명목은 억에서 원으로 한 번만 변환된다", () => {
    expect(toEnginePosition(row({ notionalEok: 100 }), 3.4, "2026-07-16").notional).toBe(1e10);
  });

  it("백엔드가 채우는 필드는 비워서 보낸다", () => {
    // 여기서 계산해 보내면 swap_inputs.py와 두 개의 진실이 생긴다.
    const p = toEnginePosition(row(), 3.4, "2026-07-16");
    expect(p.remainingDays).toBe(0);
    expect(p.currentFloatRate).toBe(0);
    expect(p.krdMap).toEqual({});
    expect(p.pvbp).toBe(0);
  });

  it("부호 관례는 백엔드와 같다 — +1 수취, −1 지급", () => {
    expect(toEnginePosition(row({ direction: -1 }), 3.4, "2026-07-16").direction).toBe(-1);
    expect(toEnginePosition(row({ direction: -1 }), 3.4, "2026-07-16").name).toMatch(/지급/);
  });

  it("원화 IRS는 분기 정산", () => {
    expect(toEnginePosition(row(), 3.4, "2026-07-16").frequency).toBe(4);
  });
});

describe("만기가 지난 줄", () => {
  it("기준일에 이미 끝난 스왑은 산 것이 아니다", () => {
    expect(isLive(row({ maturityDate: "2026-01-01" }), "2026-07-16")).toBe(false);
    expect(isLive(row(), "2026-07-16")).toBe(true);
  });
});
