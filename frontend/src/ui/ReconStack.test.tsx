// @vitest-environment jsdom
/* 일별 대사 스택의 구조 핀 [OWNER, 2026-08-11 — "1일차 KRD, BP변화, PnL를
 * 각각 가로줄로 구성해서 쌓아서 80일치면 240개의 가로줄"].
 *
 * 그 요구는 문장 그대로 검증 가능하다: 하루 = <tr> 셋, 80일 = 240행. 여기에
 * 스택이 지켜야 하는 사실 셋을 더 못박는다 — 날짜·하루 요약(평가/캐리/
 * 롤다운/그날 손익)은 하루에 **한 번**(rowSpan=3), 전 테너 열 복원
 * [OWNER, 2026-08-12 — 0 이어도 열은 선다], Δbp 는 둘째 자리 소수(정수
 * 반올림이 하루 0.17bp 를 지운다). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

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

  it("전 기간 KRD 0인 테너 열도 그대로 선다 [OWNER, 2026-08-12 — '물리적으로 잘린 테너들도 복원']", () => {
    const { container, queryByText } = render(
      <ReconStack days={[day(0)]} tenors={TENORS} />,
    );
    const headers = [...container.querySelectorAll("thead th")].map((h) => h.textContent);
    // 10Y 는 이 픽스처에서 KRD 가 전 기간 0 — 종전 폭 규율이 숨기던 열이다.
    expect(headers).toContain("10Y");
    expect(headers).toContain("6M");
    expect(queryByText(/숨겼어요/)).toBeNull();
  });

  it("표면을 마우스로 끌면 가로로 팬 되고, 그 제스처의 클릭은 삼켜진다", () => {
    // 드래그 = pointerdown → 문턱(4px) 너머 pointermove. jsdom 은 레이아웃이
    // 없어도 scrollLeft 대입은 보존한다 — 팬 수식(시작 scrollLeft − dx)을
    // 그대로 단언할 수 있다.
    const { container, getByRole } = render(
      <ReconStack days={[day(0)]} tenors={TENORS} />,
    );
    const pane = container.querySelector("div.overflow-x-auto") as HTMLElement;
    fireEvent.pointerDown(pane, { pointerType: "mouse", button: 0, clientX: 200, buttons: 1 });
    fireEvent.pointerMove(pane, { pointerType: "mouse", clientX: 120, buttons: 1 });
    expect(pane.scrollLeft).toBe(80);
    fireEvent.pointerUp(pane, { pointerType: "mouse" });
    // 팬을 끝낸 손이 정렬을 뒤집으면 안 된다 — 직후 클릭 하나는 죽는다.
    const btn = getByRole("button", { name: /날짜/ });
    fireEvent.click(btn);
    expect(btn.textContent).toContain("↑");
    // 다음 클릭부터는 보통 클릭이다.
    fireEvent.click(btn);
    expect(btn.textContent).toContain("↓");
  });

  it("Δbp 줄은 둘째 자리 소수를 그대로 보인다", () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    expect(container.textContent).toContain("0.25");
    expect(container.textContent).toContain("-0.50");
  });

  it("이월 앵커 블록(종가 KRD만, 손익 null)도 세 줄이고 나머지는 —", () => {
    // 2026-08-11 recon 앵커: 마지막 날의 종가 KRD 만 싣고 Δbp·손익·하루
    // 요약은 전부 null — 아직 오지 않은 날의 손익을 0 이라고 말하지 않는다.
    const anchor: ReconStackDay = {
      date: "2026-03-04",
      title: "2026-03-04 · 다음 영업일로 들고 가는 이월 리스크",
      krd: { "3M": -28400, "6M": 387162, "1Y": 185827, "10Y": 0 },
      dbp: {},
      est: {},
      estTotal: null,
      valuation: null,
      carry: null,
      rolldown: null,
      actual: null,
    };
    const { container } = render(
      <ReconStack days={[day(0), anchor]} tenors={TENORS} />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
    // 앵커 블록의 KRD 는 보이고(이월 리스크), 하루 요약 넷은 — 로 선다.
    expect(container.textContent).toContain("387,162");
    const dashes = [...container.querySelectorAll("tbody td[rowspan='3']")]
      .filter((el) => el.textContent === "—");
    expect(dashes.length).toBe(4); // 앵커의 평가·캐리·롤다운·그날 손익
  });
});

describe("날짜 정렬 토글 [OWNER, 2026-08-11 — '오름차순 내림차순 선택']", () => {
  const three = [day(0), day(1), day(2)]; // 03-01 → 03-03, 오름차순 입력

  const firstDate = (container: HTMLElement) =>
    container.querySelector("tbody td[rowspan='3']")?.textContent;

  it("기본 asc 는 오래된 날짜가 위, desc 는 최신이 위", () => {
    const a = render(<ReconStack days={three} tenors={TENORS} />);
    expect(firstDate(a.container)).toContain("03-01");
    cleanup();
    const b = render(<ReconStack days={three} tenors={TENORS} defaultOrder="desc" />);
    expect(firstDate(b.container)).toContain("03-03");
  });

  it("날짜 헤더를 누르면 방향이 뒤집히고 화살표가 따라온다", () => {
    const { container, getByRole } = render(<ReconStack days={three} tenors={TENORS} />);
    const btn = getByRole("button", { name: /날짜/ });
    expect(btn.textContent).toContain("↑");
    fireEvent.click(btn);
    expect(firstDate(container)).toContain("03-03");
    expect(btn.textContent).toContain("↓");
    fireEvent.click(btn);
    expect(firstDate(container)).toContain("03-01");
  });
});
