# rv1_probe.py — REPORT_rv1 의 측정 스크립트 (C7/C8/C9/C11/C12/C13).
#
# READ-ONLY: 제품 모듈을 임포트해서 쓰기만 한다. 어떤 제품 파일도 수정하지
# 않고, SQL 은 app.mysqldb.read_sql(SELECT/SHOW/DESCRIBE 만 허용) 경유다.
# 실행:  cd backend && PYTHONUTF8=1 python ../docs/diagnostics/rv1_probe.py
#
# 재사용 경계 (rv1 규칙 C8 "roll 재구현 금지"):
#   - 가격       = app.cashbond.price          (cashbond.py:111)
#   - DV01       = app.cashbond.dv01_at        (cashbond.py:739)
#   - 이표 수     = app.cashbond.periods_for    (cashbond.py:101)
#   - 커브/보간   = app.creditmatrix.curve_points / interp (creditmatrix.py:234/252)
#   - 정책금리    = app.funding.series_for("base")  (funding.py:119)
#   - 금통위 달력 = app.policy.MPC_DATES        (policy.py:58)
# 이 스크립트가 새로 적는 것은 Appendix A 의 조달 레그(carry_net)와
# 볼록껍질/격자 스캔뿐이다 — roll 은 위 price() 호출 한 줄이다(cashbond.py:784 와
# 같은 호출, Δy 와 H 만 인자로 다르다).

import datetime as dt
import itertools
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

from app import creditmatrix as cm  # noqa: E402
from app.cashbond import dv01_at, periods_for, price  # noqa: E402
from app.mysqldb import read_sql  # noqa: E402
from app.policy import MPC_DATES  # noqa: E402

Q = read_sql

_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def add_months(d: dt.date, months: int) -> dt.date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    cap = 29 if (m == 2 and leap) else _DAYS[m - 1]
    return dt.date(y, m, min(d.day, cap))


def clean_of(y: float, coupon: float, n: int, elapsed: float) -> float:
    d, a, _cp, rd = price(y, coupon, n, elapsed)
    return d - a + rd


def avg_funding(base: float, meetings, start: dt.date, sale: dt.date, eff: int) -> float:
    """Appendix A: policy + Σ(Δbp × 미팅 뒤 남은 날)/eff/10000. base·반환 = decimal."""
    extra = 0.0
    for md, dbp in meetings:
        if start < md <= sale:
            extra += (dbp / 10000.0) * (sale - md).days
    return base + (extra / eff if eff else 0.0)


def candidate(points, label, start, base, meetings, h_months=6,
              elapsed_mode="grid", j_mode="grid"):
    """한 후보(커브 노드 합성 채권)의 Appendix A 값 일습. 수익률은 decimal."""
    years = cm.TENOR_YEARS[label]
    y0 = cm.interp(points, years)
    horizon = add_months(start, h_months)
    maturity = add_months(start, round(years * 12))
    sale = min(maturity, horizon)
    eff = (sale - start).days
    f = avg_funding(base, meetings, start, sale, eff)
    carry = (y0 - f) * eff / 365.0
    n = periods_for(label)
    h_years = h_months / 12.0
    if maturity <= horizon:  # 만기 보유 — 롤 없음, 재투자 0 (Appendix B 와 동일)
        return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                    roll=lambda dy: 0.0, dur=0.0, n=n, m_res=0.0, j=None)
    if j_mode == "grid":
        m_res = years - h_years
    else:
        m_res = (maturity - horizon).days / 365.0
    m_res = max(0.25, m_res)  # Appendix A 의 0.25Y 플로어 (B-5)
    j = cm.interp(points, m_res)
    elapsed = h_years if elapsed_mode == "grid" else eff / 365.0

    def roll(dy: float) -> float:
        return clean_of(j + dy, y0, n, elapsed) - 1.0

    c0 = clean_of(j, y0, n, elapsed)
    dur = (dv01_at(j, y0, n, elapsed) / c0) * 1e4 if c0 else 0.0  # 수정듀레이션(년)
    return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                roll=roll, dur=dur, n=n, m_res=m_res, j=j)


