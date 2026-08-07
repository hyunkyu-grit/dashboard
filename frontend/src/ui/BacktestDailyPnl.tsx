"use client";

/* 백테스트의 일자별 손익 표 — 대사용 [트레이더 피드백 5, 2026-08-07].
 *
 * 창의 차트가 그리던 것과 **같은 배열**(`points`)을 숫자로 옮긴다. 차트는
 * 모양을 묻는 데 답하고 이 표는 "그날 얼마였나" 에 답한다 — 트레이딩 시스템과
 * 맞춰 볼 때 필요한 것은 후자다.
 *
 * 계산하지 않는다. `pnl`(누적)과 `d`(그날의 변화)는 둘 다 서버가 준 값이고,
 * 여기서 차분을 다시 뜨면 서버와 어긋날 수 있는 두 번째 정의가 생긴다 (§16).
 *
 * 최신이 위다. 대사는 보통 어제·오늘을 보는 일이라 맨 아래로 스크롤해야
 * 시작할 수 있으면 매번 그 스크롤을 해야 한다. */

import { fmtKrw } from "./BacktestWindow";

export interface BacktestPoint {
  t: string;
  pnl: number;
  /** 그날의 변화. **첫날은 null** 이다 — 전날이 없으므로 변화도 없다.
   * 0 으로 채우면 "안 움직였다" 는 없는 사실을 말하게 된다. */
  d: number | null;
}

export function BacktestDailyPnl({ points }: { points: BacktestPoint[] }) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-[13px] text-ink-2">아직 없어요</p>;
  }
  const rows = [...points].reverse();
  return (
    <table className="w-full text-[13px] tabular-nums">
      <thead>
        <tr className="text-ink-2">
          <th scope="col" className="py-1 text-left font-medium">
            날짜
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            누적 손익
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            그날 변화
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.t} className="border-t border-edge">
            <td className="py-1">{p.t}</td>
            <td className="py-1 text-right font-medium">{fmtKrw(p.pnl)}</td>
            {/* 방향색은 부호가 고정된 자리에서만 — 그날의 변화가 그렇다.
                누적은 부호가 있어도 "지금까지" 라 방향이 아니다. */}
            <td
              className={`py-1 text-right ${
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
