"""Curve-side functions ported from the frozen krw-fi-pms engine.

PROVENANCE (owner-approved 2026-07-24, docs/PORT_PROPOSAL.md Option A):
  source: krw-fi-pms-backend @ 570a2ff, irs_pricer/engine/quant_engine.py
  Function bodies are byte-identical to the source except two approved
  deviations, both in the holidays init block:
    1. holiday years 2016-2035 (braveworld history starts 2016; source
       used 2020-2035),
    2. a missing `holidays` package raises instead of silently degrading
       to weekends-only (business-day correctness is a display guarantee
       here).
  Do NOT edit the ported bodies; fix upstream understanding first, then
  re-port deliberately with a provenance note.

Scope: the curve side, plus `IRS_Trade` (ported 2026-07-31 for the backtest —
see the banner above it). Still excluded: PVBP, KRD, theta, bumped curves and
path simulation.
"""

import numpy as np
from datetime import date as _date, timedelta
from typing import Callable
from scipy.optimize import brentq

try:
    import holidays as _hols_lib
    _KR_HOLIDAYS = _hols_lib.KR(years=range(2016, 2036))
except ImportError as _exc:  # deviation 2: loud failure, never weekends-only
    raise ImportError(
        "braveworld requires the `holidays` package for the KR business-day "
        "calendar; refusing to degrade to weekends-only"
    ) from _exc

_SHORT_ANCHOR_TENORS = [1.0 / 365.0, 0.25]  # 1D, 3M


def _inject_short_anchors(
    par_rates: list[tuple[float, float]],
    short_rate: float,                   # decimal, e.g. 0.0281
) -> list[tuple[float, float]]:
    """
    irsCurves 앞단(1D, 3M) 앵커 노드 삽입.

    문제: irsCurves가 1Y부터 시작하면 0~1Y 구간 zero rate가 1Y로 flat 외삽됨.
         → 1D/3M KRD 버킷을 bump해도 1Y 노드와 동일한 커브를 bump하게 되어
           단기 리스크가 장기 버킷으로 bleed됨.
    해결: currentFloatRate를 1D·3M 앵커 금리로 삽입 →
         short-end를 별도 노드로 고정, KRD bleed 제거.

    중복 판정 허용오차(TOL_DUP): 실제 만기일 기반 커브 노드는 라벨(0.25 등)과
    최대 며칠(예: '3m' 노드가 91일=0.24932Y처럼 0.25Y 라벨과 약간 다름) 차이가 난다.
    예전에는 이 판정이 1e-6(사실상 0)이라 "거의 같은데 살짝 다른" 노드가 중복
    생성되었다: 예) 실제 3m 노드(0.24932)와 합성 3M 앵커(0.25)가 0.02Y도 안
    떨어진 채 둘 다 존재 → KRD 계산 시 "가장 가까운 노드" 로직이 합성 앵커를
    선택하는데, 합성 앵커가 실제 노드보다 살짝 뒤에 있어서 그 사이(예: 차기
    지급일 t1=0.2Y)의 현금흐름이 "3M" bump의 영향권 밖으로 밀려나 버리는
    버그가 있었다. 허용오차를 날짜 단위 괴리를 흡수할 만큼(0.02Y≈7일)
    넉넉하게 잡아 이미 존재하는 실제 노드를 재사용하도록 수정.
    """
    if not par_rates:
        return par_rates
    TOL_DUP = 0.02  # 약 7일 — 앵커 간격(0.25Y)보다 훨씬 작아 서로 다른 앵커를 합치지 않음
    # short_rate 미제공 시 가장 짧은 par rate 금리로 대체
    _r = short_rate if short_rate > 1e-6 else sorted(par_rates, key=lambda x: x[0])[0][1]
    existing_t = [p[0] for p in par_rates]
    result = list(par_rates)
    for anchor_t in _SHORT_ANCHOR_TENORS:
        if not any(abs(t - anchor_t) < TOL_DUP for t in existing_t):
            result.append((anchor_t, _r))
    return sorted(result, key=lambda x: x[0])


def _is_kr_business_day(d: _date) -> bool:
    """d가 한국 영업일인지(주말 아님 + 공휴일 아님). _KR_HOLIDAYS는 모듈 로드 시
    2020~2034년치를 미리 만들어둔 것이라 매 호출마다 holidays.KR()을 새로 만드는
    비용이 없다 — 스케줄 생성 루프에서 대량 호출돼도 안전."""
    return d.weekday() < 5 and d not in _KR_HOLIDAYS


