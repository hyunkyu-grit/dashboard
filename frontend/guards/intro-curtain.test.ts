/* Guard: 인트로 커튼 (DESIGN §14 「인트로」) [OWNER, 2026-08-13].
 *
 * 이 커튼은 제품에서 유일하게 **모달보다 위에 있고, 사용자가 닫을 수 없는**
 * 레이어다. 그래서 여기서 지킬 것은 「예쁘게 나오는가」가 아니라 「반드시
 * 사라지는가」이고, 이 파일이 세는 것도 그것이다. 세 갈래:
 *
 *  1. 실패해도 걷힌다. 백엔드가 죽었을 때 커튼이 버티면 안정화 세션이 고쳤던
 *     결함 — "실패가 대기처럼 보인다" — 이 화면 전체 크기로 돌아온다.
 *  2. 사라짐이 애니메이션 완료 보고에 매달리지 않는다. 이 리포에는 exit 완료가
 *     유실되어 창이 안 닫힌 전례가 둘 있다(ba2c1e0, a344fb2e). 같은 일이 여기서
 *     나면 앱 전체가 덮인 채로 잠긴다.
 *  3. 그림의 타임라인은 순수 함수다. 화면을 띄우지 않고 여기서 검사한다.
 *
 * 소스를 읽는 단언은 전부 _source 의 스트리퍼를 지난다 — 이 파일은 자기가
 * 금지하는 이름들(AnimatePresence 등)을 주석에 적고 있으므로, 안 그러면 자기
 * 설명에 자기가 걸린다.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import {
  bloomAt,
  BLOOM_DRAW_MS,
  BLOOM_END_MS,
  BLOOM_STAGGER_MS,
  brightAt,
  DOMAIN,
  easeOut,
  INTRO_CURVES,
  INTRO_MAX_MS,
  INTRO_MIN_MS,
  INTRO_TENORS,
  MORPH_HOLD_MS,
  MORPH_TRAVEL_MS,
  NEWEST,
  polyline,
  revealed,
} from "../src/ui/introCurves";

const curtain = code("ui/IntroCurtain.tsx");
const app = code("ui/App.tsx");
const layers = code("ui/layers.ts");

describe("커튼은 실패에도 걷힌다", () => {
  it("ready 는 성공 OR 실패다 — 성공만이 아니다", () => {
    expect(app).toMatch(/<IntroCurtain ready=\{!!summary \|\| isError\} \/>/);
  });

  it("커튼 뒤에는 실패 화면이 이미 그려져 있다", () => {
    // 걷히는 순간 보여 줄 것이 있어야 한다. 이 두 줄이 사라지면 커튼이 걷힌
    // 자리에 빈 화면이 남는다 (failure-visible.test.ts 와 같은 쌍을 본다).
    expect(app).toMatch(/!summary && isError[\s\S]{0,240}<ErrorState/);
    expect(app).toMatch(/!summary && !isError[\s\S]{0,80}<LoadingState/);
  });
});

describe("커튼은 데이터가 오지 않아도 나간다", () => {
  /* 실측으로 찾은 것이라 여기 남긴다. 백엔드가 닿지 않는 빌드에서 `isError`
   * 는 **82초** 뒤에 떴다(react-query 6회 재시도). 커튼은 그때 정확히 걷혔지만
   * 그 82초 동안 화면 전체가 덮여 있었다. 커튼이 없을 때는 셸과 사이드바가
   * 살아 있었으므로, 상한이 없으면 이 인트로는 실패를 **더 나쁘게** 만든다. */

  it("걷는 타이머가 ready 안에 갇혀 있지 않다", () => {
    // `if (!ready ...) return;` 이면 ready 가 안 오는 날 앱이 잠긴다
    expect(curtain).toMatch(/if \(phase !== "up"\) return;/);
    expect(curtain).not.toMatch(/if \(!ready \|\| phase !== "up"\) return;/);
  });

  it("ready 가 아직이면 상한에서 걷는다", () => {
    expect(curtain).toMatch(/Math\.max\(0, INTRO_MAX_MS - elapsed\)/);
  });

  it("상한은 최소 노출보다 뒤이고, 무한정 뒤는 아니다", () => {
    expect(INTRO_MAX_MS).toBeGreaterThan(INTRO_MIN_MS);
    expect(INTRO_MAX_MS).toBeLessThanOrEqual(6000);
  });
});

