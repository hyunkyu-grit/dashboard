# -*- coding: utf-8 -*-
"""P4 측정 하네스 — 엔진을 한 번 고칠 때마다 **같은 잣대**로 다시 잰다.

    python -m scripts.p4_measure <라벨>      output/p4/<라벨>.json 을 쓴다
    python -m scripts.p4_measure --diff A B  두 라벨의 차이를 찍는다

재는 것 넷:
  1. 논문 앵커 스코어카드 (config/paper_anchors.json 의 13칸)
  2. irf.py 의 밴드/모양 스코어카드 13줄
  3. 기저 꼬리 |q24|/max — 기저마다
  4. 기저별 12개월(h=4) IRS 델타, 테너 다섯

앵커는 IRF 실행에서 잰다. `paper_anchors.json` 이 `basis` 를 적어 두지만
2026-08-21 에 실린 측정치(gap −0.0881)는 IRF A(`kr_rule_bp=25`)의 것이다 —
기저 `policy_q1` 은 못이라 응답이 다르다. 둘 다 재서 같이 적는다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from bigfoot.solve.irf import run_all, scorecard                 # noqa: E402

OUT = BACKEND / "output" / "p4"
ANCHORS = json.loads(
    (BACKEND / "config" / "paper_anchors.json").read_text("utf-8"))

#: 앵커 그룹 → (IRF 키, 배율) 과 (기저 이름, 배율).
#: 기저 배율: us_2q 는 +100bp 로 구웠고 앵커는 +25bp 다.
ROUTE = {
    "kr_policy_25bp": {"irf": ("A", 1.0), "basis": ("policy_q1", 1.0)},
    "us_policy_25bp": {"irf": ("B", 1.0), "basis": ("us_2q", 0.25)},
    "oil_10pct": {"irf": ("C", 1.0), "basis": ("oil", 1.0)},
}

TAIL_VARS = ("y_gap", "cpi_yoy", "hpi", "debt", "i_kr", "x", "m")
TENORS = ("1y", "2y", "3y", "5y", "10y")
TENOR_YEARS = {"1y": 1, "2y": 2, "3y": 3, "5y": 5, "10y": 10}
PINNED_Q = 8
PHI_I_TAIL = 0.85
PAD_Q = 44
#: 화면이 인용하는 기준 경로 둘. `guards/model-strategy-decompose.test.ts`
#: 가 쓰는 것과 같은 두 벌이다 — 지속 인하와 계단.
REF_PATHS = {
    "sustained": [-25.0] * PINNED_Q,
    "staircase": [-25.0, -50.0, -50.0, -50.0, -50.0, -50.0, -50.0, -50.0],
}
REF_DOTS = REF_PATHS["sustained"]


def _forward_sub(M, b):
    n = len(b)
    c = [0.0] * n
    for i in range(n):
        s = b[i]
        for j in range(i):
            s -= M[i][j] * c[j]
        c[i] = s / M[i][i]
    return c


def _pad_policy(i_kr):
    pad = [0.0] * PAD_Q
    for t in range(min(len(i_kr), PAD_Q)):
        pad[t] = i_kr[t]
    for j in range(len(i_kr), PAD_Q):
        pad[j] = pad[j - 1] * PHI_I_TAIL
    return pad


def _eh_term(padded, tenor_years, h):
    span = tenor_years * 4

    def mean(frm):
        acc = 0.0
        for i in range(span):
            j = frm + i
            acc += padded[j] if j < len(padded) else padded[-1]
        return acc / span

    return mean(h) - mean(0)


def lab_path(bases: dict, M, resids: dict, dots=None, h: int = 4) -> dict:
    """프런트 `strategy/path.ts` · `decompose.ts` 를 그대로 옮겨 잰다.

    화면이 인용하는 두 숫자 — q9~q12 되돌림과 테너별 준칙 몫 — 는 조합된
    경로에서만 나온다. 엔진 쪽에서 같은 산술을 돌려야 «전·후» 를 같은 잣대로
    적을 수 있다.
    """
    dots = REF_DOTS if dots is None else dots
    T = len(bases["policy_q1"]["i_kr"])
    c = _forward_sub(M, [v / 100.0 for v in dots])
    i_kr = [0.0] * T
    irs = {ten: [0.0] * len(bases["policy_q1"]["irs"][ten]) for ten in TENORS}
    u = [0.0] * PINNED_Q
    for q in range(PINNED_Q):
        w, e = c[q], bases[f"policy_q{q + 1}"]
        for t in range(T):
            i_kr[t] += w * e["i_kr"][t]
        for ten in TENORS:
            for hh in range(len(irs[ten])):
                irs[ten][hh] += w * e["irs"][ten][hh]
        ur = resids[f"policy_q{q + 1}"]["policy_rule"]
        for q2 in range(PINNED_Q):
            u[q2] += w * (ur[q2] if q2 < len(ur) else 0.0)

    head = _pad_policy([v if t < PINNED_Q else 0.0 for t, v in enumerate(i_kr)])
    tail = _pad_policy([0.0 if t < PINNED_Q else v for t, v in enumerate(i_kr)])

    per = {}
    for ten in TENORS:
        total = irs[ten][h] * 100.0
        eh = _eh_term(head, TENOR_YEARS[ten], h) * 100.0
        rule = _eh_term(tail, TENOR_YEARS[ten], h) * 100.0
        per[ten] = {"total_bp": round(total, 4), "eh_bp": round(eh, 4),
                    "rule_bp": round(rule, 4),
                    "cd_bp": round(total - eh - rule, 4),
                    "rule_share": (round(rule / total, 4)
                                   if abs(total) >= 0.5 else None)}
    rms = float(np.sqrt(np.mean(np.square(u))))
    return {
        "dots": list(dots),
        "h_quarters": h,
        "i_kr_pp": [round(v, 6) for v in i_kr],
        "clawback_q9_q12_bp": [round((i_kr[t] - i_kr[7]) * 100.0, 3)
                               for t in (8, 9, 10, 11)],
        "horizon_exit_bp": round((i_kr[11] - i_kr[7]) * 100.0, 3),
        "rule_residual_pp": [round(v, 6) for v in u],
        "rule_dev_sigma_rms": round(rms / 0.498, 4),
        "rule_dev_sigma_max": round(max(abs(v) for v in u) / 0.498, 4),
        "tenors": per,
    }


def _peak(series, sign: float) -> float:
    """앵커가 든 부호 쪽의 극값. 부호가 없으면 절대 최대."""
    a = np.asarray(series, dtype=float)
    if sign < 0:
        return float(a.min())
    if sign > 0:
        return float(a.max())
    return float(a[int(np.argmax(np.abs(a)))])


def _final_opts():
    from bigfoot.solve.phase3 import (BETA_SYNC_ADOPTED, FINAL_EQ24,
                                      FINAL_OPTIONS)
    return BETA_SYNC_ADOPTED, FINAL_EQ24, FINAL_OPTIONS


def measure_anchors(irfs: dict, bases: dict) -> list:
    rows = []
    for sh in ANCHORS["shocks"]:
        route = ROUTE[sh["id"]]
        for a in sh["anchors"]:
            var, val = a["var"], a["value"]
            row = {"anchor_id": a["id"], "panel": a["panel"], "var": var,
                   "anchor": val, "unit": a["unit"], "kind": a["kind"]}
            if var is None:
                row["skipped"] = "편차 공간에 없는 변수예요"
                rows.append(row)
                continue
            sgn = 0.0 if val is None else float(np.sign(val))
            k, s = route["irf"]
            row["irf_measured"] = round(_peak(irfs[k]["korea"][var], sgn) * s, 5)
            bk, bs = route["basis"]
            if bk in bases and var in bases[bk]:
                row["basis_measured"] = round(
                    _peak(bases[bk][var], sgn) * bs, 5)
            if val is not None:
                # 밴드 = 앵커의 ±40% — irf.py 의 밴드가 그 폭으로 서 있다.
                lo, hi = sorted((val * 0.6, val * 1.4))
                row["band"] = [round(lo, 4), round(hi, 4)]
                row["pass"] = bool(lo <= row["irf_measured"] <= hi)
            rows.append(row)
    return rows


def measure(label: str) -> dict:
    beta, eq24, opts = _final_opts()
    irfs = run_all(beta_sync=beta, eq24_form=eq24, options=opts)
    band_rows = scorecard(irfs)

    from bigfoot.scenario_basis.build import T, build_bases, linearity_gate
    sys_, bases, resids, M = build_bases()

    tails = {}
    for name, b in bases.items():
        per = {}
        for v in TAIL_VARS:
            a = np.abs(np.asarray(b[v], dtype=float))
            mx = float(a.max())
            per[v] = round(float(a[T - 1]) / mx, 4) if mx > 1e-12 else None
        tails[name] = per

    irs12 = {name: {ten: round(b["irs"][ten][4] * 100.0, 4) for ten in TENORS}
             for name, b in bases.items()}

    fi = {
        "irf_B_us25bp_trough_pct":
            round(float(np.min(irfs["B"]["korea"]["i_fi"])), 5),
        "irf_A_kr25bp_trough_pct":
            round(float(np.min(irfs["A"]["korea"]["i_fi"])), 5),
        "irf_C_oil10_trough_pct":
            round(float(np.min(irfs["C"]["korea"]["i_fi"])), 5),
    }

    out = {
        "label": label,
        "anchors": measure_anchors(irfs, bases),
        "band_scorecard": band_rows,
        "band_passed": sum(r["pass"] for r in band_rows),
        "band_total": len(band_rows),
        "basis_tails": tails,
        "irs_12m_bp": irs12,
        "fi_investment": fi,
        "lab_path": lab_path(bases, M, resids),
        "lab_paths": {k: lab_path(bases, M, resids, dots=v)
                      for k, v in REF_PATHS.items()},
        "linearity_gate": linearity_gate(sys_, bases, resids, M),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{label}.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def _fmt(v):
    return "—" if v is None else f"{v:+.5f}"


def report(o: dict) -> str:
    L = [f"# {o['label']}", "", "## 논문 앵커", "",
         "| 앵커 | 논문 | IRF 실측 | 기저 실측 | 밴드 | 판정 |",
         "|---|---|---|---|---|---|"]
    for r in o["anchors"]:
        if "skipped" in r:
            L.append(f"| {r['anchor_id']} | {r['anchor']}{r['unit']} "
                     f"| — | — | — | 대조불가 |")
            continue
        band = (f"[{r['band'][0]:+.3f}, {r['band'][1]:+.3f}]"
                if r.get("band") else "—")
        ok = "PASS" if r.get("pass") else ("MISS" if "pass" in r else "모양")
        L.append(f"| {r['anchor_id']} | {r['anchor']}{r['unit']} | "
                 f"{_fmt(r.get('irf_measured'))} | "
                 f"{_fmt(r.get('basis_measured'))} | {band} | {ok} |")
    n = sum(1 for r in o["anchors"] if r.get("pass"))
    d = sum(1 for r in o["anchors"] if "pass" in r)
    L += ["", f"앵커 {n}/{d} 통과 (숫자 있는 칸만; 전체 칸 "
              f"{len(o['anchors'])})", ""]
    L += [f"## 밴드/모양 스코어카드 {o['band_passed']}/{o['band_total']}", ""]
    for r in o["band_scorecard"]:
        v = "  --  " if r["value"] is None else f"{r['value']:+.4f}"
        b = f"[{r['band'][0]:+.2f},{r['band'][1]:+.2f}]" if r["band"] else ""
        L.append(f"- {'PASS' if r['pass'] else 'MISS'} {r['irf']} "
                 f"{r['metric']} {v} {b}")
    L += ["", "## FI 투자", ""]
    for k, v in o["fi_investment"].items():
        L.append(f"- {k}: {_fmt(v)}")
    L += ["", "## 기저 꼬리 |q24|/max", "",
          "| 기저 | " + " | ".join(TAIL_VARS) + " |",
          "|---" * (len(TAIL_VARS) + 1) + "|"]
    for name, per in o["basis_tails"].items():
        L.append("| " + name + " | " + " | ".join(
            "—" if per[v] is None else f"{per[v]:.3f}"
            for v in TAIL_VARS) + " |")
    L += ["", "## 12개월 IRS 델타 (bp, 기저 단위)", "",
          "| 기저 | 1Y | 2Y | 3Y | 5Y | 10Y |", "|---|---|---|---|---|---|"]
    for name, per in o["irs_12m_bp"].items():
        L.append("| " + name + " | " + " | ".join(
            f"{per[t]:+.3f}" for t in TENORS) + " |")
    for _name, lp in o["lab_paths"].items():
        L += ["", f"## 화면 기준 경로 «{_name}» {lp['dots']}", ""]
        L += [f"- q9~q12 되돌림: {lp['clawback_q9_q12_bp']} bp",
              f"- 지평 이탈: {lp['horizon_exit_bp']:+.2f}bp", "",
              "| 테너 | 합계 | 준칙 되돌림 | 준칙 몫 |", "|---|---|---|---|"]
        for _t in TENORS:
            _d = lp["tenors"][_t]
            _s = ("—" if _d["rule_share"] is None
                  else f"{_d['rule_share'] * 100:.1f}%")
            L.append(f"| {_t.upper()} | {_d['total_bp']:+.3f} | "
                     f"{_d['rule_bp']:+.3f} | {_s} |")
    lp = o["lab_path"]
    L += ["", f"## 화면 기준 경로 {lp['dots'][0]:+.0f}bp × {PINNED_Q}분기 "
              f"(h={lp['h_quarters']}분기)", "",
          f"- q9~q12 되돌림: {lp['clawback_q9_q12_bp']} bp",
          f"- 지평 이탈(q12−q8): {lp['horizon_exit_bp']:+.2f}bp",
          f"- 룰 이탈 σ: RMS {lp['rule_dev_sigma_rms']:.3f} · "
          f"max {lp['rule_dev_sigma_max']:.3f}", "",
          "| 테너 | 합계 | 경로 그대로 | 준칙 되돌림 | CD 전달 | 준칙 몫 |",
          "|---|---|---|---|---|---|"]
    for ten in TENORS:
        d = lp["tenors"][ten]
        sh = "—" if d["rule_share"] is None else f"{d['rule_share'] * 100:.1f}%"
        L.append(f"| {ten.upper()} | {d['total_bp']:+.3f} | {d['eh_bp']:+.3f} | "
                 f"{d['rule_bp']:+.3f} | {d['cd_bp']:+.3f} | {sh} |")
    L += ["", "## 선형성 게이트", ""]
    for k, g in o["linearity_gate"].items():
        L.append(f"- {k}: curve {g['max_curve_bp']}bp · macro "
                 f"{g['max_macro_pp']}pp · {'PASS' if g['pass'] else 'FAIL'}")
    return "\n".join(L)


def diff(a: str, b: str) -> str:
    A = json.loads((OUT / f"{a}.json").read_text("utf-8"))
    B = json.loads((OUT / f"{b}.json").read_text("utf-8"))
    L = [f"# {a} → {b}", "", "## 앵커", "",
         "| 앵커 | 논문 | 전 | 후 | Δ | 판정 |", "|---|---|---|---|---|---|"]
    for ra, rb in zip(A["anchors"], B["anchors"]):
        if "irf_measured" not in ra:
            continue
        d = rb["irf_measured"] - ra["irf_measured"]
        ok = ("PASS" if rb.get("pass") else "MISS") if "pass" in rb else "모양"
        was = ("PASS" if ra.get("pass") else "MISS") if "pass" in ra else "모양"
        L.append(f"| {ra['anchor_id']} | {ra['anchor']} | "
                 f"{ra['irf_measured']:+.5f} | {rb['irf_measured']:+.5f} | "
                 f"{d:+.5f} | {was}→{ok} |")
    L += ["", f"## 밴드 {A['band_passed']}/{A['band_total']} → "
              f"{B['band_passed']}/{B['band_total']}", ""]
    for ra, rb in zip(A["band_scorecard"], B["band_scorecard"]):
        if ra["value"] is None:
            L.append(f"- {ra['irf']} {ra['metric']}: "
                     f"{'PASS' if ra['pass'] else 'MISS'}→"
                     f"{'PASS' if rb['pass'] else 'MISS'}")
            continue
        L.append(f"- {ra['irf']} {ra['metric']}: {ra['value']:+.4f} → "
                 f"{rb['value']:+.4f} ({rb['value'] - ra['value']:+.4f}) "
                 f"{'PASS' if ra['pass'] else 'MISS'}→"
                 f"{'PASS' if rb['pass'] else 'MISS'}")
    L += ["", "## FI 투자", ""]
    for k in A["fi_investment"]:
        va, vb = A["fi_investment"][k], B["fi_investment"][k]
        if va is None or vb is None:
            L.append(f"- {k}: {va} → {vb}")
        else:
            L.append(f"- {k}: {va:+.5f} → {vb:+.5f} ({vb - va:+.5f})")
    L += ["", "## 12개월 IRS 델타 변화 (bp)", "",
          "| 기저 | 1Y | 2Y | 3Y | 5Y | 10Y |", "|---|---|---|---|---|---|"]
    for name in A["irs_12m_bp"]:
        L.append("| " + name + " | " + " | ".join(
            f"{B['irs_12m_bp'][name][t] - A['irs_12m_bp'][name][t]:+.3f}"
            for t in TENORS) + " |")
    L += ["", "## 기저 꼬리 변화 |q24|/max", "",
          "| 기저 | y_gap | cpi_yoy | hpi | debt | i_kr |",
          "|---|---|---|---|---|---|"]
    for name in A["basis_tails"]:
        cells = []
        for v in ("y_gap", "cpi_yoy", "hpi", "debt", "i_kr"):
            xa, xb = A["basis_tails"][name][v], B["basis_tails"][name][v]
            cells.append("—" if xa is None or xb is None
                         else f"{xa:.3f}→{xb:.3f}")
        L.append("| " + name + " | " + " | ".join(cells) + " |")
    for _name in A["lab_paths"]:
        _a, _b = A["lab_paths"][_name], B["lab_paths"][_name]
        L += ["", f"## 경로 «{_name}»", "",
              f"- q9~q12 되돌림: {_a['clawback_q9_q12_bp']} → "
              f"{_b['clawback_q9_q12_bp']} bp", "",
              "| 테너 | 합계 전→후 | 준칙 몫 전→후 |", "|---|---|---|"]
        for _t in TENORS:
            _da, _db = _a["tenors"][_t], _b["tenors"][_t]
            _f = lambda v: "—" if v is None else f"{v * 100:.1f}%"
            L.append(f"| {_t.upper()} | {_da['total_bp']:+.3f} → "
                     f"{_db['total_bp']:+.3f} | {_f(_da['rule_share'])} → "
                     f"{_f(_db['rule_share'])} |")
    la, lb = A["lab_path"], B["lab_path"]
    L += ["", "## 화면 기준 경로 −25bp × 8분기", "",
          f"- q9~q12 되돌림: {la['clawback_q9_q12_bp']} → "
          f"{lb['clawback_q9_q12_bp']} bp",
          f"- 지평 이탈: {la['horizon_exit_bp']:+.2f} → "
          f"{lb['horizon_exit_bp']:+.2f}bp",
          f"- 룰 이탈 σ RMS: {la['rule_dev_sigma_rms']:.3f} → "
          f"{lb['rule_dev_sigma_rms']:.3f}", "",
          "| 테너 | 합계 전→후 | 준칙 되돌림 전→후 | 준칙 몫 전→후 |",
          "|---|---|---|---|"]
    for ten in TENORS:
        da, db = la["tenors"][ten], lb["tenors"][ten]
        f = lambda v: "—" if v is None else f"{v * 100:.1f}%"   # noqa: E731
        L.append(f"| {ten.upper()} | {da['total_bp']:+.3f} → "
                 f"{db['total_bp']:+.3f} | {da['rule_bp']:+.3f} → "
                 f"{db['rule_bp']:+.3f} | {f(da['rule_share'])} → "
                 f"{f(db['rule_share'])} |")
    L += ["", "## 선형성 게이트", ""]
    for k in A["linearity_gate"]:
        ga, gb = A["linearity_gate"][k], B["linearity_gate"][k]
        L.append(f"- {k}: curve {ga['max_curve_bp']}→{gb['max_curve_bp']}bp · "
                 f"macro {ga['max_macro_pp']}→{gb['max_macro_pp']}pp")
    return "\n".join(L)


if __name__ == "__main__":
    if sys.argv[1] == "--diff":
        print(diff(sys.argv[2], sys.argv[3]))
    else:
        print(report(measure(sys.argv[1])))
