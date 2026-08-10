"use client";

/* 백테스트의 일자별 손익 표 — 대사용 [트레이더 피드백 5, 2026-08-07].
 *
 * 창의 차트가 그리던 것과 **같은 배열**(`points`)을 숫자로 옮긴다. 차트는
 * 모양을 묻는 데 답하고 이 표는 "그날 얼마였나" 에 답한다 — 트레이딩 시스템과
 * 맞춰 볼 때 필요한 것은 후자다.
 *
 * **누적 열은 없앴다** [OWNER, 2026-08-10 — "PnL와 KRD는 시스템과 대사가
 * 목적이므로 Cumulative가 아니라 매일매일을 적어주면 됨"]. `pnl`(누적)은
 * 여전히 서버가 주지만 표에서는 안 읽는다 — 대사는 그날그날 트레이딩
 * 시스템의 일별 기록과 맞춰 보는 일이고, 누적은 그 비교에 쓰이지 않는다.
 * `d`(그날의 변화)만 계산 없이 그대로 옮긴다 (§16).
 *
 * 최신이 위다. 대사는 보통 어제·오늘을 보는 일이라 맨 아래로 스크롤해야
 * 시작할 수 있으면 매번 그 스크롤을 해야 한다. */

import { fmtKrw } from "./krw";

export interface BacktestPoint {
  t: string;
  pnl: number;
  /** 그날의 변화. **첫날은 null** 이다 — 전날이 없으므로 변화도 없다.
   * 0 으로 채우면 "안 움직였다" 는 없는 사실을 말하게 된다. */
  d: number | null;
}

export function BacktestDailyPnl({ points }: { points: BacktestPoint[] }) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-[14px] text-ink-2">아직 없어요</p>;
  }
  const rows = [...points].reverse();
  return (
    <table className="w-full text-[14px] tabular-nums">
      <thead>
        <tr className="text-ink-2">
          <th scope="col" className="py-1 text-left font-medium">
            날짜
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            그날 손익
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.t} className="border-t border-edge">
            <td className="py-1">{p.t}</td>
            {/* 방향색은 부호가 고정된 자리에서만 — 그날의 변화가 그렇다. */}
            <td
              className={`py-1 text-right font-medium ${
                p.d === null
                  ? "text-ink-3"
                  : p.d > 0
                    ? "text-up"
                    : p.d < 0
                      ? "text-down"
                      : "text-ink-2"
              }`}
            >
              {/* 첫날은 em dash — 0원이 아니라 잴 것이 없다는 뜻이다 */}
              {p.d === null ? "—" : fmtKrw(p.d)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