def tr(c, dy=0.0):
    return c["carry"] + c["roll"](dy)


def upper_hull(cands):
    """(dur, TR0) 상단 볼록껍질. dur 오름차순으로 훑으며 기울기 감소열만 남긴다."""
    pts = sorted(cands, key=lambda c: (c["dur"], -tr(c)))
    ded = []
    for c in pts:  # 같은 dur 는 TR 최대만
        if ded and abs(ded[-1]["dur"] - c["dur"]) < 1e-12:
            continue
        ded.append(c)
    hull: list = []
    for c in ded:
        while len(hull) >= 2:
            a, b = hull[-2], hull[-1]
            s1 = (tr(b) - tr(a)) / (b["dur"] - a["dur"])
            s2 = (tr(c) - tr(b)) / (c["dur"] - b["dur"])
            if s2 >= s1:
                hull.pop()
            else:
                break
        hull.append(c)
    # 오른쪽(고듀레이션) 가장자리도 껍질이다 — TR 이 낮아도 충분히 음(랠리)의
    # Δy 에서는 이긴다. 지배 필터를 걸면 KTB 30Y 같은 승자를 잘못 지운다(실측).
    return hull


def breakpoints(hull):
    """dur 내림차순 이웃 간 스왑 지점 Δy*(bp). Δy 가 커질수록 낮은 dur 로 간다."""
    hs = sorted(hull, key=lambda c: -c["dur"])
    out = []
    for a, b in zip(hs, hs[1:]):
        dy = (tr(a) - tr(b)) / (a["dur"] - b["dur"]) * 1e4
        out.append((a["label"], b["label"], dy))
    return out


def winners_in_window(cands, lo=-50, hi=50, step=1):
    """격자에서 선형화 승자와 그 구간 (Δy ∈ [lo,hi] bp). key = (sector,label)."""
    win: dict = {}
    for dy in range(lo, hi + 1, step):
        best = max(cands, key=lambda c: tr(c) - c["dur"] * dy / 1e4)
        key = (best.get("sector", "-"), best["label"])
        win.setdefault(key, []).append(dy)
    return win


# ═══════════════════════════════════ ANCHOR — Appendix B 재현 ═══════════════
print("=" * 78)
print("ANCHOR — Appendix B 재현 (특은채 = KDB, 2026-08-13 커브, H = 6M)")
SHEET = {"3M": 3.007, "6M": 3.279, "9M": 3.612, "1Y": 3.619,
         "1.5Y": 3.781, "2Y": 3.842, "2.5Y": 3.911, "3Y": 4.007}
EXPECT = {  # (total, carry, roll, BEP)  — Appendix B 표
    "3M": (1.07, 1.07, 0.0, None), "6M": (9.48, 9.48, 0.0, None),
    "9M": (40.91, 26.26, 14.64, 169.0), "1Y": (43.49, 26.62, 16.88, 88.8),
    "1.5Y": (50.62, 34.78, 15.84, 51.8), "2Y": (46.77, 37.86, 8.91, 32.2),
    "2.5Y": (54.50, 41.34, 13.17, 28.4), "3Y": (68.97, 46.17, 22.79, 29.1),
}
pts_sheet = [(cm.TENOR_YEARS[k], v / 100.0) for k, v in SHEET.items()]
BASE = 0.0275
print(f"금통위 달력(policy.MPC_DATES): {MPC_DATES}")

best = None
for start_d in (dt.date(2026, 8, 13), dt.date(2026, 8, 14)):
    for pair in itertools.combinations([d for d in MPC_DATES if d > start_d], 2):
        meetings = [(d, 25.0) for d in pair]
        c6 = candidate(pts_sheet, "6M", start_d, BASE, meetings)
        err = abs(c6["f"] * 100 - 3.091)
        if best is None or err < best[0]:
            best = (err, start_d, pair)
