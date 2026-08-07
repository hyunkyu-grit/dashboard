import { describe, expect, it } from "vitest";

import {
  directionLabel,
  directionOptions,
  kindOf,
  newManualPosition,
  positionError,
  type ManualPosition,
} from "./manual-position";

const row = (over: Partial<ManualPosition> = {}): ManualPosition => ({
  ...newManualPosition(1),
  ...over,
});

describe("id 하나로 종류를 안다", () => {
  it("모니터의 문법 그대로", () => {
    expect(kindOf("10Y")).toBe("outright");
    expect(kindOf("3Y-10Y")).toBe("spread");
    expect(kindOf("2Y-5Y-10Y")).toBe("fly");
    expect(kindOf("1Yx1Y")).toBe("forward");
  });

  it("포워드를 먼저 본다 — 포워드에는 '-'가 없다", () => {
    // `1.5Y-10Y`처럼 소수점이 든 id도 대시 개수로만 갈린다
    expect(kindOf("1.5Y-10Y")).toBe("spread");
    expect(kindOf("6Mx6M")).toBe("forward");
  });

  it("백엔드의 kind_of와 같은 답을 낸다", () => {
    // app/instruments.py: "x"가 있으면 forward, 아니면 대시 개수
    const cases: [string, string][] = [
      ["6M", "outright"],
      ["6M-9M", "spread"],
      ["6M-9M-1Y", "fly"],
      ["2Yx3Y", "forward"],
    ];
    for (const [id, want] of cases) expect(kindOf(id), id).toBe(want);
  });
});

describe("방향은 종류마다 다른 말로 불린다", () => {
  it("아웃라이트·포워드는 페이/리시브 — 데스크가 쓰는 동사", () => {
    // 고정 지급/수취는 회계의 등록부이지 트레이딩의 말이 아니다
    // [OWNER, 2026-07-31 — BacktestWindow의 규칙].
    expect(directionLabel("10Y", 1)).toBe("페이");
    expect(directionLabel("10Y", -1)).toBe("리시브");
    expect(directionLabel("1Yx1Y", 1)).toBe("페이");
  });

  it("스프레드는 스티프너/플래트너", () => {
    expect(directionLabel("3Y-10Y", 1)).toBe("스티프너");
    expect(directionLabel("3Y-10Y", -1)).toBe("플래트너");
  });

  it("플라이는 벨리를 사는지 파는지", () => {
    expect(directionLabel("2Y-5Y-10Y", 1)).toBe("벨리 매도");
    expect(directionLabel("2Y-5Y-10Y", -1)).toBe("벨리 매수");
  });

  it("세그먼트가 읽는 쌍은 항상 롱이 먼저다", () => {
    const opts = directionOptions("3Y-10Y");
    expect(opts.map((o) => o.value)).toEqual(["long", "short"]);
    expect(opts[0].label).toBe("스티프너");
  });
});

describe("실행 가능성", () => {
  it("명목 0은 막는다", () => {
    expect(positionError(row({ notionalEok: 0 }))).toMatch(/명목/);
    expect(positionError(row({ notionalEok: -5 }))).toMatch(/명목/);
  });

  it("상품이 비면 막는다", () => {
    expect(positionError(row({ seriesId: "" }))).toMatch(/상품/);
  });

  it("기본 줄은 그대로 실행 가능하다", () => {
    // 추가하자마자 빨간 글씨가 뜨는 폼은 사용자가 무엇을 잘못했는지 모르게 한다
    expect(positionError(row())).toBeNull();
  });
});

describe("새 줄", () => {
  it("id는 seq를 따른다 — 화면이 최댓값+1로 부른다", () => {
    expect(newManualPosition(3).id).toBe("manual-3");
  });

  it("고정금리 칸은 없다", () => {
    // 다리마다 그 날 par로 쳐진다. 진입 MtM 0이라 결과에 남는 것은 경로가
    // 만든 손익뿐이고, 이 화면이 묻는 것이 그것이다.
    expect(newManualPosition(1)).not.toHaveProperty("fixedRatePct");
    expect(newManualPosition(1)).not.toHaveProperty("startDate");
  });
});
