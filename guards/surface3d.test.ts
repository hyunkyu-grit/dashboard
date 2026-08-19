import { describe, expect, it } from 'vitest';

import { pchipSample, pchipSlopes, pchipAt } from '@/chart/pchip';
import {
  clampPitch,
  clampYaw,
  domainOf,
  fitTransform,
  nearestNode,
  PRESETS,
  project,
  projectFast,
  projectedBounds,
  sampleGrid,
  sampleRidges,
  smoothRidges,
  tenorAxis,
  toScreen,
  YAW_DEFAULT,
  YAW_MAX,
  YAW_MIN,
} from '@/chart/surfaceProjection';

/**
 * 3D 커브 표면의 순수 기하 — 화면 없이 잡는 거짓말 자리들.
 *
 * 전작 가드의 교훈이 둘 반영돼 있다:
 *   1. **역산 검사는 내부 지점으로.** 전작은 능선의 왼쪽 모서리(테너·금리
 *      오프셋 0인 유일한 무오염 지점)만 왕복시켜서, 화면의 ~70%가 최고령으로
 *      포화하는 결함을 놓쳤다(2026-08-18 실측). hover 는 이제 최근접 탐색이라
 *      포화 자체가 없어졌지만, 검사는 여전히 내부 지점으로 한다.
 *   2. **PCHIP 의 존재 이유는 무오버슈트다.** natural cubic 은 실제 커브에서
 *      최대 6.95bp 를 지어냈다(전 이력 실측). 그 성질이 회귀하면 이 표면의
 *      매끄러움이 거짓 주장이 된다 — 무작위 데이터로 속성 검사한다.
 */

