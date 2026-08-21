# -*- coding: utf-8 -*-
"""Phase-5a Step 1 — policy->CD transmission event study.

python -m bigfoot.cd_layer.study    (writes output/cd_passthrough.json
                                     + output/cd_event_study.html)

Events: base-rate CHANGE dates derived from the daily 722Y001 series
(2010-01+; all steps are +/-25bp or +/-50bp). CALENDAR_CHANGES_ONLY: the
full meeting calendar (holds) is not compiled — pass-through estimation
needs change events; holds would only refine the anticipation baseline.
Note: the change date is the EFFECTIVE date; for the 2020-03 emergency
cut the announcement was the prior day (flagged, single event).

Per event, on the CD series' own trading-day grid, window D-10..D+15:
  pre-reflection ratio  (CD_{D-1} - CD_{D-10}) / delta
  announcement jump     (CD_D - CD_{D-1}) / delta
  post half-life        days until the remaining gap (1 - cum ratio)
                        halves; median across clean events + an
                        exponential tau fitted to the mean clean path
Windows contaminated by a neighboring event (another change inside
D-10..D-1 for the pre metrics, or D+1..D+15 for the post metrics) are
excluded from the affected metric only, with counts reported.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from bigfoot.data.ecos import daily

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"

PRE_W, POST_W = 10, 15
SAMPLE_START = "2010-01-01"
MIN_SPLIT_N = 4

CAVEATS = [
    "CALENDAR_CHANGES_ONLY: hold meetings not compiled; anticipation "
    "baseline uses change events only",
    "EFFECTIVE_DATE_CONVENTION: event date = base-rate effective date "
    "(equals announcement day for scheduled MPC decisions; the 2020-03 "
    "emergency cut was announced the prior day)",
    "OVERLAP_EXCLUSION: metrics drop events whose window contains a "
    "neighboring change (per-metric, counts reported)",
    "HALF_LIFE_RIGHT_CENSORED: most events do not halve their residual "
    "gap within D+15 (mean path plateaus ~0.73); medians are reported "
    "only when identified under censoring, and the adapter tau comes "
    "from the two-point D->D+15 gap decay (extrapolation beyond the "
    "window rests on base-CD cointegration, not on within-window data)",
    "CD_STALENESS: ~82% of CD trading days show zero change — quotes "
    "move in steps; day-level dynamics are coarse",
]


def load_series():
    cd = daily("bigfoot_cd91_d").loc[SAMPLE_START:]
    base = daily("bigfoot_base_rate_d").loc["2009-06-01":]
    msb = daily("bigfoot_msb1y_d").loc["2009-06-01":]
    return cd, base, msb


def detect_events(base: pd.Series) -> pd.Series:
    ch = base.diff()
    ev = ch[ch != 0].dropna()
    return ev.loc[SAMPLE_START:]


def event_frame(cd: pd.Series, msb: pd.Series, events: pd.Series):
    """Per-event window metrics on the CD trading-day grid."""
    days = cd.index
    ev_pos = {d: int(days.searchsorted(d)) for d in events.index}
    rows = []
    for d, delta in events.items():
        p = ev_pos[d]
        if p - PRE_W < 0 or p + POST_W >= len(days):
            continue
        win = cd.iloc[p - PRE_W: p + POST_W + 1].values
        cum = (win - win[0]) / delta                    # rel -10 .. +15
        # neighboring-event contamination (trading-day positions)
        others = [q for dd, q in ev_pos.items() if dd != d]
        clean_pre = not any(p - PRE_W < q < p for q in others)
        clean_post = not any(p < q <= p + POST_W for q in others)
        # surprise proxy: |D-day move| in MSB 1y
        mpos = int(msb.index.searchsorted(d))
        msb_move = (abs(float(msb.iloc[mpos] - msb.iloc[mpos - 1]))
                    if 0 < mpos < len(msb) else np.nan)
        gap0 = 1.0 - cum[PRE_W]
        half = np.nan
        if clean_post and gap0 > 0:
            for k in range(1, POST_W + 1):
                if 1.0 - cum[PRE_W + k] <= gap0 / 2.0:
                    half = k
                    break
        rows.append({
            "date": d, "delta": float(delta),
            "hike": delta > 0, "post2020": d >= pd.Timestamp("2020-01-01"),
            "pre_ratio": float(cum[PRE_W - 1]),
            "jump": float(cum[PRE_W] - cum[PRE_W - 1]),
            "cum_D": float(cum[PRE_W]),
            "half_life": half, "gap0": float(gap0),
            "clean_pre": clean_pre, "clean_post": clean_post,
            "msb_move": msb_move,
            "cum_path": cum,
        })
    return pd.DataFrame(rows)


def fit_tau_terminal(df: pd.DataFrame) -> tuple:
    """Two-point exponential tau from the mean gap decay D -> D+POST_W
    (the LS fit is ill-posed on the fast-then-flat empirical shape).
    Returns (tau_days, mean cum at D, mean cum at D+POST_W)."""
    paths = np.vstack([r for r in df["cum_path"]])
    m = paths.mean(axis=0)
    cum_d, cum_t = float(m[PRE_W]), float(m[PRE_W + POST_W])
    g0, gT = 1.0 - cum_d, 1.0 - cum_t
    if g0 <= 0 or gT <= 0 or gT >= g0:
        return float("inf"), cum_d, cum_t
    return -POST_W / np.log(gT / g0), cum_d, cum_t


def _half_life_stats(sub: pd.DataFrame) -> dict:
    """Right-censoring-aware: median identified only if the events that
    halve within the window are at least half of those at risk."""
    at_risk = sub[sub.clean_post & (sub.gap0 > 0)]
    halved = at_risk["half_life"].dropna()
    identified = len(halved) >= len(at_risk) / 2 and len(at_risk) > 0
    return {
        "at_risk": int(len(at_risk)),
        "halved_within_window": int(len(halved)),
        "censored_beyond_window": int(len(at_risk) - len(halved)),
        "median_days": (round(float(at_risk["half_life"]
                                    .fillna(POST_W + 1).median()), 1)
                        if identified else None),
        "censored": not identified,
        "note": None if identified else f"> {POST_W}bd (right-censored)",
    }


def _stats(sub: pd.DataFrame) -> dict:
    return {
        "n": int(len(sub)),
        "n_clean_pre": int(sub.clean_pre.sum()),
        "pre_reflection_ratio": round(float(
            sub.loc[sub.clean_pre, "pre_ratio"].mean()), 3),
        "jump_ratio": round(float(sub["jump"].mean()), 3),
        "half_life": _half_life_stats(sub),
    }


def run() -> dict:
    cd, base, msb = load_series()
    events = detect_events(base)
    df = event_frame(cd, msb, events)

    med = float(df["msb_move"].median())
    df["surprise"] = df["msb_move"] > med

    headline = _stats(df)
    tau, cum_d, cum_t = fit_tau_terminal(df)

    splits = {}
    for name, mask in [("hikes", df.hike), ("cuts", ~df.hike),
                       ("expected", ~df.surprise), ("surprise", df.surprise),
                       ("pre2020", ~df.post2020), ("post2020", df.post2020)]:
        sub = df[mask]
        if len(sub) < MIN_SPLIT_N:
            splits[name] = {"n": int(len(sub)),
                            "suppressed": f"n < {MIN_SPLIT_N}"}
        else:
            splits[name] = _stats(sub)

    # CD staleness: share of zero-change trading days (pre-flagged risk)
    dcd = cd.diff().dropna()
    staleness = {
        "zero_change_share_all": round(float((dcd == 0).mean()), 3),
        "zero_change_share_in_windows": round(float(np.mean([
            (np.diff(r) == 0).mean() for r in df["cum_path"]])), 3),
    }

    spread = float((cd - base.reindex(cd.index).ffill()).mean())

    out = {
        "module": "cd_transmission",
        "as_of": date.today().isoformat(),
        "headline": {
            "pre_reflection_ratio": headline["pre_reflection_ratio"],
            "jump_ratio": headline["jump_ratio"],
            "half_life_days": headline["half_life"]["median_days"],
            "half_life_censored": headline["half_life"]["censored"],
            "half_life_detail": headline["half_life"],
            "cum_at_D": round(cum_d, 3),
            "cum_at_D_plus_15": round(cum_t, 3),
            "exp_tau_days_from_terminal": round(tau, 1),
        },
        "sample": {"events": int(len(df)),
                   "period": f"{df['date'].min().date()}"
                             f"..{df['date'].max().date()}",
                   "n_clean_pre": headline["n_clean_pre"],
                   "steps_pp": sorted(df["delta"].round(2).unique().tolist()),
                   "msb_surprise_median_bp": round(med * 100, 1)},
        "splits": splits,
        "cd_base_spread_mean_pp": round(spread, 4),
        "staleness": staleness,
        "caveats": CAVEATS,
    }
    (OUT / "cd_passthrough.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    render(df, out)
    return out


# ------------------------------------------------------------------ chart
C_LINE, C_HIKE, C_CUT = "#2a78d6", "#2a78d6", "#eb6834"
SURFACE, PAGE, INK, INK2, MUTED = ("#fcfcfb", "#f9f9f7", "#0b0b0b",
                                   "#52514e", "#898781")
GRID, BASE_C = "#e1e0d9", "#c3c2b7"


def render(df: pd.DataFrame, summary: dict) -> None:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    x = list(range(-PRE_W, POST_W + 1))
    paths = np.vstack([r for r in df["cum_path"]])
    mean = paths.mean(axis=0)
    q25 = np.percentile(paths, 25, axis=0)
    q75 = np.percentile(paths, 75, axis=0)

    fig = make_subplots(
        rows=1, cols=2, horizontal_spacing=0.08,
        subplot_titles=("전체 평균 경로 (IQR 밴드)", "인상 vs 인하"))
    fig.add_trace(go.Scatter(
        x=x + x[::-1], y=list(q75) + list(q25[::-1]), fill="toself",
        fillcolor="rgba(42,120,214,0.10)", line=dict(width=0),
        showlegend=False, hoverinfo="skip"), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=x, y=mean, mode="lines", line=dict(color=C_LINE, width=2.2),
        name="평균", showlegend=False,
        hovertemplate="D%{x:+d}: %{y:.2f}<extra></extra>"), row=1, col=1)
    for name, mask, color in [("인상", df.hike, C_HIKE),
                              ("인하", ~df.hike, C_CUT)]:
        sub = np.vstack([r for r in df.loc[mask, "cum_path"]])
        fig.add_trace(go.Scatter(
            x=x, y=sub.mean(axis=0), mode="lines", name=name,
            line=dict(color=color, width=2.2),
            hovertemplate="D%{x:+d}: %{y:.2f}<extra>" + name + "</extra>"),
            row=1, col=2)
    for col in (1, 2):
        fig.add_hline(y=1.0, line=dict(color=BASE_C, width=1, dash="dot"),
                      row=1, col=col)
        fig.add_hline(y=0.0, line=dict(color=BASE_C, width=1), row=1, col=col)
        fig.add_vline(x=0, line=dict(color=MUTED, width=1, dash="dot"),
                      row=1, col=col)
    fig.update_layout(
        template="none", height=430, width=1240,
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif',
                  color=INK, size=11),
        legend=dict(orientation="h", y=1.12, x=0.55,
                    font=dict(color=INK2)),
        margin=dict(l=54, r=24, t=64, b=44))
    fig.update_xaxes(gridcolor=GRID, linecolor=BASE_C,
                     tickfont=dict(color=MUTED), title_text="영업일 (D=발표)",
                     title_font=dict(size=11, color=MUTED))
    fig.update_yaxes(gridcolor=GRID, linecolor=BASE_C,
                     tickfont=dict(color=MUTED))
    for a in fig.layout.annotations:
        a.font = dict(size=12, color=INK2)

    h = summary["headline"]
    hl_txt = (f"{h['half_life_days']:.0f}영업일" if h["half_life_days"]
              else f">{POST_W}영업일 (우측중도절단 — "
                   f"{h['half_life_detail']['halved_within_window']}/"
                   f"{h['half_life_detail']['at_risk']}건만 창 내 반감)")
    header = f"""
    <div style="max-width:1240px;margin:0 auto;padding:16px 8px 4px;
                font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:{INK}">
      <h1 style="font-size:19px;margin:0 0 6px">기준금리 → CD 91일 전달 — 이벤트 스터디
        <span style="font-weight:400;color:{INK2}">2010–2026, 변경 이벤트 {summary['sample']['events']}건 ·
        {date.today().isoformat()}</span></h1>
      <div style="font-size:12px;color:{INK2};line-height:1.55">
        발표 전 선반영 <b>{h['pre_reflection_ratio']:.0%}</b> ·
        발표일 점프 <b>{h['jump_ratio']:.0%}</b> (D 종가 누적 {h['cum_at_D']:.0%}) ·
        잔여 갭 반감기 <b>{hl_txt}</b> · D+15 누적 {h['cum_at_D_plus_15']:.0%} 플래토
        → 어댑터 τ = {h['exp_tau_days_from_terminal']:.0f}영업일 (D→D+15 갭 감쇠 2점 추정) ·
        CD 무변동일 비중 {summary['staleness']['zero_change_share_all']:.0%}<br>
        <span style="color:{MUTED}">경로 = (CD − CD_{{D-10}}) / Δ기준금리, D-10 기준 누적반영률 ·
        {' · '.join(summary['caveats'][:1])}</span>
      </div>
    </div>"""
    body = fig.to_html(full_html=False, include_plotlyjs=True,
                       config={"displaylogo": False})
    html = (f"<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>CD transmission event study</title></head>"
            f"<body style='margin:0;background:{PAGE}'>{header}"
            f"<div style='max-width:1240px;margin:0 auto'>{body}</div>"
            f"</body></html>")
    (OUT / "cd_event_study.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    s = run()
    print(json.dumps({k: s[k] for k in ("headline", "sample", "splits",
                                        "staleness",
                                        "cd_base_spread_mean_pp")},
                     indent=2, ensure_ascii=False))
