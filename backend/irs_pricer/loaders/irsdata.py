"""Market data from this repo's own `data/irsdata.xlsx` [OWNER, 2026-08-07].

WHY THIS EXISTS. The simulation arrived reading `True Data.xlsx` — one of five
workbooks totalling 50 MB, none of them tracked. Once positions became
hand-entered, four of the five stopped mattering (measured: a swap-only run is
byte-identical with all five present and with True Data alone, and the funding
workbooks contribute exactly 0 because there are no bonds to fund). The owner's
ruling is that the fifth goes too: this monitor already keeps one IRS workbook,
tracked in git at 776 KB, and the simulation should read that one.

WHAT CHANGES, STATED PLAINLY. The two workbooks are DIFFERENT INFOMAX SERIES,
not two copies of one:

    irsdata.xlsx    원화 IRS 종합코드
    True Data.xlsx  IRS KRW (QR VS QR 91D CD91)

Both are MID종가, and on 2026-07-16 they disagree — 6M +1.25bp, 1Y +1.25bp,
3Y +3.5bp, 10Y +3.75bp, widening with tenor. Every priced number moves by
roughly that much. This is a deliberate change of input, not a bug to hunt: the
owner chose the series after the difference was measured and put in front of
them. What it is NOT is a silent drift, which is why it is written here.

Three things this source does not have, and one it has that the old one did not:

  - NO LONG END. Quotes stop at 10Y; True Data ran to 30Y. A swap maturing past
    10Y cannot be bootstrapped from this file, so the tenor picker stops at 10Y
    (frontend: sim/lib/manual-position.ts::TENORS).
  - SHORTER CD HISTORY. Fixings start 2016-01-04 (2,616 dates) against True
    Data's 2010-03-11 (4,047). A swap that started before 2016 has no fixing for
    its current period; swap_inputs.py leaves currentFloatRate unresolved and
    says so in the log rather than inventing one.
  - NO 11Y/12Y/25Y/30Y pillars, and 1.5Y is labelled 1.5Y where True Data said
    18M. Same instrument, and both map onto RateQuote(tenor_years=2,
    tenor_months=18).
  - IT HAS THE CALL RATE. `on_rate` was always None from True Data (see
    MarketSnapshot's own comment); the 1D column supplies it here, so the curve
    gets an O/N pillar it did not have before.

ONE PARSER, ONE TRUTH. This module does not open the workbook itself — it calls
`app.dataset.load_dataset`, the parser this repo already trusts for the monitor,
and which owns the sheet geometry, the DataFileError validation (duplicate or
out-of-order dates, implausible values) and the Seoul-timezone as-of rule. A
second parser over the same bytes is a second set of answers.

The import direction is worth a word: `app` imports `irs_pricer` (app/main.py
registers its routers), and here `irs_pricer` imports `app.dataset`. That is not
a cycle — `app.dataset` imports nothing from `irs_pricer` — but it is the reason
the import sits inside the function rather than at module scope, where it would
run during `app.main`'s own import.
"""

from __future__ import annotations

import logging
from datetime import date
from functools import lru_cache
from pathlib import Path

from ..core.errors import NonBusinessDayError
from ..core.market_data import MarketSnapshot, RateQuote

logger = logging.getLogger(__name__)

IRSDATA_FILE = "irsdata.xlsx"

# 이 워크북의 노드 → RateQuote. 3M은 여기 없다 — CD 91d 픽싱이지 스왑 par 호가가
# 아니고, cd_rate로 따로 실린다. 1D도 없다 — on_rate다.
#
# (tenor_years, tenor_months): tenor_months는 1년 미만/분수 테너에만 붙는다.
# 1.5Y는 True Data가 18M이라 부르던 것과 같은 핀이고, 값도 같은 자리에 간다.
_NODE_QUOTES: list[tuple[str, int, int | None]] = [
    ("6M", 1, 6),
    ("9M", 1, 9),
    ("1Y", 1, None),
    ("1.5Y", 2, 18),
    ("2Y", 2, None),
    ("3Y", 3, None),
    ("4Y", 4, None),
    ("5Y", 5, None),
    ("6Y", 6, None),
    ("7Y", 7, None),
    ("8Y", 8, None),
    ("9Y", 9, None),
    ("10Y", 10, None),
]

_CD_NODE = "3M"  # CD 91d — dataset.py:121 "IRS 3M = CD91"
_ON_NODE = "1D"  # 콜금리


#: [OWNER, 2026-08-25 — 시뮬 스냅샷 SQL 이관 · 감사록 F2] app 계층이 기동 시
#: 주입하는 병합 데이터셋 — app/main.py 의 `_dataset`(load_dataset_merged,
#: SQL 우선 + 엑셀 보충) **그 인스턴스**다. 있으면 아래 세 함수가 워크북 대신
#: 이것을 읽는다: 시뮬의 DATA_DIR 워크북 복사가 멈춰(실측 08-19에서 정지)
#: 스왑이 «당일 IRS 호가 없음»으로 통째로 제외되던 병의 근본 수정이고,
#: 백테스트와 시뮬이 **같은 데이터 한 벌**을 보게 된다. None(기본 — 테스트·
#: 스크립트)은 종전 워크북 경로 그대로라 골든이 결정적으로 남는다(bond_roll
#: 공급자와 같은 규율 — conftest 가 매 테스트 앞에서 내린다).
_injected_dataset = None


