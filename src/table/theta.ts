/* 세타 열의 글자 — 라벨, 헤더 설명, 셀 툴팁.
 *
 * 숫자는 전부 백엔드가 낸다(`backend/app/theta.py`, §16). 이 파일이 하는 일은
 * 그 숫자를 한국어로 말하는 것뿐이고, **반올림을 하나도 소유하지 않는다** —
 * 돈은 `lib/krw.ts`, bp 는 `lib/format.ts::fmtDelta` 를 지나간다. 이 규칙이
 * `cells.ts` 의 "포매터는 하나" 와 같은 규칙이고, 같은 이유로 있다.
 *
 * v1 `ui/RangeCells.tsx` 의 세타 부분을 옮긴 것이다. v2 는 표 셀을
 * `InstrumentTable` 이 직접 그리므로 컴포넌트는 안 오고 글자만 왔다.
 */

import { fmtDelta } from "@/lib/format";
import { fmtKrw, fmtKrwFromMan, manUnits } from "@/lib/krw";

import type { Row } from "./rows";

/** 3개월 세타, DV01 백만원당 [OWNER, 2026-08-13].
 *
 * 라벨이 **정규화 단위를 지고 있어야** 숫자가 읽힌다. "세타" 만 쓰면 현금으로
 * 읽히는데 이건 리스크 한 단위당 현금이고, 열이 존재하는 이유가 바로 그 둘이
 * 테너 순위를 반대로 매기기 때문이다 — 100억 기준으로는 10Y 가 제일 크고,
 * 리스크당으로는 1Y 가 6배 크다. 호라이즌과 부호 방향은 라벨에 안 들어가고
 * `THETA_TITLE` 이 진다. */
export const THETA_LABEL = "세타/DV01백만";

/** 헤더 툴팁 — 라벨에 자리가 없던 사실들. 문체는 해요체, 한 문장 한 사실.
 *
 * 방향 문장이 핵심이다. "페이 기준" 은 아웃라이트에서만 참이고 버터플라이에서는
 * 뜻이 없다. 셋을 관통하는 건 제품이 이미 쓰는 **방향 +1**(= 호가값을 롱)이고,
 * 그게 아웃라이트에서 페이 · 스프레드에서 스티프너 · 플라이에서 벨리 페이다.
 * 셋을 이름으로 부르는 데 한 절이 더 들지만 어느 탭에서도 읽히고, "+1 방향" 은
 * 정확하되 안 읽힌다. */
export const THETA_TITLE =
  "커브가 그대로일 때 하루 손익이에요 (캐리 + 롤다운). " +
  "아웃라이트는 페이, 스프레드는 스티프너, 플라이는 벨리 페이 기준이라 " +
  "마이너스면 그 방향을 잡았을 때 시간이 돈을 가져가요. " +
  "DV01 백만원당이라 종목끼리 바로 비교돼요 — 스프레드·플라이는 다리 하나의 DV01이에요.";

/**
 * 셀 툴팁: 열에 자리가 없던 100억 기준 금액과 본전.
 *
 * **표시 정밀도에서 더해진다.** 합계와 롤다운만 각각 한 번 반올림하고 캐리는
 * 그 둘의 차(만원 단위)로 낸다. 셋을 따로 반올림하면 읽는 사람이 두 부분을
 * 더했을 때 합계가 안 나오는 날이 있고(만원 하나 차이), 이 리포는 그 거짓말을
 * 이미 한 번 출하한 적이 있다(`lib/krw.ts` 의 기록).
 */
export function thetaTitle(t: NonNullable<Row["theta"]>): string {
  const uCash = manUnits(t.cash);
  const uRoll = manUnits(t.roll);
  const uCarry = uCash - uRoll;
  return (
    `100억 기준 ${fmtKrwFromMan(uCash)}` +
    ` — 캐리 ${fmtKrwFromMan(uCarry)} + 롤다운 ${fmtKrwFromMan(uRoll)}. ` +
    `이 100억의 DV01 은 ${fmtKrw(t.dv01)}/bp 예요. ` +
    // 본전은 bp 움직임이라 변화 열이 쓰는 문법으로 찍는다 — 여기서 toFixed 를
    // 부르지 않는 이유이자, 이 파일이 반올림을 소유하지 않는다는 규칙의 실행
    `3개월 안에 ${fmtDelta(t.beBp, "bp")}bp 움직여야 본전이에요.`
  );
}

/** 열이 값을 지는 행. 라더가 "폭이 되나" 를 묻고 이 함수가 "여기 있나" 를
 * 묻는다 — 둘 다 참일 때만 열이 그려진다(`columns.withThetaData`). */
export function hasTheta(rows: Row[]): boolean {
  return rows.some((r) => r.theta != null);
}