// 결정적 의사난수 — 실행마다 다른 데이터로 붉었다 푸르렀다 하는 가드는 가드가 아니다.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('PCHIP — 노드를 지나고, 지어내지 않는다', () => {
  const xs = [1, 1.5, 2, 3, 5, 7, 10];

  it('모든 노드를 정확히 지난다', () => {
    const ys = [3.4, 3.5, 3.63, 3.79, 4.04, 4.18, 4.31];
    const got = pchipSample(xs, ys, xs);
    ys.forEach((y, i) => expect(got[i]).toBeCloseTo(y, 10));
  });

  it('어떤 데이터에서도 구간 [min,max] 를 벗어나지 않는다 — 무오버슈트', () => {
    const rnd = lcg(20260818);
    for (let trial = 0; trial < 200; trial++) {
      const ys = xs.map(() => 1 + rnd() * 4);
      const m = pchipSlopes(xs, ys);
      for (let i = 0; i < xs.length - 1; i++) {
        const lo = Math.min(ys[i], ys[i + 1]) - 1e-9;
        const hi = Math.max(ys[i], ys[i + 1]) + 1e-9;
        for (let k = 0; k <= 50; k++) {
          const q = xs[i] + ((xs[i + 1] - xs[i]) * k) / 50;
          const v = pchipAt(xs, ys, m, q);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('단조 데이터에서 단조를 보존한다', () => {
    const ys = [1, 1.2, 1.3, 1.9, 2.4, 2.5, 3.1];
    const qs = sampleGrid(1, 10, 200);
    const got = pchipSample(xs, ys, qs) as number[];
    for (let i = 1; i < got.length; i++) {
      expect(got[i]).toBeGreaterThanOrEqual(got[i - 1] - 1e-9);
    }
  });

  it('노드 범위 밖은 null — 외삽하지 않는다', () => {
    const got = pchipSample([2, 3, 5], [1, 2, 3], [1, 2, 4, 5, 6]);
    expect(got[0]).toBeNull();
    expect(got[4]).toBeNull();
    expect(got[1]).toBeCloseTo(1);
    expect(got[3]).toBeCloseTo(3);
  });

  it('노드 둘이면 직선이다', () => {
    const got = pchipSample([1, 3], [2, 4], [1, 2, 3]) as number[];
    expect(got[1]).toBeCloseTo(3);
  });
});

describe('투영 — 관례와 정렬', () => {
  it('요 0°에서 최신(z01=1)이 화면 아래(가까이)·과거가 위다', () => {
    const newest = project(0.5, 0, 1, 0);
    const oldest = project(0.5, 0, 0, 0);
    expect(newest.depth).toBeGreaterThan(oldest.depth);
    expect(newest.sy).toBeGreaterThan(oldest.sy); // 화면 y 는 아래로 증가
  });

  it('금리가 높을수록 화면에서 위다', () => {
    const lo = project(0.5, 0, 0.5, YAW_DEFAULT);
    const hi = project(0.5, 1, 0.5, YAW_DEFAULT);
    expect(hi.sy).toBeLessThan(lo.sy);
  });

  it('요 0°에서 만기가 길수록 오른쪽이다 — 그리고 측면에선 시간이 그 자리를 잇는다', () => {
    const short = project(0, 0, 0.5, 0);
    const long = project(1, 0, 0.5, 0);
    expect(long.sx).toBeGreaterThan(short.sx);
    const old90 = project(0.5, 0, 0, 90);
    const new90 = project(0.5, 0, 1, 90);
    expect(new90.sx).toBeGreaterThan(old90.sx);
  });

  it('projectFast(cos,sin) ≡ project(yaw) — 셰이더가 이 식을 직역하므로 여기가 어긋나면 주석 층이 표면에서 뜬다', () => {
    const c = Math.cos((YAW_DEFAULT * Math.PI) / 180);
    const s = Math.sin((YAW_DEFAULT * Math.PI) / 180);
    for (const [x, y, z] of [[0, 0, 0], [1, 1, 1], [0.3, 0.7, 0.2], [0.9, 0.1, 0.8]]) {
      const slow = project(x, y, z, YAW_DEFAULT);
      const fast = projectFast(x, y, z, c, s);
      expect(fast.sx).toBeCloseTo(slow.sx, 12);
      expect(fast.sy).toBeCloseTo(slow.sy, 12);
      expect(fast.depth).toBeCloseTo(slow.depth, 12);
    }
  });

  it('현재 요 기준 맞춤 — 그 요에서 상자를 채우고, 벗어나지 않는다', () => {
    // 전 범위 합집합 맞춤은 정면(0°)을 대각 폭의 1/3 로 쪼그라뜨렸다(실측).
    // 요마다 자기 사각으로 맞추고, 여덟 꼭짓점이 상자 안 + 어느 축 하나는
    // 패딩 경계에 닿는지(= 헛돌지 않고 실제로 채우는지)를 본다.
    const box = { w: 900, h: 560 };
    const pad = 24;
    for (const yaw of [YAW_MIN, 0, YAW_DEFAULT, 90, YAW_MAX]) {
      const fit = fitTransform(box, pad, projectedBounds(yaw, yaw));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const x of [0, 1]) {
        for (const y of [0, 1]) {
          for (const z of [0, 1]) {
            const p = toScreen(project(x, y, z, yaw), fit);
            expect(p.x).toBeGreaterThanOrEqual(pad - 0.5);
            expect(p.x).toBeLessThanOrEqual(box.w - pad + 0.5);
            expect(p.y).toBeGreaterThanOrEqual(pad - 0.5);
            expect(p.y).toBeLessThanOrEqual(box.h - pad + 0.5);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
      const fillsW = maxX - minX >= box.w - pad * 2 - 1;
      const fillsH = maxY - minY >= box.h - pad * 2 - 1;
      expect(fillsW || fillsH).toBe(true);
    }
  });

  it('요·피치는 잠긴 범위 안 — 뒤로 돌아 거울상을 볼 수 없다', () => {
    expect(clampYaw(-999)).toBe(YAW_MIN);
    expect(clampYaw(999)).toBe(YAW_MAX);
    expect(clampPitch(-5)).toBeGreaterThan(0);
    expect(clampPitch(999)).toBe(90);
    for (const p of PRESETS) {
      expect(clampYaw(p.yaw)).toBe(p.yaw);
      expect(clampPitch(p.pitch)).toBe(p.pitch);
    }
  });

  it('세 정거장 [OWNER 2026-08-18] — 위에서(평면도)·오늘 커브(정면)·시계열(측면)', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toEqual(['top', 'front', 'side']);
    const top = PRESETS[0];
    expect(top.pitch).toBe(90);
    // 평면도: **시간이 가로(하단 축)** [OWNER — "시계열이 하단으로"] — 최신이
    // 오른쪽, 만기는 세로(단기가 아래).
    const newest = project(0.5, 0, 1, top.yaw, top.pitch);
    const oldest = project(0.5, 0, 0, top.yaw, top.pitch);
    expect(newest.sx).toBeGreaterThan(oldest.sx);
    const shortT = project(0, 0, 0.5, top.yaw, top.pitch);
    const longT = project(1, 0, 0.5, top.yaw, top.pitch);
    expect(shortT.sy).toBeGreaterThan(longT.sy);
    // 시계열(측면): 시간이 가로로 눕는다 — 최신이 오른쪽.
    const side = PRESETS[2];
    const o90 = project(0.5, 0, 0, side.yaw, side.pitch);
    const n90 = project(0.5, 0, 1, side.yaw, side.pitch);
    expect(n90.sx).toBeGreaterThan(o90.sx);
  });
});

describe('표본화 — 구멍은 구멍으로', () => {
  it('노드가 빠진 날은 그 자리가 비고, 이웃 런은 산다', () => {
    // 테너 5개 × 능선 1장, 가운데(2Y)가 구멍.
    const years = [1, 1.5, 2, 3, 5];
    const z: (number | null)[][] = [[3.0], [3.1], [null], [3.3], [3.5]];
    const qs = sampleGrid(1, 5, 41);
    const rows = sampleRidges(years, z, qs);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // 2Y 자리(q=2)는 null — 구멍 너머로 잇지 않는다.
    const at2 = row[qs.findIndex((q) => Math.abs(q - 2) < 1e-9)];
    expect(at2).toBeNull();
    // 1~1.5 런과 3~5 런은 산다.
    expect(row[0]).toBeCloseTo(3.0);
    expect(row[qs.length - 1]).toBeCloseTo(3.5);
  });

  it('도메인은 풀 하나에 하나 — 기준금리도 넣으면 넓힌다', () => {
    const d = domainOf([[1, 2], [3, 4]], [0.5]);
    expect(d.min).toBeLessThan(0.5);
    expect(d.max).toBeGreaterThan(4);
  });
});

describe('그리기 전용 시간축 평활', () => {
  it('마지막 능선(as-of)은 손대지 않고, 구멍은 구멍으로 남는다', () => {
    // [테너][능선] 이 아니라 [능선][표본] — sampleRidges 의 출력 모양이다.
    const rows: (number | null)[][] = [
      [3.0, null],
      [3.4, 2.0],
      [3.0, 2.4],
    ];
    const got = smoothRidges(rows);
    // as-of(마지막 행)는 원값 — 오늘 커브에 어제가 섞이면 안 된다.
    expect(got[2]).toEqual([3.0, 2.4]);
    // 구멍 이웃은 가중 재정규화로 빠지고, 구멍 자신은 구멍이다.
    expect(got[0][1]).toBeNull();
    // 이항 5탭 [1,4,6,4,1]/16 (2026-08-19, 3탭에서 확대) — 행 3개면 창의
    // 바깥 두 탭이 빠져 [4,6,4]/14 로 재정규화된다.
    expect(got[1][0]).toBeCloseTo((3.0 * 4 + 3.4 * 6 + 3.0 * 4) / 14);
    // 평활값은 창 안 [min,max] — 볼록 결합이라 새 극값을 지어내지 않는다.
    expect(got[1][0]).toBeGreaterThanOrEqual(3.0);
    expect(got[1][0]).toBeLessThanOrEqual(3.4);
  });
});

describe('기준테너 등간격 축 [OWNER 2026-08-19]', () => {
  it('노드는 등간격·사이는 단조·왕복이 맞고, 1~1.5Y 와 5~10Y 가 같은 폭이다', () => {
    const years = [1, 1.5, 2, 3, 5, 10];
    const { toAxis, toYears } = tenorAxis(years);
    years.forEach((y, i) => expect(toAxis(y)).toBeCloseTo(i / 5, 10));
    let prev = -1;
    for (let y = 1; y <= 10; y += 0.1) {
      const a = toAxis(y);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    for (const a of [0, 0.13, 0.5, 0.77, 1]) {
      expect(toAxis(toYears(a))).toBeCloseTo(a, 10);
    }
    // 실연수 비례였다면 0.5년 vs 5년 — 등간격 축이라 같은 화면 폭이다.
    expect(toAxis(1.5) - toAxis(1)).toBeCloseTo(toAxis(10) - toAxis(5), 10);
    // 범위 밖은 클램프.
    expect(toAxis(0.5)).toBe(0);
    expect(toAxis(20)).toBe(1);
  });
});

describe('hover — 최근접 노드', () => {
  it('내부 지점에서 정확히 그 노드를 집는다 (전작 포화의 회귀 방지)', () => {
    // 실제와 같은 밀도의 노드 구름: 능선 300 × 테너 7 을 투영해 화면 좌표로.
    const fit = fitTransform({ w: 900, h: 560 }, 24);
    const nodes: { x: number; y: number; ridge: number; tenor: number }[] = [];
    for (let r = 0; r < 300; r++) {
      for (let t = 0; t < 7; t++) {
        const p = toScreen(
          project(t / 6, 0.4 + 0.2 * Math.sin(r / 40 + t), r / 299, YAW_DEFAULT),
          fit,
        );
        nodes.push({ x: p.x, y: p.y, ridge: r, tenor: t });
      }
    }
    // 화면 여기저기의 노드를 그대로 조준하면 그 노드가 나와야 한다.
    for (const probe of [nodes[0], nodes[1500], nodes[2099], nodes[1043]]) {
      const got = nearestNode(nodes, probe.x, probe.y, 14);
      expect(got).not.toBeNull();
      expect(got!.ridge).toBe(probe.ridge);
      expect(got!.tenor).toBe(probe.tenor);
    }
  });

  it('아무 노드에서도 멀면 null — 억지로 잡지 않는다', () => {
    expect(nearestNode([{ x: 0, y: 0, ridge: 0, tenor: 0 }], 500, 500, 14)).toBeNull();
  });
});
