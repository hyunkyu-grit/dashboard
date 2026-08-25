"""Per-day bond MtM/carry/funding glue + shock lookup — moved verbatim from
simulation_service.py (R3a).

`calculate_daily_mtm` / `calculate_daily_carry` are the two functions the s18
T5 profiler wraps (through the chart module's globals — see profiling.py) and
the closed forms `tests/test_simulate_api.py::test_bond_only_analytic` pins.
"""

from __future__ import annotations

from datetime import date

from .futures_pricing import synth_price
from .models import FrontendPosition, FrontendShockCurves


def get_sector_curve_key(sector: str) -> str:
    s = sector or ""
    if any(k in s for k in ("국고", "통안", "국채")): return "국채"
    if any(k in s for k in ("시은", "은행")): return "은행채"
    if any(k in s for k in ("특은", "공사")): return "특은채"
    if any(k in s for k in ("여전", "카드")): return "카드채"
    if "회사" in s: return "회사채"
    return "국채"


def parse_tenor_to_years(tenor: str) -> float:
    t = str(tenor).upper().replace("년", "Y").replace("개월", "M").replace("일", "D").strip()
    try:
        if "Y" in t: return float(t.replace("Y", ""))
        if "M" in t: return float(t.replace("M", "")) / 12
        if "D" in t: return float(t.replace("D", "")) / 365
        return float(t)
    except Exception:
        return 0.0


def interpolate_curve_shift(years: float, curve: list[dict]) -> float:
    if not curve:
        return 0.0
    pts = sorted(
        [{"t": float(p.get("t", 0)), "val": float(p.get("val", 0))} for p in curve],
        key=lambda x: x["t"],
    )
    if not pts: return 0.0
    if years <= pts[0]["t"]: return pts[0]["val"]
    if years >= pts[-1]["t"]: return pts[-1]["val"]
    for i in range(len(pts) - 1):
        lo, hi = pts[i], pts[i + 1]
        if lo["t"] <= years <= hi["t"]:
            if hi["t"] == lo["t"]: return lo["val"]
            ratio = (years - lo["t"]) / (hi["t"] - lo["t"])
            return lo["val"] + (hi["val"] - lo["val"]) * ratio
    return 0.0


def get_position_shock_bp(
    p: FrontendPosition,
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    multiplier: float,
    t: int,
) -> float:
    if shock_mode == "parallel":
        return (base_shock_bp or 0.0) * multiplier
    if not shock_curves:
        return 0.0
    safe_remaining = max(p.remainingDays or 0, 0)
    eval_days = safe_remaining if shock_type == "step" else max(0, safe_remaining - t)
    years = eval_days / 365.0
    if p.bondType == "swap":
        return interpolate_curve_shift(years, shock_curves.swapCurve) * multiplier
    curve_key = get_sector_curve_key(p.sector)
    target = (
        shock_curves.bondCurves.get(curve_key)
        or shock_curves.bondCurves.get("국채")
        or []
    )
    return interpolate_curve_shift(years, target) * multiplier


def _is_matured(p: FrontendPosition, current_date: date) -> bool:
    if p.maturityDate:
        try:
            return current_date >= date.fromisoformat(p.maturityDate)
        except Exception:
            pass
    return False


