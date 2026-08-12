/* 차트 종류 — 선 · 주봉 · 월봉 [OWNER, 2026-08-13 "모드 설정하면 원하면
 * 캔들차트로 보여줄 수 있게"].
 *
 * **전역 하나다.** 예전에는 크게 보기 팝업만 캔들을 알았고 그 선택은 `?type=`
 * 로 URL 에 살았다. 이제는 읽는 사람의 **환경설정**이다 — 툴바에서 한 번 고르면
 * 화면의 모든 시계열 차트가 같은 종류로 그려지고, 새로고침해도 남는다. 환경설정은
 * URL 에 들어갈 것이 아니므로(링크 하나가 남의 화면 설정을 바꾼다) 상태는
 * `state/ui.ts` 의 스토어가 지고, `?type=` 은 **읽기만** 한다 — 예전 링크가
 * 여전히 그 종류로 열리도록.
 *
 * **일봉은 없다. 만들 수 없다.** 소스가 종가뿐(`mkt_irs_close`)이라 하루 봉의
 * 시가가 종가와 같아진다 — 몸통 없는 봉 2,600개는 차트가 아니다. 주/월봉은
 * 종가들을 서버에서 묶어 만든다(`derive.py::ohlc_buckets`, §G/§16).
 *
 * 이 모듈이 따로 있는 이유: 종류의 정의가 `wall/DetailChart` 에 있었는데 그건
 * lightweight-charts 를 끌고 오는 파일이다. 스토어와 툴바가 팝업 전용 청크의
 * 타입에 기대게 두면 의존 방향이 거꾸로다. 여기에는 값 하나 없고 타입과 라벨뿐.
 */

import type { Interval } from "@/lib/api";

/** 선, 또는 서버에서 묶은 주/월봉. */
export type ChartType = "line" | Interval;

/** 토글이 그리는 것 — 이 배열이 순서이자 라벨이다. 두 컨트롤(툴바·팝업)이
 * 같은 배열을 읽으므로 한쪽만 항목이 늘어날 수 없다. */
export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "line", label: "선" },
  { id: "w", label: "주봉" },
  { id: "m", label: "월봉" },
];

export const CHART_TYPE_KEY = "bw-chart-type";

/** 저장된 값·URL 파라미터를 믿기 전에 통과시키는 문. 모르는 값은 선으로. */
export function asChartType(v: string | null | undefined): ChartType | null {
  return v === "line" || v === "w" || v === "m" ? v : null;
}

/** 캔들인가 — 호출부에서 `t !== "line"` 을 반복하지 않도록. */
export const isCandleType = (t: ChartType): t is Interval => t !== "line";
