"""민평 커브 — SQL `credit_matrix` [OWNER, 2026-08-14].

`mysqldb.py` 가 IRS 종가에 대해 한 일을 채권 시가평가(민평)에 대해 한다. 같은
`sim_portfolio` 스키마의 `credit_matrix` 테이블이 원천이고, **읽기 전용**이다 —
질의는 전부 `mysqldb.read_sql()` 을 지나므로 SELECT 가 아닌 문장은 낼 수 없다.

## 왜 엑셀 로더(`irs_pricer/loaders/credit_matrix.py`)를 안 쓰나

그 로더는 `Credit Matrix Data.xlsx` 를 읽는데 **이 리포의 `data/` 에 그 파일이
없다**(2026-08-14 확인: bokbaserate.xlsx · irsdata.xlsx · AS_data.zip 뿐).
즉 그 경로는 이 배포에서 죽은 코드다. 오너가 SQL 을 지목한 이유가 그것이고,
이 모듈이 살아있는 유일한 민평 출처다. 엑셀 로더는 건드리지 않는다 —
시뮬레이션 레인이 아직 import 하고 있고, 그쪽 폴더가 채워지면 다시 산다.

## 0 은 금리가 아니라 결측이다

이 테이블은 **없는 값을 0.0 으로 채운다**(NULL 이 아니라). 실측(2026-08-14,
1,624 영업일):

    30Y   국고채·공사채만 존재. 나머지 6종은 1,624일 전부 0
    MSB   5Y 이상 전부 0, 30M·3Y 는 424일이 0 (통안채가 그 만기까지 없던 날)

0 을 금리로 읽으면 통안채 10년이 0% 로 그려지고 보간이 커브 전체를 끌어내린다.
이 모듈은 파싱 시점에 0 을 `None` 으로 바꾸고, 그 뒤로는 0 이 존재하지 않는다.

## 캐시 키

`mysqldb.watermark()` 와 같은 이유로 (MAX(bas_dt), COUNT(*)) 를 키로 쓴다.
CLAUDE.md 가 SQL 이동에서 못 박은 규칙 — 바이트가 없으니 워터마크가 그 자리를
대신한다. 이 테이블 역시 `updated_at` 이 없어 **과거 행의 조용한 수정은 못
잡는다**(mysqldb.watermark 의 같은 한계). 사실만 적어 둔다. [미해결]
"""

from __future__ import annotations

import datetime as dt
import logging
from bisect import bisect_right
from dataclasses import dataclass

from . import mysqldb

log = logging.getLogger("app.creditmatrix")

TABLE = "credit_matrix"


class CreditMatrixError(RuntimeError):
    """민평 데이터를 쓸 수 없다 — 종목군/테너가 없거나 그날 값이 없다."""


# ── 유니버스 ────────────────────────────────────────────────────────────────
# [OWNER, 2026-08-14] 화면에 필요한 여덟 종목. SQL 의 `bond_type` 코드는
# 자명하지 않아서 값으로 확인했다 — 2026-08-13 3Y 민평이 국고 3.777 < 통안
# 3.820 < 산금 4.007 < 공사 4.090 < 은행 4.099 < 회사AAA 4.275 < 카드 4.339
# < 캐피탈 4.495 로, 관행 신용 사다리 순서가 코드 배정을 강제한다.
#
# CB2~CB5(AA+ ~ A 급 회사채)는 테이블에 있지만 이 화면의 유니버스가 아니다.
# 나중에 필요하면 여기 한 줄씩이다.
BOND_TYPES: dict[str, str] = {
    "KTB": "국고채",
    "MSB": "통안채",
    "KDB": "산금채 AAA",
    "SPB": "공사채 AAA",
    "BD": "은행채 AAA",
    "CB1": "회사채 AAA",
    "CARD": "카드채 AA+",
    "OFB": "캐피탈채 AA-",
}

#: 표에 뜨는 순서 = 신용 사다리 순 (국고가 맨 위).
TYPE_ORDER: list[str] = list(BOND_TYPES)

