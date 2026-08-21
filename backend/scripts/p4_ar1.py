# -*- coding: utf-8 -*-
"""준칙 잔차의 AR(1) 과 그 표준오차 — 화면이 인용할 숫자의 정밀도를 잰다.

`residual_moments.json` 은 `ar1` 을 **표본 자기상관**(피어슨)으로만 적는다.
0.801 이라는 점추정만으로는 「밴드가 좁은 0.8」과 「넓은 0.8」을 구별할 수
없고, 화면은 그 숫자를 인용한다. 그래서 OLS 로 다시 풀고 표준오차를 붙인다.

    python -m scripts.p4_ar1
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from bigfoot.conditional.residuals import extract_residuals   # noqa: E402


def ols_ar1(u: np.ndarray, const: bool = True) -> dict:
    y, x = u[1:], u[:-1]
    X = np.column_stack([np.ones_like(x), x]) if const else x[:, None]
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    e = y - X @ b
    n, k = X.shape
    s2 = float(e @ e) / (n - k)
    XtXinv = np.linalg.inv(X.T @ X)
    se = np.sqrt(np.diag(s2 * XtXinv))
    # Newey-West, L = floor(4 (n/100)^(2/9))
    L = int(np.floor(4 * (n / 100.0) ** (2.0 / 9.0)))
    S = (X * e[:, None]).T @ (X * e[:, None])
    for lag in range(1, L + 1):
        w = 1.0 - lag / (L + 1.0)
        A = (X[lag:] * e[lag:, None]).T @ (X[:-lag] * e[:-lag, None])
        S = S + w * (A + A.T)
    nw = np.sqrt(np.diag(XtXinv @ S @ XtXinv))
    rho_i = 1 if const else 0
    return {"rho": float(b[rho_i]), "se_ols": float(se[rho_i]),
            "se_nw": float(nw[rho_i]), "nw_lags": L, "n_obs": int(n),
            "half_life_q": (float(np.log(0.5) / np.log(b[rho_i]))
                            if 0 < b[rho_i] < 1 else None)}


def main() -> None:
    r = extract_residuals()
    u = r["policy_rule"].dropna()
    v = u.values.astype(float)
    out = {
        "sample": f"{u.index[0]}-{u.index[-1]}",
        "n": int(len(v)),
        "mean_pp": float(v.mean()),
        "std_pp": float(v.std(ddof=1)),
        "pearson_ar1": float(np.corrcoef(v[:-1], v[1:])[0, 1]),
        "ols_with_const": ols_ar1(v, const=True),
        "ols_no_const": ols_ar1(v, const=False),
        "ols_demeaned": ols_ar1(v - v.mean(), const=False),
    }
    x = np.arange(len(v))
    detr = v - np.polyval(np.polyfit(x, v, 1), x)
    out["ols_detrended"] = ols_ar1(detr, const=False)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    (BACKEND / "output" / "p4").mkdir(parents=True, exist_ok=True)
    (BACKEND / "output" / "p4" / "ar1.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
