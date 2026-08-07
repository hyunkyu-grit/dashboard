/* Guard: 유리 위의 글자 [2026-08-07].
 *
 * 툴바와 사이드바가 Liquid Glass 로 바뀌면서 새로 생긴 종류의 실패다. 유리는
 * **반투명**이라 그 위의 대비가 유리 자신의 색이 아니라 **뒤에 무엇이 있느냐**로
 * 결정된다. 다른 색 가드들은 전부 불투명한 면(page/tile/popover)을 배경으로
 * 재므로 이 자리를 하나도 보지 못한다.
 *
 * 뒤에 오는 것은 `--bw-tile` 이다. 셸의 루트가 `bg-tile` 이고, 툴바와 사이드바는
 * 그 위에 절대 배치로 떠 있다. 실제로는 스크롤된 콘텐츠가 지나가기도 하지만,
 * 콘텐츠는 무엇이든 될 수 있으므로 **바탕면을 기준으로 잰다** — 유리 뒤로 더
 * 어두운 것이 지나가면 라이트에서 대비는 올라가고, 더 밝은 것이 지나가면
 * 내려간다. 즉 이 값은 라이트의 하한이 아니라 기준선이다. 그래서 여기서
 * 4.5 를 아슬아슬하게 넘기는 것으로는 부족하고, 실제로 얼마인지 적어 둔다.
 *
 * blur 은 계산에 넣지 않는다. 흐림은 뒤에 있는 것들을 **평균**낼 뿐 유리 자신의
 * 알파를 바꾸지 않고, 평균의 결과가 바탕면일 때가 이 계산이다.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";
import {
  GRAPHIC_FLOOR,
  TEXT_FLOOR,
  TIERS,
  contrast,
  over,
  parse,
  resolve,
} from "./_tokens";

/** 유리 한 겹을 바탕면 위에 합성한 결과. */
function glassOn(scope: string, glass: string): [number, number, number, number] {
  return over(parse(resolve(scope, glass)), parse(resolve(scope, "--bw-tile")));
}

describe("유리 위의 글자는 뒤의 면까지 합쳐서 재야 한다", () => {
  for (const [name, scope] of TIERS) {
    const bar = () => glassOn(scope, "--bw-glass-bar");
    const side = () => glassOn(scope, "--bw-glass-side");

    it(`${name}: 툴바의 제목과 사이드바의 항목이 읽힌다`, () => {
      const ink = resolve(scope, "--bw-ink");
      expect(contrast(ink, bar())).toBeGreaterThanOrEqual(TEXT_FLOOR);
      expect(contrast(ink, side())).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });

    it(`${name}: 선택된 사이드바 항목의 라벨이 액센트 채움 위에서 읽힌다`, () => {
      /* 채움은 불투명하므로 유리와 무관하다. 여기 있는 이유는 **흰 라벨이
         2.31:1** 이고 그 실수가 이 파일이 지키는 것과 같은 종류이기 때문이다 —
         무엇 위에 있는지 보지 않고 색을 고르는 것. */
      expect(
        contrast(resolve(scope, "--bw-on-accent"), resolve(scope, "--bw-accent")),
      ).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });

    it(`${name}: 사이드바 글리프는 마크 바닥을 넘는다`, () => {
      // 다리 점(ui/Sidebar.tsx Legs)은 글자가 아니라 마크라 3:1 이다.
      expect(
        contrast(resolve(scope, "--bw-accent-fg"), side()),
      ).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    });

    it(`${name}: 채움 주황은 사이드바 위에서 마크로 쓸 수 없다`, () => {
      /* 이것은 **금지의 증명**이다. 채움 주황을 글리프나 가는 선에 쓰면 안
         된다는 규칙(guards/palette.test.ts)이 유리 위에서도 유효한지 — 라이트에서
         2.23:1 이라 3:1 을 못 넘는다. 다크에서는 넘으므로 라이트만 주장한다. */
      if (name.startsWith("light")) {
        expect(
          contrast(resolve(scope, "--bw-accent"), side()),
        ).toBeLessThan(GRAPHIC_FLOOR);
      }
    });
  }
});

describe("사이드바가 이차 잉크를 라벨로 쓰지 않는다", () => {
  /* 사이드바 항목의 라벨. 킷도 목업도 이차 잉크(50%)를 여러 자리에 쓰는데,
   * 유리 사이드바 위에서 그 값이 **라이트 3.07:1** 이다 [측정 2026-08-07].
   * 이 제품이 라벨에 두는 바닥은 4.5 다.
   *
   * 측정 [2026-08-07, 바탕면 기준]: ink-1 은 light 14.62 · dark 19.04.
   *
   * 값이 아니라 **어느 토큰이 라벨 자리에 오느냐** 를 잡는다. */
  for (const [name, scope] of TIERS) {
    const side = () =>
      over(
        parse(resolve(scope, "--bw-glass-side")),
        parse(resolve(scope, "--bw-tile")),
      );

    it(`${name}: 라벨에 쓰는 잉크가 본문 바닥을 넘는다`, () => {
      expect(contrast(resolve(scope, "--bw-ink"), side())).toBeGreaterThanOrEqual(
        TEXT_FLOOR,
      );
    });

    it(`${name}: ink-2 는 라벨 자리에 못 온다 — 라이트에서 바닥 미달`, () => {
      if (!name.startsWith("light")) return;
      expect(contrast(resolve(scope, "--bw-ink-2"), side())).toBeLessThan(TEXT_FLOOR);
    });
  }

  it("사이드바가 라벨에 ink-2 를 쓰지 않는다", () => {
    /* 토큰의 성질만으로는 부족하다 — 컴포넌트가 무엇을 쓰는지는 소스에서 봐야
     * 한다. Tailwind 는 소스 텍스트를 읽으므로 클래스가 글자 그대로 있다.
     *
     * `text-ink-2` 는 딱 한 곳 허용된다: 디스클로저 삼각형. 그건 글자가 아니라
     * 마크라 3:1 만 넘으면 되고, 잉크 50%는 유리 위에서 3.07:1 이다.
     *
     * 앞 판은 `const GROUP_HEADER` 하나만 검사했는데 헤더가 둘이라 두 번째가
     * 옛 클래스를 그대로 들고 통과했다. 이제 파일 전체에서 개수를 센다. */
    const sidebar = code("ui/Sidebar.tsx");
    const hits = [...sidebar.matchAll(/text-ink-2/g)];
    expect(hits.length, "ink-2 는 디스클로저 글리프 한 곳만").toBeLessThanOrEqual(1);
    expect(sidebar).toContain("text-on-accent");
    expect(sidebar).toContain("text-ink hover:bg-ink-5");
  });
});