def _next_business_day(d: _date) -> _date:
    """d가 영업일(평일+한국 공휴일 아님)이 아니면 다음 영업일로 조정, 이미 영업일이면
    그대로. 스케줄 생성(ModFol)용 — '주말만 보는' 예전 버전은 실제 공휴일(추석/성탄절
    등)에 걸린 지급일을 못 미뤄서 실제 사내 스케줄과 하루 이상 어긋나는 문제가 있었다
    (실측 확인: 9/25가 추석인 트레이드에서 재현)."""
    nd = d
    while not _is_kr_business_day(nd):
        nd += timedelta(days=1)
    return nd


def _prev_business_day(d: _date) -> _date:
    """d가 영업일이 아니면 직전 영업일로 조정, 이미 영업일이면 그대로."""
    pd = d
    while not _is_kr_business_day(pd):
        pd -= timedelta(days=1)
    return pd


def next_kr_business_day(d: _date) -> _date:
    """d의 다음 한국 영업일(주말+공휴일 제외, d 자신은 제외) — '결제일(T+1)' 계산용.

    마켓 컨벤션: "N일자 NPV"를 요청받으면 실제로는 N일의 결제일(N의 다음
    영업일)을 평가일(val_date)로 잡아 재평가한 값을 "N일자 값"으로 보고한다
    (main.py의 next_kr_business_day와 동일 정의 — 여기 별도로 둔 이유는
    quant_engine.py가 simulate_irs_path_fm 내부 일별 루프에서 자체적으로
    이 변환을 적용해야 해서 main.py에 대한 의존성 없이 동작해야 하기 때문).
    """
    return _next_business_day(d + timedelta(days=1))


def _modfol_bd(d: _date) -> _date:
    """Modified Following 영업일 조정 (주말 전용).
    다음 영업일로 조정하되, 월경(Month-End Crossing)이면 직전 영업일로 조정.
    예: Feb 28(토) → Mar 2는 월경 → Feb 27(금) / May 31(일) → Jun 1은 월경 → May 29(금)
    """
    adj = _next_business_day(d)
    if adj.month != d.month:
        return _prev_business_day(d)
    return adj


def _subtract_months(d: _date, months: int) -> _date:
    """달력 개월 역산 (월말 초과분은 해당 월 말일로 클램프).
    예: Apr 13 - 3 → Jan 13  /  Mar 31 - 1 → Feb 28(29)
    timedelta(91) 근사(±1~2일 오차) 대비 정확한 분기 역산.
    """
    import calendar as _cal
    m = d.month - months
    y = d.year
    while m <= 0:
        m += 12
        y -= 1
    max_day = _cal.monthrange(y, m)[1]
    return _date(y, m, min(d.day, max_day))


