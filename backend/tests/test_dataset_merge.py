"""병합 로더의 판정을 못 박는다 [OWNER, 2026-08-11 — 아침 자동 굽기].

오너 규칙 세 줄이 전부다:

    SQL 이 기대 전영업일을 온전히 들고 있으면 SQL 그대로.
    1D 만 비면 그 칸만 엑셀에서 채운다.
    하루가 통째로 없으면 그 하루를 엑셀에서 덧붙인다.

여기서 지키는 불변식은 두 가지다. 첫째, **과거사는 절대 엑셀로 갈아타지
않는다** — 1D 는 두 출처가 다른 계열(80.8% 불일치)이라, 폴백이 역사를 건드리면
SQL 이 뒤늦게 적재된 날 1D 차트에 유령 점프가 생긴다. 둘째, **엑셀이 섞이면
`source` 가 반드시 말한다** — 화면 칩과 manifest 가 이 값 하나를 읽는다.

`merge_expected_close` 는 순수 함수라서 DB 도 워크북도 없이 Dataset 리터럴로
전 케이스를 친다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.dataset import (
    DataFileError,
    Dataset,
    merge_expected_close,
    prev_kr_business_day,
)

MON = dt.date(2026, 8, 10)   # 월요일 — 기대 전영업일 (화요일 아침 기준)
FRI = dt.date(2026, 8, 7)    # 그 전 영업일


def ds(dates: list[dt.date], series: dict[str, list[float | None]],
       source: str) -> Dataset:
    return Dataset(
        dates=list(dates),
        series={t: list(v) for t, v in series.items()},
        tenor_order=list(series),
        source=source,
    )


def sql_two_days(d1_latest: float | None = 2.5) -> Dataset:
    return ds(
        [FRI, MON],
        {"1D": [2.49, d1_latest], "3Y": [3.30, 3.31], "10Y": [3.60, 3.62]},
        source="sql",
    )


def xlsx_two_days() -> Dataset:
    # 1D 가 SQL 과 다른 값인 것이 포인트다 — 다른 계열이라는 사실이 테스트의
    # 관찰 수단이 된다.
    return ds(
        [FRI, MON],
        {"1D": [2.60, 2.61], "3Y": [3.30, 3.31], "10Y": [3.60, 3.62]},
        source="xlsx",
    )


# ── 정상 경로: SQL 이 온전하면 손대지 않는다 ────────────────────────────────

def test_sql_complete_untouched():
    out = merge_expected_close(sql_two_days(), xlsx_two_days(), MON)
    assert out.source == "sql"
    assert out.latest("1D") == 2.5          # 엑셀 2.61 이 새어들지 않았다
    assert out.asof == MON
    assert out.warnings == []


# ── 1D 만 빈 날: 그 칸만 엑셀 [OWNER "1D는 엑셀에서 가져와서 채우는 걸로"] ──

def test_missing_1d_patched_from_xlsx():
    out = merge_expected_close(sql_two_days(d1_latest=None), xlsx_two_days(), MON)
    assert out.source == "sql+xlsx-1d"
    assert out.latest("1D") == 2.61          # asof 의 1D 만 엑셀 값
    assert out.series["1D"][0] == 2.49       # 과거사는 SQL 그대로
    assert out.latest("3Y") == 3.31          # 다른 노드는 손대지 않았다
    assert any("1D" in w for w in out.warnings)


def test_missing_1d_nowhere_stays_none():
    xl = xlsx_two_days()
    xl.series["1D"][-1] = None
    out = merge_expected_close(sql_two_days(d1_latest=None), xl, MON)
    assert out.source == "sql"               # 엑셀이 못 채웠으면 라벨도 없다
    assert out.latest("1D") is None
    assert any("엑셀에도 없다" in w for w in out.warnings)


def test_missing_1d_without_xlsx_stays_none():
    out = merge_expected_close(sql_two_days(d1_latest=None), None, MON)
    assert out.source == "sql"
    assert out.latest("1D") is None


# ── 하루가 통째로 없는 날: 그 하루만 엑셀에서 덧붙인다 ──────────────────────

def test_missing_day_appended_from_xlsx():
    sql = ds([FRI], {"1D": [2.49], "3Y": [3.30], "10Y": [3.60]}, source="sql")
    out = merge_expected_close(sql, xlsx_two_days(), MON)
    assert out.source == "sql+xlsx-day"
    assert out.asof == MON
    assert out.latest("1D") == 2.61          # 덧붙인 날은 전부 엑셀 값
    assert out.latest("3Y") == 3.31
    assert out.series["1D"][0] == 2.49       # 과거사는 SQL 그대로
    assert out.dates == [FRI, MON]           # 오름차순 유지


def test_missing_day_xlsx_lacks_a_tenor():
    # 엑셀에는 없는 노드(SQL 전용 4Y 같은 것)는 그 날 빈칸이 된다 — 값을
    # 지어내지 않는다.
    sql = ds([FRI], {"1D": [2.49], "3Y": [3.30], "4Y": [3.40]}, source="sql")
    out = merge_expected_close(sql, xlsx_two_days(), MON)
    assert out.source == "sql+xlsx-day"
    assert out.latest("4Y") is None
    assert any("4Y" in w for w in out.warnings)


def test_missing_day_xlsx_also_stale_stays_sql():
    sql = ds([FRI], {"1D": [2.49], "3Y": [3.30]}, source="sql")
    xl = ds([FRI], {"1D": [2.60], "3Y": [3.30]}, source="xlsx")
    out = merge_expected_close(sql, xl, MON)
    assert out.source == "sql"               # 덧붙일 것이 없다 — 지연 칩의 몫
    assert out.asof == FRI
    assert any("엑셀에도 없다" in w for w in out.warnings)


def test_missing_day_without_xlsx_stays_sql():
    sql = ds([FRI], {"1D": [2.49], "3Y": [3.30]}, source="sql")
    out = merge_expected_close(sql, None, MON)
    assert out.source == "sql"
    assert out.asof == FRI


# ── 비상 경로: SQL 자체를 못 읽었다 ─────────────────────────────────────────

def test_sql_down_falls_back_to_xlsx_whole():
    out = merge_expected_close(None, xlsx_two_days(), MON)
    assert out.source == "xlsx"
    assert out.latest("1D") == 2.61
    assert any("폴백" in w for w in out.warnings)


def test_both_down_raises():
    with pytest.raises(DataFileError):
        merge_expected_close(None, None, MON)


# ── 기대 전영업일 계산 ──────────────────────────────────────────────────────

def test_prev_business_day_skips_weekend():
    assert prev_kr_business_day(dt.date(2026, 8, 10)) == FRI   # 월 → 금
    assert prev_kr_business_day(dt.date(2026, 8, 11)) == MON   # 화 → 월


def test_prev_business_day_skips_holiday():
    # 광복절 2026-08-15 는 토요일 — 8/17(월)의 전영업일은 8/14(금)이고,
    # 8/14 가 대체공휴일이면 그 앞 영업일로 물러난다. 달력이 어느 쪽으로
    # 답하든 "주말도 공휴일도 아닌 날" 이라는 성질만 못 박는다.
    from app.engine_port import _is_kr_business_day

    d = prev_kr_business_day(dt.date(2026, 8, 17))
    assert _is_kr_business_day(d)
    assert d < dt.date(2026, 8, 17)
