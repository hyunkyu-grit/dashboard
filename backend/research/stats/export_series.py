"""Export real series for the regime study.

Runs on the APPLICATION interpreter (which has the data layer but not
`ruptures`/`hmmlearn`); the regime study runs in the isolated `.venv-q1`
(which has those but not the data layer). This file is the seam between them
and is the reason no research package is installed into the app venv.

Real data only. Writes `docs/q1/_series_ktb.csv`.
"""
from __future__ import annotations
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))
import pandas as pd

def main() -> None:
    from app import creditmatrix as cm
    m = cm.load()
    cols = {}
    for label in ("3Y", "10Y"):
        if not m.has("KTB", label):
            continue
        yrs = cm.TENOR_YEARS[label]
        vals, idx = [], []
        for i, d in enumerate(m.dates):
            try:
                v = cm.yield_at(m, "KTB", i, yrs)
            except Exception:
                continue
            if v is None:
                continue
            vals.append(v * 1e4)   # bp
            idx.append(pd.Timestamp(d))
        cols[f"KTB_{label}_bp"] = pd.Series(vals, index=pd.DatetimeIndex(idx))
    df = pd.DataFrame(cols).dropna()
    df["slope_10y_3y_bp"] = df["KTB_10Y_bp"] - df["KTB_3Y_bp"]
    out = REPO / "docs" / "q1" / "_series_ktb.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, encoding="utf-8")
    print(f"wrote {out}  rows={len(df)}  {df.index[0].date()} .. {df.index[-1].date()}")
    print(df.tail(3).to_string())

if __name__ == "__main__":
    main()
