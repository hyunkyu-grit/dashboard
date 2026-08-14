"""Cash Bond — 민평 커브에서 par 로 발행한 3개월 이표채를 매일 재평가한다
[OWNER, 2026-08-14].

Backtest 섹션의 여섯 번째 종목군이다. IRS 백테스트(`app/backtest.py`)가 스왑에
대해 하는 일을 현금채권에 대해 한다 — 진입일에 그날 par 로 스트라이크하고,
그 뒤로 매일 그날의 시장으로 다시 값을 매기고, 손익을 칸으로 쪼갠다.

## 규약 [OWNER, 2026-08-14]

    표면금리   진입일 민평 (그 종목군 · 그 만기)
    할인       **단일 민평수익률** — 잔존만기에 보간한 값 하나로 전 현금흐름
    이표       3개월 (스왑과 기준을 맞춘다)
    조달       Setting 탭의 기준 시계열 + 스프레드, Cash Bond 에만 차감

쿠폰 = 수익률이므로 **진입일 가격은 정확히 par** 다. 연금 항등식이 그렇게
만든다: c=y/4, q=1+y/4 이면 Σ c·q^-k + q^-n = 1. 이 성질이 이 화면의 기준선
이고, `test_cashbond.py` 가 소수 열두 자리까지 못박는다.

## 왜 제로커브가 아닌가 [OWNER, 2026-08-14 — 선택]

민평은 par 호가가 아니라 **매매수익률**이다. 시장이 그 숫자 하나로 값을
주고받으므로 그 관행을 그대로 옮긴다. 스왑(제로커브 부트스트랩)과 할인
기계가 달라지는 것은 알고 받아들인 대가이고, 자산스왑 행이 두 기계의 차이를
그대로 보여 준다.

## 스케줄은 이상화돼 있다

이 채권은 실재하는 종목(ISIN)이 아니라 **커브 노드의 합성물**이다. 3Y 를
사면 만기는 진입일+3년이고 이표는 정확히 1/4년 간격이다 — 영업일 보정도
스텁도 없다. 실물 종목이라면 틀렸겠지만 여기서 재는 것은 "그 만기의 민평이
어떻게 움직였나" 이고, 이상화된 격자라야 진입일 par 가 정확해지고 롤다운이
매끄럽다. 실제 발행 종목을 붙일 때가 오면 `pos_krw_bond`(현재 0행)가 그
자리다.

## 손익 분해 [OWNER, 2026-08-14 — 4분해]

    평가     민평 수익률이 움직인 몫 (clean 변화에서 롤다운을 뺀 나머지)
    캐리     쿠폰 — 경과이자 증가분 + 이미 받은 이표
    롤다운   커브가 멈춰도 잔존만기가 줄며 생기는 몫 (전일 커브 동결, 체인)
    조달     원금을 조달한 비용 (음수로 표시)

`app/backtest.py` 의 3분해와 같은 항등식이다. 개시(거래일→발효일) 칸이 없는
이유는 이 채권이 **진입일에 발행돼 진입일부터 경과이자가 붙기** 때문이다 —
결제 시차가 없으므로 셀 밤도 없다. 자산스왑 행에서는 스왑 다리가 자기 개시를
싣고 오므로 그 칸이 산다.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from . import creditmatrix as cm
from . import funding as fd
from .creditmatrix import CreditMatrix, CreditMatrixError

log = logging.getLogger("app.cashbond")

#: 이표 주기 (연 4회) [OWNER — "3개월 이표채라고 가정해서 스왑과 기준을 맞춘다"]
FREQ = 4

#: 부동소수 경계에서 "오늘이 이표일" 을 판정하는 폭. 1e-9년 = 0.03초.
_EPS = 1e-9

#: 손익 라인의 발행 점 수 — `app/backtest.py:MAX_POINTS` 와 같은 이유·같은 값.
MAX_POINTS = 400

#: 한 번에 재는 포지션 수 상한 — 같은 이유.
MAX_POSITIONS = 12

#: 자산스왑이 설 수 있는 테너 = 민평 격자 ∩ IRS 격자. 채권의 2.5Y·20Y·30Y 는
#: 대응 IRS 노드가 없고, IRS 의 4Y·6Y·8Y·9Y 는 대응 민평 노드가 없다. 보간으로
#: 메우면 "같은 만기 두 상품" 이라는 이 행의 전제가 깨지므로 세우지 않는다.
ASW_TENORS: list[str] = ["3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "7Y", "10Y"]

KIND_CASH = "CB"
KIND_ASW = "ASW"


class CashBondError(Exception):
    """요청을 실행할 수 없다 — 없는 종목군/테너이거나 데이터 밖의 날짜다."""


@dataclass(frozen=True)
class BondPosition:
    kind: str          # "CB" | "ASW"
    bond_type: str     # "KTB" …
    tenor: str         # "3Y"
    direction: int     # +1 매수, -1 매도
    notional: float
    entry: dt.date
    exit: dt.date | None = None

    @property
    def id(self) -> str:
        return f"{self.kind}:{self.bond_type}:{self.tenor}"


# ── 가격 ────────────────────────────────────────────────────────────────────


def periods_for(tenor: str) -> int:
    """그 테너의 이표 횟수. 3M→1, 1.5Y→6, 2.5Y→10, 30Y→120."""
    years = cm.TENOR_YEARS.get(tenor)
    if years is None:
        raise CashBondError(f"알 수 없는 테너입니다: {tenor}")
    return max(1, round(years * FREQ))


def price(
    y: float, coupon: float, n: int, elapsed: float
) -> tuple[float, float, float, float]:
    """(dirty, 경과이자, 결제된 이표, **상환된 액면**) — 액면 1 기준.

    `y`·`coupon` 은 소수(0.0378), `elapsed` 는 진입일로부터 흐른 년수(ACT/365).
    현금흐름 k 는 진입일로부터 k/4년에 있고, 마지막에 액면 1 이 함께 온다.
    할인은 이표 주기 복리 — `(1+y/4)^(-4τ)`, τ 는 그 현금흐름까지 남은 년수다.

    `elapsed=0` · `coupon=y` 면 dirty 는 정확히 1.0 이다(연금 항등식). 이표일을
    막 지난 순간의 경과이자는 0 이고, 지급 직전에는 한 기 전액에 수렴한다.

    ## 셋째 값은 이표만이 아니라 **원금 상환까지** 포함한다

    2026-08-14 에 이것이 빠져 있어서 **만기까지 들고 있으면 원금만큼 손실**로
    찍혔다. `dirty` 는 아직 안 온 현금흐름의 현재가치이므로 만기에 0 이 되는데,
    그때 나간 액면 1 이 결제현금에 안 잡히면 `dirty + 현금` 이 1.04 에서 0.04 로
    떨어진다(1Y·쿠폰 4% 실측). 손익 = Δdirty + 결제현금 이라는 이 화면의 항등식
    자체는 옳고, **결제현금의 정의가 좁았다**.

    교과서도 지수 계산 규칙도 같은 말을 한다 — FTSE Russell 의 Guide to
    Calculation 은 total return 의 cash 항을 "the sum of any coupons **and any
    principal repayments** … including cumulative cash from principal
    redemption" 로 정의한다. 스왑 쪽에는 이 결함이 없다: 바닐라 IRS 는 원금
    교환이 없어 잃을 원금이 애초에 없다(2026-08-14 실측으로 확인).

    ## 이표와 액면을 **따로** 돌려주는 이유

    총액에는 둘이 같이 들어가지만 **분해에서는 서로 다른 칸**이다. 이표는
    소득(캐리)이고 상환된 액면은 자본 회수 — par 로 사서 par 를 돌려받은 것이라
    가격 쪽에 붙어야 한다. 한 값으로 합쳐 돌려주었더니 만기 보유 3Y 의 캐리가
    110억, 롤다운이 −102억으로 찍혔다(실측). 총액은 맞고 칸만 틀린, 이 리포가
    오늘 오전에도 한 번 겪은 결함이다.
    """
    q = 1.0 + y / FREQ
    c = coupon / FREQ
    dirty = 0.0
    paid_count = 0
    for k in range(1, n + 1):
        tau = k / FREQ - elapsed
        if tau <= _EPS:
            paid_count = k
            continue
        cf = c + (1.0 if k == n else 0.0)
        dirty += cf * q ** (-FREQ * tau)
    matured = paid_count >= n
    # 현재 이표기간에서 흐른 비율. paid_count 가 직전 이표이므로 [0,1) 이다.
    # 만기 뒤에는 붙을 이표가 없다 — 이 가드가 없으면 `frac` 이 무한정 자란다.
    frac = 0.0 if matured else elapsed * FREQ - paid_count
    return dirty, c * max(0.0, frac), c * paid_count, 1.0 if matured else 0.0


# ── 백테스트 ────────────────────────────────────────────────────────────────


def _entry_index(m: CreditMatrix, d: dt.date) -> int:
    """진입일 이상의 첫 영업일 자리. 민평 달력 밖이면 에러."""
    for i, x in enumerate(m.dates):
        if x >= d:
            return i
    raise CashBondError(f"민평 데이터 이후의 날짜입니다: {d} (마지막 {m.dates[-1]})")


def _span(m: CreditMatrix, pos: BondPosition) -> tuple[int, int, bool]:
    """(진입 자리, 종료 자리, 만기도달 여부). 종료는 만기에서 잘린다 — 만기가
    지난 채권을 계속 마킹하면 백테스트가 스스로를 미화한다."""
    if not m.has(pos.bond_type, pos.tenor):
        raise CashBondError(
            f"{cm.BOND_TYPES.get(pos.bond_type, pos.bond_type)} 에는 {pos.tenor} 민평이 없습니다."
        )
    entry_i = _entry_index(m, pos.entry)
    years = cm.TENOR_YEARS[pos.tenor]
    maturity = m.dates[entry_i] + dt.timedelta(days=round(years * 365))

    last = len(m.dates) - 1
    exit_i = last
    if pos.exit is not None:
        for i in range(len(m.dates) - 1, -1, -1):
            if m.dates[i] <= pos.exit:
                exit_i = i
                break
        else:
            raise CashBondError(f"청산일이 민평 데이터보다 앞섭니다: {pos.exit}")
    matured = False
    for i in range(entry_i, exit_i + 1):
        if m.dates[i] >= maturity:
            exit_i, matured = i, True
            break
    if exit_i < entry_i:
        raise CashBondError("청산일이 진입일보다 앞섭니다.")
    return entry_i, exit_i, matured


def _thin(idx: list[int], keep: int) -> list[int]:
    """`app/backtest.py:_thin` 과 같은 규칙 — 양 끝은 반드시 남는다."""
    if len(idx) <= keep:
        return idx
    step = (len(idx) - 1) / (keep - 1)
    out = sorted({idx[round(k * step)] for k in range(keep)} | {idx[0], idx[-1]})
    return out


@dataclass
class _BondLeg:
    """한 포지션의 채권 다리를 그린 것 — 자산스왑도 이 다리를 그대로 쓴다."""

    coupon: float
    n: int
    years: float
    entry_i: int
    exit_i: int
    matured: bool


def _bond_leg(m: CreditMatrix, pos: BondPosition) -> _BondLeg:
    entry_i, exit_i, matured = _span(m, pos)
    years = cm.TENOR_YEARS[pos.tenor]
    coupon = cm.yield_at(m, pos.bond_type, entry_i, years)
    return _BondLeg(coupon, periods_for(pos.tenor), years, entry_i, exit_i, matured)


def run_bond_leg(
    m: CreditMatrix,
    pos: BondPosition,
    leg: _BondLeg,
    sample: list[int],
    spec: fd.FundingSpec,
) -> tuple[dict, dict[int, float], dict[int, float]]:
    """채권 다리 하나를 매일 재평가한다.

    (요약, {자리: 손익}, {자리: **전영업일** 손익}) 을 돌려준다. 셋째가 있는
    이유는 차트의 당일 변화 때문이다 — `live` 가 이미 발행점 하루 전까지 값을
    매기고 있으므로(아래) 공짜에 가깝고, 없으면 화면이 발행점 사이의 차이를
    "당일" 이라고 부르게 된다. IRS 쪽 `_run_one` 의 `prev_day` 와 같은 규약이다.

    부호 규약은 IRS 쪽과 같다: `direction` 이 +1 이면 매수(금리가 내리면 이익),
    −1 이면 매도. 조달은 **매수에만** 붙는다 — 공매도는 돈을 빌리는 것이 아니라
    채권을 빌리는 것이고, 그 비용(대차료)은 이 화면이 아는 값이 아니다.
    """
    N = pos.notional * pos.direction
    entry_i, exit_i = leg.entry_i, leg.exit_i
    entry_date = m.dates[entry_i]

    # 진입일: 쿠폰 = 그날 수익률이므로 dirty 는 정확히 1.0, 경과이자 0.
    dirty0, accrued0, _cp0, _rd0 = price(leg.coupon, leg.coupon, leg.n, 0.0)
    clean0 = dirty0 - accrued0

    live = sorted(
        {i for i in sample if entry_i <= i <= exit_i}
        | {exit_i}
        | {i - 1 for i in sample if entry_i < i <= exit_i}
    )

    own: dict[int, float] = {}
    last = last_val = last_roll = last_carry = last_fund = 0.0
    prev_i, prev_clean = entry_i, clean0
    roll_cum = 0.0

    for i in live:
        elapsed = (m.dates[i] - entry_date).days / 365.0
        remaining = max(0.0, leg.years - elapsed)
        y = cm.yield_at(m, pos.bond_type, i, remaining) if remaining > 0 else leg.coupon
        dirty, accrued, coupons, redeemed = price(y, leg.coupon, leg.n, elapsed)
        # **상환된 액면은 가격 쪽이다** — par 로 사서 par 를 돌려받은 것이라
        # 소득이 아니라 자본 회수다. 여기 안 넣고 캐리에 두면 만기에 캐리가
        # 액면만큼 부풀고 롤다운이 그만큼 음수가 된다(price 독스트링의 실측).
        clean = dirty - accrued + redeemed

        if i > prev_i:
            # 롤다운 = **전일 커브**로 오늘의 (짧아진) 채권을 다시 값 매긴 것.
            # Tuckman 의 불변 기간구조 가정이고, IRS 쪽 체인과 같은 규약이다.
            y_frozen = (
                cm.yield_at(m, pos.bond_type, prev_i, remaining)
                if remaining > 0
                else leg.coupon
            )
            d_f, a_f, _cp_f, rd_f = price(y_frozen, leg.coupon, leg.n, elapsed)
            roll_cum += (d_f - a_f + rd_f) - prev_clean

        # 조달은 매수 원금(= 액면 × par)에 붙는다. 매도는 위 주석대로 0.
        funding = (
            fd.cost_between(spec, entry_date, m.dates[i], pos.notional)
            if pos.direction > 0
            else 0.0
        )

        val_total = (clean - clean0) * N
        carry = (accrued - accrued0 + coupons) * N
        own[i] = last = val_total + carry - funding
        last_val = val_total - roll_cum * N
        last_roll = roll_cum * N
        last_carry, last_fund = carry, funding
        prev_i, prev_clean = i, clean

    def at(i: int) -> float:
        if i < entry_i:
            return 0.0
        if i > exit_i:
            return last
        return own[i]

    record = {
        "coupon": round(leg.coupon * 100, 4),
        "entryYield": round(leg.coupon * 100, 4),
        "exitYield": round(
            cm.yield_at(
                m, pos.bond_type, exit_i,
                max(0.0, leg.years - (m.dates[exit_i] - entry_date).days / 365.0),
            ) * 100,
            4,
        ),
        "valuation": round(last_val, 0),
        "rolldown": round(last_roll, 0),
        "carry": round(last_carry, 0),
        "funding": round(-last_fund, 0),  # 화면에서 빼는 값이라 부호를 여기서 준다
        "pnl": round(last, 0),
        "matured": leg.matured,
    }
    return (
        record,
        {i: at(i) for i in sample},
        {i: at(i - 1) for i in sample if i - 1 >= 0},
    )


# ── 자산스왑 ────────────────────────────────────────────────────────────────


def _irs_index_map(m: CreditMatrix, dataset) -> dict[int, int]:
    """민평 자리 → IRS 자리. 민평 달력은 IRS 달력의 **부분집합**이다(실측
    2026-08-14: 겹치는 1,624일 전부 포함, 반대로 IRS 에만 있는 날이 15일 —
    연말 폐장일 등). 그래서 이 사상은 전사이고, 없는 날이 나오면 그것은
    데이터가 변했다는 뜻이므로 조용히 넘기지 않고 세운다."""
    pos = {d: i for i, d in enumerate(dataset.dates)}
    out: dict[int, int] = {}
    for i, d in enumerate(m.dates):
        j = pos.get(d)
        if j is not None:
            out[i] = j
    return out


# ── 북 ──────────────────────────────────────────────────────────────────────


def run_backtest(
    m: CreditMatrix,
    dataset,
    positions: list[BondPosition],
    spec: fd.FundingSpec,
) -> dict:
    """포지션 여럿을 매일 재평가해 합친다 — `app/backtest.py:run_backtest` 의
    현금채권 판이다. 창은 가장 이른 진입부터 가장 늦은 종료까지이고, 모든
    포지션을 **같은 날짜들**에서 재서 합계가 점마다 맞는다."""
    if not positions:
        raise CashBondError("포지션이 하나는 있어야 합니다.")
    if len(positions) > MAX_POSITIONS:
        raise CashBondError(f"포지션은 최대 {MAX_POSITIONS}개입니다.")
    # 매수뿐이다 [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"]. 현금채권을
    # 공매도하려면 채권을 빌려야 하고, 그 대차료는 이 화면이 아는 값이 아니다 —
    # 모르는 비용을 0 으로 두고 계산하면 공매도가 늘 이기는 백테스트가 된다.
    # 화면에는 고를 것 자체가 없으므로 여기 걸리는 것은 손으로 만든 URL 뿐이고,
    # 그때 조용히 값을 내놓는 것보다 거절하는 편이 옳다.
    for p in positions:
        if p.direction != 1:
            raise CashBondError(
                "현금채권은 매수만 됩니다 — 공매도는 대차료가 필요한데 그 값이 없습니다."
            )
    spec = spec.validated()

    legs = [_bond_leg(m, p) for p in positions]
    first = min(l.entry_i for l in legs)
    last = max(l.exit_i for l in legs)
    sample = _thin(list(range(first, last + 1)), MAX_POINTS)

    # IRS 달력 사상은 자산스왑 행이 있을 때만 세운다 — 현금채권만 있는 북은
    # IRS 데이터셋 없이도 돌아야 하고(게이트가 합성 민평으로 그렇게 돈다),
    # 없는 의존을 요구하면 그 자체가 결함이다.
    needs_swap = any(p.kind == KIND_ASW for p in positions)
    if needs_swap and dataset is None:
        raise CashBondError("자산스왑 행에는 IRS 데이터셋이 필요합니다.")
    imap = _irs_index_map(m, dataset) if needs_swap else {}
    swap_cache: dict[int, object] = {}

    records: list[dict] = []
    series: list[dict[int, float]] = []
    prevs: list[dict[int, float]] = []

    for p, leg in zip(positions, legs):
        rec, own, own_prev = run_bond_leg(m, p, leg, sample, spec)
        rec = {
            "id": p.id,
            "kind": p.kind,
            "bondType": p.bond_type,
            "label": instrument_label(p.kind, p.bond_type, p.tenor),
            "tenor": p.tenor,
            "direction": p.direction,
            "notional": p.notional,
            "entry": m.dates[leg.entry_i].isoformat(),
            "exit": m.dates[leg.exit_i].isoformat(),
            "closed": leg.exit_i < len(m.dates) - 1,
            **rec,
            # 스왑 다리가 없는 행은 개시가 없다 — 이 채권은 진입일에 발행돼
            # 진입일부터 경과이자가 붙으므로 결제 시차의 밤 자체가 없다.
            "startup": 0.0,
            "swapPnl": None,
        }

        if p.kind == KIND_ASW:
            srec, sown, sprev = _swap_leg(dataset, p, leg, m, sample, imap, swap_cache)
            for key in ("valuation", "rolldown", "carry", "startup"):
                rec[key] = round(rec[key] + srec[key], 0)
            rec["swapPnl"] = srec["pnl"]
            rec["swapEntryRate"] = srec["entryRate"]
            rec["aswSpread"] = round((leg.coupon * 100 - srec["entryRate"]) * 100, 2)
            for i in own:
                own[i] += sown.get(i, 0.0)
            for i in own_prev:
                own_prev[i] += sprev.get(i, 0.0)
            rec["pnl"] = round(own[sample[-1]] if sample else 0.0, 0)

        records.append(rec)
        series.append(own)
        prevs.append(own_prev)

    # 손익 라인. `d` 는 **늘 1영업일** 변화다 — 발행점 사이가 아니라.
    # 창이 MAX_POINTS 를 넘어 솎이면 점 사이가 며칠씩 벌어지는데, 그 간격을
    # "당일" 이라고 부르면 거짓말이 된다. 그래서 각 포지션이 발행점의 **전날**
    # 손익도 같이 내고(`run_bond_leg` 의 셋째 반환값), 여기서 그 차를 쓴다.
    # 값싸다: `live` 가 이미 그 날짜들을 평가하고 있다.
    #
    # 브라우저에서 빼지 않는 것도 규약이다(§16) — 이미 원 단위로 반올림된
    # 계열을 화면에서 차분하면 읽는 사람이 보는 두 숫자와 안 맞는 값이 나온다.
    points = []
    for k, i in enumerate(sample):
        total = round(sum(s.get(i, 0.0) for s in series), 0)
        d = (
            None
            if k == 0
            else round(total - sum(pd.get(i, 0.0) for pd in prevs), 0)
        )
        points.append({"t": m.dates[i].isoformat(), "pnl": total, "d": d})

    pnls = [p["pnl"] for p in points]
    return {
        "positions": records,
        "from": m.dates[first].isoformat(),
        "to": m.dates[last].isoformat(),
        "complete": len(sample) == last - first + 1,
        "points": points,
        "pnl": pnls[-1] if pnls else 0.0,
        "maxProfit": max(pnls) if pnls else 0.0,
        "maxLoss": min(pnls) if pnls else 0.0,
        "funding": fd.provenance(spec),
    }


def _swap_leg(
    dataset, p: BondPosition, leg: _BondLeg, m: CreditMatrix,
    sample: list[int], imap: dict[int, int], cache: dict,
) -> tuple[dict, dict[int, float], dict[int, float]]:
    """자산스왑의 IRS 다리 — 채권 매수에 **같은 명목**의 페이 고정 [OWNER,
    2026-08-14 — par-par]. DV01 중립이 아닌 이유는 진입일 스프레드가 표에 보이는
    민평 − IRS 그대로 읽히기 때문이고, 대가는 채권이 par 에서 멀어지면 남는
    잔여 금리노출이다(채권 DV01 은 단일수익률, 스왑 PV01 은 제로커브).

    기존 IRS 백테스트 엔진을 그대로 부른다 — 이 다리는 그냥 스왑이고, 개시
    칸까지 그쪽 규약을 물려받는다."""
    from .backtest import Position, _run_one

    if p.tenor not in ASW_TENORS:
        raise CashBondError(
            f"{p.tenor} 는 자산스왑을 세울 수 없습니다 — 채권과 IRS 양쪽에 있는 "
            f"만기만 가능합니다 ({'·'.join(ASW_TENORS)})."
        )
    if leg.entry_i not in imap or leg.exit_i not in imap:
        raise CashBondError("민평 날짜가 IRS 달력에 없습니다 — 데이터를 확인하세요.")

    spos = Position(
        series_id=p.tenor,
        direction=p.direction,   # 채권 매수 = 스왑 페이
        notional=p.notional,
        entry=m.dates[leg.entry_i],
        exit=m.dates[leg.exit_i],
    )
    isample = sorted({imap[i] for i in sample if i in imap})
    rec, own, prev = _run_one(dataset, spos, isample, cache)
    back = {i: own.get(imap[i], 0.0) for i in sample if i in imap}
    # 전영업일도 **IRS 달력의** 하루 전이다. 민평 달력에 없는 날(연말 폐장일
    # 등 15일)이 그 사이에 끼면 채권 다리와 하루가 어긋나는데, 그 어긋남은
    # 스왑이 실제로 그날 값이 매겨졌다는 사실 그대로다.
    back_prev = {i: prev.get(imap[i], 0.0) for i in sample if i in imap}
    rec["entryRate"] = rec["legs"][0]["entryRate"] if rec["legs"] else 0.0
    return rec, back, back_prev


# ── 표 ──────────────────────────────────────────────────────────────────────


def instrument_label(kind: str, bond_type: str, tenor: str) -> str:
    """화면 이름. 종목군 이름은 오너가 부르는 그대로다 (creditmatrix.BOND_TYPES)."""
    name = cm.BOND_TYPES.get(bond_type, bond_type)
    return f"{name} {tenor}" if kind == KIND_CASH else f"{name} {tenor} 자산스왑"


def _basis_indices(m: CreditMatrix) -> dict[str, int | None]:
    """d1 / mtd / ytd 각각의 **직전 종가** 자리 — `derive.basis_dates` 와 같은
    정의다(그 기간이 시작되기 전 마지막 영업일)."""
    asof = m.asof

    def last_before(cutoff: dt.date) -> int | None:
        j = None
        for i, d in enumerate(m.dates):
            if d < cutoff:
                j = i
            else:
                break
        return j

    return {
        "d1": last_before(asof),
        "mtd": last_before(asof.replace(day=1)),
        "ytd": last_before(asof.replace(month=1, day=1)),
    }


def _last_at_or_before(values: list[float | None], i: int | None) -> float | None:
    if i is None:
        return None
    while i >= 0:
        if values[i] is not None:
            return values[i]
        i -= 1
    return None


def asw_series(m: CreditMatrix, dataset, bond_type: str, tenor: str) -> list[float | None]:
    """자산스왑 스프레드(bp) = 민평 − IRS, 민평 날짜에 맞춰서.

    par-par 규약이라 진입일 스프레드가 이 숫자 그대로다 [OWNER, 2026-08-14].
    IRS 쪽에만 있는 날(연말 폐장일 등 15일)은 민평 격자에 없으므로 자연히 빠진다.
    """
    irs = dataset.series.get(tenor)
    if irs is None:
        raise CashBondError(f"IRS 에 {tenor} 계열이 없습니다.")
    pos = {d: i for i, d in enumerate(dataset.dates)}
    mp = m.series(bond_type, tenor)
    out: list[float | None] = []
    for i, d in enumerate(m.dates):
        j = pos.get(d)
        a = mp[i]
        b = irs[j] if j is not None else None
        out.append(None if a is None or b is None else round((a - b) * 100, 2))
    return out


def series_for(m: CreditMatrix, dataset, series_id: str) -> list[float | None]:
    kind, bond_type, tenor = parse_id(series_id)
    if kind == KIND_CASH:
        return m.series(bond_type, tenor)
    return asw_series(m, dataset, bond_type, tenor)


def parse_id(series_id: str) -> tuple[str, str, str]:
    parts = series_id.split(":")
    if len(parts) != 3 or parts[0] not in (KIND_CASH, KIND_ASW):
        raise CashBondError(f"알 수 없는 종목입니다: {series_id!r} (CB:KTB:3Y 형식)")
    kind, bond_type, tenor = parts
    if bond_type not in cm.BOND_TYPES:
        raise CashBondError(f"알 수 없는 종목군입니다: {bond_type}")
    if tenor not in cm.TENOR_YEARS:
        raise CashBondError(f"알 수 없는 테너입니다: {tenor}")
    return kind, bond_type, tenor


def instruments(
    m: CreditMatrix,
    dataset,
    irs_theta: dict[str, dict] | None = None,
) -> dict:
    """Cash Bond 표의 행 전부 — 현금채권과 자산스왑.

    §16 계산 경계: 수준·변화·백분위·52주 범위를 전부 여기서 내고 브라우저는
    그리기만 한다. IRS 표(`app/payloads.py`)와 같은 규약이다.

    행이 서는 조건은 **그 종목군이 그 만기를 실제로 갖는 것**이다. 통안채는
    3Y 까지, 30Y 는 국고채·공사채만 — `creditmatrix` 가 관측이 얇은 계열을
    이미 떨어냈으므로 여기서는 있는 것만 돈다.
    """
    from .derive import annual_stats

    bases = _basis_indices(m)
    last = len(m.dates) - 1
    rows: list[dict] = []
    for bond_type in cm.TYPE_ORDER:
        for tenor in m.tenors_for(bond_type):
            for kind in (KIND_CASH, KIND_ASW):
                if kind == KIND_ASW and tenor not in ASW_TENORS:
                    continue
                try:
                    vals = series_for(m, dataset, f"{kind}:{bond_type}:{tenor}")
                except CashBondError:
                    continue
                now = _last_at_or_before(vals, len(vals) - 1)
                if now is None:
                    continue
                stats = annual_stats(vals)
                changes: dict[str, float | None] = {}
                for k, bi in bases.items():
                    prev = _last_at_or_before(vals, bi)
                    # 현금채권은 %, 자산스왑은 이미 bp — 변화는 둘 다 bp 다.
                    mult = 100.0 if kind == KIND_CASH else 1.0
                    changes[k] = None if prev is None else round((now - prev) * mult, 2)
                rows.append({
                    "id": f"{kind}:{bond_type}:{tenor}",
                    "kind": kind,
                    "bondType": bond_type,
                    "tenor": tenor,
                    "label": instrument_label(kind, bond_type, tenor),
                    # 화면의 단위 어휘 그대로 ("%" | "bp") — IRS 행과 같은 값을
                    # 써야 같은 포매터(`lib/format.ts:fmtLevel`)를 탄다.
                    "unit": "%" if kind == KIND_CASH else "bp",
                    "now": round(now, 4),
                    "changes": changes,
                    "pct": stats["pct"],
                    "rangeHigh": stats["max"],
                    "rangeLow": stats["min"],
                    "rangeAvg": stats["avg"],
                    # 정렬 키도 서버가 정한다(§6/§16): 종목군 사다리 → 만기.
                    "sortKey": [cm.TYPE_ORDER.index(bond_type), cm.TENOR_YEARS[tenor]],
                    "theta": _row_theta(m, bond_type, tenor, kind, last, irs_theta),
                })
    return {
        "asof": m.asof.isoformat(),
        "from": m.dates[0].isoformat(),
        "types": [{"id": t, "label": cm.BOND_TYPES[t]} for t in cm.TYPE_ORDER],
        "rows": rows,
        # 세타가 무엇을 뜻하는지는 표 아래에 한 번 적는다 — 행마다 되풀이할
        # 문장이 아니다. `app/theta.py` 의 `meta` 와 같은 자리·같은 이유.
        #
        # 조달은 여기 없다 [OWNER, 2026-08-14] — 세타가 그것을 안 뺀다. Setting
        # 의 조달값은 백테스트의 조달 칸이 여전히 쓴다.
        "thetaBasis": {
            "horizonDays": 1,
            "notional": NOTIONAL,
            "side": "buy",
        },
    }


def _row_theta(
    m: CreditMatrix,
    bond_type: str,
    tenor: str,
    kind: str,
    i: int,
    irs_theta: dict[str, dict] | None,
) -> dict | None:
    """행 하나의 세타. 현금채권은 그대로, 자산스왑은 **두 다리의 합**이다.

    자산스왑의 정규화 분모는 **채권 다리의 DV01** 이다. par-par 라 순 DV01 이
    0 에 가깝고, 0 에 가까운 수로 나누면 숫자가 폭발한다 — IRS 쪽이 스프레드·
    플라이에서 기준 다리의 DV01 을 쓰는 것과 같은 이유이고 같은 처리다
    (`theta.theta_for_package` 의 근거 참조).
    """
    bond = theta_for_bond(m, bond_type, tenor, i)
    if bond is None:
        return None
    if kind == KIND_CASH:
        return bond
    swap = (irs_theta or {}).get(tenor)
    if swap is None:
        return None  # 그 만기에 IRS 세타가 없으면 패키지 세타도 없다
    cash = bond["cash"] + swap["cash"]
    dv01 = bond["dv01"]
    return {
        "perDv01": round(cash / (dv01 / 1_000_000)) if dv01 else 0,
        "cash": round(cash),
        "carry": round(bond["carry"] + swap["carry"]),
        "roll": round(bond["roll"] + swap["roll"]),
        "dv01": round(dv01),
        # 본전은 **스프레드**가 몇 bp 움직여야 하나 — 그 행의 레벨 칸과 같은 단위
        "beBp": round((cash / dv01) if dv01 else 0.0, 2),
    }


# ── 세타 ────────────────────────────────────────────────────────────────────
# 표에 상시로 뜨는 열이다 — IRS 쪽 `app/theta.py` 와 **같은 자리·같은 질문**.
# 그쪽 모듈 주석이 근거를 다 들어 뒀으므로 여기서는 다른 점만 적는다.
#
# 다른 점 하나: **캐리에서 조달을 빼지 않는다** [OWNER, 2026-08-14 — "채권에서는
# 조달 차감하지 않는 걸로 하기"]. IRS 세타와 정의를 맞추기 위한 결정이다.
#
# **이것은 시장 관행과 다르다**, 그래서 여기 적어 둔다. 외부 확인(2026-08-14):
# 채권 캐리의 표준 정의는 `carry = y − r_f` — 수익률에서 조달(레포)을 뺀 값이고,
# yieldcurve.pro 는 "You collect coupon, you pay financing, and the difference is
# yours" 로, AnalystPrep 은 "income a bond earns above its funding cost" 로 적는다.
# 조달을 빼지 않으면 이 열은 **총 쿠폰**이 되어 수익률 높은 종목이 늘 이긴다 —
# 캐피탈채가 국고채보다 늘 위에 서는 것이 그 뜻이다.
#
# 되돌리려면 아래 `funding` 한 줄을 다시 빼면 된다. 조달값 자체는 Setting 이
# 여전히 들고 있고 백테스트의 조달 칸이 쓴다 — 사라진 것이 아니라 세타에서만
# 빠졌다.
#
# 다른 점 둘: **부호가 매수 기준**이다. IRS 표의 행은 방향이 없어서 페이로
# 고정했지만, 현금채권은 살 수만 있으므로(매도 거절) 살 때의 숫자가 곧 그 행의
# 숫자다. 우상향 커브에서 양수로 뜨는 것이 정상이다.

#: `app/theta.py` 와 **같은** 호라이즌·노셔널·bp. 세 값이 갈리면 두 표의 세타를
#: 나란히 놓고 읽을 수 없다 — 그래서 재정의하지 않고 가져온다.
from .theta import BP, HORIZON_DAYS, HORIZON_Y, NOTIONAL  # noqa: E402


def dv01_at(y: float, coupon: float, n: int, elapsed: float) -> float:
    """액면 1 기준 DV01 (원/bp) — 수익률을 ±0.5bp 흔든 clean 가격의 중앙차분.

    해석해를 쓰지 않는 이유는 `price` 가 이 화면의 유일한 가격 정의이기
    때문이다. 미분을 따로 적으면 규약이 둘이 되고, 둘이 어긋나도 아무도
    모른다(이 리포가 이미 한 번 겪은 결함 종류).
    """
    half = BP / 2
    up = price(y + half, coupon, n, elapsed)
    dn = price(y - half, coupon, n, elapsed)
    # clean = dirty − 경과이자 + 상환액면. 상환분은 수익률에 안 흔들리므로
    # 차분에서 지워지지만, 같은 식으로 적어 두어야 정의가 하나로 남는다.
    clean = lambda t: t[0] - t[1] + t[3]  # noqa: E731
    return clean(dn) - clean(up)


def theta_for_bond(
    m: CreditMatrix,
    bond_type: str,
    tenor: str,
    i: int,
) -> dict | None:
    """한 현금채권의 세타 블록. 값을 낼 수 없으면 None (표가 em dash 를 그린다).

    호라이즌은 **하루**이고 커브는 **동결**이다 — 오늘 커브 하나로 닫힌 식이라
    백테스트를 돌리지 않아도 나온다. 그것이 이 열의 존재 이유다. 기간은 IRS 쪽과
    같은 상수를 쓴다(`theta.HORIZON_Y`) — 두 표의 세타를 나란히 놓고 읽으려면
    그 값이 하나여야 한다.
    """
    years = cm.TENOR_YEARS[tenor]
    # 호라이즌을 지나고도 한 분기는 남아야 롤다운이 뜻이 있다 — IRS 쪽
    # `theta.theta_table` 의 같은 문턱과 같은 이유(민평 커브의 가장자리는
    # 보간이 지배한다).
    if years - HORIZON_Y < 0.25 - 1e-9:
        return None
    try:
        y0 = cm.yield_at(m, bond_type, i, years)
        y_roll = cm.yield_at(m, bond_type, i, years - HORIZON_Y)
    except CreditMatrixError:
        return None

    n = periods_for(tenor)
    coupon = y0  # 진입일 par — 표면금리가 곧 그날 민평이다

    # 호라이즌의 마킹: 잔존이 짧아진 채권을 **오늘 커브의** 그 지점으로 값 매김
    d_h, a_h, cp_h, rd_h = price(y_roll, coupon, n, HORIZON_Y)
    clean_h = d_h - a_h + rd_h

    roll = (clean_h - 1.0) * NOTIONAL          # par 로 샀으므로 기준이 1.0
    # 조달은 빼지 않는다 — 모듈 주석의 [OWNER] 와 그 아래 외부 확인 참조.
    carry = (a_h + cp_h) * NOTIONAL            # 분기치 쿠폰(경과 + 받은 것)

    dv01 = dv01_at(y0, coupon, n, 0.0) * NOTIONAL
    dv01_h = dv01_at(y_roll, coupon, n, HORIZON_Y) * NOTIONAL

    # 분기에서 재고 하루로 나눈다 — IRS 쪽 `theta._block` 과 같은 자리·같은 이유
    # (하루 간격 두 지점으로 롤을 재면 커브 보간 잡음이 롤보다 커진다).
    carry /= HORIZON_DAYS
    roll /= HORIZON_DAYS
    cash = carry + roll
    return {
        "perDv01": round(cash / (dv01 / 1_000_000)) if dv01 else 0,
        "cash": round(cash),
        "carry": round(carry),
        "roll": round(roll),
        "dv01": round(dv01),
        # 본전: 이 종목의 **호가값**(민평 수익률)이 몇 bp 올라야 세타가
        # 상쇄되나. IRS 표의 같은 열과 같은 문장이다.
        "beBp": round((cash / dv01_h) if dv01_h else 0.0, 2),
    }