def set_dataset(ds) -> None:
    """app 기동 훅. None 으로 되돌리면 워크북 경로다."""
    global _injected_dataset
    _injected_dataset = ds


def _active(source: Path):
    """주입본이 있으면 그것, 없으면 워크북. 주입본이 곧 신선도다 — app 이
    기동 때 한 번 SQL 을 읽는 이 리포의 모델(07:00 재기동) 그대로."""
    return _injected_dataset if _injected_dataset is not None else _load(source)


def _workbook(source: Path) -> Path:
    return source / IRSDATA_FILE if source.is_dir() else source


@lru_cache(maxsize=4)
def _dataset(path_str: str, mtime: float):
    """파싱된 워크북. mtime이 캐시 키에 들어 있어 파일을 덮어쓰면 자동으로
    다시 읽는다 — 서버를 재시작하지 않아도 된다. lru_cache인 이유는 이 파서가
    2,616일 × 15노드를 훑어 한 번에 수 초가 걸리고, 한 요청 안에서도 스냅샷과
    픽싱과 날짜목록이 각각 부른다."""
    from app.dataset import load_dataset  # 함수 안에서 — 모듈 주석 참고

    return load_dataset(Path(path_str))


def _load(source: Path):
    wb = _workbook(source)
    if not wb.exists():
        raise FileNotFoundError(f"시장 데이터 워크북을 찾을 수 없습니다: {wb}")
    return _dataset(str(wb), wb.stat().st_mtime)


def _row(ds, valuation_date: date) -> dict[str, float]:
    """그 날짜의 노드별 값(퍼센트). 없는 날이면 NonBusinessDayError.

    `dates`가 오름차순이라는 것은 load_dataset이 보장한다(어긋나면 거기서
    DataFileError로 죽는다). 그래서 여기서 정렬을 다시 확인하지 않는다."""
    try:
        idx = ds.dates.index(valuation_date)
    except ValueError:
        # NonBusinessDayError takes (date, reason) — the class builds the
        # sentence. A bare-message call here raised TypeError INSIDE the raise,
        # which aborted the simulate stream instead of becoming the clean 422
        # this path exists to produce (measured 2026-08-19, backend.log).
        raise NonBusinessDayError(
            valuation_date, "영업일이 아니거나 워크북에 없는 날짜"
        ) from None
    out: dict[str, float] = {}
    for node, series in ds.series.items():
        v = series[idx]
        if v is not None:
            out[node] = v
    return out


def load_market_snapshot_irsdata(source: Path, valuation_date: date) -> MarketSnapshot:
    ds = _active(source)
    row = _row(ds, valuation_date)

    if _CD_NODE not in row:
        # CD가 없으면 변동 다리의 기준이 없다. 조용한 0으로 가격하면 스왑이
        # 통째로 틀린 채 숫자만 그럴듯하게 나온다.
        raise NonBusinessDayError(valuation_date, "CD 91d(3M) 호가 없음")

    quotes = [
        RateQuote(tenor_years=ty, rate=row[node] / 100.0, tenor_months=tm)
        for node, ty, tm in _NODE_QUOTES
        if node in row
    ]
    if not quotes:
        raise NonBusinessDayError(valuation_date, "IRS par 호가가 하나도 없음")

    on = row.get(_ON_NODE)
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=row[_CD_NODE] / 100.0,
        swap_quotes=quotes,
        # None은 "O/N 핀 없음"이지 "O/N이 0"이 아니다 (MarketSnapshot 주석).
        on_rate=None if on is None else on / 100.0,
    )


def load_fixing_history_irsdata(source: Path) -> dict[date, float]:
    """CD 91d 픽싱 이력 {날짜: 소수}. 빈 칸은 담지 않는다 — 0으로 채우면
    select_fixing이 그날을 유효한 0% 리셋으로 읽는다."""
    ds = _active(source)
    series = ds.series.get(_CD_NODE)
    if series is None:
        raise FileNotFoundError(f"{_workbook(source)}에 CD 91d(3M) 열이 없습니다.")
    return {d: v / 100.0 for d, v in zip(ds.dates, series) if v is not None}


def common_dates_irsdata(source: Path) -> list[date]:
    """가격이 가능한 날짜들 — CD와 par 호가가 함께 있는 날만.

    `ds.dates` 전체를 그대로 돌려주면 캘린더에는 있는데 실행하면 위의
    NonBusinessDayError로 떨어지는 날이 섞인다. 고를 수 있는 날짜와 돌아가는
    날짜는 같아야 한다."""
    ds = _active(source)
    nodes = [n for n, _, _ in _NODE_QUOTES]
    out: list[date] = []
    for i, d in enumerate(ds.dates):
        if ds.series.get(_CD_NODE, [None])[i] is None:
            continue
        if any(ds.series.get(n, [None] * len(ds.dates))[i] is not None for n in nodes):
            out.append(d)
    return out
