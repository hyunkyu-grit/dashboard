"""조달금리 — Setting 탭이 정하는 값 [OWNER, 2026-08-14].

현금채권은 원금을 조달해서 산다. 그 비용을 빼지 않은 채권 손익은 쿠폰을 공짜로
번 것처럼 보이므로, Cash Bond 백테스트는 손익을 넷으로 쪼갤 때 **조달비용을
독립된 한 줄로** 뺀다 [OWNER — 4분해].

## 규약 [OWNER, 2026-08-14]

조달금리 = **기준 시계열 + 스프레드(bp)**, 그날그날의 계단이다. 전 기간 고정
상수가 아니다 — 2020년 구간을 백테스트하면 그 시점의 0.50% 로 조달해야 한다.
기준은 둘 중 하나를 화면에서 고른다:

    base   한국은행 기준금리   SQL `infomax.기준금리`  (아래 V2 주석 참조)
    call   콜금리              SQL `mkt_irs_close.call_rate`  2016-01-04 ~ 현재

커버리지 **밖**에서는 가장 가까운 끝값을 평탄 연장한다 — 단, 그 연장이 사실인
것은 **시계열이 살아 있을 때뿐**이다. "끝에서 평탄" 은 "그 뒤로 결정이 없었다"
는 주장인데, 죽은 피드에서는 그 주장을 할 수 없다. 그래서 base 에는 신선도
게이트가 있다(아래).

## V2 — 기준 시계열의 출처가 v1 과 다르다 [OWNER 2026-08-18 — "v2 데이터 소스는 SQL만"]

v1 은 base 를 `data/bokbaserate.xlsx` 에서 읽었다. v2 는 엑셀 보조 경로를
이식하지 않으므로 SQL 후보 `infomax.기준금리`(일자·한국·미국, 퍼센트)를 쓴다.
검증 실측 (2026-08-18):

    값 대사   v1 xlsx 와 겹치는 3,733일 **전건 일치** (오차 0)
    기간      2012-12-31 시작 — 민평(2020-01-02)을 완전히 덮는다
    최신성    **실패.** 테이블이 2026-03-21 에 멈췄고, 그 뒤의 금리 결정
              (2026-07-16 인상 2.50→2.75%)이 빠져 있다. 평탄 연장하면
              그 뒤 구간의 조달이 25bp 낮게 잡힌다 — 화면 어디에도 안 보이는
              방식으로.

그래서 base 는 **신선하지 않으면 실패 상태로 선다**(`_require_fresh`). 폴백은
없다 — SQL 이 못 주는 것을 xlsx 가 조용히 메우는 경로가 이 규칙이 금지하는
바로 그것이다. 테이블이 다시 적재되면 게이트는 저절로 열린다.

기본 기준도 그래서 v1(base)과 다르게 **call** 이다. 기본값이 항상 422 를
돌려주는 화면은 제품이 아니고, 콜금리는 신선하다(검증 시점 2026-08-17 까지).

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

#: 화면 기본값. v1 은 base("기준금리 + 10bp")였다 — v2 가 call 인 이유는 모듈
#: 주석의 V2 절 참조(기준금리 테이블이 멈춰 있어 base 는 실패 상태다).
DEFAULT_BASIS = "call"
DEFAULT_SPREAD_BP = 10.0

BASIS_LABEL = {"base": "기준금리", "call": "콜금리"}

#: base 시계열이 이보다 낡으면 실패 상태다. 기준금리 테이블은 달력일마다 한
#: 행이므로, 영업일 10일 넘게 새 행이 없다는 것은 적재가 멈췄다는 뜻이다 —
#: 그 사이 금통위가 지나갔을 수 있고, 놓친 결정은 화면에 안 보인다.
STALE_BUSINESS_DAYS = 10


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


def _business_age(last: dt.date) -> int:
    """`last` 이후 오늘까지의 영업일 수 — universe._age 와 같은 셈."""
    n, cur = 0, last
    today = dt.date.today()
    while cur < today:
        cur += dt.timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def _require_fresh(last: dt.date) -> None:
    age = _business_age(last)
    if age > STALE_BUSINESS_DAYS:
        raise FundingError(
            f"기준금리 테이블(infomax.기준금리)이 {last.isoformat()} 에 멈춰 있습니다"
            f" (영업일 {age}일 경과). 멈춘 계단을 평탄 연장하면 그 뒤의 금리 결정을"
            f" 놓칩니다 (실측: 2026-07-16 인상 2.50→2.75% 가 이 테이블에 없다) —"
            f" 조달 기준을 콜금리로 바꾸거나 테이블을 갱신하세요."
        )


def _base_rate_series() -> list[tuple[dt.date, float]]:
    """한국은행 기준금리, 날짜 오름차순 (date, decimal) — SQL `infomax.기준금리`.

    `한국` 열은 퍼센트다(2.5 = 2.5%). 검증과 신선도 게이트는 모듈 주석의 V2 절.
    """
    from . import mysqldb

    rows = mysqldb.read_sql(
        "SELECT 일자, 한국 FROM infomax.기준금리 "
        "WHERE 한국 IS NOT NULL ORDER BY 일자 ASC"
    )
    if not rows:
        raise FundingError("기준금리 시계열이 비어 있습니다 (infomax.기준금리).")
    out: list[tuple[dt.date, float]] = []
    for r in rows:
        d = r[0]
        if isinstance(d, dt.datetime):
            d = d.date()
        out.append((d, float(r[1]) / 100.0))
    _require_fresh(out[-1][0])
    return out


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
