import { render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { Table, TableBody } from '@coinbase/cds-web/tables';
import { describe, expect, it } from 'vitest';

import { RECON_COLS, ReconDay } from '@/mr/StrategyWindow';
import type { MrStrategyPoint } from '@/mr/api';

/* 대사표의 **격자가 실제로 맞나** — 타입이 못 잡는 자리다.
 *
 * 2026-09-03 에 하루가 한 줄에서 «다리마다 세 줄 + 종합» 으로 바뀌었다. 머리와
 * 몸통이 각자 셀을 세는 구조라, 한쪽에 셀을 하나 더 두거나 조건부 열(CD)을
 * 한쪽에만 넣으면 **tsc 는 통과하고 표만 어긋난다.** 어긋난 대사표는 대사표가
 * 아니라 숫자 더미이므로, 여기서 그려서 센다.
 *
 * 값 자체가 닫히는지는 `backend/tests/test_mr_legrecon.py` 가 라우트를 타고
 * 잰다 — 이 파일은 «격자» 만 본다. */

const BASE: MrStrategyPoint = {
  t: '2026-09-01', v: 63.3, z: -2.15, ma: 70, up: 80, lo: 60,
  cum: 1_234_567, mtm: -250_000, carry: 12_000, cost: 0, pnl: -238_000,
  pos: -1, hold: -1, dv: 0.25, tradePnl: 1_234_567, out: 0, outRun: 0,
};

const TWO_LEGS = [
  { k: '국고', lvl: 3.878, dv: 0.5, krd: 1_000_000, mtm: -500_000, carry: 14_000 },
  { k: 'IRS', lvl: 3.245, dv: 0.25, krd: -1_000_000, mtm: 250_000, carry: -2_000 },
];

function draw(p: MrStrategyPoint) {
  /* ThemeProvider 는 장식이 아니라 **필수**다 — 롤 표식이 CDS `Popover` 를
     쓰고, 그 안의 `useTheme` 이 없으면 던진다(실측 2026-09-03). */
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <Table accessibilityLabel="probe">
        <TableBody>
          <ReconDay p={p} word="보유" />
        </TableBody>
      </Table>
    </ThemeProvider>,
  );
  return [...container.querySelectorAll('tr')];
}

describe('대사표의 하루 — 격자가 맞나', () => {
  it('다리 둘이면 일곱 줄이다 — 다리마다 셋에 종합 하나', () => {
    const rows = draw({ ...BASE, legs: TWO_LEGS });
    expect(rows).toHaveLength(7);
    const labels = rows.map((r) => r.children[1]?.textContent?.trim());
    expect(labels).toEqual([
      '국고 KRD', '국고 Δbp', '국고 손익',
      'IRS KRD', 'IRS Δbp', 'IRS 손익',
      '종합 · 보유',
    ]);
  });

  it('다리 하나면 세 줄이다 — 백테스트와 같은 모양', () => {
    const legs = [{ k: '선물', lvl: 2.9, dv: -3.2, krd: -1_000_000, mtm: -3_200_000, carry: 0 }];
    const rows = draw({ ...BASE, legs });
    expect(rows).toHaveLength(3);
    /* 종합 줄이 없으므로 **그날의 사건이 손익 줄에 붙는다** — 없으면 선물
       두 계열의 대사표에서 「언제 들어가고 나왔나」가 사라진다(2026-09-03 감사). */
    expect(rows.map((r) => r.children[1]?.textContent?.trim()))
      .toEqual(['선물 KRD', '선물 Δbp', '선물 손익 · 보유']);
  });

  it('구 백엔드(다리 없음)는 종합 한 줄로 접힌다', () => {
    const rows = draw(BASE);
    expect(rows).toHaveLength(1);
    expect(rows[0].children[1]?.textContent?.trim()).toBe('보유');
    /* 「값」 칸은 **비어 있다** — 다리 줄이 없으면 그 수가 무엇인지 말해 줄
       이름표가 없고, 옛 「감도」는 부호가 새 KRD 규약과 반대다(2026-09-03 감사). */
    expect(rows[0].children[2]?.textContent?.trim()).toBe('—');
  });

  it('줄마다 칸 수가 머리와 같다', () => {
    /* 레벨·z·CD 는 2026-09-03 에 「일별 레벨」 칸으로 나갔다 — 대사는 돈의
       표만 남는다 [OWNER — "레벨이랑 Z값은 일별대사 말고 일별레벨 칸을 하나
       파서"]. 머리와 몸통이 갈리면 tsc 는 통과하고 표만 어긋난다. */
    const want = 2 + RECON_COLS.length;                       // 날짜·구분 + 숫자 열
    for (const rows of [draw({ ...BASE, legs: TWO_LEGS }), draw(BASE)]) {
      for (const r of rows) {
        expect(r.children.length, String(r.children[1]?.textContent)).toBe(want);
      }
    }
  });

  it('날짜는 블록의 첫 줄에만 적힌다', () => {
    const rows = draw({ ...BASE, legs: TWO_LEGS });
    expect(rows[0].children[0]?.textContent).toContain('2026-09-01');
    for (const r of rows.slice(1)) expect(r.children[0]?.textContent?.trim()).toBe('');
  });

  it('롤일은 **다리도 같이** 0 으로 선다 — 한쪽만 살리면 그 줄이 안 닫힌다', () => {
    const legs = TWO_LEGS.map((g) => ({ ...g, dv: 0, mtm: 0 }));
    const rows = draw({ ...BASE, roll: true, dv: 0, legs });
    for (const nth of [1, 4]) {                       // 두 다리의 Δbp 줄
      expect(rows[nth].children[1]?.textContent).toContain('Δbp');
      expect(rows[nth].children[2]?.textContent).toContain('0.00');
    }
  });
});