def bootstrap_zero_curve(par_rates: list[tuple[float, float]]) -> np.ndarray:
    """
    Par Rate (decimal) → Continuously Compounded Zero Rate 부트스트래핑
    (QuantLib PiecewiseYieldCurve 스타일 — 실제 마디점 기반 순차적 해찾기)

    알고리즘:
      T ≤ 3M : 단순이자 DF(T) = 1/(1 + c*T) → r = -ln(DF)/T  (폐쇄형, 단일지급 상품)
      T > 3M : 실제 만기 T에서 역산(backward)한 분기 지급 스케줄로 par swap 항등식을 풀어 DF(T) 확정.
                 1 = DF(T)·(1 + c·0.25) + c·Σ(accrual_i · DF(t_i))
               스케줄은 T에서 0.25씩 역산하며 만들고, T가 0.25의 정확한 배수가 아니면
               첫 구간(가장 오래된 지급일)에만 남는 단수(stub) 일수를 흡수시킨다.
               → 마디점 T가 정확한 격자(0.25 배수)가 아니어도 스케줄 자체가 T에 정확히
                 맞춰 재생성되므로, 이전의 "고정 격자 t_step += 0.25" 방식에서 발생하던
                 마디점-격자 불일치(예: T=1.50411인데 루프는 1.25에서 끊김) 문제가 없다.
               이 방정식은 DF(T)에 대해 선형이므로 폐쇄형으로 직접 풀며(QuantLib의
               Brent 해찾기와 수학적으로 동일한 해 — 1e-8 정밀도까지 일치 확인,
               단 폐쇄형이 약 10배 빠름), DF(T)가 비정상(≤0)일 때만 brentq로 안전망 처리.
               이미 확정된 노드(0..i-1)들 사이는 기존과 동일하게 zero rate 선형 보간/외삽.

    입력 : [(T_years, par_rate_decimal), ...]  오름차순
    출력 : np.ndarray shape (N,2)  → col0=T, col1=zero_rate
    """
    if not par_rates:
        # 커브 없음 → flat 3.5% fallback
        return np.array([[0.001, 0.035], [30.0, 0.035]])

    pts = sorted(par_rates, key=lambda x: x[0])
    zero_t: list[float] = []
    zero_r: list[float] = []

    SHORT_THRESHOLD = 0.25 * 1.04  # 기존 0.26과 동일한 임계값의 일반화

    def _df_interp(t: float) -> float:
        """이미 확정된 노드(zero_t, zero_r)까지 zero rate를 선형 보간/외삽 후 DF 환산
        (기존 부트스트랩의 _interp_zero와 동일한 방식 — log-linear on DF로 바꾸면
        오히려 정확도가 크게 떨어짐이 실측으로 확인됨. df() 최종 조회 단계의 보간법과는
        의도적으로 분리되어 있음)."""
        if not zero_t:
            return float(np.exp(-pts[0][1] * max(t, 1e-12)))
        r = float(np.interp(t, zero_t, zero_r, left=zero_r[0], right=zero_r[-1]))
        return float(np.exp(-r * max(t, 1e-12)))

    for T, c in pts:
        if T <= SHORT_THRESHOLD + 1e-9:
            # 단기(≤3M): 단순이자 DF(T) = 1/(1+c*T)  →  r = -ln(DF)/T
            df_T = 1.0 / (1.0 + c * T) if T > 1e-9 else 1.0
            r_T = float(-np.log(df_T) / T) if T > 1e-9 else c
        else:
            # 실제 만기 T에서 역산한 분기 스케줄 (T가 0.25 배수가 아니면 첫 구간이 stub)
            periods: list[float] = []
            t_cursor = T
            while t_cursor > 0.25 + 1e-9:
                periods.append(t_cursor)
                t_cursor = round(t_cursor - 0.25, 10)
            periods.append(t_cursor)  # 첫 stub 지급일 (0 < t_cursor <= 0.25)
            periods.sort()
            interim = periods[:-1]  # T 이전 지급일들
            accruals = [interim[0]] + [0.25] * (len(interim) - 1) if interim else []

            pv_interim = sum(a * _df_interp(t) for a, t in zip(accruals, interim))
            df_T = (1.0 - c * pv_interim) / (1.0 + c * 0.25)

            if df_T > 0:
                r_T = float(-np.log(df_T) / T)
            else:
                # 비정상(음수/0) DF인 극단적 커브 형태에 대한 안전망 — brentq로 재탐색
                def swap_eq(r_guess: float) -> float:
                    df_T_guess = float(np.exp(-r_guess * T))
                    return df_T_guess * (1.0 + c * 0.25) + c * pv_interim - 1.0
                try:
                    r_T = brentq(swap_eq, -0.10, 1.00, xtol=1e-12)
                except ValueError:
                    r_T = float(-np.log(1e-12) / T)

        zero_t.append(T)
        zero_r.append(r_T)

    return np.column_stack([zero_t, zero_r])


def df(t: float, zc: np.ndarray) -> float:
    """Discount Factor: Log-linear 보간 (ln DF = -r·T 를 선형 보간 → DF 로그선형)"""
    if t <= 0:
        return 1.0
    if zc is None or len(zc) == 0:
        return float(np.exp(-0.035 * t))
    # 각 노드의 ln(DF) = -r*T 를 계산 후 선형 보간 → log-linear on DF
    log_dfs = -(zc[:, 1] * zc[:, 0])          # -r·T at each node
    log_df_t = float(np.interp(t, zc[:, 0], log_dfs,
                                left=float(log_dfs[0]),
                                right=float(log_dfs[-1])))
    return float(np.exp(log_df_t))


def df_linear_rate(t: float, zc: np.ndarray) -> float:
    """Discount Factor: zero rate를 선형보간(linear-on-rate) 후 DF 환산.

    df()의 log-linear-on-DF와 달리, T가 극단적으로 작은 노드(예: 1D 앙커
    T=1/365)에서도 ln(DF)=-r*T가 T→0으로 인해 소멸하지 않고 rate 자체의
    변화가 그대로 보간에 반영된다. KRD/PVBP 테너별 버킷 분해(compute_irs_krd_map)
    전용 — 단기 앙커 bump가 인접 현금흐름에 기여하는 몫이 log-linear-DF에서는
    T가 작을수록 사실상 0으로 씻겨나가(DF(T)->1 as T->0) 그 몫이 전부 다음
    버킷으로 넘어가버리는 문제를 해결하기 위해 도입. 전체 KRD 합계(=병렬 평행이동
    민감도)는 두 보간법 사이에 사실상 차이가 없음(실측 확인) — 버킷 간 "배분"만
    바뀐다. 절대 NPV(compute_irs_npv 기본 경로)에는 영향 없도록 별도 함수로 분리.
    """
    if t <= 0:
        return 1.0
    if zc is None or len(zc) == 0:
        return float(np.exp(-0.035 * t))
    r = float(np.interp(t, zc[:, 0], zc[:, 1], left=float(zc[0, 1]), right=float(zc[-1, 1])))
    return float(np.exp(-r * t))