# ── 테너 격자 ───────────────────────────────────────────────────────────────
# (컬럼, 라벨, 년수). **라벨은 이 리포의 테너 어휘를 따른다** — SQL 은 18m/30m
# 이라 부르지만 여기서는 1.5Y/2.5Y 다. 자산스왑이 IRS 노드와 문자열로 만나야
# 하고(`app/curves.py:TENOR_T`), 화면에 두 벌의 이름이 도는 것이 이 리포에서
# 반복된 결함이기 때문이다.
TENOR_COLS: list[tuple[str, str, float]] = [
    ("rt_3m", "3M", 0.25),
    ("rt_6m", "6M", 0.5),
    ("rt_9m", "9M", 0.75),
    ("rt_1y", "1Y", 1.0),
    ("rt_18m", "1.5Y", 1.5),
    ("rt_2y", "2Y", 2.0),
    ("rt_30m", "2.5Y", 2.5),
    ("rt_3y", "3Y", 3.0),
    ("rt_5y", "5Y", 5.0),
    ("rt_7y", "7Y", 7.0),
    ("rt_10y", "10Y", 10.0),
    ("rt_20y", "20Y", 20.0),
    ("rt_30y", "30Y", 30.0),
]

TENOR_LABELS: list[str] = [label for _c, label, _y in TENOR_COLS]
TENOR_YEARS: dict[str, float] = {label: y for _c, label, y in TENOR_COLS}

#: 한 테너를 "그 종목군이 실제로 가진 것" 으로 인정하는 최소 관측 비율. 통안채
#: 30M·3Y 는 1,624일 중 1,200일(74%)만 있고 그건 진짜 커브다 — 반면 5Y 이상은
#: 0일이라 아예 없다. 문턱을 절반에 두면 그 둘이 갈린다.
_COVERAGE_FLOOR = 0.5


@dataclass(frozen=True)
class CreditMatrix:
    """`credit_matrix` 전량, 날짜 오름차순.

    `values[(bond_type, tenor_label)]` 는 `dates` 와 길이가 같고 자리가 맞는
    `list[float | None]` 이다 — 결측(및 0)은 None. 이 모양인 이유는
    `app/derive.py:annual_stats` 같은 기존 요약기가 정확히 그 모양을 먹기
    때문이다.

    금리 단위는 **퍼센트**다 (3.777 = 3.777%). IRS 쪽 `Dataset.series` 와 같은
    규약이라 두 표가 같은 포매터를 쓴다. 소수로 필요한 곳(할인)에서만 /100 한다.
    """

    dates: list[dt.date]
    values: dict[tuple[str, str], list[float | None]]
    watermark: tuple[str, int]

    @property
    def asof(self) -> dt.date:
        return self.dates[-1]

    def series(self, bond_type: str, tenor: str) -> list[float | None]:
        v = self.values.get((bond_type, tenor))
        if v is None:
            raise CreditMatrixError(f"민평 계열이 없습니다: {bond_type} {tenor}")
        return v

    def has(self, bond_type: str, tenor: str) -> bool:
        return (bond_type, tenor) in self.values

    def tenors_for(self, bond_type: str) -> list[str]:
        """그 종목군이 실제로 가진 테너, 짧은 것부터."""
        return [t for t in TENOR_LABELS if (bond_type, t) in self.values]


def rate_or_none(v: object) -> float | None:
    """SQL 값 하나를 금리로 읽는다 — **0 은 결측이다**(모듈 주석).

    한 줄짜리라 함수로 뽑을 일이 없어 보이지만, 이 리포에서 0 을 금리로 읽는
    것이 가장 비싼 실수라 규칙에 이름과 핀을 준다. `_fetch` 는 SQL 이 있어야
    돌아서 게이트가 못 만지고, 이 함수는 만질 수 있다.
    """
    if v is None or v == 0:
        return None
    return float(v)