err, START, PAIR = best
MEET = [(d, 25.0) for d in PAIR]
print(f"조달 3.091% 역산: 시작일 {START}, 인상 회의 {PAIR} (오차 {err * 100:.3f}bp)")

print("규약 스캔 (elapsed × J 보간) — 셀 = max|Δ|bp (carry / roll, 롤 있는 6행):")
for em in ("grid", "act"):
    for jm in ("grid", "act"):
        rows = {k: candidate(pts_sheet, k, START, BASE, MEET,
                             elapsed_mode=em, j_mode=jm) for k in SHEET}
        dc = max(abs(rows[k]["carry"] * 1e4 - EXPECT[k][1]) for k in SHEET)
        dr = max(abs(rows[k]["roll"](0.0) * 1e4 - EXPECT[k][2]) for k in SHEET)
        print(f"  elapsed={em:4s} J={jm:4s}  carry {dc:5.2f}  roll {dr:5.2f}")

print("채택 규약(grid/grid)의 행별 대조 — 계산 vs Appendix B:")
print("      total(계산/기대)   carry(계산/기대)   roll(계산/기대)   BEP(계산/기대)")
CAND_SHEET = {}
for k in SHEET:
    c = candidate(pts_sheet, k, START, BASE, MEET)
    c["sector"] = "SHEET"
    CAND_SHEET[k] = c
    t, cy, ro = tr(c) * 1e4, c["carry"] * 1e4, c["roll"](0.0) * 1e4
    bep = (tr(c) / c["dur"] * 1e4) if c["dur"] else None
    eb = EXPECT[k][3]
    tail = f"{bep:7.1f}/{eb:7.1f}" if eb else "   만기보유"
    print(f"{k:5s} {t:7.2f}/{EXPECT[k][0]:7.2f}   {cy:7.2f}/{EXPECT[k][1]:7.2f}   "
          f"{ro:7.2f}/{EXPECT[k][2]:7.2f}   {tail}")

hull = upper_hull(list(CAND_SHEET.values()))
hull_labels = [c["label"] for c in sorted(hull, key=lambda c: -c["dur"])]
print(f"껍질 = {hull_labels}  (기대: 3Y 와 9M 이 창 안 승자)")
for a, b, dy in breakpoints(hull):
    print(f"  스왑 {a} -> {b}: dy* = {dy:+.1f}bp")
win = winners_in_window(list(CAND_SHEET.values()))
print("  창 안 승자: " + ", ".join(
    f"{k[1]}[{v[0]:+d}..{v[-1]:+d}]" for k, v in sorted(win.items(), key=lambda kv: kv[1][0])))

# ═══════════════════════════════════ 실데이터 로드 ═════════════════════════
print("=" * 78)
m = cm.load()
ASOF_I = len(m.dates) - 1
ASOF = m.dates[ASOF_I]
print(f"credit_matrix 로드: {len(m.dates)}일, asof = {ASOF}")

from app import funding as fnd  # noqa: E402

base_series = fnd.series_for("base")
last_rate = base_series[-1][1]
BASE_NOW = last_rate / 100.0 if last_rate > 1 else last_rate
print(f"정책금리(funding.series_for('base') 마지막): {base_series[-1]} -> {BASE_NOW}")

