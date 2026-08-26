import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PolicyStep } from '../src/lib/api';
import { alignByDate, policyByDate, referenceMode } from '../src/chart/references';

/**
 * CD 91일 · 기준금리 기준선 — 틀려도 **그럴듯해 보이는** 것만 모아 못박는다.
 *
 * 이 세 가지는 전부 "차트는 멀쩡한데 숫자가 다른 날의 것" 이라는 한 가지 결과로
 * 끝난다. 그래서 눈으로는 잡을 수 없고 여기서 잡아야 한다.
 */

const axis = (...dates: string[]) => dates.map((t) => ({ t }));

describe('날짜로 맞춘다 — 위치로 맞추지 않는다', () => {
  it('축이 더 촘촘해도 그 날짜 이하의 마지막 값을 쓴다', () => {
    const a = axis('2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08');
    const cd = [
      { t: '2026-01-05', v: 2.9 },
      { t: '2026-01-07', v: 3.0 },
    ];
    // 06 은 CD 고시가 없는 날 — 05 값이 유효하다(다음 고시 전까지)
    expect(alignByDate(a, cd)).toEqual([2.9, 2.9, 3.0, 3.0]);
  });

  it('축이 솎아져 있어도(프리뷰) 같은 날짜끼리 붙는다', () => {
    // 이게 이 함수의 존재 이유다. 두 시리즈를 그냥 zip 하면 i 번째가 서로 다른 날.
    const sparse = axis('2026-01-05', '2026-01-09');
    const cd = [
      { t: '2026-01-05', v: 2.9 },
      { t: '2026-01-06', v: 2.95 },
      { t: '2026-01-07', v: 3.0 },
      { t: '2026-01-09', v: 3.1 },
    ];
    expect(alignByDate(sparse, cd)).toEqual([2.9, 3.1]);
  });

  it('시리즈가 시작되기 전은 null — 뒤에서 앞으로 끌어오지 않는다', () => {
    const a = axis('2026-01-01', '2026-01-05');
    expect(alignByDate(a, [{ t: '2026-01-05', v: 2.9 }])).toEqual([null, 2.9]);
  });
});

const POLICY: PolicyStep = {
  unit: '%',
  asof: '2026-01-10',
  through: '2026-01-08',
  steps: [
    { date: '2026-01-03', rate: 2.5 },
    { date: '2026-01-06', rate: 2.75 },
  ],
  latest: 2.75,
  warnings: [],
};

