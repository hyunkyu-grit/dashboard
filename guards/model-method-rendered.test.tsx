// @vitest-environment jsdom
/* Method 면이 **화면에** 무엇을 세우나.
 *
 * 위의 `model-payload-rendered.test.ts` 는 「페이로드의 칸이 소스 어디엔가
 * 나오나」 만 본다. 그건 무른 잣대다 — 타입에만 적고 렌더는 안 해도 통과한다.
 * 여기서는 진짜로 그려서 글자가 나오는지 본다.
 *
 * ## 여기서 붙드는 것
 *
 *   1. 알려진 이음매 셋이 **이름과 설명을 둘 다** 낸다. 2026-08-24 까지
 *      `engine_status.json::known_seams` 가 계약에 타입까지 있는데 어느 면도
 *      렌더하지 않았다. 셋 중 둘은 트레이더가 당장 알아야 하는 것이다 —
 *      IRS 다리에 기간프리미엄이 안 오고 국고 3년은 기대가설 평균만이다.
 *   2. 9/13 을 **만드는 열세 칸**이 화면에 있다. 예전에는 큰 숫자로 9/13 을
 *      찍고 그 아래에 **다른** 열셋(논문 앵커)의 표를 놨다. 헤드라인의 근거를
 *      화면에서 셀 수 없었다.
 *   3. 빈티지가 «구속하는 분기» 를 말한다. 제일 새 분기(2026Q2)와 구속하는
 *      분기(2026Q1)가 갈리는데, 요약 문장은 디플레이터만 이름을 댄다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';

import { MethodSurface } from '../src/lab/model/method/MethodSurface';
import methodJson from '../src/lab/model/method/method_surface.json';
import statusJson from '../src/lab/model/artifacts/engine_status.json';
import anchorsJson from '../src/lab/model/artifacts/paper_anchors.json';

afterEach(cleanup);

/* eslint-disable @typescript-eslint/no-explicit-any */
const M = methodJson as any;
const ST = statusJson as any;
const PAPER = (anchorsJson as any).paper;

/* `ThemeProvider` 는 장식이 아니라 **필수**다. 차례의 `Pressable` 이 CDS
   `Interactable` 을 타고 `useTheme` 를 부르고, 프로바이더가 없으면 그 자리에서
   던진다 — 2026-08-24 에 골격을 카드 안으로 옮기면서 이 파일이 그렇게 여섯 개
   다 빨개졌다. */
function text(): string {
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <MethodSurface />
    </ThemeProvider>,
  );
  return container.textContent ?? '';
}

describe('Method 면이 실제로 그리는 것', () => {
  it('알려진 이음매 셋이 이름과 설명을 둘 다 낸다', () => {
    const t = text();
    expect(ST.known_seams.length).toBeGreaterThan(0);
    for (const s of ST.known_seams) {
      expect(t, s.flag).toContain(s.flag);
      /* 설명은 문장이라 통째로 비교하면 공백 하나에 깨진다. 앞머리로 본다. */
      expect(t, s.flag).toContain(s.what.slice(0, 16));
    }
  });

  it('엔진의 출처와 시험 수를 말한다', () => {
    const t = text();
    expect(t).toContain(ST.engine.home);
    for (const c of ST.engine.source_commits) expect(t).toContain(c);
    if (ST.tests.collected !== null) expect(t).toContain(String(ST.tests.collected));
  });

  it('어느 논문인지 통째로 댄다 — 저자·연도·PDF 까지', () => {
    const t = text();
    for (const k of ['id', 'title', 'authors', 'published', 'pdf'] as const) {
      expect(t, k).toContain(PAPER[k]);
    }
  });

  it('빈티지가 구속하는 분기를 이름과 함께 낸다', () => {
    const t = text();
    for (const name of Object.keys(ST.data_edge.per_series)) expect(t).toContain(name);
    expect(t).toContain(ST.data_edge.binding_quarter);
    expect(t).toContain(ST.data_edge.newest_quarter);
  });

  it('9/13 을 만드는 열세 칸이 화면에 있다 — 헤드라인의 근거가 화면 밖이면 안 된다', () => {
    const t = text();
    const rows = M.scorecard.engine_rows;
    expect(rows.length).toBe(M.scorecard.engine_total);
    expect(rows.filter((r: any) => r.pass).length).toBe(M.scorecard.engine_passed);
    for (const r of rows) expect(t, r.metric).toContain(r.metric);
  });

  it('모양 칸은 밴드를 지어내지 않는다 — null 을 0 으로 채우면 정중앙처럼 보인다', () => {
    for (const r of M.scorecard.engine_rows) {
      if (String(r.metric).startsWith('shape:')) {
        expect(r.value, r.metric).toBeNull();
        expect(r.band, r.metric).toBeNull();
      }
    }
    expect(text()).toContain('모양만 봐요');
  });
});
