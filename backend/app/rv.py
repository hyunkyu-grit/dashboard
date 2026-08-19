# -*- coding: utf-8 -*-
"""RV Analysis — Strategy 섹션의 세 구성 (rv2) [OWNER — "RV = v2 Strategy 섹션"].

근거 문서는 v1 `docs/diagnostics/REPORT_rv1.md`(커밋 25f293ac)와 그 측정
스크립트 `rv1_probe.py` 다. 이 모듈은 그 프로브의 **앵커 검증된 규약**
(Appendix B 8행 재현: carry ≤0.01bp · roll ≤0.37bp · 스왑점 13.0 vs 13.2bp)을
제품 코드로 올린 것이고, `tests/test_rv.py` 의 상주 앵커가 그 재현을 지킨다.

## 재사용 경계 — 롤·가격·DV01 재구현 금지 [세션 규칙]

    가격       cashbond.price
    DV01       cashbond.dv01_at
    이표 수     cashbond.periods_for
    커브/보간   creditmatrix.curve_points / interp
    조달       funding.rate_on (Setting 의 스펙 그대로 — v2 기본 = 콜금리.
               기준금리 테이블이 멈춰 base 가 실패 상태인 결정을 그대로 경유한다)
    금통위 달력 policy.MPC_DATES (calendar.json 이중사본 + 대조테스트 구조)

이 파일이 새로 적는 수식은 Appendix A 의 조달 레그(`avg_funding`)와
볼록껍질/스왑점/백분위뿐이다. `roll` 은 `cashbond.price` 호출 한 줄이다.

## 그레인 [rv1 C7 확정, OWNER]

후보 = **섹터×테너 커브 격자**(신용 종목 민평은 DB 에 존재하지 않는다 —
kbond.marketvalue 는 국고·통안 ~99종목뿐). 종목 단위는 쓰지 않는다.

## 세 구성

  A. 동일섹터 레인 — 만기 × Δy 격자, 칸 = H(6M) 보유 총수익 bp.
     **결정 숫자는 밴드가 아니라 스왑점 목록이다** — 1bp 격자는 껍질 멤버를
     건너뛴다(rv1 실측: KDB 10Y 의 승리 구간 +5.2~+5.7bp 는 정수 bp 를 하나도
     안 품는다). 섹터 안은 선형화로 충분(C12: 1위 불일치 0), **풀 경계만
     재가격 이분법으로 다듬는다**(C12: 선형화 경계가 ±1bp 이동, 그 ±1bp 가
     화면의 결정 숫자로 나가므로).
  B. 동일테너 레인 — 섹터 × 만기 히트맵, 칸 = 스프레드의 **랭크 백분위**
     [OWNER — 총수익 절대 금지: 풀 껍질 6장 중 5장을 최고 스프레드 섹터(OFB)가
     독점하는 실측이 그 이유의 형태다].
  C. 크레딧 RV — 트레이더 설계안(2026-08-18, "참고사항" 명시) 반영. 아래
     "크레딧 RV 의 계산 정의" 절이 코드보다 먼저 쓰인 문서다.

## 용어 규율

"껍질"(전 Δy 상단 볼록껍질)과 "창 안 승자"(Δy ∈ [−50,+50]bp 에서 실제로
이기는 것)는 **다른 집합이다** — 앵커 커브의 6M(D=0)은 껍질에 있지만 스왑점이
+128bp 라 창 밖이다(rv1 PN-2). 페이로드가 둘을 딴 이름으로 싣고, 화면도 딴
이름으로 부른다.

## 크레딧 RV 의 계산 정의 [트레이더 설계안 — 원칙은 따르고, 참고는 출발값]

**원칙 넷**: ① 절대축(버퍼)·상대축(RV)을 독립 숫자로 먼저, 합성은 그 다음
② BEP 는 **크레딧 스프레드 축** — 금리 효과는 듀레이션 영역이라 이 화면 밖
(화면 각주 의무) ③ 점수화는 level 이 아니라 **deviation 만**(수준을 점수화하면
최고 스프레드 섹터가 늘 이긴다 — 레인 B 금지의 같은 실측) ④ 버퍼는 bp 하나로
주지 않고 σ 보정을 병기("+12bp (1.5σ)").

**BEP Buffer (스프레드 bp)** — H(기본 3M) 보유의 캐리&롤이 흡수하는 스프레드
확대폭. **국고 헤지 페어**(채권 매수 + 같은 만기 국고 매도)로 정의한다:

    carry_money = (y_bond − f)·t − (y_ktb − f)·t     f = funding 모듈의 조달
    roll_money  = roll_bond(0) − roll_ktb(0)          둘 다 price() 재가격
    buffer_bp   = (carry + roll) ÷ 매도시점 스프레드 DV01 × 10⁴
    BEP Spread  = 지금 스프레드 + buffer

조달 f 는 두 다리에 같게 붙어 **페어에서 소거된다** — carry_net = 캐리 − 조달
규약을 다리별로 경유한 결과가 정확히 스프레드 발생분이고, 그래서 금리(조달)
효과가 이 축에 남지 않는 것이 원칙 ② 의 산술적 형태다 [조정 보고: 트레이더
문안의 "조달 = funding 모듈"은 경유하되 페어에서 상쇄된다]. 분모의 스프레드
DV01 은 헤지가 DV01 매칭이라는 가정 아래 채권 다리의 매도시점 D_mod 다.
앵커 예제(스프레드 70bp·캐리 ≈7bp·롤 ≈5bp → BEP ≈82bp)는 `tests/test_rv.py`
의 상주 pytest 다 — 캐리의 1차 형태는 s×t ÷ D (70×0.25÷2.5 ≈ 7).

**BEP Coverage (σ)** = Buffer ÷ 3M 실현 스프레드 변동성. 변동성 = 겹침 63영업일
스프레드 변화의 표준편차(창 = 52주/전체 토글과 같은 창).

**Relative RV (σ)** = z 3성분 합성, 가중 40/40/20 (출발값 — 조건 바에 노출):

    ① 절대 스프레드 RV   z(자기 이력) + 백분위 + Fair(창 평균) 대비 Cheapness bp
    ② 섹터 상대 RV       같은 테너의 **횡단면(섹터 간) 평균 대비 편차**의 z
    ③ 커브 RV            같은 섹터 **커브(테너 간) 평균 대비 편차**의 z

셋 다 deviation 이라 원칙 ③ 을 지킨다. 창 = 52주 기본·전체(2020~, 6.6년) 토글,
0=결측 규칙은 상류(creditmatrix)가 이미 지킨다.

**Total RV Score (0~100)** = 절대축과 상대축을 50:50 [출발값]. **랭킹이지
투자판단이 아니다** — 화면이 그 명구를 의무로 달고, 별·메달·추천 문구는 없다.

절대축의 점수 입력은 Coverage 의 **자기 이력 대비 백분위**(covPct)다 — 오늘
Coverage 원값을 오늘 후보들 사이에서 랭크하면 스프레드 수준(=신용위험
프리미엄)이 점수로 통과해 최고 스프레드 섹터의 단기물이 표를 독식한다
[OWNER 2026-08-19 — "크레딧 리스크가 반영되지 않아 회사채 단기물이 가장
매력적으로 보인다"; 레인 B 가 총수익 셀을 금지한 그 병리(OFB 독점)가 합성층의
Coverage 경로로 재침입한 형태이고, 원칙 ③(deviation 만 점수화)의 우회였다].

covPct 의 이력 근사: buffer ≈ k·s (캐리 1차 = s·t/D) 이므로 Coverage(t) 의
분포 위치는 **covProxy(t) = s(t) ÷ vol3m(t)** 의 위치와 같다(상수배는 백분위
불변). vol3m(t) 는 각 시점까지의 겹침 63일 변화 σ(같은 창 규칙, 최소 26관측).
동률은 midrank 로 센다(`mid_rank_pct` — 상수 계열이 100%로 읽히면 "늘
후하다"가 되는 왜곡; 기존 `rank_pct` 와 **다른 통계라 다른 이름**).

**랭크 Δ** [OWNER 2026-08-19] = 전 영업일 랭크 − 오늘 랭크(양수 = 올라옴).
전일 랭크는 전일까지의 이력만 아는 세계에서 통째로 다시 계산한다(`_credit_items`
의 end_i) — 미래 참조 금지의 형태다.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from . import creditmatrix as cm
from . import funding as fd
from .cashbond import dv01_at, periods_for, price
from .policy import MPC_DATES

# ── Δy 창과 격자 ────────────────────────────────────────────────────────────
#: 창 [−50, +50]bp — rv1 의 측정 창 그대로. 화면의 격자 열은 10bp 걸음이지만
#: (읽는 밀도), 결정 숫자는 아래 스왑점 목록이다.
WINDOW_BP = 50
GRID_STEP_BP = 10

#: 숏(헤지) 가능 만기와 수단 [OWNER — 주간 세션 제약 그대로. 5년 숏 불가].
SHORTABLE: dict[float, str] = {1.0: "IRS", 1.5: "IRS", 2.0: "IRS", 3.0: "IRS·선물", 10.0: "선물"}

#: 크레딧 RV 랭킹의 만기 상한 [OWNER 2026-08-19 — "10년 초과 테너는 반영하지
#: 않는 걸로"]. 20Y·30Y 는 고시 인공산물 위험이 크고 헤지 수단도 없다 —
#: 후보에서 아예 빼되, 조용히 빼지 않고 exclusions 가 사유를 싣는다.
RANK_MAX_YEARS = 10.0

#: 랭크 백분위의 창 — 52주는 기존 수준 통계(derive.ANNUAL_OBS)와 같은 252관측,
#: 전체 이력은 movePct 와 같은 규칙(민평은 2020~ 라 6.6년이 된다 — rv1 PN-1).
ANNUAL_OBS = 252

_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def add_months(d: dt.date, months: int) -> dt.date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    cap = 29 if (m == 2 and leap) else _DAYS[m - 1]
    return dt.date(y, m, min(d.day, cap))


def _clean(y: float, coupon: float, n: int, elapsed: float) -> float:
    d, a, _cp, rd = price(y, coupon, n, elapsed)
    return d - a + rd


def avg_funding(
    base: float, meetings: list[tuple[dt.date, float]], start: dt.date, sale: dt.date, eff: int
) -> float:
    """Appendix A 의 조달 레그: base + Σ(Δbp × 회의 뒤 남은 날)/유효일/10⁴.

    base·반환은 decimal. 후보별 유효기간(만기 보유는 자기 만기까지) 안의 회의만
    친다 — 조달 3.091% 역산(시작 2026-08-14, +25bp 회의 08-27·11-26, 오차
    0.003bp)이 이 식의 앵커다.
    """
    extra = 0.0
    for md, dbp in meetings:
        if start < md <= sale:
            extra += (dbp / 10000.0) * (sale - md).days
    return base + (extra / eff if eff else 0.0)


def candidate(
    points: list[tuple[float, float]],
    label: str,
    start: dt.date,
    base: float,
    meetings: list[tuple[dt.date, float]],
    h_months: int = 6,
) -> dict[str, Any]:
    """한 후보(커브 노드 합성 채권)의 Appendix A 값 일습. 수익률은 decimal.

    규약은 앵커가 채택한 grid/grid 다: elapsed = H(년), 매도시점 잔존 =
    격자년수 − H(0.25Y 플로어). 이 규약 쌍이 Appendix B 와 carry 0.01bp 이내로
    맞았다(다른 조합은 최대 0.4bp) — 바꾸면 앵커 테스트가 막는다.
    """
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
    if maturity <= horizon:
        # 만기 보유 — 롤 없음, 재투자 0 (Appendix B 와 동일). 듀레이션 0 이므로
        # BEP(버퍼)는 정의되지 않는다 — 금리 위험이 없다.
        return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                    roll=(lambda dy: 0.0), dur=0.0, n=n, m_res=0.0, j=None)
    m_res = max(0.25, years - h_years)
    j = cm.interp(points, m_res)
    elapsed = h_years

    def roll(dy: float) -> float:
        return _clean(j + dy, y0, n, elapsed) - 1.0

    c0 = _clean(j, y0, n, elapsed)
    dur = (dv01_at(j, y0, n, elapsed) / c0) * 1e4 if c0 else 0.0  # 매도시점 수정듀레이션(년)
    return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                roll=roll, dur=dur, n=n, m_res=m_res, j=j)


def tr(c: dict, dy: float = 0.0) -> float:
    """H 보유 총수익(decimal) — 완전 재가격이다(롤이 price 호출이므로)."""
    return c["carry"] + c["roll"](dy)


def upper_hull(cands: list[dict]) -> list[dict]:
    """(dur, TR₀) 상단 볼록껍질 — dur 오름차순, 기울기 감소열만 남긴다.

    **오른쪽(고듀레이션) 가장자리도 껍질이다.** TR 이 낮아도 충분히 음의
    Δy(랠리)에서는 이긴다 — 지배 필터를 걸면 KTB 30Y 같은 승자를 잘못
    지운다(rv1 실측 그대로).
    """
    pts = sorted(cands, key=lambda c: (c["dur"], -tr(c)))
    ded: list[dict] = []
    for c in pts:  # 같은 dur 는 TR 최대만
        if ded and abs(ded[-1]["dur"] - c["dur"]) < 1e-12:
            continue
        ded.append(c)
    hull: list[dict] = []
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
    return hull


def breakpoints(hull: list[dict]) -> list[tuple[dict, dict, float]]:
    """dur 내림차순 이웃 간 **선형화** 스왑점 Δy*(bp) — Δy 가 커질수록 낮은
    dur 로 간다. 섹터 안은 이걸로 충분하다(C12: 1위 불일치 0)."""
    hs = sorted(hull, key=lambda c: -c["dur"])
    out = []
    for a, b in zip(hs, hs[1:]):
        dy = (tr(a) - tr(b)) / (a["dur"] - b["dur"]) * 1e4
        out.append((a, b, dy))
    return out


def refine_breakpoint(a: dict, b: dict, dy_lin: float, span_bp: float = 5.0) -> float:
    """풀 경계의 스왑점을 **재가격 이분법**으로 다듬는다(C12: 선형화 경계가
    최대 ±1bp 이동하고, 그 숫자가 그대로 화면의 결정 숫자다).

    g(dy) = TR_a(dy) − TR_b(dy) 의 부호가 [dy*−span, dy*+span] 안에서 바뀌는
    구간을 찾아 1e-3bp 까지 좁힌다. 안 바뀌면(순수 접선 등) 선형화 값을 그대로
    돌려준다 — 지어내지 않는다.
    """
    def g(dy_bp: float) -> float:
        d = dy_bp / 1e4
        return tr(a, d) - tr(b, d)

    lo, hi = dy_lin - span_bp, dy_lin + span_bp
    glo, ghi = g(lo), g(hi)
    if glo == 0.0:
        return lo
    if ghi == 0.0:
        return hi
    if glo * ghi > 0:
        return dy_lin
    for _ in range(40):
        mid = (lo + hi) / 2.0
        gm = g(mid)
        if gm == 0.0:
            return mid
        if glo * gm < 0:
            hi, ghi = mid, gm
        else:
            lo, glo = mid, gm
    return (lo + hi) / 2.0


def winners_in_window(cands: list[dict], lo: int = -WINDOW_BP, hi: int = WINDOW_BP) -> dict:
    """1bp 격자에서 재가격 승자와 그 구간. **표시 보조**다 — 결정 숫자는 스왑점
    목록이다(격자는 껍질 멤버를 건너뛸 수 있다 — 모듈 독스트링의 실측)."""
    win: dict[tuple[str, str], list[int]] = {}
    for dy in range(lo, hi + 1):
        best = max(cands, key=lambda c: tr(c, dy / 1e4))
        key = (best.get("sector", "-"), best["label"])
        win.setdefault(key, []).append(dy)
    return win


# ── 스프레드 통계 (레인 B 와 크레딧 RV) ─────────────────────────────────────


def aligned_spread(m: cm.CreditMatrix, bt: str, label: str) -> list[float | None] | None:
    """섹터 − KTB 동일 테너 스프레드(bp), `m.dates` 에 **자리 맞춤**. 한 다리가
    빈 날은 None — 이월하면 없던 스프레드를 지어낸다(universe._align 의 판단).
    자리를 맞추는 이유는 횡단면(섹터 간·테너 간) 평균이 **같은 날끼리** 서야
    하기 때문이다."""
    a = m.values.get((bt, label))
    k = m.values.get(("KTB", label))
    if a is None or k is None:
        return None
    out: list[float | None] = [
        None if x is None or y is None else (x - y) * 100.0 for x, y in zip(a, k)
    ]
    return out if any(v is not None for v in out) else None


def spread_series(m: cm.CreditMatrix, bt: str, label: str) -> list[float] | None:
    """위의 압축판 — 관측이 있는 날만. 레인 B 백분위가 먹는 모양."""
    al = aligned_spread(m, bt, label)
    if al is None:
        return None
    out = [v for v in al if v is not None]
    return out or None


def window_vals(seq: list[float | None], window: str) -> list[float]:
    """창 적용 후 관측만 — 52주는 마지막 252**일**(자리 기준), 전체는 전부."""
    xs = seq if window == "all" else seq[-ANNUAL_OBS:]
    return [v for v in xs if v is not None]


def vol_3m(seq: list[float | None], window: str) -> float | None:
    """3M(63영업일) 실현 스프레드 변동성 — 겹침 변화의 표준편차(bp).

    Coverage 의 분모다. 관측이 얇으면(변화 26개 = 약 한 분기 미만) None —
    지어낸 σ 로 나눈 배수는 숫자처럼 보이는 잡음이다."""
    step = 63
    ch = [seq[i] - seq[i - step]  # type: ignore[operator]
          for i in range(step, len(seq))
          if seq[i] is not None and seq[i - step] is not None]
    ch = ch if window == "all" else ch[-ANNUAL_OBS:]
    if len(ch) < 26:
        return None
    mean = sum(ch) / len(ch)
    var = sum((v - mean) ** 2 for v in ch) / (len(ch) - 1)
    return var ** 0.5 if var > 0 else None


def rank_pct(series: list[float], now: float) -> float:
    """랭크 백분위 — now 이하 관측의 비율(%). 기존 `pct`(52주 min-max 위치)와
    **다른 통계라 다른 이름**을 쓴다. 중앙(50)에서의 이탈이 레인 B 틴트다."""
    n = len(series)
    if n == 0:
        return 50.0
    return sum(1 for v in series if v <= now) / n * 100.0


def mid_rank_pct(series: list[float], now: float) -> float:
    """midrank 백분위 — 동률을 절반으로 센다. `rank_pct`(≤ 전부)와 **다른
    통계라 다른 이름**: covPct 처럼 동률이 정상 상태인 계열(변화 없는 날들)에서
    ≤-셈은 상수 구간을 100%("늘 후하다")로 읽는 왜곡이 있다."""
    n = len(series)
    if n == 0:
        return 50.0
    less = sum(1 for v in series if v < now)
    ties = sum(1 for v in series if v == now)
    return (less + ties / 2.0) / n * 100.0


def coverage_hist_series(seq: list[float | None]) -> list[float | None]:
    """covProxy(t) = s(t) ÷ vol3m(t) — Coverage 의 자기 이력 근사(모듈
    독스트링). vol3m(t) 는 t 까지의 겹침 63일 변화 중 **마지막 252자리 창**의
    σ(최소 26관측) — 오늘 하나만 계산하던 `vol_3m` 의 시점별 판이고, 롤링
    누적합으로 O(n) 이다(74계열 × 1,600일 × 2회가 요청 경로에 있다)."""
    step = 63
    win = ANNUAL_OBS
    n = len(seq)
    out: list[float | None] = [None] * n
    # 창 안 유효 변화의 (개수, 합, 제곱합) — 자리 기준 롤링.
    ch: list[float | None] = [None] * n
    m = 0
    s1 = 0.0
    s2 = 0.0
    for i in range(n):
        if i >= step and seq[i] is not None and seq[i - step] is not None:
            ch[i] = seq[i] - seq[i - step]  # type: ignore[operator]
            m += 1
            s1 += ch[i]  # type: ignore[arg-type]
            s2 += ch[i] * ch[i]  # type: ignore[operator]
        j = i - win  # 창을 벗어나는 자리
        if j >= 0 and ch[j] is not None:
            m -= 1
            s1 -= ch[j]  # type: ignore[arg-type]
            s2 -= ch[j] * ch[j]  # type: ignore[operator]
        if seq[i] is None or m < 26:
            continue
        var = (s2 - s1 * s1 / m) / (m - 1)
        if var <= 0:
            continue
        out[i] = seq[i] / (var**0.5)  # type: ignore[operator]
    return out


def z_score(series: list[float], now: float) -> float | None:
    n = len(series)
    if n < 2:
        return None
    mean = sum(series) / n
    var = sum((v - mean) ** 2 for v in series) / (n - 1)
    sd = var ** 0.5
    return (now - mean) / sd if sd > 0 else None


# ── 페이로드 ────────────────────────────────────────────────────────────────


def parse_meetings(raw: str) -> list[tuple[dt.date, float]]:
    """`2026-08-27:-25;2026-10-22:0` → [(date, bp)]. 모양이 안 맞는 조각은
    **거절한다**(422 로) — 반쯤 해석한 경로로 계산하면 조용히 틀린다."""
    out: list[tuple[dt.date, float]] = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        d, _, bp = part.partition(":")
        out.append((dt.date.fromisoformat(d), float(bp)))
    return out


def _sector_block(
    m: cm.CreditMatrix, bt: str, asof_i: int, start: dt.date,
    base: float, meetings: list[tuple[dt.date, float]], h_months: int,
    dys: list[int],
) -> tuple[dict[str, Any], list[dict]]:
    points = cm.curve_points(m, bt, asof_i)
    labels = [lab for lab in cm.TENOR_LABELS
              if (bt, lab) in m.values and m.values[(bt, lab)][asof_i] is not None]
    cands = [candidate(points, lab, start, base, meetings, h_months) for lab in labels]
    for c in cands:
        c["sector"] = bt

    hull = upper_hull(cands)
    hull_set = {id(c) for c in hull}
    bps = breakpoints(hull)
    win = winners_in_window(cands)

    rows = []
    for c in cands:
        key = (bt, c["label"])
        rng = win.get(key)
        rows.append({
            "tenor": c["label"],
            "years": c["years"],
            # 매도시점 수정듀레이션 — BEP 의 분모이자 격자의 기울기.
            "dur": round(c["dur"], 4),
            "carryBp": round(c["carry"] * 1e4, 2),
            "rollBp": round(c["roll"](0.0) * 1e4, 2),
            "trBp": round(tr(c) * 1e4, 2),
            # 불리 평행이동을 몇 bp 버티나. 만기 보유는 금리 위험이 없어 None.
            "bepBp": round(tr(c) / c["dur"] * 1e4, 1) if c["dur"] else None,
            "maturityHold": c["dur"] == 0.0,
            "inHull": id(c) in hull_set,
            "winFrom": rng[0] if rng else None,
            "winTo": rng[-1] if rng else None,
            # 격자 열 — 완전 재가격(롤이 price 호출이므로 공짜다). 표시 밀도용.
            "tr": [round(tr(c, dy / 1e4) * 1e4, 1) for dy in dys],
        })

    block = {
        "id": bt,
        "label": cm.BOND_TYPES[bt],
        "candidates": rows,
        # 결정 숫자 — 선형화 스왑점(C12: 섹터 안은 1위 불일치 0). 창 안만 싣되
        # 전 구간 껍질 구성은 candidates.inHull 이 말한다.
        "swapPoints": [
            {"from": a["label"], "to": b["label"], "dyBp": round(dy, 1)}
            for a, b, dy in bps if -WINDOW_BP <= dy <= WINDOW_BP
        ],
        "filtered": len(cands) - len(win),
    }
    return block, cands


def build_rv(
    m: cm.CreditMatrix,
    dataset,
    spec: fd.FundingSpec,
    h_months: int = 6,
    meetings: list[tuple[dt.date, float]] | None = None,
    window: str = "52w",
) -> dict[str, Any]:
    """세 구성의 페이로드 전부 — 다섯 파생량(carry_net·roll·매도 듀레이션·BEP·
    스왑점)을 서버가 끝낸다(§16). 프런트는 틴트만.

    `dataset` 은 IRS 싱글턴(main._dataset) — 자산스왑 버퍼와 **소스별 as-of**
    (IRS 와 민평이 1영업일 갈라진 실측 — rv1 C11/B-2)에 쓴다.
    """
    meetings = meetings or []
    asof_i = len(m.dates) - 1
    start = m.dates[asof_i]
    # 조달 = Setting 의 스펙 그대로 (v2 기본 콜금리 — funding.py V2 절의 결정을
    # 경유한다). 금통위 Δbp 는 avg_funding 이 그 위에 얹는다.
    base = fd.rate_on(spec, start)

    dys = list(range(-WINDOW_BP, WINDOW_BP + 1, GRID_STEP_BP))

    sectors = []
    pool: list[dict] = []
    for bt in cm.TYPE_ORDER:
        block, cands = _sector_block(m, bt, asof_i, start, base, meetings, h_months, dys)
        sectors.append(block)
        pool.extend(cands)

    # ── 풀 — 껍질은 선형화로, 경계는 재가격 이분법으로 (C12) ────────────────
    pool_hull = upper_hull(pool)
    pool_bps = []
    for a, b, dy_lin in breakpoints(pool_hull):
        dy = refine_breakpoint(a, b, dy_lin)
        pool_bps.append({
            "from": {"sector": a["sector"], "tenor": a["label"]},
            "to": {"sector": b["sector"], "tenor": b["label"]},
            "dyBp": round(dy, 1),
            "dyLinearBp": round(dy_lin, 1),
        })
    pool_win = winners_in_window(pool)

    # ── 레인 B — 섹터 × 테너 랭크 백분위 히트맵 ────────────────────────────
    credit = [bt for bt in cm.TYPE_ORDER if bt != "KTB"]
    heat_tenors = [lab for lab in cm.TENOR_LABELS
                   if any((bt, lab) in m.values for bt in credit)]
    heat_rows = []
    for bt in credit:
        cells: list[dict | None] = []
        for lab in heat_tenors:
            s = spread_series(m, bt, lab)
            if s is None or len(s) < 2:
                cells.append(None)
                continue
            now = s[-1]
            w52 = s[-ANNUAL_OBS:]
            cells.append({
                "tenor": lab,
                "nowBp": round(now, 1),
                "pct52": round(rank_pct(w52, now), 1),
                "pctAll": round(rank_pct(s, now), 1),
                "z52": (lambda z: None if z is None else round(z, 2))(z_score(w52, now)),
                "zAll": (lambda z: None if z is None else round(z, 2))(z_score(s, now)),
                "obs": len(s),
            })
        heat_rows.append({"id": bt, "label": cm.BOND_TYPES[bt], "cells": cells})

    # ── C — 크레딧 RV (정의는 모듈 독스트링 — 코드보다 먼저 쓴 문서) ───────
    credit_payload = credit_block(m, spec, meetings, window)

    return {
        # 소스별 as-of — 장식이 아니라 차단 사항(rv1 B-2: IRS 08-17 vs 민평
        # 08-14 실측). 두 숫자가 다른 날짜를 말하면 화면이 그렇다고 말해야 한다.
        "asof": {
            "creditMatrix": m.asof.isoformat(),
            "irs": dataset.asof.isoformat() if dataset is not None else None,
        },
        "funding": fd.provenance(spec),
        "hMonths": h_months,
        "windowBp": WINDOW_BP,
        "meetings": [
            {"date": d.isoformat(), "bp": next((bp for md, bp in meetings if md == d), 0.0)}
            for d in MPC_DATES if d > start
        ],
        "window": window,
        "candidates": len(pool),
        "dys": dys,
        "sectors": sectors,
        "pool": {
            "hull": [{"sector": c["sector"], "tenor": c["label"]}
                     for c in sorted(pool_hull, key=lambda c: -c["dur"])],
            "swapPoints": [p for p in pool_bps
                           if -WINDOW_BP <= p["dyBp"] <= WINDOW_BP],
            "winners": [
                {"sector": k[0], "tenor": k[1], "from": v[0], "to": v[-1]}
                for k, v in sorted(pool_win.items(), key=lambda kv: kv[1][0])
            ],
        },
        "heat": {"tenors": heat_tenors, "sectors": heat_rows},
        "credit": credit_payload,
    }


# ── 크레딧 RV — 절대축(버퍼)·상대축(RV) 독립, 합성은 그 다음 [원칙 ①] ───────

#: Relative RV 의 가중 (절대·섹터상대·커브) [트레이더 출발값 — 조건 바에 노출].
RV_WEIGHTS = (0.40, 0.40, 0.20)

#: 크레딧 RV 의 보유 호라이즌 — 레인 A(6M)와 **다르다** [트레이더 출발값 3M].
H_CREDIT_MONTHS = 3


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _cross_sector_rel(
    sp: dict[tuple[str, str], list[float | None]], credit: list[str],
    bt: str, lab: str, n_dates: int,
) -> list[float | None]:
    """② 섹터 상대 — 같은 테너의 **횡단면 평균 대비 편차**, 날짜별. 그날 그
    테너를 가진 섹터가 하나뿐이면 편차 0 이 아니라 None(비교 상대가 없다)."""
    mine = sp.get((bt, lab))
    if mine is None:
        return [None] * n_dates
    out: list[float | None] = []
    for i in range(n_dates):
        xs = [sp[(o, lab)][i] for o in credit
              if (o, lab) in sp and sp[(o, lab)][i] is not None]
        v = mine[i]
        out.append(None if v is None or len(xs) < 2 else v - _mean(xs))
    return out


def _curve_rel(
    sp: dict[tuple[str, str], list[float | None]],
    bt: str, lab: str, labs: list[str], n_dates: int,
) -> list[float | None]:
    """③ 커브 — 같은 섹터의 **테너 간 평균 대비 편차**, 날짜별."""
    mine = sp.get((bt, lab))
    if mine is None:
        return [None] * n_dates
    out: list[float | None] = []
    for i in range(n_dates):
        xs = [sp[(bt, o)][i] for o in labs
              if (bt, o) in sp and sp[(bt, o)][i] is not None]
        v = mine[i]
        out.append(None if v is None or len(xs) < 2 else v - _mean(xs))
    return out


def _credit_items(
    m: cm.CreditMatrix,
    spec: fd.FundingSpec,
    meetings: list[tuple[dt.date, float]],
    window: str,
    end_i: int,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """`end_i` 자리를 "오늘"로 놓은 크레딧 RV 항목 일습 — 시계열을 전부
    `[:end_i+1]` 로 자른 세계에서 계산한다. credit_block 이 오늘과 **전
    영업일**을 이 함수로 두 번 계산해 랭크 Δ 를 만든다(전일의 z·σ·랭크는
    전일까지의 이력만 알아야 한다 — 오늘 관측이 섞이면 미래 참조다)."""
    asof_i = end_i
    start = m.dates[asof_i]
    base = fd.rate_on(spec, start)
    n_dates = asof_i + 1

    credit = [bt for bt in cm.TYPE_ORDER if bt != "KTB"]
    sp: dict[tuple[str, str], list[float | None]] = {}
    for bt in credit:
        for lab in cm.TENOR_LABELS:
            al = aligned_spread(m, bt, lab)
            if al is not None:
                sp[(bt, lab)] = al[:n_dates]

    ktb_points = cm.curve_points(m, "KTB", asof_i)

    items: list[dict[str, Any]] = []
    excl: list[dict[str, str]] = []
    for bt in credit:
        points = cm.curve_points(m, bt, asof_i)
        labs = [lab for lab in cm.TENOR_LABELS if (bt, lab) in sp]
        for lab in labs:
            if cm.TENOR_YEARS[lab] > RANK_MAX_YEARS:
                # 10년 초과는 랭킹 대상 밖 [OWNER] — 조용히 빼지 않는다.
                excl.append({
                    "id": f"{bt}:{lab}",
                    "label": f"{cm.BOND_TYPES[bt]} {lab}",
                    "reason": "10년 초과 — 랭킹에 반영하지 않아요.",
                })
                continue
            seq = sp[(bt, lab)]
            now = seq[asof_i]
            if now is None:
                continue  # 그날 스프레드가 없다 — 이월하지 않는다

            # ── 절대축: 스프레드 축 BEP (국고 헤지 페어 — 원칙 ②) ──────────
            cb = candidate(points, lab, start, base, meetings, H_CREDIT_MONTHS)
            ck = candidate(ktb_points, lab, start, base, meetings, H_CREDIT_MONTHS)
            if cb["dur"] == 0.0:
                excl.append({
                    "id": f"{bt}:{lab}",
                    "label": f"{cm.BOND_TYPES[bt]} {lab}",
                    "reason": "만기 보유(H 안에 만기) — 스프레드 위험이 없어 버퍼가 정의되지 않아요.",
                })
                continue
            # 조달 f 는 두 다리에 같게 붙어 소거된다(독스트링) — 그래도 다리별
            # carry_net 을 각각 지나게 두는 이유는, 헤지 다리의 조달이 달라지는
            # 날 이 자리가 그 갈림의 이음매이기 때문이다.
            carry_money = cb["carry"] - ck["carry"]
            roll_money = cb["roll"](0.0) - ck["roll"](0.0)
            carry_bp = carry_money / cb["dur"] * 1e4
            roll_bp = roll_money / cb["dur"] * 1e4
            buffer_bp = carry_bp + roll_bp

            vol = vol_3m(seq, window)
            coverage = buffer_bp / vol if vol else None

            # 절대축의 점수 입력 — Coverage 의 자기 이력 백분위(모듈 독스트링의
            # covProxy 근사). 표시축(coverage — bp·σ 병기)은 그대로 사실이다.
            proxy = coverage_hist_series(seq)
            p_now = proxy[asof_i]
            p_hist = window_vals(proxy, window)
            cov_pct = (
                mid_rank_pct(p_hist, p_now)
                if p_now is not None and len(p_hist) >= 26
                else None
            )

            # ── 상대축: z 3성분 (전부 deviation — 원칙 ③) ───────────────────
            w = window_vals(seq, window)
            z1 = z_score(w, now)
            pct = rank_pct(w, now)
            fair = _mean(w) if w else None
            cheap = None if fair is None else now - fair

            rel = _cross_sector_rel(sp, credit, bt, lab, n_dates)
            rel_now = rel[asof_i]
            z2 = z_score(window_vals(rel, window), rel_now) if rel_now is not None else None

            cur = _curve_rel(sp, bt, lab, labs, n_dates)
            cur_now = cur[asof_i]
            z3 = z_score(window_vals(cur, window), cur_now) if cur_now is not None else None

            w1, w2, w3 = RV_WEIGHTS
            rel_rv = (
                None if z1 is None or z2 is None or z3 is None
                else w1 * z1 + w2 * z2 + w3 * z3
            )

            via = SHORTABLE.get(cm.TENOR_YEARS[lab])
            items.append({
                "sector": bt,
                "sectorLabel": cm.BOND_TYPES[bt],
                "tenor": lab,
                "years": cm.TENOR_YEARS[lab],
                "nowBp": round(now, 1),
                # 절대축 — bp 와 σ 병기 [원칙 ④ "+12bp (1.5σ)"]
                "carryBp": round(carry_bp, 1),
                "rollBp": round(roll_bp, 1),
                "bufferBp": round(buffer_bp, 1),
                "bepSpreadBp": round(now + buffer_bp, 1),
                "vol3mBp": None if vol is None else round(vol, 1),
                "coverage": None if coverage is None else round(coverage, 2),
                # 절대축의 점수 입력 — 자기 이력 백분위(높음 = 평소보다 후한 버퍼)
                "covPct": None if cov_pct is None else round(cov_pct, 1),
                # 상대축 — 성분을 따로 싣는다(독립 숫자 먼저 — 원칙 ①)
                "pct": round(pct, 1),
                "cheapBp": None if cheap is None else round(cheap, 1),
                "zAbs": None if z1 is None else round(z1, 2),
                "zSector": None if z2 is None else round(z2, 2),
                "zCurve": None if z3 is None else round(z3, 2),
                "relRv": None if rel_rv is None else round(rel_rv, 2),
                "shortable": via is not None,
                "shortVia": via,
                "seriesId": f"CRD-{bt}-{lab}",
            })

    # ── 합성은 그 다음 — Total RV Score 50:50 [출발값] ─────────────────────
    # 절대축 = covPct(자기 이력 백분위 — 모듈 독스트링의 레벨 오염 수리),
    # 상대축 = relRv 의 오늘 후보 간 랭크 백분위.
    rels = [it["relRv"] for it in items if it["relRv"] is not None]
    for it in items:
        if it["covPct"] is None or it["relRv"] is None or len(rels) < 2:
            it["score"] = None
            continue
        it["score"] = round(
            0.5 * it["covPct"] + 0.5 * rank_pct(rels, it["relRv"]), 1
        )

    return items, excl


def _rank_map(items: list[dict[str, Any]]) -> dict[str, int]:
    """seriesId → 랭크(1 = 최고 Score). Score 없는 항목은 랭크가 없다.
    동점은 seriesId 로 갈라 결정적으로 — 표시 순서가 날마다 흔들리면 안 된다."""
    scored = sorted(
        (it for it in items if it["score"] is not None),
        key=lambda it: (-it["score"], it["seriesId"]),
    )
    return {it["seriesId"]: i + 1 for i, it in enumerate(scored)}


def credit_block(
    m: cm.CreditMatrix,
    spec: fd.FundingSpec,
    meetings: list[tuple[dt.date, float]],
    window: str,
) -> dict[str, Any]:
    """크레딧 RV 페이로드 — 정의는 모듈 독스트링의 "크레딧 RV 의 계산 정의".

    랭크와 **랭크 Δ**(전 영업일 대비, 양수 = 올라옴)까지 서버가 끝낸다(§16)
    [OWNER 2026-08-19 — "매일 보는 화면에 어제 대비가 없으면 정적 사진"].
    전일 랭크는 전일까지의 이력만 아는 세계(`_credit_items(end_i-1)`)에서
    다시 계산한다 — 오늘 커브·오늘 관측이 섞이면 미래 참조다. 어제 없던
    항목(신규·전일 결측)은 Δ 가 None 이다.
    """
    asof_i = len(m.dates) - 1
    items, excl = _credit_items(m, spec, meetings, window, asof_i)
    rank = _rank_map(items)
    prev_rank: dict[str, int] = {}
    if asof_i >= 1:
        prev_items, _ = _credit_items(m, spec, meetings, window, asof_i - 1)
        prev_rank = _rank_map(prev_items)
    for it in items:
        r = rank.get(it["seriesId"])
        p = prev_rank.get(it["seriesId"])
        it["rank"] = r
        it["rankDelta"] = None if r is None or p is None else p - r

    return {
        "hMonths": H_CREDIT_MONTHS,
        "weights": {"abs": RV_WEIGHTS[0], "sector": RV_WEIGHTS[1], "curve": RV_WEIGHTS[2]},
        "items": items,
        "exclusions": excl,
    }


def credit_history(m: cm.CreditMatrix, bt: str, lab: str, window: str) -> dict[str, Any]:
    """클릭 상세의 두 소형 차트 — 스프레드 이력과 섹터 상대(횡단면 평균 대비)
    이력, 각각의 창 통계(평균·σ — ±σ 밴드가 이걸 그린다).

    **points 도 창으로 자른다** — 통계만 창을 적용하고 그림은 전체를 실으면
    밴드와 선이 다른 모집단이 되고, 화면 라벨("52주")이 거짓이 된다
    (2026-08-19 크리틱 P0: 라벨 52주 아래 2020~ 전체 1,625점이 그려져 있었다).
    자르는 규칙은 `window_vals` 와 같은 자리 기준(마지막 252일)이다."""
    if bt == "KTB" or bt not in cm.BOND_TYPES:
        raise cm.CreditMatrixError(f"크레딧 섹터가 아닙니다: {bt!r}")
    seq = aligned_spread(m, bt, lab)
    if seq is None:
        raise cm.CreditMatrixError(f"스프레드 계열이 없습니다: {bt} {lab}")
    credit = [x for x in cm.TYPE_ORDER if x != "KTB"]
    sp = {(bt, lab): seq}
    for o in credit:
        al = aligned_spread(m, o, lab)
        if al is not None:
            sp[(o, lab)] = al
    rel = _cross_sector_rel(sp, credit, bt, lab, len(m.dates))

    def stats(xs: list[float | None]) -> dict[str, float | None]:
        w = window_vals(xs, window)
        nowv = next((v for v in reversed(xs) if v is not None), None)
        if len(w) < 2 or nowv is None:
            return {"now": nowv, "mean": None, "sd": None}
        mean = _mean(w)
        var = sum((v - mean) ** 2 for v in w) / (len(w) - 1)
        return {"now": round(nowv, 2), "mean": round(mean, 2),
                "sd": round(var ** 0.5, 2) if var > 0 else None}

    i0 = 0 if window == "all" else max(0, len(m.dates) - ANNUAL_OBS)
    pts = [
        {"t": d.isoformat(), "s": None if s is None else round(s, 2),
         "rel": None if r is None else round(r, 2)}
        for d, s, r in zip(m.dates[i0:], seq[i0:], rel[i0:])
        if s is not None
    ]
    return {
        "sector": bt,
        "sectorLabel": cm.BOND_TYPES[bt],
        "tenor": lab,
        "window": window,
        "points": pts,
        "spread": stats(seq),
        "rel": stats(rel),
    }