describe('기준금리 — 각지게, 그리고 `through` 를 넘지 않게', () => {
  const a = axis('2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09');

  it('그 날 시행 중이던 금리를 든다', () => {
    expect(policyByDate(a, POLICY)).toEqual([null, 2.5, 2.5, 2.75, 2.75, null]);
  });

  it('첫 결정 이전은 null — 그때 뭐였는지 이 페이로드는 모른다', () => {
    expect(policyByDate(a, POLICY)[0]).toBeNull();
  });

  /* ── v1 패리티 레인 P1-4 (2026-08-20) ────────────────────────────────────
   * v1 `policy-line` 가드가 지키던 명제 중 여기 없던 셋. 셋 다 "선은 그려지는데
   * 다른 날의 값" 으로 끝나서 눈으로는 못 잡는다. */

  it('결정은 그 날짜 **이후 첫 점**에 착지한다', () => {
    /* 결정일이 휴장이면 그 다음 거래일부터 보인다 — 없는 날에 점을 만들지 않고,
     * 그렇다고 하루 늦게 반영하지도 않는다. POLICY 의 01-06 결정은 축의 01-06 에
     * 바로 선다. 결정일이 축에 없는 경우도 함께 본다. */
    const holiday = axis('2026-01-02', '2026-01-05', '2026-01-07', '2026-01-08');
    // 01-03 결정은 축에 없다 → 01-05 부터, 01-06 결정도 축에 없다 → 01-07 부터
    expect(policyByDate(holiday, POLICY)).toEqual([null, 2.5, 2.75, 2.75]);
  });

  it('시리즈 시작 **전**의 결정이 여럿이면 마지막 것으로 접힌다', () => {
    /* 세 번의 결정이 축보다 앞서면 그 시점에 유효한 것은 마지막 하나뿐이다.
     * 첫 것을 들면 몇 달치가 통째로 틀리고, 화면은 멀쩡해 보인다. */
    const late = axis('2026-02-01', '2026-02-02');
    const many: PolicyStep = {
      ...POLICY,
      through: '2026-02-02',
      steps: [
        { date: '2025-10-01', rate: 3.5 },
        { date: '2025-12-01', rate: 3.0 },
        { date: '2026-01-06', rate: 2.75 },
      ],
    };
    expect(policyByDate(late, many)).toEqual([2.75, 2.75]);
  });

  it('연속 결정이 겹침도 구멍도 없이 축을 덮는다', () => {
    /* 결정 사이의 모든 점이 값을 가지고, 각 점의 값은 정확히 하나다.
     * 구멍이 하나 나면 선이 끊기고, 읽는 사람은 그 날 금리가 없었다고 읽는다. */
    const dense = axis(
      '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
    );
    const out = policyByDate(dense, POLICY);
    expect(out).toEqual([2.5, 2.5, 2.5, 2.75, 2.75, 2.75]);
    expect(out.some((v) => v == null)).toBe(false);
    // 계단은 한 번만 오른다 — 같은 결정이 두 번 반영되면 여기서 어긋난다.
    const rises = out.filter((v, i) => i > 0 && v !== out[i - 1]).length;
    expect(rises).toBe(1);
  });

  it('`through` 이후는 null — 백엔드가 보증을 끊은 자리다', () => {
    // 축 끝까지 늘이는 것이 바로 그 bound 가 막으려는 실패이고, 그렇게 그려도
    // 화면은 완벽하게 정상으로 보인다.
    expect(policyByDate(a, POLICY).at(-1)).toBeNull();
  });

  it('`through` 가 시리즈보다 앞서면 아무것도 안 그린다', () => {
    const early = { ...POLICY, through: '2025-12-31' };
    expect(policyByDate(a, early).every((v) => v === null)).toBe(true);
  });

  it('정책이 없으면 조용히 빈다 — 지어내지 않는다', () => {
    expect(policyByDate(a, undefined).every((v) => v === null)).toBe(true);
  });
});

describe('한 단위에 축 하나', () => {
  it('%-차트는 셋이 같은 축을 쓴다', () => {
    // 축을 둘로 나누면 3.4% 와 2.9% 가 같은 높이에 그려질 수 있다 — 비교가 아니라
    // 착시다. 같은 단위는 같은 스케일.
    expect(referenceMode('%')).toBe('shared');
  });

  it('축에 이름을 붙였으면 시리즈도 그 이름을 가리켜야 한다 — 안 그러면 선이 조용히 사라진다', () => {
    /* 실측 2026-08-14: x 축 설정에만 `id: 'date'` 를 주고 시리즈에 `xAxisId` 를
     * 안 달았더니 CDS 가 `xAxisId ?? DEFAULT_AXIS_ID` 로 스케일을 찾다 빗나갔고,
     * `Line` 이 `if (!xScale || !yScale || !path) return` 으로 **아무 말 없이**
     * 사라졌다. 축과 눈금은 멀쩡히 그려져서 "선만 없는 차트" 가 됐고 콘솔에는
     * 한 줄도 안 남았다. x 축은 하나뿐이므로 이름을 주지 않는 것이 규칙이다. */
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/PreviewPane.tsx'),
      'utf8',
    );
    const xAxisProp = /xAxis=\{\{([^}]*)\}\}/.exec(src)?.[1] ?? '';
    expect(xAxisProp, 'x 축 설정을 못 찾음').toContain('data:');
    expect(xAxisProp, 'x 축에 id 를 주려면 시리즈에 xAxisId 도 달아야 한다').not.toMatch(/\bid:/);

    // y 축은 반대로 **반드시** 이름이 있어야 한다(둘일 수 있으므로), 그리고
    // 시리즈가 그 이름을 쓴다.
    expect(src).toMatch(/yAxisId: MAIN_AXIS/);
    expect(src).toMatch(/axisId=\{MAIN_AXIS\}/);
    expect(src).toMatch(/axisId=\{PCT_AXIS\}/);
  });

  it('bp·ratio·가격 은 기준선이 **자기 %축**을 왼쪽에 단다 [OWNER 2026-08-14]', () => {
    // 한때 'none'(안 그림) 이었고 근거는 "CDS 에 보조축이 없다" 였는데 그게 틀렸다:
    // `LineChart` 의 yAxis 가 단수인 건 래퍼의 편의이고, `CartesianChart` 는
    // 배열을 받고 시리즈가 `yAxisId` 로 축을 고른다.
    expect(referenceMode('bp')).toBe('own');
    expect(referenceMode('ratio')).toBe('own');
    expect(referenceMode('가격')).toBe('own');
  });

  it('보조 축은 **왼쪽** [OWNER 2026-08-14]', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/PreviewPane.tsx'),
      'utf8',
    );
    // 종목 축은 오른쪽(레퍼런스의 자리), 기준선 축은 왼쪽.
    expect(src).toMatch(/axisId=\{MAIN_AXIS\}[\s\S]{0,80}position="right"/);
    expect(src).toMatch(/axisId=\{PCT_AXIS\}[\s\S]{0,80}position="left"/);
  });
});