def _fetch() -> CreditMatrix:
    cols = ", ".join(col for col, _l, _y in TENOR_COLS)
    rows = mysqldb.read_sql(
        f"SELECT bas_dt, bond_type, {cols} FROM {TABLE} "
        f"WHERE bond_type IN ({', '.join(repr(t) for t in TYPE_ORDER)}) "
        f"ORDER BY bas_dt ASC"
    )
    if not rows:
        raise CreditMatrixError(f"{TABLE} 에서 행을 읽지 못했습니다.")

    dates: list[dt.date] = []
    seen: set[dt.date] = set()
    # (type, tenor) -> {date: rate}
    grid: dict[tuple[str, str], dict[dt.date, float]] = {}
    for r in rows:
        m = r._mapping
        d = m["bas_dt"]
        if isinstance(d, dt.datetime):
            d = d.date()
        if d not in seen:
            seen.add(d)
            dates.append(d)
        bt = m["bond_type"]
        for col, label, _y in TENOR_COLS:
            # 0 은 결측이다 — 모듈 독스트링 참조. 여기서 한 번 걸러내고 나면
            # 이 아래로 0 은 존재하지 않는다.
            v = rate_or_none(m[col])
            if v is None:
                continue
            grid.setdefault((bt, label), {})[d] = v

    n = len(dates)
    floor = n * _COVERAGE_FLOOR
    values: dict[tuple[str, str], list[float | None]] = {}
    dropped: list[str] = []
    for key, by_date in grid.items():
        if len(by_date) < floor:
            dropped.append(f"{key[0]} {key[1]} ({len(by_date)}/{n})")
            continue
        values[key] = [by_date.get(d) for d in dates]

    if dropped:
        log.info("credit_matrix: 관측이 얇아 제외한 계열 %d개 — %s", len(dropped), ", ".join(sorted(dropped)))
    log.info("credit_matrix: %d일 × %d계열 (%s .. %s)", n, len(values), dates[0], dates[-1])
    return CreditMatrix(dates=dates, values=values, watermark=watermark())


def watermark() -> tuple[str, int]:
    """(마지막 날짜, 행 수) — 캐시 키. `mysqldb.watermark()` 와 같은 규약."""
    row = mysqldb.read_sql(f"SELECT MAX(bas_dt) AS d, COUNT(*) AS n FROM {TABLE}")[0]
    return (str(row.d), int(row.n))


_cached: CreditMatrix | None = None


def load() -> CreditMatrix:
    """전량, 워터마크가 그대로면 재사용.

    19,488행 × 13열이라 전량이 몇 MB다. 페이지네이션은 커브 조회를 여러 왕복으로
    갈라 놓기만 한다 — `mysqldb.irs_close_rows()` 가 같은 판단을 했다.
    """
    global _cached
    wm = watermark()
    if _cached is None or _cached.watermark != wm:
        _cached = _fetch()
    return _cached


def reset_cache() -> None:
    """데이터 갱신 훅과 테스트용."""
    global _cached
    _cached = None


# ── 커브 조회 ───────────────────────────────────────────────────────────────


def index_on_or_before(dates: list[dt.date], d: dt.date) -> int:
    """`d` 이하의 마지막 자리. 없으면 -1."""
    return bisect_right(dates, d) - 1


def curve_points(cm: CreditMatrix, bond_type: str, i: int) -> list[tuple[float, float]]:
    """그 날짜 자리의 커브를 [(년수, decimal rate), ...] 로, 짧은 것부터.

    **그날 값이 없는 테너는 직전 관측으로 메우지 않고 뺀다.** 통안채 30M 처럼
    "그날은 그 만기가 없었다" 가 진짜 사실인 계열이 있고, 옛 값을 끌어오면
    없던 만기가 있었던 것처럼 보간에 참여한다.
    """
    out: list[tuple[float, float]] = []
    for label in TENOR_LABELS:
        v = cm.values.get((bond_type, label))
        if v is None:
            continue
        x = v[i]
        if x is not None:
            out.append((TENOR_YEARS[label], x / 100.0))
    return out


def interp(points: list[tuple[float, float]], years: float) -> float:
    """정렬된 (년수, 값)에서 선형보간, 양 끝은 평탄 외삽.

    `irs_pricer/services/credit_curve_service.py:_interp` 와 같은 규칙이다 —
    민평은 par 호가의 격자이고 그 사이를 잇는 시장 관행이 직선이다.
    """
    if not points:
        raise CreditMatrixError("민평 커브에 점이 없습니다.")
    if years <= points[0][0]:
        return points[0][1]
    if years >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= years <= x1:
            if x1 == x0:
                return y0
            return y0 + (years - x0) / (x1 - x0) * (y1 - y0)
    return points[-1][1]


def yield_at(cm: CreditMatrix, bond_type: str, i: int, years: float) -> float:
    """그 날짜 자리 · 그 잔존만기의 민평 수익률(decimal)."""
    return interp(curve_points(cm, bond_type, i), years)
