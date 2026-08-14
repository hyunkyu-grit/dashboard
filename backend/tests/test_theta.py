"""세타 — 정의가 스스로 닫히는지, 그리고 화면이 읽을 모양인지.

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
from app.derive import derived_ids
from app.dv01 import dv01_payload, pv01
from app.engine_port import bootstrap_zero_curve
from app.theta import (
    BP,
    CD_TENOR,
    HORIZON_Y,
    NOTIONAL,
    PACKAGE_COEF,
    PACKAGE_REF,
    THETA_TENORS,
    theta_for,
    theta_for_package,
    theta_table,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"


@pytest.fixture(scope="module")
def dataset():
    return load_dataset(DATA)


@pytest.fixture(scope="module")
def table(dataset):
    return theta_table(dataset)


@pytest.fixture(scope="module")
def zc(dataset):
    return bootstrap_zero_curve(par_rates_at(dataset, dataset.asof))


@pytest.fixture(scope="module")
def cd(dataset):
    return dict(par_rates_at(dataset, dataset.asof))[TENOR_T[CD_TENOR]]


def test_basis_states_what_the_column_means(table):
    _, meta = table
    # 화면이 "하루 · 페이 기준"이라고 적을 수 있어야 한다. 이 셋이 없으면
    # 열은 출처 없는 숫자가 된다.
    #
    # 하루치다 [OWNER, 2026-08-14 — "세타 전부 다 하루치로"]. **계산 창은
    # 여전히 분기**이고 표기만 일 단위인데, 그 이유가 `theta.HORIZON_Y` 의
    # 주석에 실측으로 있다: 하루 간격으로 파 금리를 두 번 구성하면 스케줄
    # 이산화와 노드 보간이 진짜 롤보다 15배 큰 점프를 만든다. 캐리는 시간에
    # 선형이라 나누기가 정확하고, 롤은 "앞으로 한 분기의 하루 평균" 이다.
    assert meta["horizonDays"] == 1
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
    assert expected <= set(rows)
    assert len(expected) >= 10, "커브 대부분이 비면 열이 있으나 마나다"


def test_every_spread_and_fly_gets_one(table):
    """[OWNER, 2026-08-13 — "스프레드랑 버터플라이까지 부탁할게"]"""
    rows, _ = table
    packages = {sid for sid, kind, _ in derived_ids() if kind in PACKAGE_COEF}
    assert packages <= set(rows)
    assert len(packages) == 84, "28 스프레드 + 56 플라이"


def test_the_short_end_is_not_a_swap(table):
    rows, _ = table
    # 1D(콜)·3M(CD)은 스왑의 다리가 아니라 커브의 짧은 끝이다.
    assert "1D" not in rows and "3M" not in rows


def test_carry_plus_roll_is_the_whole_thing(table):
    """세타 = 캐리 + 롤다운. 다른 몫이 숨어 있으면 여기서 갈라진다."""
    rows, _ = table
    for sid, v in rows.items():
        assert v["cash"] == pytest.approx(v["carry"] + v["roll"], abs=1.0), sid


def test_per_dv01_is_the_cash_divided_by_the_risk(table):
    """열의 정의 그 자체 — 세타 ÷ (기준 다리의 DV01 ÷ 백만).

    허용치는 반올림에서 온다: 페이로드의 셋이 각각 원 단위로 따로 반올림된
    뒤에 여기서 나눗셈을 되풀이하므로 정확히 같을 수가 없다. 100원이면
    화면의 만원 표기보다 두 자리 아래다."""
    rows, _ = table
    for sid, v in rows.items():
        assert v["perDv01"] == pytest.approx(
            v["cash"] / (v["dv01"] / 1_000_000), abs=100.0
        ), sid


def test_per_dv01_does_not_depend_on_notional(zc, cd):
    """정규화가 실제로 노셔널을 지웠는지. 지워지지 않았다면 이 열은 100억
    열의 사본일 뿐이고, 테너 비교라는 목적이 통째로 무너진다."""
    import app.theta as theta_mod

    base = theta_for(zc, 5.0, cd)["perDv01"]
    pkg = theta_for_package(zc, [2.0, 5.0, 10.0], "fly", cd)["perDv01"]
    original = theta_mod.NOTIONAL
    try:
        theta_mod.NOTIONAL = original * 7
        assert theta_for(zc, 5.0, cd)["perDv01"] == pytest.approx(base, rel=1e-9)
        assert theta_for_package(zc, [2.0, 5.0, 10.0], "fly", cd)["perDv01"] == (
            pytest.approx(pkg, rel=1e-9)
        )
    finally:
        theta_mod.NOTIONAL = original


def test_breakeven_is_the_move_that_cancels_the_theta(table, zc):
    """`beBp` 는 그 종목의 **호가값**이 몇 bp 움직여야 세타가 상쇄되는가다.
    아웃라이트면 금리, 패키지면 스프레드 — 어느 쪽이든 기준 다리의 호라이즌
    연금에 곱하면 세타가 부호만 뒤집혀 돌아와야 한다."""
    rows, _ = table
    for sid, v in rows.items():
        legs = sid.split("-")
        ref = legs[PACKAGE_REF] if len(legs) > 1 else legs[0]
        a_h = pv01(zc, TENOR_T[ref] - HORIZON_Y)
        denom = a_h * NOTIONAL * BP  # 원 per bp
        # `beBp` 는 소수 둘째 자리까지 실린다 — 되돌린 금액의 오차는 그
        # 반올림(≤0.005bp)이 정한다. 상대 허용치를 쓰면 세타가 0 에 가까운
        # 플라이(2s5s10s 는 −0.30bp)에서 의미 없이 빡빡해진다.
        assert v["beBp"] * denom == pytest.approx(-v["cash"], abs=0.01 * denom), sid


# ── 패키지 ────────────────────────────────────────────────────────────────


def test_a_package_normalises_by_a_LEG_dv01_not_the_net(table, zc):
    """DV01 중립이라 **순** DV01 은 0 이다. 0 으로 나눈 값은 숫자가 아니므로
    분모는 기준 다리(긴 다리 / 벨리)의 DV01 이어야 한다 — 커브 트레이드의
    표준 리스크 단위. 분모가 순 DV01 로 바뀌면 값이 폭발하고, 이 테스트는
    분모가 그 다리의 것과 정확히 같은지를 본다."""
    rows, _ = table
    for sid, kind, legs in derived_ids():
        if kind not in PACKAGE_COEF or sid not in rows:
            continue
        ref = legs[PACKAGE_REF]
        # 페이로드의 dv01 은 원 단위로 반올림돼 실린다(≈1e6 원이라 rel 5e-7)
        assert rows[sid]["dv01"] == pytest.approx(
            pv01(zc, TENOR_T[ref]) * BP * NOTIONAL, rel=1e-5
        ), sid


def test_a_package_is_the_legs_combined_with_its_own_weights(table):
    """DV01 중립 가중 아래에서 패키지의 리스크당 세타 = 다리 값들의 같은
    계수 선형결합. 노셔널이 약분되기 때문이고, 커브 트레이드의 캐리를
    스프레드 bp 로 말하는 관행이 이 항등식의 다른 이름이다.

    이게 깨지면 가중이 DV01 중립이 아니거나 분모가 다리의 것이 아니다 —
    둘 중 무엇이든 화면의 숫자는 아무 뜻이 없어진다."""
    rows, _ = table
    checked = 0
    for sid, kind, legs in derived_ids():
        if kind not in PACKAGE_COEF or sid not in rows:
            continue
        if any(leg not in rows for leg in legs):
            continue
        expected = sum(
            coef * rows[leg]["perDv01"]
            for coef, leg in zip(PACKAGE_COEF[kind], legs)
        )
        # 다리별 반올림이 원 단위로 섞이므로 절대 허용치를 둔다
        assert rows[sid]["perDv01"] == pytest.approx(expected, abs=200.0), sid
        checked += 1
    assert checked == 84


def test_the_weights_are_the_ones_dv01_py_already_serves(table, zc):
    """가중이 세 곳(백테스트의 다리 구성 · dv01 의 중립 비율 · 여기)에 살아
    있다. 여기 계수와 `dv01_payload` 의 노셔널 비율이 갈라지면 화면의 세타는
    화면의 DV01 중립 비율과 다른 트레이드를 말하게 된다."""
    for sid, kind, legs in derived_ids():
        if kind not in PACKAGE_COEF:
            continue
        payload = dv01_payload(sid, kind, zc)
        ref_dv01 = pv01(zc, TENOR_T[legs[PACKAGE_REF]])
        for coef, leg in zip(PACKAGE_COEF[kind], payload["legs"]):
            # dv01_payload 는 기준 다리를 100 으로 정규화한다 — 그 비율이
            # 곧 |coef| 배의 DV01 이다.
            share = leg["notional"] * leg["dv01"] / (100.0 * ref_dv01)
            # **그쪽은 노셔널을 정수로 반올림한다**(그래서 residual 을 같이
            # 싣는다). 다리 사이 DV01 비가 클수록 정수 하나가 크게 어긋난다 —
            # 6M/9M/10Y 의 10Y 날개는 노셔널이 3 까지 내려가 share 가 0.445 다.
            # 허용치를 그 반올림에서 유도한다: 노셔널 ±0.5 는 share ±0.5·d/(100·d_ref).
            slack = 0.5 * leg["dv01"] / (100.0 * ref_dv01)
            assert share == pytest.approx(
                abs(coef), abs=max(slack, 0.01)
            ), f"{sid}/{leg['tenor']}"


def test_the_sign_means_the_same_thing_on_every_kind(table):
    """방향 +1(호가값을 롱)에서의 세타 — 아웃라이트면 페이, 스프레드면
    스티프너, 플라이면 벨리 페이. 우상향 커브에서 페이는 전 구간 음수여야
    하고, 스티프너는 그 음수 둘의 차이라 부호가 자유롭다. 여기서 잡는 것은
    **스티프너가 정확히 (긴 페이 + 짧은 리시브)** 라는 사실이다."""
    rows, _ = table
    assert all(rows[t]["cash"] < 0 for t in THETA_TENORS if t in rows)
    for sid, kind, legs in derived_ids():
        if kind != "spread" or sid not in rows:
            continue
        short, long = legs
        # 스티프너 = 긴 다리 페이 + 짧은 다리 리시브
        assert rows[sid]["perDv01"] == pytest.approx(
            rows[long]["perDv01"] - rows[short]["perDv01"], abs=200.0
        ), sid


def test_a_flat_curve_leaves_only_carry(cd):
    """롤다운은 기울기의 것이다 — 평평한 커브에서는 0 이어야 한다. 커브
    없이도 성립하는 관계라 합성 커브로 잡는다."""
    par = [(t, 0.03) for t in (0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 7.0, 10.0)]
    flat = bootstrap_zero_curve(par)
    v = theta_for(flat, 5.0, 0.03)
    assert v["roll"] == pytest.approx(0.0, abs=NOTIONAL * 1e-6)
    assert v["carry"] == pytest.approx(0.0, abs=NOTIONAL * 1e-6)
    assert np.isfinite(v["perDv01"])
    # 평평하면 커브 트레이드에는 아무것도 안 남는다
    s = theta_for_package(flat, [2.0, 5.0], "spread", 0.03)
    assert s["cash"] == pytest.approx(0.0, abs=NOTIONAL * 1e-6)


# ── 배선 ──────────────────────────────────────────────────────────────────


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
    derived = {d["id"]: d for d in body["derived"]}
    assert derived["2Y-10Y"]["theta"]["perDv01"] != 0
    assert derived["2Y-5Y-10Y"]["theta"]["perDv01"] != 0


def test_the_column_is_a_days_worth(table, dataset):
    """하루치다 [OWNER, 2026-08-14 — "세타 전부 다 하루치로"].

    계산 창은 분기이고 표기만 일 단위인데(`theta.HORIZON_Y` 의 실측 주석), 그
    나누기가 빠지거나 두 번 되면 열이 91배 틀리고도 **부호와 순위가 그대로**라
    다른 테스트는 아무것도 못 잡는다. 그래서 손으로 셀 수 있는 값 하나를 박는다:
    페이의 하루 캐리는 (CD − 파금리) × 노셔널 ÷ 365 다.
    """
    rows, meta = table
    rates = dict(par_rates_at(dataset, dataset.asof))
    cd = meta["cd"] / 100.0
    for tenor in ("1Y", "3Y", "10Y"):
        block = rows.get(tenor)
        if block is None:
            continue
        k = rates[TENOR_T[tenor]]
        expected = (cd - k) * NOTIONAL / 365.0
        assert block["carry"] == pytest.approx(expected, rel=5e-3), tenor
