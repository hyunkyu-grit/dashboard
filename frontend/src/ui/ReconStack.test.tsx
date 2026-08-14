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
    // 개시는 진입일 행에만 선다 — 보통 날은 0 이다 [OWNER, 2026-08-14]
    startup: 0,
    actual: 142901,
  };
}

describe("하루 = 가로줄 셋", () => {
  it("80일이면 정확히 240개의 <tr>이 쌓인다", () => {
    const days = Array.from({ length: 80 }, (_, i) => day(i));
    const { container } = render(<ReconStack days={days} tenors={TENORS} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(240);
  });

  it("날짜와 하루 요약(평가·캐리·롤다운·개시·그날 손익)은 하루에 한 번, rowSpan=3", () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const spanned = [...container.querySelectorAll("tbody td[rowspan='3']")];
    // 날짜 1 + 요약 5
    expect(spanned).toHaveLength(6);
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

  it("양축 스크롤러가 높이 캡을 갖는다 — 가로 바가 표 바닥이 아니라 눈앞에 선다", () => {
    // [OWNER, 2026-08-12 2차 — "마우스로 잡아 끄는게 아니라 좌우 스크롤이
    // 가능하게"]: 잡아 끄는 팬은 걷어냈다. 컨테이너가 자기 안에서 세로로
    // 스크롤해야 헤더 행 고정이 성립하고 가로 스크롤바가 닿는 곳에 선다.
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const pane = container.querySelector("div.overflow-auto") as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.className).toContain("max-h-");
  });

  it("범례는 사방 고정 — 헤더 행은 top, 날짜·구분은 left, 요약 여섯은 right", () => {
    // [OWNER, 2026-08-12 2차 — "좌우의 범례 … 열과 행 고정시켜서 스크롤을
    // 움직이더라도 고정"]. 좌표는 컬럼 트랙(ch)과 같은 자로 풀려야 한다 —
    // 13px 헤더는 14/13 환산(calc), 14px 본문 셀은 ch 그대로.
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const ths = [...container.querySelectorAll("thead th")] as HTMLElement[];
    expect(ths.every((th) => th.className.includes("sticky"))).toBe(true); // 행 고정
    // jsdom 의 CSSOM 이 calc(Nch * 14 / 13) 을 calc(N·14/13 ch) 로 접어
    // 직렬화한다 — 소스의 수식이 아니라 환산된 값으로 단언한다.
    expect(ths[0].style.left).toBe("0px"); // 날짜
    expect(ths[1].style.left).toMatch(/calc\(7\.53\d*ch\)/); // 구분 = 7ch·14/13
    const tail = ths.slice(-6);
    expect(tail.map((th) => th.style.right)).toEqual([
      expect.stringMatching(/calc\(59\.23\d*ch\)/), // 합계   = 55ch·14/13
      expect.stringMatching(/calc\(47\.38\d*ch\)/), // 평가   = 44ch·14/13
      expect.stringMatching(/calc\(35\.53\d*ch\)/), // 캐리   = 33ch·14/13
      expect.stringMatching(/calc\(23\.69\d*ch\)/), // 롤다운 = 22ch·14/13
      expect.stringMatching(/calc\(11\.84\d*ch\)/), // 개시   = 11ch·14/13
      "0px",
    ]);
    // 본문: 날짜(왼쪽)와 요약 다섯(오른쪽)의 rowSpan 셀도 스티키 + 불투명 bg(§G).
    const spanned = [...container.querySelectorAll("tbody td[rowspan='3']")] as HTMLElement[];
    expect(spanned).toHaveLength(6);
    for (const td of spanned) {
      expect(td.className).toContain("sticky");
      expect(td.className).toMatch(/bg-(tile|page|popover)/);
    }
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
      startup: null,
      actual: null,
    };
    const { container } = render(
      <ReconStack days={[day(0), anchor]} tenors={TENORS} />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
    // 앵커 블록의 KRD 는 보이고(이월 리스크), 하루 요약 다섯은 — 로 선다.
    expect(container.textContent).toContain("387,162");
    const dashes = [...container.querySelectorAll("tbody td[rowspan='3']")]
      .filter((el) => el.textContent === "—");
    expect(dashes.length).toBe(5); // 앵커의 평가·캐리·롤다운·개시·그날 손익
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
