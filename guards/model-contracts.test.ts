/* Lab 「모형」 계약 — 세션 2·3 이 동시에 코딩하는 대상의 모양을 붙든다.
 *
 * ## 왜 가드가 필요한가
 *
 * 두 세션이 **동시에** 돈다. 둘 다 `assumptions.json` · `engine_status.json` ·
 * `paper_anchors.json` 을 읽어서 화면을 그린다. 그 모양이 흔들리면 두 세션이
 * 같이 깨지고, 병합 시점에야 보인다.
 *
 * ## 사본이 갈리는 자리
 *
 * 엔진은 `backend/output/` 에 쓰고 프런트는 `src/lab/model/artifacts/` 를
 * 번들한다(Next 가 런타임에 백엔드 경로를 못 읽는다 — `src/lab/scenario/
 * basis.json` 이 이미 같은 이유로 사본이다). 사본이 둘이면 갈린다. 리베이크가
 * 같이 옮기고, **이 가드가 동일성을 붙든다.**
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND_OUT = path.join(ROOT, 'backend', 'output');
const BACKEND_CONFIG = path.join(ROOT, 'backend', 'config');
const FRONT = path.join(ROOT, 'src', 'lab', 'model', 'artifacts');

const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

/** 엔진 산출물 → 프런트 사본. 왼쪽이 정본이다. */
const MIRRORED: [string, string][] = [
  [path.join(BACKEND_OUT, 'scenario_basis.json'), 'scenario_basis.json'],
  [path.join(BACKEND_OUT, 'assumptions.json'), 'assumptions.json'],
  [path.join(BACKEND_OUT, 'engine_status.json'), 'engine_status.json'],
  [path.join(BACKEND_CONFIG, 'paper_anchors.json'), 'paper_anchors.json'],
];

describe('사본은 정본과 바이트가 같다', () => {
  it.each(MIRRORED)('%s', (source, name) => {
    const mirror = path.join(FRONT, name);
    expect(fs.existsSync(mirror), `${name} 사본이 없어요 — 리베이크를 돌리세요`).toBe(true);
    expect(
      fs.readFileSync(mirror, 'utf-8'),
      `${name} 이 갈렸어요 — \`python -m rebake\` 로 다시 옮기세요`,
    ).toBe(fs.readFileSync(source, 'utf-8'));
  });
});

describe('assumptions.json', () => {
  const asm = read(path.join(FRONT, 'assumptions.json'));

  it('출처 없는 칸이 없다 — 빈칸으로 렌더하느니 빌드를 세운다', () => {
    for (const it_ of asm.items) {
      expect(String(it_.source ?? '').trim(), it_.key).not.toBe('');
      expect(String(it_.effect_note ?? '').trim(), it_.key).not.toBe('');
    }
  });

  /* 이 가드의 하중이 여기 있다.
   *
   * 「미 정책금리 3.75%」 를 「r* 2.0%」 옆에 아무 표시 없이 세우면, 트레이더는
   * 둘 다 화면의 bp 를 만든 값이라고 읽는다. 실측(2026-08-21)으로는 **둘 다
   * 아니다** — r* 를 1.5·2.5 로 바꿔 기저를 다시 풀어도 10년 IRS 반응이
   * 0.000000bp 달라지고(편차 공간에서 가법 상수는 소거된다), 미 정책금리·유가는
   * 기저가 **단위 충격**으로 담아서 현재 수준이 아예 안 들어간다. */
  it('모든 가정이 델타에 영향을 주는지 아닌지를 말한다', () => {
    const ok = new Set(['delta', 'level_only', 'not_in_basis']);
    for (const it_ of asm.items) expect(ok.has(it_.effect), it_.key).toBe(true);
  });

  it('r*·π* 는 level_only 다 — 실측 0.000000bp', () => {
    const by = Object.fromEntries(asm.items.map((i: { key: string }) => [i.key, i]));
    expect(by.r_star.effect).toBe('level_only');
    expect(by.pi_star.effect).toBe('level_only');
  });

  it('충격 가정은 기저에 들어갔다고 주장하지 않는다', () => {
    const by = Object.fromEntries(asm.items.map((i: { key: string }) => [i.key, i]));
    for (const k of ['us_policy', 'oil', 'foreign_growth']) {
      expect(by[k].effect, k).toBe('not_in_basis');
    }
  });

  it('못 받은 값은 0 이 아니라 null 이다', () => {
    for (const it_ of asm.items) {
      if (!it_.fetched && it_.value !== null) {
        // 상수(r*·π*)는 안 받아 오지만 값이 있다. 그건 정상이다.
        expect(it_.effect, `${it_.key} 는 안 받아 왔는데 값이 있어요`).toBe('level_only');
      }
    }
  });
});

