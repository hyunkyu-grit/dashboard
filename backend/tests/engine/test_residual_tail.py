# -*- coding: utf-8 -*-
"""못 창이 끝난 뒤의 준칙 잔차 — P4 D.4.

예전에는 q9 부터 잔차가 정확히 0 이었다. 그게 「급단절」인데, **그렇게 정한
것이 아니라 못이 없는 분기를 아무도 안 채웠기 때문**이었다(진단 §C.6). 같은
잔차의 역사 자기상관은 0.801 이고 Newey-West 표준오차 0.0745 라 ρ=0 은 10σ
밖이다.

여기서 재는 것은 넷이다.

  1. 창을 안 주면 예전과 **완전히 같다** — 이 기능은 옵트인이다
  2. `tail_rho=0` 이 급단절을 **정확히** 복원한다 (되돌릴 수 있는 변경)
  3. 꼬리는 창의 **마지막 분기**에서만 자란다 — 그래야 선형성이 산다
  4. 감쇠가 실제로 ρ^k 다 — 이름만 달고 다른 걸 하고 있지 않다
"""
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from bigfoot.solve.config import FINAL_EQ24, FINAL_OPTIONS  # noqa: E402
from bigfoot.solve.system import (BigfootSystem, RESIDUAL_TAIL,  # noqa: E402
                                  RESIDUAL_TAIL_RHO)

T = 24
WINDOW = 8


@lru_cache(maxsize=1)
def _sys() -> BigfootSystem:
    return BigfootSystem(beta_sync=1.05, eq24_form=FINAL_EQ24, T=T,
                         options=FINAL_OPTIONS)


def _pin(q: int) -> np.ndarray:
    p = np.full(T, np.nan)
    p[q] = 0.25
    return p


def test_the_default_is_decay_not_break():
    """기본값이 무엇인지 코드가 말하게 한다 — 화면이 이 이름을 그대로 단다."""
    assert RESIDUAL_TAIL == "decay"
    assert 0.7 < RESIDUAL_TAIL_RHO < 0.9


def test_without_a_window_nothing_changes():
    """못 창을 안 주는 호출자에게 이 기능은 존재하지 않는다.

    IRF·조건부 예측·커브 조립은 전부 창 없이 부른다. 그쪽 숫자가 한 자리라도
    움직이면 D.4 가 자기 자리를 벗어난 것이다.
    """
    s = _sys()
    out = s.solve({}, pin={"i_kr": _pin(7)})
    assert out["diagnostics"]["residual_tail"]["applied"] is False
    assert out["diagnostics"]["residual_tail"]["from_q"] is None

    broke = s.solve({}, pin={"i_kr": _pin(7)}, pin_window=WINDOW, tail_rho=0.0)
    for k in ("i_kr", "y_gap", "cpi_yoy", "hpi", "debt"):
        assert np.allclose(out["korea"][k], broke["korea"][k], atol=0, rtol=0)


def test_rho_zero_restores_the_hard_break_exactly():
    """되돌릴 수 있어야 변경이다. 부동소수 오차 없이 **정확히** 같아야 한다."""
    s = _sys()
    a = s.solve({}, pin={"i_kr": _pin(7)}, pin_window=WINDOW, tail_rho=0.0)
    b = s.solve({}, pin={"i_kr": _pin(7)})
    assert np.array_equal(a["korea"]["i_kr"], b["korea"]["i_kr"])


def test_only_the_last_quarter_of_the_window_grows_a_tail():
    """선형성이 사는 이유가 여기다.

    기저 `policy_qN` 은 q(N−1) 한 칸만 못 박는다. 창의 마지막 칸(q8)이 안
    박힌 기저는 꼬리를 지지 않아야 한다 — 그래야 여덟 기저의 선형결합이
    여덟 점을 다 못 박는 정확해와 같아진다.
    """
    s = _sys()
    for q in range(WINDOW - 1):                # q1~q7
        with_w = s.solve({}, pin={"i_kr": _pin(q)}, pin_window=WINDOW)
        without = s.solve({}, pin={"i_kr": _pin(q)})
        assert np.array_equal(with_w["korea"]["i_kr"], without["korea"]["i_kr"]), q

    q8_w = s.solve({}, pin={"i_kr": _pin(7)}, pin_window=WINDOW)
    q8_b = s.solve({}, pin={"i_kr": _pin(7)})
    assert not np.allclose(q8_w["korea"]["i_kr"], q8_b["korea"]["i_kr"])


def test_the_tail_actually_decays_at_rho():
    """이름이 「감쇠」인데 다른 걸 하고 있지 않은지 본다.

    꼬리가 없는 판과 있는 판의 준칙 우변 차이가 정확히 `ρ^(t−7)·u_8` 이어야
    한다. 그 차이를 직접 잴 수는 없으니 **잔차를 손으로 넣어 재현**한다 —
    같은 값을 `residuals=` 로 주면 꼬리 판과 같은 경로가 나와야 한다.
    """
    s = _sys()
    tail = s.solve({}, pin={"i_kr": _pin(7)}, pin_window=WINDOW)
    u8 = tail["diagnostics"]["pin_residuals"]["i_kr"][7]
    assert abs(u8) > 1e-6, "q8 못이 잔차를 안 남겼어요"

    hand = np.zeros(T)
    for t in range(WINDOW, T):
        hand[t] = RESIDUAL_TAIL_RHO ** (t - (WINDOW - 1)) * u8
    replay = s.solve({}, pin={"i_kr": _pin(7)}, residuals={"policy_rule": hand})
    assert np.allclose(tail["korea"]["i_kr"], replay["korea"]["i_kr"], atol=1e-12)


def test_the_basis_carries_the_treatment_and_its_standard_error():
    """화면이 ρ 를 인용할 때 표준오차를 같이 들 수 있어야 한다.

    점추정만 실으면 「0.801 이니까 감쇠가 맞다」 로 읽힌다. 밴드가 있어야
    「급단절이 10σ 밖」 이라는 문장이 검사 가능한 주장이 된다.
    """
    import json
    b = json.loads((ROOT / "output" / "scenario_basis.json").read_text("utf-8"))
    t = b["residual_tail"]
    assert t["treatment"] == RESIDUAL_TAIL
    assert t["rho"] == RESIDUAL_TAIL_RHO
    assert t["rho_se_nw"] > 0
    assert t["pin_window_q"] == WINDOW
    assert t["in_paper"] is False
    assert any("RESIDUAL_TAIL_DECAY" in c for c in b["caveats"])
