'use client';

/* 크레딧 RV Score 히트맵 (레인 C 2구역) — 합성층의 지도 [트레이더 피드백].
 *
 * 레인 B(스프레드 백분위)와 **딴 표다**: 그쪽은 오너 확정(수준의 deviation),
 * 이쪽은 합성 Score(Coverage × 상대 RV 랭크 백분위 50:50) — 원칙 ①(독립 먼저,
 * 합성 다음)의 배치 그대로 합성이 뒤에 선다. 명구도 같은 이유로 의무다:
 * **"투자판단이 아니라 RV 랭킹이에요"**.
 *
 * 틴트는 레인 B 와 같은 다이버징 소스 — `tintFor(score − 50, 50)`, 중앙(50)
 * 이탈이 크기다. Score 없는 칸(σ 미확정)은 — 로 빈다.
 *
 * 칸은 랭킹 표와 같은 목적지(이력 창)의 **포인터 지름길**이다 — 실제 <button>
 * 이되 `tabIndex=-1`: 키보드 경로는 랭킹 표의 종목 버튼 하나로 둔다(같은 항목
 * 74개가 표·히트맵·산점에 세 번 서는 화면이라, 셋 다 탭 정지면 226회가 된다 —
 * 2026-08-19 크리틱의 실측). `<td role="button">` 은 표 의미론을 부수므로 안
 * 쓴다(행↔열머리 연결이 죽는다).
 *
 * CDS `Table` 금지(셀당 32px) — 손 표.
 */

import { VStack } from '@coinbase/cds-web/layout';
import { TextLegal } from '@coinbase/cds-web/typography';

import { tintFor } from '@/theme/tint';

import type { RvCreditItem } from './api';
import { bp1 } from './fmt';

export function ScoreHeat({
  items,
  onSelect,
}: {
  items: RvCreditItem[];
  onSelect: (p: RvCreditItem) => void;
}) {
  /* 격자는 항목에서 유도한다 — 서버가 실은 종목·테너만, 재계산 없이(§16). */
  const tenors = [...new Set(items.map((p) => p.tenor))].sort(
    (a, b) =>
      (items.find((p) => p.tenor === a)?.years ?? 0) -
      (items.find((p) => p.tenor === b)?.years ?? 0),
  );
  const sectors = [...new Set(items.map((p) => p.sector))];
  const byKey = new Map(items.map((p) => [`${p.sector}|${p.tenor}`, p]));

  return (
    <VStack gap={0.75} width="100%">
      <div className="sr-rv-scroll">
        <table className="sr-rv-table">
          <thead>
            <tr>
              <th className="sr-rv-th sr-rv-left">섹터</th>
              {tenors.map((t) => (
                <th key={t} className="sr-rv-th">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => {
              const label = items.find((p) => p.sector === s)?.sectorLabel ?? s;
              return (
                <tr key={s}>
                  <td className="sr-rv-td sr-rv-left">{label}</td>
                  {tenors.map((t) => {
                    const p = byKey.get(`${s}|${t}`);
                    if (!p) return <td key={t} className="sr-rv-td">—</td>;
                    return (
                      <td
                        key={t}
                        className="sr-rv-td sr-rv-cell"
                        /* 다이버징 = 중앙 50 에서의 이탈이 크기다. */
                        style={p.score != null ? { background: tintFor(p.score - 50, 50) } : undefined}
                      >
                        <button
                          type="button"
                          className="sr-rv-cellbtn"
                          tabIndex={-1}
                          title={`${p.sectorLabel} ${p.tenor} — 버퍼 ${bp1(p.bufferBp)}bp, 상대 RV ${
                            p.relRv != null ? p.relRv.toFixed(2) : '—'
                          }σ`}
                          aria-label={`${p.sectorLabel} ${p.tenor} 이력 단면 열기`}
                          onClick={() => onSelect(p)}
                        >
                          {p.score != null ? p.score.toFixed(0) : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <VStack paddingX={2} paddingBottom={1.5}>
        <TextLegal as="span" color="fgMuted">
          투자판단이 아니라 RV 랭킹이에요 — 100에 가까울수록 평소보다 벌어져 있고
          버틸 힘도 있다는 뜻이에요.
        </TextLegal>
      </VStack>
    </VStack>
  );
}
