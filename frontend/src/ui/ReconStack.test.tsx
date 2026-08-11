// @vitest-environment jsdom
/* 일별 대사 스택의 구조 핀 [OWNER, 2026-08-11 — "1일차 KRD, BP변화, PnL를
 * 각각 가로줄로 구성해서 쌓아서 80일치면 240개의 가로줄"].
 *
 * 그 요구는 문장 그대로 검증 가능하다: 하루 = <tr> 셋, 80일 = 240행. 여기에
 * 스택이 지켜야 하는 사실 셋을 더 못박는다 — 날짜·하루 요약(평가/캐리/
 * 롤다운/그날 손익)은 하루에 **한 번**(rowSpan=3), 전 기간 KRD 0 인 테너
 * 열은 숨김, Δbp 는 둘째 자리 소수(정수 반올림이 하루 0.17bp 를 지운다). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ReconStack, type ReconStackDay } from "./ReconStack";

afterEach(cleanup);

const TENORS = ["3M", "6M", "1Y", "10Y"];

function day(i: number): ReconStackDay {
  return {
    date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
    title: `d${i}`,
    krd: { "3M": -28400, "6M": 387162, "1Y": 185827, "10Y": 0 },
    dbp: { "3M": 0.25, "6M": -0.5, "1Y": 1.0, "10Y": 0.75 },
    est: { "3M": -7100, "6M": 193581, "1Y": -185827, "10Y": 0 },
    estTotal: 654,
    valuation: -369066 - i,
    carry: 143836,
    rolldown: 368131,
    actual: 142901,
  };
}

describe("하루 = 가로줄 셋", () => {
  it("80일이면 정확히 240개의 <tr>이 쌓인다", () => {
    const days = Array.from({ length: 80 }, (_, i) => day(i));
    const { container } = render(<ReconStack days={days} tenors={TENORS} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(240);
  });

  it("날짜와 하루 요약(평가·캐리·롤다운·그날 손익)은 하루에 한 번, rowSpan=3", () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const spanned = [...container.querySelectorAll("tbody td[rowspan='3']")];
    // 날짜 1 + 요약 4
    expect(spanned).toHaveLength(5);
    const texts = spanned.map((el) => el.textContent);
    expect(texts.some((t) => t?.includes("03-01"))).toBe(true);
    expect(texts.some((t) => t?.includes("+368,131"))).toBe(true); // 롤다운
  });

  it("전 기간 KRD 0인 테너 열은 숨고, 숨겼다고 말한다", () => {
    const { container, getByText } = render(
      <ReconStack days={[day(0)]} tenors={TENORS} />,
    );
    const headers = [...container.querySelectorAll("thead th")].map((h) => h.textContent);
    expect(headers).not.toContain("10Y");
    expect(headers).toContain("6M");
    getByText(/테너 1개는 숨겼어요/);
  });

  it("Δbp 줄은 둘째 자리 소수를 그대로 보인다", () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    expect(container.textContent).toContain("0.25");
    expect(container.textContent).toContain("-0.50");
  });
});