def zero_rate(t: float, zc: np.ndarray) -> float:
    """Log-linear DF 보간에서 역산한 연속복리 제로금리 (보고/감사용)"""
    if zc is None or len(zc) == 0:
        return 0.035
    if t <= 1e-12:
        return float(zc[0, 1])
    return float(-np.log(max(df(t, zc), 1e-12)) / t)


def forward_rate_simple(
    t1: float, t2: float, zc: np.ndarray,
    df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
) -> float:
    """
    Simple Forward Rate for period [t1, t2]:
        f(t1, t2) = (DF(t1) / DF(t2) - 1) / (t2 - t1)

    의미: 미래 구간 [t1, t2]에서 예상되는 CD / IRS 픽싱 금리 (연율, decimal)
    """
    if t2 <= t1 + 1e-10:
        return zero_rate((t1 + t2) / 2, zc)
    df1 = df_fn(t1, zc)
    df2 = df_fn(t2, zc)
    if df2 < 1e-12:
        return 0.0
    return (df1 / df2 - 1.0) / (t2 - t1)


# ─────────────────────────────────────────────────────────────────────────────
# Trade object — ported 2026-07-31 for the backtest [OWNER].
#
# The module docstring above used to end "Excluded by design (spec §0): all
# valuation/scenario code — NPV, PVBP, KRD, theta, bumped curves, path
# simulation, trade objects." The owner lifted that exclusion for the backtest
# and directed the frozen code be brought over rather than rewritten, so
# IRS_Trade comes across BYTE-IDENTICAL like everything above it — including
# `compute_npv`, which nothing here calls: a port is of a thing, not of the
# parts of it we happen to want, and trimming it would end the byte-identity
# that makes the parity test meaningful.
# ─────────────────────────────────────────────────────────────────────────────

