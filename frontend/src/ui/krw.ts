/* Money, the way a Korean desk reads it: 억 / 만, never 12 raw digits.
 * (BacktestWindow.tsx 에서 추출, 2026-08-10 — 포매터가 창 컴포넌트에 얹혀
 * 살면서 BacktestDailyPnl·RegretLab 이 "창"을 임포트해 돈 표기를 얻고 있었다.
 * 값·동작 불변, 자리만 유틸로.)
 *
 * ROUNDED to the nearest 만원, not floored (2026-08-03 verification). The
 * floor shipped a visible lie: the real book was 평가 1,091,329,056 + 캐리
 * 823,973 = 1,092,153,029 to the won, and the screen said 9,132만 + 82만
 * against a 9,215만 total — off by one 만원, purely from truncating each
 * figure separately. Rounding alone does not make parts SUM at displayed
 * precision, though; that is `splitKrw` below, which the 손익 구성 table
 * must use. Symmetric under negation (sign·round(|v|)), so a payer and its
 * mirror receiver always print mirror figures. */

/** Nearest 만원, as signed integer units — the arithmetic domain in which
 * displayed money is additive. */
export function manUnits(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v) / 10_000);
}

/** Money from signed 만-units. The units-based twin of `fmtKrw`: a table
 * whose parts must sum at displayed precision does its arithmetic on units
 * and formats the results through this. */
export function fmtKrwFromMan(units: number): string {
  const sign = units < 0 ? "−" : "+";
  const n = Math.abs(units);
  const eok = Math.floor(n / 10_000);
  const man = n % 10_000;
  if (eok > 0) return `${sign}${eok}억${man ? ` ${man.toLocaleString()}만` : ""}원`;
  return `${sign}${man.toLocaleString()}만원`;
}

export function fmtKrw(v: number): string {
  const n = Math.abs(Math.round(v));
  if (n < 10_000) return `${v < 0 ? "−" : "+"}${n.toLocaleString()}원`;
  return fmtKrwFromMan(manUnits(v));
}

/** 평가 + 캐리 + 롤다운 = 합계, AT DISPLAYED PRECISION, by construction: the
 * total, the valuation and the rolldown round once each, and the carry IS
 * their difference in 만-units — the fmtMove precedent (difference the
 * displayed endpoints) applied to money. Rounding all of them independently
 * can miss by a 만원, which is exactly the defect the old carry & roll block
 * was deleted for.
 *
 * [OWNER, 2026-08-11 — 교과서 3분해] `rolldown` joined the split.
 *
 * **개시는 평가에 접어 넣는다** [OWNER, 2026-08-14 — "개시손익 적으면 걍
 * 무시해도 될 거 같은데"]. 그 밤을 롤다운에서 빼낸 것은 그대로다 — 오늘 오전
 * 실측한 "10일 보유 롤다운의 24~26%가 첫날 밤" 은 돌아오지 않는다. 바뀌는 것은
 * **어느 칸이 그것을 안고 있느냐**뿐이고, 총손익 대비 0.005% 짜리 숫자에 열을
 * 하나 더 주지 않기로 한 것이다. 대가는 적어 둔다: 그 밤은 엄밀히 '금리가
 * 움직인 몫'이 아닌데 평가가 그것을 안는다.
 *
 * 서버는 여전히 `startup` 을 따로 보낸다 — 접는 것은 표시 결정이고, 나중에
 * 다시 펴려면 이 함수 하나만 고치면 된다. */
export function splitKrw(
  pnl: number,
  valuation: number,
  rolldown: number = 0,
  startup: number = 0,
): { uPnl: number; uVal: number; uRoll: number; uCarry: number } {
  const uPnl = manUnits(pnl);
  const uVal = manUnits(valuation + startup);
  const uRoll = manUnits(rolldown);
  return { uPnl, uVal, uRoll, uCarry: uPnl - uVal - uRoll };
}

/** 현금채권의 네 칸을 표시 정밀도에서 가산적으로 [OWNER, 2026-08-14].
 *
 * `splitKrw` 와 **같은 수법·같은 규칙**이다: 합계와 평가·롤다운·조달이 각각 한
 * 번씩 반올림하고, 캐리가 그 잔차를 진다. 개시는 평가에 접힌다(위 참조) —
 * 현금채권 단독은 어차피 0 이고, 자산스왑에서만 스왑 다리 몫으로 붙는다.
 *
 * 잔차에 실리는 반올림이 셋이라 캐리는 원 단위 값에서 최대 2만원까지 떨어질 수
 * 있다. 그래도 **행은 반드시 가로로 더해진다** — 그 성질이 이 표의 존재
 * 이유다(읽는 사람이 암산으로 표의 거짓말을 잡을 수 있어야 한다).
 *
 * 조달은 서버가 이미 음수로 준다(`app/cashbond.py`) — 여기서 부호를 다시 주면
 * 두 번 뒤집힌다. */
export function splitCashBondKrw(
  pnl: number,
  valuation: number,
  rolldown: number,
  funding: number,
  startup: number,
): {
  uPnl: number;
  uVal: number;
  uRoll: number;
  uFund: number;
  uCarry: number;
} {
  const uPnl = manUnits(pnl);
  const uVal = manUnits(valuation + startup);
  const uRoll = manUnits(rolldown);
  const uFund = manUnits(funding);
  return { uPnl, uVal, uRoll, uFund, uCarry: uPnl - uVal - uRoll - uFund };
}
