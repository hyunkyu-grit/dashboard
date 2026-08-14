/* Guard: Lab — the incubation tab, and its tenant's geometry.
 *
 * 앞 절반은 `guards/regret-list.test.ts` 에서 왔다. 그 파일은 첫 세입자(라고
 * 할 때 살걸)의 어휘를 핀으로 잡으면서 같은 자리에서 **탭 자체의 규칙**도
 * 잡고 있었고, 세입자가 내려간 2026-08-14 에 앞 절반만 세입자와 함께
 * 사라졌다 — 실험 하나가 내려갈 때 탭 순서 규칙까지 조용히 같이 사라지면
 * 안 된다.
 *
 * 뒤 절반은 두 번째 세입자인 **커브 표면**의 투영이다. 여기서 잡는 것은
 * 「예쁜가」가 아니라 **그림이 데이터에 대해 거짓말하는 자리** 셋이다.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import {
  type Box,
  depthAtPoint,
  curveAtSlice,
  depthOf,
  domainOf,
  rateY,
  RIDGE_PITCH,
  RIDGE_RISE,
  RIDGE_SPAN,
  ridgeAtPoint,
  ridgeBaseY,
  ridgePoints,
  segments,
  slicesFor,
} from "../src/ui/surfaceGeometry";
import { SECTIONS } from "../src/ui/tabs";

const BOX: Box = { x: 0, y: 0, w: 800, h: 400 };

describe("Lab — the incubation tab stays LAST", () => {
  it("Lab is the LAST section [OWNER, 2026-08-04]", () => {
    /* Tab order is the product's order of confidence: experiments enter at
     * the far edge and GRADUATE toward the front on trader feedback. A lab tab
     * that drifted forward without that feedback is the violation.
     *
     * 2026-08-07: 탭 스트립이 사이드바가 되면서 "맨 오른쪽"이 "맨 아래"가
     * 됐고, 이름도 연구실 → Lab 이 됐다 [OWNER]. 규칙은 그대로고 축만 돌았다.
     * 정의는 ui/tabs.ts 이므로 소스를 정규식으로 긁지 않고 배열을 직접 읽는다. */
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids[ids.length - 1]).toBe("lab");
  });
});

