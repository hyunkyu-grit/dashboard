# -*- coding: utf-8 -*-
"""Phase-4.7 tests: the US term-premium FIR kernel (FORM_TP_FIR)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bigfoot.equations import us  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "output"


def test_tp_steady_state_zero():
    """tp_us -> 0 at baseline: FIR of a zero policy deviation is zero."""
    assert np.all(us.tp_us_path(np.zeros(40)) == 0.0)
    # convolution identity: one-off unit deviation replays the kernel
    one_off = np.zeros(40)
    one_off[0] = 1.0
    tp = us.tp_us_path(one_off)
    K = len(us.TP_KERNEL)
    assert np.allclose(tp[:K], us.TP_KERNEL, atol=1e-12)
    assert np.all(tp[K:] == 0.0)


def test_tp_kernel_nonnegative_and_sum():
    """NNLS kernel: nonnegative, sum below 1 (no over-accumulation on
    sustained paths — the 4.5/4.6 failure mode)."""
    assert np.all(us.TP_KERNEL >= 0.0)
    assert 0.5 < float(us.TP_KERNEL.sum()) < 1.0
    # sustained unit path: tp converges to the kernel sum, never beyond
    tp = us.tp_us_path(np.ones(40))
    assert abs(tp[-1] - us.TP_KERNEL.sum()) < 1e-12
    assert float(tp.max()) <= float(us.TP_KERNEL.sum()) + 1e-12


def test_tp_holdout_gate_locked():
    """The fit-forbidden holdout (+50bp x 2q) stays inside the Phase-4.7
    gate: mean |gap| < 15bp, peak error < 20bp. Re-derives the model US10y
    from the checked-in kernel + the holdout csv (fails if either the
    kernel constants, the US block, or the holdout paths drift)."""
    usb = us.USBlock()
    df = pd.read_csv(OUT / "holdout_paths.csv")
    piv = df.pivot(index="quarter", columns="variable",
                   values="diff").sort_index()
    cond = {"us_i": piv["rff"].values, "us_y": piv["xgap2"].values,
            "us_pi": piv["picxfe"].values}
    i = usb.conditioned_solve(cond, T=120)[0]["i"]
    tq = len(piv)
    eh = np.array([i[t:t + 40].mean() for t in range(tq)])
    model = eh + us.tp_us_path(i)[:tq]
    rg10 = piv["rg10"].values
    mean_gap_bp = float(np.mean(np.abs(model - rg10))) * 100
    peak_err_bp = abs(float(model[np.argmax(np.abs(model))])
                      - float(rg10[np.argmax(np.abs(rg10))])) * 100
    assert mean_gap_bp < 15.0, mean_gap_bp
    assert peak_err_bp < 20.0, peak_err_bp


def test_sync_pin_conditions_locked():
    """Phase-4.8 FINAL adoption conditions: beta_sync = 1.05, interior."""
    from bigfoot.solve.phase3 import BETA_SYNC_ADOPTED, SYNC_PIN_RESULT
    assert BETA_SYNC_ADOPTED == 1.05
    assert 0.1 < BETA_SYNC_ADOPTED < 1.5
    assert SYNC_PIN_RESULT["interior"] and not SYNC_PIN_RESULT["degenerate"]


def test_imposed_shock_mode():
    """[SHOCK_IMPL_B_IMPOSED] The imposed 25bp shock produces an ACTUAL
    25bp policy move at q1 (the whole point of the 4.8 ruling), the rule
    resumes from q2, and y/pi stay endogenous (IS/PC rows hold)."""
    usb = us.USBlock()
    sim = usb.simulate_imposed_rate([0.25], T=80)
    assert abs(sim["i"][0] - 0.25) < 1e-12
    # rule resumed: q2 rate is the rule's response, strictly attenuated
    assert sim["i"][1] < 0.25
    # internal mode attenuates the impact quarter (~0.19); imposed must not
    internal = usb.simulate_shock(25.0, T=80)
    assert internal["i"][0] < 0.22 < sim["i"][0] + 1e-9
    # IS row holds at t=0 in imposed mode (only MP rows were dropped)
    y, pi, i = sim["y"], sim["pi"], sim["i"]
    pi4 = lambda t: np.mean([pi[s] if s >= 0 else 0.0
                             for s in range(t - 3, t + 1)])
    is_resid = y[0] - (us.B2 * y[1] - us.B3 * (0.0 - pi4(3)))
    assert abs(is_resid) < 1e-10