describe("사라짐은 타이머가 결정한다", () => {
  it("AnimatePresence 도, exit 완료 콜백도 쓰지 않는다", () => {
    expect(curtain).not.toContain("AnimatePresence");
    expect(curtain).not.toContain("onExitComplete");
    expect(curtain).not.toContain("onAnimationComplete");
    // motion/react 를 아예 들이지 않는다 — 들이는 순간 위의 셋이 한 줄 거리가
    // 되고, 이 커튼에서 그 셋은 앱 전체가 잠기는 경로다
    expect(curtain).not.toContain('from "motion/react"');
  });

  it("gone 으로 가는 것은 setTimeout 이고, gone 이면 언마운트한다", () => {
    expect(curtain).toMatch(/setTimeout\(\(\) => setPhase\("gone"\)/);
    expect(curtain).toMatch(/if \(phase === "gone"\) return null;/);
  });

  it("걷히기 시작하면 클릭이 즉시 통과한다", () => {
    // 페이드가 어떤 이유로 안 끝나도 앱은 쓸 수 있어야 한다 — 두 번째 겹
    expect(curtain).toMatch(/lifting \? "pointer-events-none" : ""/);
  });

  it("페이드는 §14 의 EXIT 를 쓴다", () => {
    expect(curtain).toMatch(/transitionDuration: `\$\{MOTION\.exit\}s`/);
    expect(curtain).toContain("var(--bw-ease-out)");
  });
});

describe("reduced motion 은 움직임만 뺀다", () => {
  it("커튼이 선호를 직접 읽는다", () => {
    // motion/react 를 안 쓰므로 MotionConfig 가 닿지 않는다. CSS 페이드는
    // globals.css 담요가 덮고, canvas 루프는 이 호출이 덮는다.
    expect(curtain).toContain("prefersReducedMotion()");
  });

  it("움직이지 않을 때도 그림은 그린다", () => {
    // 선호는 "애니메이션을 빼 달라" 이지 "빈 화면을 달라" 가 아니다
    expect(curtain).toMatch(/draw\(BLOOM_END_MS\)/);
  });
});

describe("최소 노출은 그림보다 길고, 무한정 길어지지 않는다", () => {
  it("부채가 다 펴진 뒤에 걷힌다", () => {
    // 이보다 짧으면 그리다 만 그림에서 커튼이 걷힌다
    expect(INTRO_MIN_MS).toBeGreaterThanOrEqual(BLOOM_END_MS);
  });

  it("2초를 넘기지 않는다", () => {
    // 매일 쓰는 도구다. 이 숫자가 커지는 것은 늘 나중 세션의 유혹이라
    // 천장을 코드에 박아 둔다
    expect(INTRO_MIN_MS).toBeLessThanOrEqual(2000);
  });
});

describe("커튼은 모달보다 위다", () => {
  const z = (name: string) =>
    Number(new RegExp(`${name} = "z-\\[?(\\d+)\\]?"`).exec(layers)![1]);

  it("Z_CURTAIN > Z_MODAL > Z_WINDOW", () => {
    expect(z("Z_CURTAIN")).toBeGreaterThan(z("Z_MODAL"));
    expect(z("Z_MODAL")).toBeGreaterThan(z("Z_WINDOW"));
  });

  it("커튼은 layers.ts 에서 층을 고른다 — 손으로 적은 z 가 아니다", () => {
    expect(curtain).toContain("Z_CURTAIN");
    expect(curtain).not.toMatch(/className=.*\bz-\[?\d/);
  });
});

describe("색은 테마 브릿지를 지난다", () => {
  it("canvas 색을 브릿지에서 풀어 온다", () => {
    for (const fn of ["resolveInk", "resolveLine", "withAlpha", "onThemeChange"]) {
      expect(curtain).toContain(fn);
    }
  });

  it("색 문자열을 직접 적지 않는다", () => {
    // no-raw-hex 는 hex 만 본다. canvas 는 rgb() 문자열도 그대로 먹으므로
    // 그 구멍을 여기서 막는다 (§9 의 규칙은 "색은 토큰에서만")
    expect(curtain).not.toMatch(/rgba?\(\s*\d/);
  });
});

describe("이징은 제품의 그 곡선이다", () => {
  it("끝점은 0 과 1", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });

  it("범위 밖은 잘린다", () => {
    expect(easeOut(-3)).toBe(0);
    expect(easeOut(9)).toBe(1);
  });

  it("단조 증가한다", () => {
    for (let i = 1; i <= 40; i++) {
      expect(easeOut(i / 40)).toBeGreaterThanOrEqual(easeOut((i - 1) / 40));
    }
  });

  it("감속한다 — 앞에서 앞서고 뒤에서 눕는다", () => {
    // EASE_OUT 을 고른 이유 그 자체 (motion-tokens.test.ts 와 같은 성질)
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
    expect(easeOut(0.9)).toBeGreaterThan(0.9);
  });
});

describe("피어남", () => {
  it("첫 커브는 0ms 에 시작하고, 뒤 커브는 차례로 늦다", () => {
    expect(bloomAt(0, 0)).toBe(0);
    for (let i = 1; i < INTRO_CURVES.length; i++) {
      expect(bloomAt(i * BLOOM_STAGGER_MS - 1, i)).toBe(0);
      expect(bloomAt(i * BLOOM_STAGGER_MS + 1, i)).toBeGreaterThan(0);
    }
  });

  it("마지막 커브가 다 그려지는 시각이 BLOOM_END_MS 다", () => {
    const last = INTRO_CURVES.length - 1;
    expect(bloomAt(BLOOM_END_MS - 1, last)).toBeLessThan(1);
    expect(bloomAt(BLOOM_END_MS, last)).toBe(1);
    expect(BLOOM_END_MS).toBe(last * BLOOM_STAGGER_MS + BLOOM_DRAW_MS);
  });
});

describe("잘라 그리기", () => {
  const pts = polyline(INTRO_CURVES[0].rates, { x: 0, y: 0, w: 120, h: 60 });

  it("0 이면 아무것도, 1 이면 전부", () => {
    expect(revealed(pts, 0)).toEqual([]);
    expect(revealed(pts, 1)).toEqual(pts);
  });

  it("절반이면 가로로 절반까지 온다", () => {
    const half = revealed(pts, 0.5);
    expect(half[half.length - 1].x).toBeCloseTo(60, 6);
  });

  it("잘린 끝점은 그 구간 위에 있다 — 마디로 튀지 않는다", () => {
    const f = 0.4;
    const cut = revealed(pts, f);
    const tip = cut[cut.length - 1];
    const segments = pts.length - 1;
    const whole = Math.floor(f * segments);
    const a = pts[whole];
    const b = pts[whole + 1];
    const t = (tip.x - a.x) / (b.x - a.x);
    expect(tip.y).toBeCloseTo(a.y + (b.y - a.y) * t, 6);
  });

  it("점은 상자 안에 있다", () => {
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(120);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(60);
    }
  });

  it("아홉 장이 같은 축을 쓴다 — 레벨 이동이 보여야 한다", () => {
    // 장마다 축을 다시 잡으면 2020년 0.77% 와 2023년 4.0% 가 같은 높이가 된다
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const lows = polyline(INTRO_CURVES[3].rates, box);
    const highs = polyline(INTRO_CURVES[5].rates, box);
    expect(lows[0].y).toBeGreaterThan(highs[0].y + 50);
  });
});

describe("밝은 선은 오늘에서 출발해 과거로 걷는다", () => {
  it("피어나는 동안에는 가장 최근 커브다", () => {
    const s = brightAt(0);
    expect(s.rates).toEqual(INTRO_CURVES[NEWEST].rates);
    expect(s.label).toBe(INTRO_CURVES[NEWEST].label);
    expect(s.reveal).toBeLessThan(1);
  });

  it("다 피면 통째로 그려진다", () => {
    expect(brightAt(BLOOM_END_MS).reveal).toBe(1);
  });

  it("첫 이동의 도착지는 바로 앞 장이다", () => {
    const settled = BLOOM_END_MS + MORPH_HOLD_MS;
    const arrived = brightAt(settled + MORPH_TRAVEL_MS);
    expect(arrived.label).toBe(INTRO_CURVES[NEWEST - 1].label);
    for (let i = 0; i < INTRO_TENORS.length; i++) {
      expect(arrived.rates[i]).toBeCloseTo(INTRO_CURVES[NEWEST - 1].rates[i], 6);
    }
  });

  it("한 바퀴 돌면 제자리로 온다", () => {
    const cycle = MORPH_TRAVEL_MS + MORPH_HOLD_MS;
    const settled = BLOOM_END_MS + MORPH_HOLD_MS;
    const round = brightAt(settled + INTRO_CURVES.length * cycle);
    for (let i = 0; i < INTRO_TENORS.length; i++) {
      expect(round.rates[i]).toBeCloseTo(INTRO_CURVES[NEWEST].rates[i], 6);
    }
  });

  it("언제 물어도 축 안에 있고 NaN 이 아니다", () => {
    for (let t = 0; t < 40000; t += 37) {
      const s = brightAt(t);
      expect(s.rates).toHaveLength(INTRO_TENORS.length);
      for (const r of s.rates) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(DOMAIN.min);
        expect(r).toBeLessThanOrEqual(DOMAIN.max);
      }
      expect(s.label).toMatch(/^\d{4}년 \d{1,2}월$/);
    }
  });
});

