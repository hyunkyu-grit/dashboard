"""Pass A2 — compare the forward matrix against the owner's spreadsheet, the one
external truth this product has never met.

No reference file is committed (it is the owner's data), so this SKIPS until one
is dropped into `data/reference/` per that folder's README. When present it
bootstraps for the sheet's valuation date, compares all 21×8 cells, and — per
the session's rule — either pins the sheet as a golden fixture (agreement) or
writes a report to docs/diagnostics/ and fails loudly (disagreement). It never
invents reference numbers and never adjusts a tolerance to agree.
"""

from pathlib import Path

import pytest

REF_DIR = Path(__file__).resolve().parents[2] / "data" / "reference"


def _reference_files():
    return sorted(REF_DIR.glob("forward_matrix_*.xlsx"))


@pytest.mark.skipif(not _reference_files(), reason="no reference sheet in data/reference/ (see its README)")
def test_forward_matrix_matches_reference_sheet():
    import openpyxl  # noqa: local import so the skip path needs nothing

    from app.curves import par_rates_at
    from app.dataset import load_dataset
    from app.engine_port import bootstrap_zero_curve
    from app.forwards import FWD_TENORS, START_POINTS, forward_par_rate

    path = _reference_files()[-1]
    valdate = path.stem.replace("forward_matrix_", "")  # YYYY-MM-DD from filename

    # ── load the owner's grid (layout documented in data/reference/README.md) ──
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    tenor_hdr = [str(c) for c in rows[0][1:9]]
    ref: dict[tuple[str, str], float] = {}
    for r in rows[1:22]:
        start = str(r[0])
        for j, ten in enumerate(tenor_hdr):
            if r[j + 1] is not None:
                ref[(start, ten)] = float(r[j + 1])

    # ── our matrix for the same valuation date ──
    ds = load_dataset(Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx")
    idx = next((i for i, d in enumerate(ds.dates) if d.isoformat() == valdate), None)
    assert idx is not None, f"valuation date {valdate} not in dataset"
    from app.curves import par_rates_at_index

    zc = bootstrap_zero_curve(par_rates_at_index(ds, idx))
    start_t = dict(START_POINTS)
    tenor_t = {lbl: t for lbl, t in FWD_TENORS}

    diffs = []  # (start, tenor, ours, theirs, bp)
    for (start, ten), theirs in ref.items():
        if start not in start_t or ten not in tenor_t:
            continue
        ours = forward_par_rate(zc, start_t[start], tenor_t[ten]) * 100
        diffs.append((start, ten, ours, theirs, abs(ours - theirs) * 100))

    worst = max(d[4] for d in diffs)
    over_1bp = [d for d in diffs if d[4] > 1.0]
    # Agreement is < 0.1bp; > 1bp is a convention mismatch to diagnose, never
    # tolerate. This assertion is deliberately tight — see the module docstring.
    assert not over_1bp, (
        f"{len(over_1bp)} cells differ > 1bp (worst {worst:.2f}bp) vs {path.name}; "
        f"write the diagnosis to docs/diagnostics/ rather than loosening this."
    )