describe('기준선은 같은 위계의 두 색이다 [OWNER 2026-08-18, 3차 확정]', () => {
  /* 판정의 역사, 다음 세션이 안 되풀이하도록:
   *   ① fgMuted 둘 다(0.7/0.45) → "너무 눈에 안 보이는데"
   *   ② v1 대사로 회색 vs 반투명-빨강 → 철회: 문제는 색이 아니라 **불평등**
   *      (조용한 회색 vs 시끄러운 빨강)이었다
   *   ③ 실측 리서치(오너의 인포맥스 터미널·Finviz·네이버 MA) 후 선택지 제시 →
   *      오너 선택 = **네이버 MA 방식: 제3의 두 색, 같은 굵기·같은 진하기**.
   * 같은 위계 = 같은 취급이지 같은 색이 아니다 — 그래서 이 가드가 지키는 것은
   * 색 값이 아니라 **취급의 같음**(굵기·불투명도·범례·칩 문법)이다. */
  const ROOT = path.resolve(import.meta.dirname, '..');
  const pane = fs.readFileSync(path.join(ROOT, 'src/ui/PreviewPane.tsx'), 'utf8');

  it('전용 토큰 두 개 — 방향색 계열이 아니다', () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'src/theme/direction.css'), 'utf8');
    const light = tokens.slice(0, tokens.indexOf("[data-sr-scheme='dark']"));
    const dark = tokens.slice(tokens.indexOf("[data-sr-scheme='dark']"));
    for (const block of [light, dark]) {
      const cd = /--sr-ref-cd:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
      const policy = /--sr-ref-policy:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
      expect(cd, '스킴마다 두 값이 있어야 한다').toBeTruthy();
      expect(policy).toBeTruthy();
      expect(cd).not.toBe(policy);
      // 방향색과 같은 값이면 상승/하락으로 읽힌다.
      const up = /--sr-up:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
      const down = /--sr-down:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
      expect([up, down]).not.toContain(cd);
      expect([up, down]).not.toContain(policy);
    }
  });

  it('두 시리즈가 각자의 토큰을 든다', () => {
    expect(pane).toMatch(/id: CD_LINE[^}]*color: 'var\(--sr-ref-cd\)'/);
    expect(pane).toMatch(/id: BASE_LINE[^}]*color: 'var\(--sr-ref-policy\)'/);
  });

  it('두 선이 같은 굵기·같은 불투명도로 그려진다', () => {
    /* 숫자 자체가 아니라 **같음**이 계약이다 — 한쪽만 조정하면 위계가 다시
     * 갈라지고, 그건 화면에서만 보인다. */
    const lines = [...pane.matchAll(/<Line\s+seriesId=\{(CD_LINE|BASE_LINE)\}[\s\S]*?\/>/g)];
    expect(lines).toHaveLength(2);
    const recipe = lines.map((m) => ({
      id: m[1],
      width: /strokeWidth=\{([\d.]+)\}/.exec(m[0])?.[1],
      opacity: /strokeOpacity=\{([\d.]+)\}/.exec(m[0])?.[1],
    }));
    expect(recipe[0].width, '굵기가 다르면 위계가 다르다').toBe(recipe[1].width);
    expect(recipe[0].opacity, '불투명도가 다르면 위계가 다르다').toBe(recipe[1].opacity);
    // 그리고 첫 판(0.45)의 흐림으로 돌아가지 않는다 — 원래 불만이 그것이었다.
    expect(Number(recipe[0].opacity)).toBeGreaterThanOrEqual(0.7);
  });

  it('선 끝 가격 칩은 없다 — 오너 지시로 내렸다', () => {
    /* lightweight-charts 의 price line 관용구로 잠깐 붙었다가 축 눈금·날짜와
     * 겹쳐서 내렸다 [OWNER 2026-08-18 — "굳이 선 끝에 가격 칩은 안 넣어줘도
     * 될듯"]. 이름은 색 범례가, 값은 리드아웃 카드가 진다. 되살리려면 겹침을
     * 먼저 풀 것. */
    expect(pane).not.toMatch(/<RefLineLabel/);
  });

  it('범례가 선의 색을 입고, 둘의 취급이 같다 — 점선 견본은 없다', () => {
    /* 범례는 차트의 견본이다(Finviz/네이버 문법). 색만 다르고 취급은 같아야
       한다 — 갈리면 ②의 불평등이 범례에서 돌아온다.

       2026-08-26 부터 이 범례 항목은 **누를 수 있다**(`RefChip`) [OWNER —
       "기준금리랑 CD금리도 MA처럼 껏다 켰다 가능하게"]. 재는 명제는 그대로다:
       각자 자기 선의 색을 입고, 둘이 같은 부품·같은 prop 으로 선다. */
    expect(pane).toMatch(/<RefChip\s+label="CD 91일"\s+color="var\(--sr-ref-cd\)"/);
    expect(pane).toMatch(/<RefChip\s+label="기준금리"\s+color="var\(--sr-ref-policy\)"/);
    const chips = [...pane.matchAll(/<RefChip\s+label="(?:CD 91일|기준금리)"/g)];
    expect(chips).toHaveLength(2);
    /* 불투명도는 이제 부품 안에 **한 번만** 적힌다 — 두 항목이 그것을 나눠 쓰므로
       갈릴 자리가 아예 없다(전에는 호출부마다 적어서 갈릴 수 있었다). */
    const comp = pane.slice(pane.indexOf('export function RefChip'));
    const ops = [...comp.slice(0, 900).matchAll(/opacity: on \? ([\d.]+) : ([\d.]+)/g)];
    expect(ops).toHaveLength(1);
    expect(pane).not.toMatch(/dashed/);
  });

  it('커브 표면의 기준금리도 같은 토큰이다', () => {
    // 같은 값이 화면마다 다른 취급을 받으면 안 된다. 3D 판은 캔버스라 var() 를
    // 직접 못 신고 `resolveColors` 가 --sr-ref-policy 를 실색으로 풀어 쓴다 —
    // 그 토큰 이름이 소스에 남아 있는지를 고정한다.
    const surface = fs.readFileSync(path.join(ROOT, 'src/ui/Surface3D.tsx'), 'utf8');
    expect(surface).toMatch(/--sr-ref-policy/);
    // 값은 표·리드아웃과 같은 포매터(fmtLevel)를 지난다 — toFixed 는 두 번째
    // 정의라 2026-08-19 정비에서 은퇴했다(ReadoutCard 의 규칙과 같음).
    expect(surface).toMatch(/colors\.policy[\s\S]{0,700}기준금리 \$\{fmtLevel\(policy\.latest, '%'\)\}/);
    expect(surface).not.toMatch(/\.toFixed\(/);
  });
});