def calculate_daily_mtm(
    positions: list[FrontendPosition],
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    multiplier: float,
    t: int,
    current_date: date | None = None,
    short_multiplier: float | None = None,  # 잔존 1Y 미만 채권에 적용 (BOK 계단 함수)
) -> float:
    total = 0.0
    for p in positions:
        if current_date and _is_matured(p, current_date):
            continue

        initial_remaining = max(float(p.remainingDays or 1), 1.0)
        initial_pvbp = p.pvbp or 0.0

        if p.bondType == "futures":
            # 국채선물 [OWNER, 2026-08-25]: 합성채는 만기 고정(늙지 않는다 —
            # futures_pricing 모듈 doc)이라 잔존 감쇠 없이 **상장 만기(3Y/10Y)
            # 고정 지평**에서 국채 커브 충격을 읽고, 손익은 KRX 폐형 재값매김
            # (컨벡시티 포함)이다 [OWNER 선택, 2026-08-25 — 대사표 잔차가
            # 컨벡시티를 정직하게 싣는다]. 캐리·조달·롤다운은 0 이 사실이라
            # 이 분기 바깥의 어떤 누적기에도 들어가지 않는다.
            years = parse_tenor_to_years(p.tenor)
            if shock_mode == "parallel":
                shock_bp = (base_shock_bp or 0.0) * multiplier
            else:
                target = []
                if shock_curves:
                    target = (
                        shock_curves.bondCurves.get(get_sector_curve_key(p.sector))
                        or shock_curves.bondCurves.get("국채")
                        or []
                    )
                shock_bp = interpolate_curve_shift(years, target) * multiplier
            y0 = p.mtmYield or 0.0        # 기준일 내재금리(%) — expand 가 채운다
            ny = int(round(years)) or 1
            d_price = synth_price(y0 + shock_bp / 100.0, ny) - synth_price(y0, ny)
            total += (p.direction or 1.0) * ((p.notional or 0.0) / 100.0) * d_price
            continue

        if p.bondType != "swap":
            # 채권: 잔존일수·PVBP를 매일 재산정
            current_remaining = max(initial_remaining - t, 0.0)

            if current_remaining <= 0:
                continue  # 만기 Roll-off: MTM = 0

            current_pvbp = initial_pvbp * (current_remaining / initial_remaining)

            # 잔존기간별 팩터 결정:
            #   < 3M (0.25Y) : BOK 계단 함수 (기준금리 직결)
            #   3M ~ 1Y      : BOK ↔ 웨이포인트 선형 보간
            #   >= 1Y        : 웨이포인트 경로
            r_years = current_remaining / 365.0
            if short_multiplier is not None:
                if r_years < 0.25:
                    eff_mult = short_multiplier
                elif r_years < 1.0:
                    blend = (r_years - 0.25) / (1.0 - 0.25)   # 0 at 3M → 1 at 1Y
                    eff_mult = short_multiplier * (1.0 - blend) + multiplier * blend
                else:
                    eff_mult = multiplier
            else:
                eff_mult = multiplier

            if shock_mode == "parallel":
                shock_bp = (base_shock_bp or 0.0) * eff_mult
            else:
                if not shock_curves:
                    shock_bp = 0.0
                else:
                    curve_key = get_sector_curve_key(p.sector)
                    target = (
                        shock_curves.bondCurves.get(curve_key)
                        or shock_curves.bondCurves.get("국채")
                        or []
                    )
                    # BOK 이벤트는 기준금리(KTB) 성분에만 적용; 크레딧 스프레드는 장기 경로를 따름
                    # → 특은채 등에 크레딧 스프레드가 포함된 경우 eff_mult가 스프레드까지 스케일하는 오류 방지
                    ktb_curve  = shock_curves.bondCurves.get("국채") or []
                    ktb_at_r   = interpolate_curve_shift(r_years, ktb_curve)
                    total_at_r = interpolate_curve_shift(r_years, target)
                    credit_addon = total_at_r - ktb_at_r   # 크레딧 스프레드 성분
                    shock_bp = ktb_at_r * eff_mult + credit_addon * multiplier

            total += current_pvbp * (-shock_bp)
        else:
            # IRS: PVBP는 DV01 관행 (receive-fixed=양수, pay-fixed=음수)
            # MTM = pvbp * (-shock_bp)  — 채권과 동일 공식
            if current_date and _is_matured(p, current_date):
                continue
            shock_bp = get_position_shock_bp(p, shock_mode, shock_type, base_shock_bp, shock_curves, multiplier, t)
            aging = 1.0 if shock_type == "step" else max(0.0, initial_remaining - t) / initial_remaining
            total += initial_pvbp * aging * (-shock_bp)

    return total