describe("커브 표면 — 투영이 데이터에 대해 거짓말하지 않는다", () => {
  it("마지막 능선은 반드시 as-of 다", () => {
    /* 솎기도 보간도 그리기 결정이지 데이터 결정이 아니다. 앞에서부터 세면
     * 상자 높이에 따라 마지막 능선이 조용히 과거가 되고, 그림은 멀쩡해
     * 보인다 — 이 리포가 §7 에서 가장 조심하는 종류의 낡음이다. */
    for (const total of [1, 2, 7, 100, 525, 2622]) {
      for (const h of [120, 400, 900]) {
        const sl = slicesFor(total, h);
        expect(sl.at(-1)!.at).toBe(total - 1);
        expect(sl[0].at).toBe(0);
        const ats = sl.map((s) => s.at);
        expect(ats).toEqual([...ats].sort((a, b) => a - b));
      }
    }
  });

  it("능선 개수는 데이터가 아니라 상자 높이가 정한다", () => {
    /* [OWNER, 2026-08-14 — "자연스럽게 사이사이에 보간하기"]. 픽셀당 한 장이
     * 목표다: 성기면 선 다발로 읽히고, 촘촘하면 이웃의 채움이 겹쳐 하나의
     * 지형이 된다. 열 수가 아니라 사다리 길이가 개수를 정한다. */
    for (const h of [200, 400, 800]) {
      for (const cols of [40, 525]) {
        const n = slicesFor(cols, h).length;
        expect((h * RIDGE_RISE) / n).toBeCloseTo(RIDGE_PITCH, 0);
      }
    }
    // 같은 데이터라도 상자가 크면 더 그린다 (= 사이를 보간한다)
    expect(slicesFor(40, 800).length).toBeGreaterThan(40);
  });

  it("사이를 보간해도 실측 열은 실측 그대로다", () => {
    const z = [
      [1, 2, 3],
      [10, 20, 30],
    ];
    expect(curveAtSlice(z, 1)).toEqual([2, 20]);
    expect(curveAtSlice(z, 0.5)).toEqual([1.5, 15]);
    expect(curveAtSlice(z, 2)).toEqual([3, 30]);
  });

  it("보간이 구멍을 메우지 않는다", () => {
    /* 한쪽이 결측인데 반대쪽 값으로 이으면 없는 값을 그리게 되고, 그 절벽이
     * 시장으로 읽힌다. 구멍은 보간 뒤에도 구멍이다. */
    const z = [[1, null, 3]];
    expect(curveAtSlice(z, 0.5)).toEqual([null]);
    expect(curveAtSlice(z, 1.5)).toEqual([null]);
    expect(curveAtSlice(z, 0)).toEqual([1]);
  });

  it("깊이가 시간과 같은 방향이다 — 최신이 맨 앞(0)", () => {
    expect(depthOf(9, 10)).toBe(0); // 마지막 열 = 최신 = 앞
    expect(depthOf(0, 10)).toBe(1); // 첫 열 = 최고령 = 뒤
    expect(depthOf(0, 1)).toBe(0); // 한 장뿐이면 깊이가 없다
    // 단조: 뒤로 갈수록 깊이가 는다
    const ds = [0, 1, 2, 3, 4].map((k) => depthOf(k, 5));
    expect(ds).toEqual([...ds].sort((a, b) => b - a));
  });

  it("사다리가 커브 모양을 납작하게 만들지 않는다", () => {
    /* RIDGE_SPAN 이 0.30 아래로 내려가면 한 장의 커브가 선이 된다 — 이 화면이
     * 존재하는 이유가 그때 사라진다. 반대로 사다리가 너무 작으면 최신 커브가
     * 벽이 되어 과거를 가린다(실측: RISE 0.55 에서 능선 67%가 완전히 가림). */
    expect(RIDGE_RISE).toBeGreaterThanOrEqual(0.6);
    expect(RIDGE_SPAN).toBeGreaterThanOrEqual(0.3);
    expect(RIDGE_RISE + RIDGE_SPAN).toBeCloseTo(1);
  });

  it("깊이의 역함수가 그린 자리를 되돌린다", () => {
    // 각 열의 바닥을 짚으면 그 열이 나와야 한다 — hover 가 짚은 날짜를
    // 화면에 적으므로, 이 역이 틀리면 화면이 다른 날짜를 적는다.
    const n = 40;
    for (const k of [0, 1, 13, 27, n - 1]) {
      const d = depthOf(k, n);
      const px = BOX.x + d * BOX.w * 0.22;
      const py = ridgeBaseY(BOX, d);
      expect(depthAtPoint(BOX, px, py)).toBeCloseTo(d, 5);
      expect(ridgeAtPoint(BOX, px, py, n)).toBe(k);
    }
  });

  it("구멍은 구멍으로 남는다 — 0 으로 채우지 않는다", () => {
    /* 0 으로 채우면 표면에 절벽이 생기고 그것이 시장으로 읽힌다. 이 리포
     * 계열의 되풀이되는 함정이다(현금채권 민평: "0 은 결측이다"). */
    const d = domainOf([[1, 2, 3]]);
    const pts = ridgePoints([1, null, 3], BOX, 0, d);
    expect(pts[1]).toBeNull();
    // 그리고 끊긴 자리를 가로지르는 선을 만들지 않는다
    expect(segments(pts)).toHaveLength(0);
    expect(segments(ridgePoints([1, 2, null, 3, 4], BOX, 0, d))).toHaveLength(2);
  });

  it("모든 능선이 같은 축을 쓴다", () => {
    /* 열마다 축을 다시 잡으면 2020년 0.77% 와 2023년 4.0% 가 같은 높이에
     * 그려져 10년치 레벨 이동이 사라진다 — 이 그림이 보여 주려는 것이다. */
    const d = domainOf([
      [1, 1, 1],
      [4, 4, 4],
    ]);
    // 같은 금리는 같은 열 안에서 같은 높이, 다른 열이면 사다리만큼만 다르다
    const y0 = rateY(BOX, 0, 2.5, d);
    const y1 = rateY(BOX, 1, 2.5, d);
    expect(y0 - y1).toBeCloseTo(BOX.h * RIDGE_RISE, 5);
  });

  it("도메인이 정책금리를 품는다", () => {
    // 안 품으면 기준금리 선이 상자 밖에 그려지거나 테두리에 눌려 "최저와
    // 같음" 으로 읽힌다 (CurveView 가 같은 이유로 같은 일을 한다).
    const d = domainOf([[3, 3.5]], [2.0]);
    expect(d.min).toBeLessThan(2.0);
  });
});

describe("커브 표면 — §16", () => {
  it("컴포넌트가 자기 값을 만들지 않는다", () => {
    const src = code("ui/YieldSurface.tsx");
    // 역전은 서버가 준 부호를 읽을 뿐이다: 브라우저에서 10Y − 2Y 를 빼면
    // 표의 스프레드 행과 표시 정밀도에서 어긋난다.
    expect(src).not.toMatch(/z\[\s*\d+\s*\]\s*\[[^\]]*\]\s*-\s*z\[/);
    expect(src).not.toMatch(/inversionBp\s*[-+*/]/);
  });

  it("표면이 회전을 약속하지 않는다면 단면 2D 를 갖는다", () => {
    /* Wilke 「Don't go 3D」가 3D 를 허용하는 조건은 회전 가능하거나 도는
     * 애니메이션이 있을 때다. 여기는 고정 각도이므로 그가 요구하는 보완 —
     * 정확한 값 읽기용 2D 뷰 — 이 반드시 있어야 한다. */
    const src = code("ui/YieldSurface.tsx");
    expect(src).toMatch(/CutPanel/);
  });
});
