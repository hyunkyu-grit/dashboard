/* 커브 표면이 **실제로 그려지는가**. 투영의 산술은 lab-tab.test.ts 가 순수
 * 모듈에서 잡지만, 렌더가 도는지·던지는지는 그려 봐야 안다. 이 파일이 있는
 * 이유는 2026-08-14 에 dev 서버에서 Lab 탭이 얼어붙은 것을 격리해서 잡아야
 * 했기 때문이다 — 공유 dev 서버는 진단 도구가 아니다. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SurfacePayload } from "../src/lib/api";
import { SurfacePlot } from "../src/ui/YieldSurface";

function payload(dates: number, holes = false): SurfacePayload {
  const tenors = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"];
  return {
    asof: "2026-08-13",
    unit: "%",
    stride: 5,
    tenors,
    dates: Array.from({ length: dates }, (_, j) =>
      new Date(Date.UTC(2016, 0, 4 + j * 7)).toISOString().slice(0, 10),
    ),
    z: tenors.map((_, i) =>
      Array.from({ length: dates }, (_, j) =>
        holes && j % 17 === 0 ? null : 1 + i * 0.3 + Math.sin(j / 9) * 0.8,
      ),
    ),
    inversionPair: "2Y-10Y",
    inversionBp: Array.from({ length: dates }, (_, j) =>
      Math.sin(j / 13) * 40,
    ),
    missingNodes: [],
  };
}

const render = (p: SurfacePayload) =>
  renderToStaticMarkup(
    createElement(SurfacePlot, { payload: p, width: 940, height: 480 }),
  );

describe("커브 표면이 그려진다", () => {
  it("실제 크기의 격자를 그린다", () => {
    const html = render(payload(525));
    expect(html).toContain("<svg");
    // 능선이 여러 장 — 한 장만 나오면 솎기가 죽은 것이다
    expect((html.match(/<polyline/g) ?? []).length).toBeGreaterThan(50);
    // 그리고 부분화소가 되도록 다 그리지는 않는다
    expect((html.match(/<polygon/g) ?? []).length).toBeLessThan(525);
  });

  it("구멍이 있어도 그린다", () => {
    expect(render(payload(525, true))).toContain("<svg");
  });

  it("좌표에 NaN 이 없다", () => {
    // NaN 이 섞이면 SVG 는 조용히 그 도형만 지운다 — 화면에서는 "표면이 좀
    // 비네" 로 보이고 콘솔은 조용하다.
    expect(render(payload(525))).not.toMatch(/NaN/);
  });

  it("능선 한 장, 테너 하나여도 죽지 않는다", () => {
    expect(render(payload(1))).toContain("<svg");
  });

  it("상자가 음수가 되는 크기에서 죽지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(SurfacePlot, { payload: payload(10), width: 10, height: 10 }),
    );
    expect(html).toBe("");
  });
});