class IRS_Trade:
    """ISDA 표준 IRS 트레이드 객체.

    초기화 시 start_date → maturity_date의 전체 지급 스케줄을 Forward Generation 방식으로
    영구 확정한다. 과거 임의 날짜로의 타임머신 재평가 및 백테스팅에 필요한 연속성을 보장.

    스케줄 생성 규칙 (ISDA 표준):
      1. Forward Generation : start_date + N × freq_months (dateutil.relativedelta 사용)
      2. EOM 룰             : start_date가 월말이면 이후 지급일도 해당 월 말일로 고정
      3. Modified Following : 주말이면 다음 영업일, 월경(Month-End Crossing) 시 직전 영업일
      4. Maturity Snap      : 생성 날짜 ≥ maturity_date이면 maturity_date로 대체 후 종료
    """

    __slots__ = (
        "notional", "fixed_rate_pct", "direction", "sector",
        "start_date", "maturity_date", "fixed_freq", "float_freq",
        "pay_dates", "accruals", "_pay_date_set",
    )

    def __init__(
        self,
        start_date: _date,
        maturity_date: _date,
        fixed_rate_pct: float,
        direction: int,
        notional: float,
        sector: str = "IRS",
        fixed_freq: float = 0.25,
        float_freq: float = 0.25,
    ) -> None:
        # start_date를 영업일로 보정(_next_business_day는 이미 영업일이면 그대로 반환하는
        # idempotent 함수라 안전하다). 호출측이 "최초거래일+1(캘린더일)"처럼 순수 T+1을
        # 앵커로 넘길 때, 그 T+1이 하필 공휴일(예: 성탄절 다음날 거래 → T+1=성탄절)이면
        # 실제 효력발생일은 그다음 영업일로 밀려야 한다 — 실측 확인: 이 보정이 없으면
        # 이후 전체 지급일이 하루씩 밀려서 실제 파일의 "차기지급일자"와 어긋난다.
        self.start_date     = _next_business_day(start_date)
        self.maturity_date  = maturity_date
        self.fixed_rate_pct = fixed_rate_pct
        self.direction      = direction
        self.notional       = notional
        self.sector         = sector
        self.fixed_freq     = fixed_freq
        self.float_freq     = float_freq
        self.pay_dates, self.accruals = self._build_schedule()
        self._pay_date_set: set[_date] = set(self.pay_dates)

    def _build_schedule(self) -> tuple[list[_date], list[float]]:
        """ISDA Forward Generation 스케줄 확정.

        Returns:
            pay_dates : Modified Following 조정 지급일 목록
            accruals  : 각 기간의 ACT/365 어큐럴 (전기간 지급일 → 당기간 지급일)
        """
        from dateutil.relativedelta import relativedelta as _rd
        import calendar as _cal

        freq_months = max(1, round(self.float_freq * 12))
        last_of_start = _cal.monthrange(self.start_date.year, self.start_date.month)[1]
        is_eom = (self.start_date.day == last_of_start)

        raw_dates: list[_date] = []
        i = 1
        while True:
            raw = self.start_date + _rd(months=freq_months * i)
            if is_eom:
                last_of_raw = _cal.monthrange(raw.year, raw.month)[1]
                raw = _date(raw.year, raw.month, last_of_raw)
            # maturity_date 직전(10일 이내)이면 별도 스텁을 만들지 않고 바로 만기로 스냅
            # → ModFol 조정 후 두 날짜가 동일해져 accrual=0인 유령 마지막 기간이
            #   생기는 것을 방지 (raw >= maturity_date 조건만으로는 걸러지지 않는 엣지케이스)
            if raw >= self.maturity_date or (self.maturity_date - raw).days <= 10:
                raw_dates.append(self.maturity_date)
                break
            raw_dates.append(raw)
            i += 1

        adj_dates = [_modfol_bd(d) for d in raw_dates]

        prev = self.start_date
        accruals: list[float] = []
        for d in adj_dates:
            accruals.append((d - prev).days / 365.0)
            prev = d

        return adj_dates, accruals

    def compute_npv(
        self,
        val_date: _date,
        zc: np.ndarray,
        current_float_rate_pct: float,
        df_fn: Callable[[float, np.ndarray], float] = df_linear_rate,
    ) -> float:
        """val_date 기준 Full Revaluation NPV.

        확정된 스케줄에서 val_date 이후(strictly greater) 잔여 지급일만 필터링.
          Fixed Leg  : Σ N × fixed_rate × accrual_i × DF(t_i)   (사전확정 어큐럴 사용)
          Float Leg
            현재 스텁: N × current_float × cur_accrual × DF(t_next)   (확정 픽싱)
            미래 스텁: N × fwd(t_s, t_e) × accrual_i × DF(t_e)        (포워드 투영)

        df_fn 기본값 df_linear_rate(linear-on-rate): KRW CD IRS 전 구간의 공식
        보간법을 linear-on-rate로 통일하기로 한 결정에 따름(KRX 청산제도
        설명자료 2019 — "일별 무이표금리는 3개월 노드 사이 단순 선형보간").
        이전에는 df()(log-linear-on-DF)가 하드코딩되어 있어, 이 메서드를 쓰는
        simulate_irs_path_fm/대시보드 시나리오 시뮬레이션 경로만 나머지 엔진
        (compute_irs_pvbp/krd_map/theta)과 다른 보간법을 쓰는 불일치가 있었다.
        """
        fixed_rate  = self.fixed_rate_pct / 100.0
        float_rate0 = current_float_rate_pct / 100.0
        is_ois      = (self.sector == "OIS")

        rem: list[int] = [i for i, pd in enumerate(self.pay_dates) if pd > val_date]
        if not rem:
            return 0.0

        first_i     = rem[0]
        t_next      = max((self.pay_dates[first_i] - val_date).days / 365.0, 1.0 / 365.0)
        cur_accrual = self.accruals[first_i]

        fixed_pv = 0.0
        for i in rem:
            t_pay    = (self.pay_dates[i] - val_date).days / 365.0
            fixed_pv += self.notional * fixed_rate * self.accruals[i] * df_fn(t_pay, zc)

        float_pv = self.notional * float_rate0 * cur_accrual * df_fn(t_next, zc)

        if is_ois:
            t_s = t_next
            for i in rem[1:]:
                t_e       = (self.pay_dates[i] - val_date).days / 365.0
                float_pv += self.notional * (df_fn(t_s, zc) - df_fn(t_e, zc))
                t_s       = t_e
        else:
            t_s = t_next
            for i in rem[1:]:
                t_e       = (self.pay_dates[i] - val_date).days / 365.0
                fwd       = forward_rate_simple(t_s, t_e, zc, df_fn=df_fn)
                float_pv += self.notional * fwd * self.accruals[i] * df_fn(t_e, zc)
                t_s       = t_e

        return self.direction * (fixed_pv - float_pv)