describe('engine_status.json', () => {
  const st = read(path.join(FRONT, 'engine_status.json'));

  /* 이관 전 기저는 `as_of` 하나만 들고 있었다. 화면이 그걸 「기준일」이라고
   * 부르면 5개월 낡은 입력(투자·건설 디플레이터 2026Q1)이 하루 전 것처럼
   * 보인다. 두 날짜가 따로 서야 한다. */
  it('구운 날과 데이터 끝을 따로 싣는다', () => {
    expect(st.basis_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.data_edge.newest_quarter).toBeTruthy();
    expect(st.data_edge.binding_quarter <= st.data_edge.newest_quarter).toBe(true);
  });

  it('as-of 문장을 엔진이 준다 — 화면이 다시 쓰지 않는다', () => {
    expect(st.as_of_sentence).toContain('분기 모형');
    expect(st.as_of_sentence).toContain(st.data_edge.newest_quarter);
  });

  it('신선도 판정을 엔진이 한다', () => {
    expect(['fresh', 'stale', 'blocked']).toContain(st.staleness.state);
    expect(String(st.staleness.why).trim()).not.toBe('');
  });

  /* 예전 `engine_status.json` 은 12/13 을 싣고 있었다. 그건 Table 8 값의 순열을
   * 그 밴드에 맞춰 고른 과적합이라 기준선이 아니고, 실제로는 9/13 이다. */
  it('스코어카드는 9/13 이고 실패 넷의 이름을 댄다', () => {
    expect(st.scorecard.passed).toBe(9);
    expect(st.scorecard.total).toBe(13);
    expect(st.scorecard.misses).toHaveLength(4);
    expect(st.scorecard.note).toContain('순열');
  });

  it('없는 달력을 지어내지 않는다', () => {
    expect(Array.isArray(st.next_event.missing_calendars)).toBe(true);
    if (st.next_event.missing_calendars.length > 0) {
      expect(st.next_event.note).toContain('없어서');
    }
  });
});

describe('paper_anchors.json', () => {
  const doc = read(path.join(FRONT, 'paper_anchors.json'));

  it('앵커마다 쪽 인용이 붙어 있다', () => {
    for (const sh of doc.shocks) {
      expect(sh.page, sh.id).toMatch(/pp?\./);
      expect(sh.anchors.length, sh.id).toBeGreaterThan(0);
    }
  });

  /* 논문 Figure 18~20 은 인쇄 해상도에서 디지타이즈가 안 된다. 그림에서 눈으로
   * 읽은 값을 기준선으로 쓰면 «논문이 이렇게 말했다» 가 되는데 그건 우리가 픽셀을
   * 센 것이다. 그래서 본문이 문장으로 적은 값만 싣는다. */
  it('왜 본문 값만 쓰는지 화면이 말할 수 있다', () => {
    expect(doc.why_text_only).toContain('디지타이즈');
  });

  it('스코어카드의 실패가 실재하는 앵커를 가리킨다', () => {
    const ids = new Set(doc.shocks.flatMap((s: { anchors: { id: string }[] }) => s.anchors.map((a) => a.id)));
    for (const m of doc.scorecard.misses) expect(ids.has(m.anchor_id), m.anchor_id).toBe(true);
    for (const m of doc.scorecard.measured_but_not_scored) expect(ids.has(m.anchor_id)).toBe(true);
  });

  it('두 스코어카드가 같은 숫자를 말한다', () => {
    const st = read(path.join(FRONT, 'engine_status.json'));
    expect(st.scorecard.passed).toBe(doc.scorecard.passed);
    expect(st.scorecard.total).toBe(doc.scorecard.total);
  });
});

describe('배선 그래프 픽스처', () => {
  const fx = read(path.join(ROOT, 'src', 'lab', 'model', 'fixtures', 'wiring_graph.fixture.json'));

  it('픽스처라고 스스로 밝힌다', () => {
    expect(fx._fixture).toContain('PLACEHOLDER');
  });

  /* 생성기가 못 잡은 자리를 **비어 있는 척하지 않는다.** 시제품 실측에서 노드
   * 23·엣지 51 이 나왔는데 `KOREA_VARS` 는 31개다 — 8개가 세 패턴(상태벡터,
   * 변수 키 루프, 중간 지역변수)에 걸려 빠진다. 그 사실이 데이터에 남아야
   * 화면이 «이 그래프는 완결이 아니에요» 라고 말할 수 있다. */
  it('못 잡은 노드를 이름과 이유로 남긴다', () => {
    expect(fx.uncovered.length).toBeGreaterThan(0);
    for (const u of fx.uncovered) {
      expect(u.var).toBeTruthy();
      expect(String(u.why).trim()).not.toBe('');
    }
  });

  it('같은 쌍에 장기·단기 엣지가 따로 설 수 있다', () => {
    const pairs = fx.edges.map((e: { from: string; to: string; horizon: string }) => `${e.from}->${e.to}:${e.horizon}`);
    expect(pairs).toContain('debt->c:LR');
    expect(pairs).toContain('debt->c:SR');
    const lr = fx.edges.find((e: { from: string; to: string; horizon: string }) => e.from === 'debt' && e.to === 'c' && e.horizon === 'LR');
    const sr = fx.edges.find((e: { from: string; to: string; horizon: string }) => e.from === 'debt' && e.to === 'c' && e.horizon === 'SR');
    expect(lr.sign).not.toBe(sr.sign);
  });

  it('엣지마다 방정식 번호가 붙어 있다', () => {
    for (const e of fx.edges) expect(String(e.equation).trim()).not.toBe('');
  });
});
