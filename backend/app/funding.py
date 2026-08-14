"""조달금리 — Setting 탭이 정하는 값 [OWNER, 2026-08-14].

현금채권은 원금을 조달해서 산다. 그 비용을 빼지 않은 채권 손익은 쿠폰을 공짜로
번 것처럼 보이므로, Cash Bond 백테스트는 손익을 넷으로 쪼갤 때 **조달비용을
독립된 한 줄로** 뺀다 [OWNER — 4분해].

## 규약 [OWNER, 2026-08-14]

조달금리 = **기준 시계열 + 스프레드(bp)**, 그날그날의 계단이다. 전 기간 고정
상수가 아니다 — 2020년 구간을 백테스트하면 그 시점의 0.50% 로 조달해야 한다.
기준은 둘 중 하나를 화면에서 고른다:

    base   한국은행 기준금리   `data/bokbaserate.xlsx`  2016-01-01 ~ 2026-07-16
    call   콜금리              SQL `mkt_irs_close.call_rate`  2016-01-04 ~ 2026-08-13

둘 다 민평(2020-01-02 시작)을 완전히 덮는다. 커버리지 **밖**에서는 가장 가까운
끝값을 평탄 연장한다 — 기준금리 시계열이 7/16 에서 끝나는 것은 그 뒤로 결정이
없었다는 뜻이므로 앞쪽 연장은 사실이고, 2020년 이전 뒤쪽 연장은 이 화면이
가지 않는 구간이다.

## 적용 범위 [OWNER, 2026-08-14 — "Cash Bond 전용"]

**IRS 백테스트는 건드리지 않는다.** 기존 `/api/backtest` 의 숫자는 이 모듈이
생기기 전과 바이트 동일해야 하고, 그래서 이 모듈은 `app/backtest.py` 가
import 하지 않는다. 자산스왑 행에서도 조달은 **채권 다리에만** 붙는다.

## 일수 계산

ACT/365, **달력일**이다. 레포는 주말에도 돈다 — 영업일만 세면 금요일 매수분의
주말 이틀이 공짜가 된다. 누적은 날짜별 계단을 한 번 적분해 두고(`_ladder`)
차분으로 읽는다: 400개 표본 × 10년치를 매번 다시 더하면 백만 번의 덧셈이다.
"""

from __future__ import annotations

import datetime as dt
import logging
from bisect import bisect_right
from dataclasses import dataclass

log = logging.getLogger("app.funding")

#: 화면 기본값. 시뮬레이션 레인이 오래 써 온 "기준금리 + 10bp"
#: (`irs_pricer/services/funding_basis.py`) 와 같은 자리에서 출발한다.
DEFAULT_BASIS = "base"
DEFAULT_SPREAD_BP = 10.0

BASIS_LABEL = {"base": "기준금리", "call": "콜금리"}


class FundingError(RuntimeError):
    """조달 기준 시계열을 쓸 수 없다."""


@dataclass(frozen=True)
class FundingSpec:
    """Setting 탭이 내려보내는 것 전부."""

    basis: str = DEFAULT_BASIS
    spread_bp: float = DEFAULT_SPREAD_BP

    def validated(self) -> "FundingSpec":
        if self.basis not in BASIS_LABEL:
            raise FundingError(
                f"알 수 없는 조달 기준입니다: {self.basis!r} (base 또는 call)"
            )
        # 화면에서 손이 미끄러져 10000bp 가 들어오면 손익이 조용히 말이 안 되게
        # 된다. 범위를 좁게 잡고 넘으면 거절한다.
        if not -500.0 <= self.spread_bp <= 500.0:
            raise FundingError(f"조달 스프레드가 범위를 벗어납니다: {self.spread_bp}bp (-500 ~ 500)")
        return self

    @property
    def label(self) -> str:
        sign = "+" if self.spread_bp >= 0 else ""
        return f"{BASIS_LABEL[self.basis]} {sign}{self.spread_bp:g}bp"


# ── 기준 시계열 ─────────────────────────────────────────────────────────────


def _base_rate_series() -> list[tuple[dt.date, float]]:
    """한국은행 기준금리, 날짜 오름차순 (date, decimal)."""
    from irs_pricer.config import DATA_DIR
    from irs_pricer.loaders import base_rate

    rates = base_rate.all_rates(DATA_DIR)
    if not rates:
        raise FundingError("기준금리 시계열이 비어 있습니다 (data/bokbaserate.xlsx).")
    return sorted(rates.items())