describe("박아 넣은 커브는 실측치다", () => {
  it("장마다 13개 테너 — 시트의 그 열들", () => {
    expect(INTRO_TENORS).toHaveLength(13);
    for (const c of INTRO_CURVES) {
      expect(c.rates, c.iso).toHaveLength(INTRO_TENORS.length);
    }
  });

  it("원화 금리로 말이 되는 범위 안에 있다", () => {
    // dataset.py 의 정신 나감 검사와 같은 종류 — 소수점 밀림을 잡는다
    for (const c of INTRO_CURVES) {
      for (const r of c.rates) {
        expect(r, c.iso).toBeGreaterThan(0);
        expect(r, c.iso).toBeLessThan(10);
      }
    }
  });

  it("날짜는 오름차순이다 — 되감기가 진짜 되감기이려면", () => {
    for (let i = 1; i < INTRO_CURVES.length; i++) {
      expect(INTRO_CURVES[i].iso > INTRO_CURVES[i - 1].iso, INTRO_CURVES[i].iso).toBe(
        true,
      );
    }
  });

  it("라벨은 timeAxis 의 월 표기와 같은 형식이고, iso 와 어긋나지 않는다", () => {
    for (const c of INTRO_CURVES) {
      expect(c.label).toMatch(/^\d{4}년 \d{1,2}월$/);
      const [y, m] = c.iso.split("-").map(Number);
      expect(c.label).toBe(`${y}년 ${m}월`);
    }
  });

  it("모양이 서로 다르다 — 겹쳐 놓을 이유가 있어야 한다", () => {
    // 10s6m 기울기의 부호가 양쪽 다 나와야 한다 (스티프닝과 역전)
    const slopes = INTRO_CURVES.map((c) => c.rates[12] - c.rates[0]);
    expect(slopes.some((s) => s > 0.2)).toBe(true);
    expect(slopes.some((s) => s < -0.2)).toBe(true);
  });
});
