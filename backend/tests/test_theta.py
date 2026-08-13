"""테너별 세타 — 정의가 스스로 닫히는지, 그리고 화면이 읽을 모양인지.

세타는 눈으로 검산할 수 없는 숫자다(캐리와 롤다운이 서로 다른 단위에서
와서 원으로 합쳐진다). 그래서 여기서 잡는 것은 값이 아니라 **관계**다 —
관계가 성립하면 값은 커브가 정한다.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.curves import TENOR_T, par_rates_at
from app.dataset import load_dataset
from app.dv01 import pv01
from app.engine_port import bootstrap_zero_curve
from app.theta import (
    BP,
    CD_TENOR,
    HORIZON_Y,
    NOTIONAL,
    THETA_TENORS,
    theta_for,
    theta_table,
)


DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def dataset():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def table(dataset):
    return theta_table(dataset)


def test_basis_states_what_the_column_means(table):
    _, meta = table
    # 화면이 "3개월 · 페이 기준"이라고 적을 수 있어야 한다. 이 셋이 없으면
    # 열은 출처 없는 숫자가 된다.
    assert meta["horizonMonths"] == 3
    assert meta["side"] == "pay"
    assert meta["notional"] == 10_000_000_000
    assert meta["cd"] is not None and 0 < meta["cd"] < 20


def test_every_swap_tenor_gets_one(table, dataset):
    rows, _ = table
    quoted = {t for t, _ in par_rates_at(dataset, dataset.asof)}
    expected = {
        t for t in THETA_TENORS
        if TENOR_T[t] in quoted and TENOR_T[t] - HORIZON_Y >= 0.25 - 1e-9
    }
    assert set(rows) == expected
    assert len(rows) >= 10, "커브 대부분이 비면 열이 있으나 마나다"


def test_the_short_end_is_not_a_swap(table):
    rows, _ = table
    # 1D(콜)·3M(CD)은 스왑의 다리가 아니라 커브의 짧은 끝이다.
    assert "1D" not in rows and "3M" not in rows


def test_carry_plus_roll_is_the_whole_thing(table):
    """세타 = 캐리 + 롤다운. 다른 몫이 숨어 있으면 여기서 갈라진다."""
    rows, _ = table
    for tenor, v in rows.items():
        assert v["cash"] == pytest.approx(v["carry"] + v["roll"], abs=1.0), tenor


def test_per_dv01_is_the_cash_divided_by_the_risk(table):
    """열의 정의 그 자체 — 100억 세타 ÷ (그 100억의 DV01 ÷ 백만)."""
    rows, _ = table
    for tenor, v in rows.items():
        assert v["perDv01"] == pytest.approx(
            v["cash"] / (v["dv01"] / 1_000_000), rel=1e-6
        ), tenor


def test_per_dv01_does_not_depend_on_notional(dataset):
    """정규화가 실제로 노셔널을 지웠는지. 지워지지 않았다면 이 열은 100억
    열의 사본일 뿐이고, 테너 비교라는 목적이 통째로 무너진다."""
    zc = bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))
    cd = dict(par_rates_at(dataset, dataset.asof))[TENOR_T[CD_TENOR]]
    import app.theta as theta_mod

    base = theta_for(zc, 5.0, cd)["perDv01"]
    original = theta_mod.NOTIONAL
    try:
        theta_mod.NOTIONAL = original * 7
        assert theta_for(zc, 5.0, cd)["perDv01"] == pytest.approx(base, rel=1e-9)
    finally:
        theta_mod.NOTIONAL = original


def test_breakeven_is_the_move_that_cancels_the_theta(table, dataset):
    """`beBp` 는 (T−h) 금리가 몇 bp 올라야 페이의 세타가 상쇄되는가다.
    그 bp 를 호라이즌 연금에 곱하면 세타가 부호만 뒤집혀 돌아와야 한다."""
    rows, _ = table
    zc = bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))
    for tenor, v in rows.items():
        a_h = pv01(zc, TENOR_T[tenor] - HORIZON_Y)
        assert v["beBp"] * a_h * NOTIONAL * BP == pytest.approx(
            -v["cash"], rel=2e-3
        ), tenor


def test_an_upward_curve_makes_the_payer_bleed(table):
    """지금 원화 커브는 우상향이고 CD 가 전 구간 아래에 있다. 그러면 페이는
    캐리도 롤다운도 마이너스여야 한다 — 이 부호가 뒤집혀 있으면 화면의
    '역캐리'가 반대편을 가리킨다. (커브가 역전되면 이 테스트는 정당하게
    바뀐다. 그때 바꿔야 할 것은 화면 문구지 부호 규약이 아니다.)"""
    rows, _ = table
    assert all(v["cash"] < 0 for v in rows.values()), {
        t: v["cash"] for t, v in rows.items() if v["cash"] >= 0
    }
    assert all(v["entry"] > v["rollIn"] for v in rows.values()), "우상향 전제"


def test_risk_per_unit_is_steepest_at_the_front(table):
    """이 열이 존재하는 이유 — 100억 기준과 순위가 뒤집힌다. 우상향 커브에서
    리스크당 세타는 앞단이 크고, 100억당 세타는 뒤가 크다. 둘이 같은 방향으로
    정렬돼 있으면 정규화가 아무 일도 하지 않은 것이다."""
    rows, _ = table
    order = [t for t in THETA_TENORS if t in rows]
    front, back = rows[order[2]], rows[order[-1]]  # 1Y vs 10Y
    assert abs(front["perDv01"]) > abs(back["perDv01"]) * 3
    assert abs(front["cash"]) < abs(back["cash"])


def test_no_cd_means_no_column(dataset):
    """CD 가 없으면 캐리를 지어낼 수 없다. 절반만 맞는 숫자를 내느니 전부
    비운다 — 없는 것은 화면에 보여야 한다."""
    import copy

    ds = copy.copy(dataset)
    ds.series = dict(dataset.series)
    ds.series[CD_TENOR] = [None] * len(dataset.dates)
    rows, meta = theta_table(ds)
    assert rows == {}
    assert meta["cd"] is None


def test_the_payload_carries_it(dataset):
    """행에 붙는 자리와 이름 — 화면이 읽는 그 모양."""
    from app.derive import basis_dates
    from app.payloads import wall_summary

    body = wall_summary(dataset, basis_dates(dataset), [], {}, [])
    assert body["thetaBasis"]["side"] == "pay"
    by_id = {o["id"]: o for o in body["outrights"]}
    assert by_id["5Y"]["theta"]["perDv01"] != 0
    assert by_id["1D"]["theta"] is None
    # 스프레드·플라이에는 붙지 않는다 (DV01 중립이라 나눌 리스크가 없다)
    assert all("theta" not in d or d["theta"] is None for d in body["derived"])


def test_a_flat_curve_leaves_only_carry():
    """롤다운은 기울기의 것이다 — 평평한 커브에서는 0 이어야 한다. 커브
    없이도 성립하는 관계라 합성 커브로 잡는다."""
    par = [(t, 0.03) for t in (0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 7.0, 10.0)]
    zc = bootstrap_zero_curve(par)
    v = theta_for(zc, 5.0, 0.03)
    assert v["roll"] == pytest.approx(0.0, abs=NOTIONAL * 1e-6)
    assert v["carry"] == pytest.approx(0.0, abs=NOTIONAL * 1e-6)
    assert np.isfinite(v["perDv01"])