def calculate_daily_carry(
    positions: list[FrontendPosition],
    shock_mode: str,
    shock_type: str,
    base_shock_bp: float,
    shock_curves: FrontendShockCurves | None,
    active_funding_rate: float,
    multiplier: float,
    t: int,
    current_date: date | None = None,
    dt_cal: int = 1,
) -> float:
    total = 0.0
    for p in positions:
        if p.bondType == "swap":
            continue  # IRS carry는 FM 엔진(irs_fm_carry)이 전담
        if p.bondType == "futures":
            # 선물 캐리 = 0 이 사실이다 [OWNER, 2026-08-25]: 액크루얼이 없고
            # (합성채는 보유물이 아니라 결제 기준), 증거금 조달은 이 화면
            # 바깥(미미·미계상)이다. 0 을 더하는 게 아니라 성분 자체가 없다.
            continue
        initial_remaining = max(float(p.remainingDays or 0), 0.0)
        matured = (current_date and _is_matured(p, current_date)) or (initial_remaining > 0 and t >= initial_remaining)
        if matured:
            # 조달의 연속성: 만기 후에도 Notional에 대한 Funding Cost 유지
            total -= (p.notional or 0.0) * active_funding_rate * dt_cal / 365.0
        else:
            eval_amt = p.evaluationAmount or 0.0
            # [OWNER, 2026-08-25 — "충격 미가산"] 보유 고정이표 채권의 캐리는
            # **쿠폰(마크 수익률) 고정**이다. 종전에는 시나리오 충격을 가산한
            # 운용수익률(carry_rate = mtmYield + shock)로 액크루얼했는데, 그건
            # 금리가 오르면 들고 있는 고정이표가 더 버는 모형이라 정확 모형
            # (캐리 = 쿠폰 액크루얼, 가격 몫은 평가·롤다운) 대비 s×평가금액×t/365
            # 를 지어냈다 — 실측 +6,170만원/180일·+250bp(감사록 F1). 문헌
            # (Tuckman·Clarus·Nordea)과 백테스트 채권 캐리(cashbond.py, 쿠폰
            # 고정)에 정렬한다. 이표·만기 원금의 재투자 수익은 별도 항
            # (chart.py daily_cash_return)이 이미 센다. 시그니처의 shock 인자들은
            # 만기 판정 경로와의 호환으로 남는다 — 이 분기에서는 더 안 쓴다.
            carry_rate = p.mtmYield or 0.0
            total += (eval_amt * (carry_rate / 100.0)) * dt_cal / 365.0 - (eval_amt * active_funding_rate) * dt_cal / 365.0
    return total


def calculate_daily_funding_cost(
    positions: list[FrontendPosition],
    active_funding_rate: float,
    t: int,
    current_date: date | None = None,
    dt_cal: int = 1,
) -> float:
    """s15 T2 — calculate_daily_carry의 조달 비용 성분만 따로 합산(양수 값).

    calculate_daily_carry와 동일한 만기 판정·동일한 항을 사용한다: 생존 채권은
    평가액 기준, 만기 채권은 Notional 기준(조달의 연속성). 기존 carry 누적기는
    바이트 단위로 그대로 두고(골든 패리티), Total Return 분해(bondCarry 총액 =
    net + funding, fundingCost = -funding)를 위한 병렬 누적만 추가한다 —
    같은 항의 인수분해이지 새 수식이 아니다."""
    total = 0.0
    for p in positions:
        if p.bondType in ("swap", "futures"):
            continue  # 선물: 명목 조달 없음(증거금 미계상) — calculate_daily_carry 의 같은 규칙
        initial_remaining = max(float(p.remainingDays or 0), 0.0)
        matured = (current_date and _is_matured(p, current_date)) or (initial_remaining > 0 and t >= initial_remaining)
        if matured:
            total += (p.notional or 0.0) * active_funding_rate * dt_cal / 365.0
        else:
            total += (p.evaluationAmount or 0.0) * active_funding_rate * dt_cal / 365.0
    return total


def calc_dynamic_funding_rate(base_rate: float, funding_events: list[dict], current_date: date) -> float:
    total = base_rate or 0.0
    for ev in funding_events:
        try:
            if date.fromisoformat(ev.get("date", "")) <= current_date:
                total += ev.get("shiftBp", 0) / 10000.0
        except Exception:
            pass
    return total
