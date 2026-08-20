'use client';

/* 동일테너 레인 (레인 B) — 섹터 × 만기 히트맵, 칸 = 스프레드의 **랭크 백분위**.
 *
 * 총수익 절대 금지 [OWNER] — 그 셀을 쓰면 최고 스프레드 섹터가 표를 통째로
 * 이긴다(rv1 실측: 풀 껍질 6장 중 5장이 캐피탈채 독점). 백분위는 "자기 이력
 * 대비 지금이 어디냐"라 섹터 사다리를 지운다.
 *
 * 틴트는 **중앙(50) 이탈의 다이버징**이다: 높음(=역사적으로 넓음, 싸다) 쪽이
 * `--sr-up` 계열, 낮음이 `--sr-down` 계열 — 방향색 관례(빨강=수치 상승)와
 * 싸우지 않는 배치이고, 채도가 이탈 크기를 진다(`theme/tint.ts` 하나로).
 *
 * 칸 클릭 → 이력 창 (2026-08-19 크리틱 — Score 히트맵과 겉이 같은데 이 표만
 * 클릭이 안 되는 불일치의 수리). 같은 섹터×테너의 크레딧 RV 항목이 있을 때만
 * 열리고, 없는 칸(만기 보유 제외 등)은 그냥 숫자다. Score 히트맵과 같은 이유로
 * `tabIndex=-1` — 키보드 경로는 랭킹 표 하나다.
 *
 * CDS `Table` 금지(셀당 32px) — 손 표.
 */

import { VStack } from '@coinbase/cds-web/layout';
import { Text, TextLegal } from '@coinbase/cds-web/typography';

import { tintFor } from '@/theme/tint';

import type { RvCreditItem, RvPayload, RvWindow } from './api';
import { bp1 } from './fmt';

export function TenorHeat({
  heat,
  window,
  items,
  onSelect,
}: {
  heat: RvPayload['heat'];
  window: RvWindow;
  /** 크레딧 RV 항목 — 칸 클릭이 여는 이력 창의 재료. 없는 칸은 클릭 없음. */
  items?: RvCreditItem[];
  onSelect?: (p: RvCreditItem) => void;
}) {
  const pctOf = (c: { pct52: number; pctAll: number }) =>
    window === '52w' ? c.pct52 : c.pctAll;
  const byKey = new Map((items ?? []).map((p) => [`${p.sector}|${p.tenor}`, p]));

  return (
    /* 행 stretch 는 한 번 넣었다 뺐다 [OWNER 2026-08-19 — "이전으로 돌려주고"]:
     * 카드를 채우려고 히트맵 행을 늘리면 밀도가 표마다 달라진다. 빈 높이는
     * 카드 배치(레이아웃)가 질 문제지 표의 행 높이가 질 문제가 아니다. */
    <VStack gap={0.75} width="100%">
      <div className="sr-rv-scroll">
        <table className="sr-rv-table">
          <thead>
            <tr>
              <th className="sr-rv-th sr-rv-left">섹터</th>
              {heat.tenors.map((t) => (
                <th key={t} className="sr-rv-th">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.sectors.map((s) => (
              <tr key={s.id}>
                {/* 앵커를 섹터 이름 아래 [트레이더 피드백 2026-08-20] — 이
                    히트맵 한 장에 국고 대비 행과 특은 대비 행이 섞인다. 열
                    머리 하나로는 못 적으므로 행마다 적는다. */}
                <td className="sr-rv-td sr-rv-left">
                  <span className="sr-rv-stack">
                    <span className="sr-rv-name">{s.label}</span>
                    <span className="sr-rv-sub">{s.baseLabel} 대비</span>
                  </span>
                </td>
                {s.cells.map((c, i) => {
                  const item = c ? byKey.get(`${s.id}|${c.tenor}`) : undefined;
                  return (
                    <td
                      key={heat.tenors[i]}
                      className={`sr-rv-td${item ? ' sr-rv-cell' : ''}`}
                      /* 다이버징 = 중앙 50 에서의 이탈이 크기다. */
                      style={c ? { background: tintFor(pctOf(c) - 50, 50) } : undefined}
                    >
                      {c && item && onSelect ? (
                        <button
                          type="button"
                          className="sr-rv-cellbtn"
                          tabIndex={-1}
                          title={`${s.label} ${c.tenor} — ${s.baseLabel} 대비 ${bp1(c.nowBp)}bp, 관측 ${c.obs}일`}
                          aria-label={`${s.label} ${c.tenor} 이력 단면 열기`}
                          onClick={() => onSelect(item)}
                        >
                          {pctOf(c).toFixed(0)}
                        </button>
                      ) : c ? (
                        <span title={`${s.label} ${c.tenor} — ${s.baseLabel} 대비 ${bp1(c.nowBp)}bp, 관측 ${c.obs}일`}>
                          {pctOf(c).toFixed(0)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VStack paddingX={2} paddingBottom={1.5}>
        <TextLegal as="span" color="fgMuted">
          숫자가 높을수록 지금 스프레드가 평소
          ({window === '52w' ? '52주' : '전체 이력'})보다 넓은 쪽이에요.
        </TextLegal>
        {/* 앵커가 두 벌이라는 사실 자체를 한 줄로 — 행마다 붙은 라벨이
            무엇인지 처음 보는 사람이 알아야 한다. */}
        <Text font="legal" as="span" color="fgMuted">
          은행·회사·카드·캐피탈은 산금채(특은) 대비로 재요. 같은 등급 안에서
          붙었는지 벌어졌는지가 보이도록요.
        </Text>
      </VStack>
    </VStack>
  );
}