def _call_rate_series() -> list[tuple[dt.date, float]]:
    """콜금리, 날짜 오름차순 (date, decimal).

    `mkt_irs_close.call_rate` 는 퍼센트이고 결측이 9건 있다(2,622행 중). 결측은
    **행을 빼는 것**으로 처리한다 — 그 자리는 직전 관측이 계단으로 덮는다.
    """
    from . import mysqldb

    rows = mysqldb.read_sql(
        "SELECT irs_date, call_rate FROM mkt_irs_close "
        "WHERE call_rate IS NOT NULL AND call_rate > 0 ORDER BY irs_date ASC"
    )
    if not rows:
        raise FundingError("콜금리 시계열이 비어 있습니다 (mkt_irs_close.call_rate).")
    out: list[tuple[dt.date, float]] = []
    for r in rows:
        d = r[0]
        if isinstance(d, dt.datetime):
            d = d.date()
        out.append((d, float(r[1]) / 100.0))
    return out


_series_cache: dict[str, list[tuple[dt.date, float]]] = {}


def series_for(basis: str) -> list[tuple[dt.date, float]]:
    if basis not in _series_cache:
        _series_cache[basis] = (
            _base_rate_series() if basis == "base" else _call_rate_series()
        )
        s = _series_cache[basis]
        log.info("funding[%s]: %d점 %s .. %s", basis, len(s), s[0][0], s[-1][0])
    return _series_cache[basis]


def reset_cache() -> None:
    _series_cache.clear()
    _ladder_cache.clear()


def rate_on(spec: FundingSpec, d: dt.date) -> float:
    """그날의 조달금리(decimal). 커버리지 밖은 가장 가까운 끝값."""
    s = series_for(spec.basis)
    i = bisect_right([x for x, _ in s], d) - 1
    base = s[0][1] if i < 0 else s[i][1]
    return base + spec.spread_bp / 10000.0


# ── 누적 조달 ───────────────────────────────────────────────────────────────

_ladder_cache: dict[tuple[str, float], tuple[list[dt.date], list[float]]] = {}


def _ladder(spec: FundingSpec) -> tuple[list[dt.date], list[float]]:
    """(계단 시작일들, 그 시작일까지의 누적 이자율) — 원금 1 기준.

    `cum[k]` = `dates[0]` 부터 `dates[k]` 까지 원금 1을 굴렸을 때 붙은 이자.
    임의의 두 날 사이는 이 배열 두 점의 차 + 양 끝 조각으로 O(log n) 이다.
    """
    key = (spec.basis, spec.spread_bp)
    if key in _ladder_cache:
        return _ladder_cache[key]

    s = series_for(spec.basis)
    sp = spec.spread_bp / 10000.0
    dates = [d for d, _ in s]
    cum = [0.0]
    for (d0, r0), (d1, _r1) in zip(s, s[1:]):
        cum.append(cum[-1] + (r0 + sp) * (d1 - d0).days / 365.0)
    _ladder_cache[key] = (dates, cum)
    return dates, cum


def _accrued_to(spec: FundingSpec, d: dt.date) -> float:
    """계단 시작점부터 `d` 까지 원금 1에 붙은 이자. 커버리지 밖은 끝값 연장."""
    dates, cum = _ladder(spec)
    sp = spec.spread_bp / 10000.0
    s = series_for(spec.basis)
    if d <= dates[0]:
        # 시계열 이전 — 최초 관측값을 뒤로 평탄 연장 (음수 방향)
        return -(s[0][1] + sp) * (dates[0] - d).days / 365.0
    i = bisect_right(dates, d) - 1
    return cum[i] + (s[i][1] + sp) * (d - dates[i]).days / 365.0


def cost_between(spec: FundingSpec, d0: dt.date, d1: dt.date, principal: float) -> float:
    """`d0` 부터 `d1` 까지 `principal` 을 조달한 **비용(양수)**.

    호출자가 손익에서 빼는 값이므로 부호는 여기서 뒤집지 않는다 — 화면의
    `조달비용` 줄이 음수로 보이는 것은 그쪽에서 한 번만 부호를 준다.
    """
    if d1 <= d0:
        return 0.0
    return principal * (_accrued_to(spec, d1) - _accrued_to(spec, d0))


def provenance(spec: FundingSpec) -> dict:
    """화면이 "이 숫자가 어디서 왔는가" 를 말할 수 있게 하는 것."""
    s = series_for(spec.basis)
    return {
        "basis": spec.basis,
        "basisLabel": BASIS_LABEL[spec.basis],
        "spreadBp": spec.spread_bp,
        "label": spec.label,
        "from": s[0][0].isoformat(),
        "to": s[-1][0].isoformat(),
        "latest": round((s[-1][1] + spec.spread_bp / 10000.0) * 100, 4),
    }