# ═══════════════ C8 — 레인 A 껍질 측정 (섹터별 + 전체 풀) ═══════════════════
print(f"\nC8 — 섹터별 껍질 (H=6M, 금통위 0, dy in [-50,+50]bp, asof={ASOF})")
ALL = {}
for bt in cm.TYPE_ORDER:
    points = cm.curve_points(m, bt, ASOF_I)
    labels = [lab for lab in cm.TENOR_LABELS
              if (bt, lab) in m.values and m.values[(bt, lab)][ASOF_I] is not None]
    cands = [candidate(points, lab, ASOF, BASE_NOW, []) for lab in labels]
    for c in cands:
        c["sector"] = bt
    ALL[bt] = cands
    h = upper_hull(cands)
    hs = sorted(h, key=lambda c: -c["dur"])
    bps = breakpoints(h)
    win = winners_in_window(cands)
    never = len(cands) - len(win)
    print(f"\n  [{bt}] 후보 {len(cands)} (테너 {labels[0]}~{labels[-1]})")
    print(f"    전구간 껍질 {len(h)}: {[c['label'] for c in hs]}")
    print("    창 안 승자 " + str(len(win)) + ": " + ", ".join(
        f"{k[1]}[{v[0]:+d}..{v[-1]:+d}]"
        for k, v in sorted(win.items(), key=lambda kv: kv[1][0])))
    inw = [f"{a}->{b} {dy:+.1f}bp" for a, b, dy in bps if -50 <= dy <= 50]
    print(f"    창 안 스왑점: {', '.join(inw) if inw else '없음'}")
    print(f"    창 밖 후보(필터율): {never}/{len(cands)} = {never / len(cands) * 100:.0f}%")

print("\nC8 — 전 섹터 풀 (후보 = 섹터x테너 전부)")
pool = [c for cands in ALL.values() for c in cands]
h = upper_hull(pool)
hs = sorted(h, key=lambda c: -c["dur"])
print(f"  후보 {len(pool)}, 전구간 껍질 {len(h)}: "
      + ", ".join(f"{c['sector']}.{c['label']}" for c in hs))
by_sector: dict = {}
for c in hs:
    by_sector[c["sector"]] = by_sector.get(c["sector"], 0) + 1
print(f"  껍질의 섹터 구성: {by_sector}")
win = winners_in_window(pool)
print("  창 안 승자(섹터.테너, 구간):")
for k, v in sorted(win.items(), key=lambda kv: kv[1][0]):
    print(f"    {k[0]}.{k[1]}  [{v[0]:+d} .. {v[-1]:+d}]")
wsec = sorted({k[0] for k in win})
print(f"  창 안 승자의 섹터 집합: {wsec}")

# ═══════════════ C12 — 볼록성: 선형화 vs 완전 재가격 순위 ═══════════════════
print("\nC12 — 볼록성 (재가격 vs 선형화, dy in [-50,+50], 1bp 격자)")


def rank_map(cands, key):
    order = sorted(cands, key=key, reverse=True)
    return {id(c): i for i, c in enumerate(order)}


for name, cands in [("KDB 단일섹터", ALL["KDB"]), ("전 섹터 풀", pool)]:
    worst = (0, None, None)
    affected = set()
    top1_diff = []
    for dy in range(-50, 51):
        rf = rank_map(cands, lambda c: tr(c, dy / 1e4))
        rl = rank_map(cands, lambda c: tr(c) - c["dur"] * dy / 1e4)
        for c in cands:
            d = abs(rf[id(c)] - rl[id(c)])
            if d > 0:
                affected.add((c["sector"], c["label"]))
            if d > worst[0]:
                worst = (d, dy, (c["sector"], c["label"]))
        t_f = max(cands, key=lambda c: tr(c, dy / 1e4))
        t_l = max(cands, key=lambda c: tr(c) - c["dur"] * dy / 1e4)
        if t_f is not t_l:
            top1_diff.append(dy)
    print(f"  [{name}] 최대 순위이동 {worst[0]}칸 (dy={worst[1]}bp, {worst[2]}) / "
          f"순위 달라진 후보 {len(affected)}/{len(cands)} / "
          f"1위 불일치 dy: {top1_diff if top1_diff else '없음'}")

# ═══════════════ C7 — 코드 대사: credit_matrix ↔ matrix_금융채 ═══════════════
print("\nC7 — credit_matrix 코드 <-> matrix_금융채(벤더 열 이름) 전 겹침일 대사")
TEN8 = ["3월이하", "6월이하", "9월이하", "1년이하", "1.5년이하", "2년이하",
        "2.5년이하", "3년이하"]
RTC = ["rt_3m", "rt_6m", "rt_9m", "rt_1y", "rt_18m", "rt_2y", "rt_30m", "rt_3y"]
for code, fam in [("KDB", "금융채산금채(이표)AAA"), ("BD", "금융채은행채AAA"),
                  ("CARD", "금융채카드채AA+"), ("OFB", "금융채기타금융채AA-")]:
    sel = ", ".join(f"`{fam}_{t}`" for t in TEN8)
    vend = {(r[0].date() if isinstance(r[0], dt.datetime) else r[0]): r[1:]
            for r in Q(f"SELECT date, {sel} FROM infomax.matrix_금융채 "
                       f"WHERE date >= '2020-01-02'")}
    ours = {r[0]: r[1:] for r in Q(
        f"SELECT bas_dt, {', '.join(RTC)} FROM sim_portfolio.credit_matrix "
        f"WHERE bond_type = '{code}' AND bas_dt >= '2020-01-02'")}
    def _f(x):  # matrix_금융채의 일부 열은 문자열이다(카드채 실측)
        if x is None or x == "":
            return None
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    common = sorted(set(vend) & set(ours))
    eq = sum(1 for d in common
             if all((_f(a) is None and (_f(b) is None or _f(b) == 0)) or
                    (_f(a) is not None and _f(b) is not None
                     and abs(_f(a) - _f(b)) < 1e-9)
                    for a, b in zip(vend[d], ours[d])))
    pct = eq / len(common) * 100 if common else 0.0
    print(f"  {code} <-> {fam}: 겹침 {len(common)}일, 8테너 전부 일치 {eq}일 ({pct:.1f}%)")

# ═══════════════ C9 — 이력 깊이 (섹터x테너, 스프레드) ═══════════════════════
print("\nC9 — 관측 깊이 (credit_matrix, 0->None 적용 후)")
print(f"  전체 날짜 수: {len(m.dates)} ({m.dates[0]} ~ {m.dates[-1]})")
print("  섹터x테너 비-None 관측수 (min~max), KTB 와 짝지어진 스프레드 관측수:")
for bt in cm.TYPE_ORDER:
    obs: dict = {}
    paired: dict = {}
    for lab in cm.TENOR_LABELS:
        v = m.values.get((bt, lab))
        if v is None:
            continue
        nn = sum(1 for x in v if x is not None)
        if nn == 0:
            continue
        obs[lab] = nn
        k = m.values.get(("KTB", lab))
        paired[lab] = (sum(1 for a, b in zip(v, k)
                           if a is not None and b is not None) if k else 0)
    lo, hi = min(obs.values()), max(obs.values())
    plo, phi = min(paired.values()), max(paired.values())
    short = {k2: v2 for k2, v2 in obs.items() if v2 < 1300}
    extra = f", 얕은 테너 {short}" if short else ""
    print(f"    {bt:5s} 테너 {len(obs)}: 관측 {lo}~{hi}, 스프레드쌍 {plo}~{phi}{extra}")

# ═══════════════ C11 — 섹터별 as-of / 최근 30영업일 결측 ═══════════════════
print("\nC11 — 섹터별 최신일과 최근 30영업일 결측 (영업일 = 12섹터 합집합 날짜)")
rows11 = Q("SELECT bond_type, MAX(bas_dt), COUNT(*) FROM sim_portfolio.credit_matrix "
           "GROUP BY bond_type ORDER BY bond_type")
for bt, mx, n in rows11:
    print(f"  {bt:5s} MAX(bas_dt)={mx}  rows={n}")
print("  최근 30영업일에 '전 테너 None' 인 섹터-일:")
any_miss = False
for bt in cm.TYPE_ORDER:
    miss = [m.dates[i] for i in range(len(m.dates) - 30, len(m.dates))
            if not cm.curve_points(m, bt, i)]
    if miss:
        any_miss = True
        print(f"    {bt}: {miss}")
if not any_miss:
    print("    (없음)")
irs_max = Q("SELECT MAX(irs_date) FROM sim_portfolio.mkt_irs_close")[0][0]
print(f"  mkt_irs_close MAX(irs_date) = {irs_max}")

# ═══════════════ C13 — 검증 프로토콜 데이터 지원 ═══════════════════════════
print("\nC13-A — 평행이동의 정의와 실현 6M 이동 시계열 (KTB)")
try:
    import numpy as np

    labs = [lab for lab in cm.TENOR_LABELS if ("KTB", lab) in m.values]
    mat = np.array([[(m.values[("KTB", lab)][i] if m.values[("KTB", lab)][i]
                      is not None else np.nan) for lab in labs]
                    for i in range(len(m.dates))], dtype=float)
    ok = ~np.isnan(mat).any(axis=1)
    d1 = np.diff(mat[ok], axis=0)
    cov = np.cov(d1.T)
    ev = np.linalg.eigvalsh(cov)[::-1]
    print(f"  KTB {len(labs)}노드 일간 delta 공분산 PC1 설명력: "
          f"{ev[0] / ev.sum() * 100:.1f}% (PC2 {ev[1] / ev.sum() * 100:.1f}%)")
    dates = [d for d, o in zip(m.dates, ok) if o]
    sub = mat[ok]
    shifts = []
    j = 0
    for i, d in enumerate(dates):
        tgt = add_months(d, 6)
        while j < len(dates) and dates[j] < tgt:
            j += 1
        if j >= len(dates):
            break
        if (dates[j] - tgt).days > 7:
            continue
        shifts.append(float((sub[j] - sub[i]).mean() * 100))  # bp
    sh = np.array(shifts)
    qs = np.percentile(sh, [5, 25, 50, 75, 95])
    print(f"  실현 6M 평행이동(노드평균) 시계열: {len(sh)}점(겹침), "
          f"분위 5/25/50/75/95 = {[f'{q:+.0f}' for q in qs]}bp, "
          f"|이동|>13.2bp 비율 {np.mean(np.abs(sh) > 13.2) * 100:.0f}%")
except Exception as e:  # noqa: BLE001
    print(f"  numpy 경로 실패: {e}")

print("\nC13-B — 종목단위 패널 (kbond.marketvalue)")
r = Q("SELECT COUNT(*), MIN(bonddate), MAX(bonddate), COUNT(DISTINCT isin), "
      "COUNT(DISTINCT bonddate) FROM kbond.marketvalue")[0]
print(f"  전체 {r[0]}행, {r[1]} ~ {r[2]}, ISIN {r[3]}, 날짜 {r[4]}")
r = Q("SELECT COUNT(*) FROM kbond.marketvalue WHERE estcompgb='3사평균' "
      "AND bonddate='2026-08-14'")[0]
print(f"  2026-08-14 3사평균 종목 수: {r[0]}")
rows = Q("SELECT cnt, COUNT(*) FROM (SELECT isin, COUNT(DISTINCT bonddate) cnt "
         "FROM kbond.marketvalue WHERE estcompgb='3사평균' GROUP BY isin) t "
         "GROUP BY cnt ORDER BY cnt DESC LIMIT 5")
print(f"  종목별 재적일수 상위 5개 계급: {rows}")
rows = Q("SELECT COUNT(*) FROM (SELECT isin FROM kbond.marketvalue "
         "WHERE bonddate='2026-02-06' AND estcompgb='3사평균') a "
         "JOIN (SELECT isin FROM kbond.marketvalue WHERE bonddate='2026-08-14' "
         "AND estcompgb='3사평균') b ON a.isin=b.isin")
print(f"  2026-02-06 재적 종목 중 2026-08-14 에도 재적: {rows[0][0]}")
r = Q("SELECT COUNT(*), SUM(estdanga IS NOT NULL), SUM(duration IS NOT NULL) "
      "FROM kbond.marketvalue WHERE estcompgb='3사평균'")[0]
print(f"  3사평균 행 {r[0]}: 단가 보유 {r[1]}, 듀레이션 보유 {r[2]}")
print("\nC13-B — 국고통_민평 (infomax) 최근 3행 샘플")
for r in Q("SELECT * FROM infomax.`국고통_민평` ORDER BY `일자` DESC LIMIT 3"):
    print(f"  {r}")

# ═══════════════ C7 — 종목단위 유니버스 스냅샷 ═════════════════════════════
print("\nC7 — 종목단위 스냅샷 2026-08-14 (marketvalue 3사평균 x bond_info)")
rows = Q("SELECT b.big, COUNT(*), SUM(b.rpy_dt IS NULL) FROM kbond.marketvalue mm "
         "LEFT JOIN kbond.bond_info b ON mm.isin=b.isin "
         "WHERE mm.bonddate='2026-08-14' AND mm.estcompgb='3사평균' "
         "GROUP BY b.big ORDER BY 2 DESC")
for r in rows:
    print(f"  {r}")
print("  bond_info 에 없는 ISIN 샘플:")
for r in Q("SELECT mm.isin FROM kbond.marketvalue mm LEFT JOIN kbond.bond_info b "
           "ON mm.isin=b.isin WHERE mm.bonddate='2026-08-14' "
           "AND mm.estcompgb='3사평균' AND b.isin IS NULL LIMIT 8"):
    print(f"    {r[0]}")
print("\nC7/C13 보강 — 값 의미와 적격성")
r = Q("SELECT COUNT(*), MIN(`민평`), MAX(`민평`), AVG(`민평`) "
      "FROM infomax.`국고통_민평` WHERE `일자`='2026-08-14'")[0]
print(f"  국고통_민평 2026-08-14: n={r[0]}, min={r[1]}, max={r[2]}, avg={r[3]:.3f}")
print("  최저/최고 5종목:")
for r in Q("SELECT `종목코드`, `민평` FROM infomax.`국고통_민평` "
           "WHERE `일자`='2026-08-14' ORDER BY `민평` ASC LIMIT 5"):
    print(f"    {r}")
for r in Q("SELECT `종목코드`, `민평` FROM infomax.`국고통_민평` "
           "WHERE `일자`='2026-08-14' ORDER BY `민평` DESC LIMIT 5"):
    print(f"    {r}")
print("  marketvalue 2026-08-14 3사평균 estyld 범위:")
r = Q("SELECT MIN(estyld), MAX(estyld), AVG(estyld) FROM kbond.marketvalue "
      "WHERE bonddate='2026-08-14' AND estcompgb='3사평균'")[0]
print(f"    min={r[0]}, max={r[1]}, avg={r[2]:.3f}")
print("  잔존만기 분포 (marketvalue x bond_info.rpy_dt, 2026-08-14):")
for r in Q("SELECT CASE WHEN b.rpy_dt IS NULL THEN 'no-meta' "
           "WHEN DATEDIFF(b.rpy_dt,'2026-08-14') < 91 THEN '<3M' "
           "WHEN DATEDIFF(b.rpy_dt,'2026-08-14') < 365 THEN '3M-1Y' "
           "WHEN DATEDIFF(b.rpy_dt,'2026-08-14') < 1095 THEN '1-3Y' "
           "WHEN DATEDIFF(b.rpy_dt,'2026-08-14') < 3650 THEN '3-10Y' "
           "ELSE '10Y+' END bkt, COUNT(*) FROM kbond.marketvalue mm "
           "LEFT JOIN kbond.bond_info b ON mm.isin=b.isin "
           "WHERE mm.bonddate='2026-08-14' AND mm.estcompgb='3사평균' "
           "GROUP BY bkt ORDER BY 2 DESC"):
    print(f"    {r}")
r = Q("SELECT COUNT(*) FROM (SELECT isin, COUNT(*) c FROM kbond.marketvalue "
      "WHERE bonddate='2026-08-14' AND estcompgb='3사평균' "
      "GROUP BY isin HAVING c > 1) t")[0]
print(f"  같은 날 같은 평가구분에 중복 ISIN: {r[0]}")

print("\n끝. (이 스크립트는 아무것도 쓰지 않았다 — stdout 뿐)")
