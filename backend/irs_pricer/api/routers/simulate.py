"""
POST /api/simulate — scenario P&L simulation, ported from rates-simulator-main.

The request/response shapes are the FROZEN frontend contract
(UIUX_test src/features/simulation/api/simulate-dto.ts, pinned by its MSW
contract test): camelCase field names, positions in the source's
FrontendPosition shape. Do not "normalise" these to snake_case.

Unlike the source (whose endpoint had no response model), the response is
typed below — SimulateResponse mirrors what run_simulation() actually returns,
with `SimulationChartPoint` left open (extra="allow") because the per-day rows
carry a varying set of series keys plus an optional bokBreakdown block, exactly
as the frontend DTO models it ([key: string]: unknown).

The engine run itself is seconds of numpy/engine work (a full-revaluation path
per IRS position plus a per-business-day KRD rebuild) and must never touch the
event loop — see the NOTE in portfolio_analytics.py. This endpoint is `async
def` only to interleave Cloudflare/Vercel keepalive heartbeats; the actual run
still executes in a worker thread via run_in_executor (see the endpoint NOTE).

Errors: engine crashes surface as the source's ValueError("FM Engine Crash …")
and deliberately stay 500s (via app.py's catch-all middleware, which keeps the
CORS header on) — they are server faults on valid input, not the 400-worthy
bad-input ValueErrors the other routers map.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from ...services import simulation_service
from ...services.simulation_service import FrontendPosition, FrontendShockCurves

router = APIRouter(prefix="/api")


class SimulateRequest(BaseModel):
    positions: list[FrontendPosition]
    shockCurves: FrontendShockCurves | None = None         # 시나리오 충격 (chartData 전용)
    dailyShockCurves: FrontendShockCurves | None = None    # 당일 실제 금리변동 (bookDailyPnL 전용)
    # s15 T1: 생략(None)이면 조달금리 = 기준금리 + 10bp 상수, 전 기간 고정 —
    # 이벤트 스테핑 없음 (simulation_service.POLICY_BASE_RATE_KRW /
    # FUNDING_SPREAD_BP가 유일한 원천; 라이브 브리지는 이 필드를 싣지 않는다).
    # 명시하면 원본 소스 의미론(그 값 + fundingEvents 계단 스테핑) 유지 —
    # 소스 골든 캡처(0.042 명시)의 패리티가 그 경로로 계속 검증된다.
    fundingRate: float | None = None
    fundingEvents: list[dict] = []
    simDays: int = 90
    shockType: str = "step"             # 'step' | 'ramp'
    shockMode: str = "parallel"         # 'parallel' | 'matrix'
    baseShockBp: float = 50.0
    baseDate: str = "2026-01-01"
    irsCurves: list[dict] = []          # [{t: float, rate: float, maturityDate?: str, tenor?: str}, ...] IRS Par Rate (decimal)
                                         # maturityDate(ISO, 실제 달력 만기일)가 있으면 t 대신 우선 사용.
                                         # 없고 tenor(예: "3m","1y")가 있으면 resolve_curve_maturity_dates가
                                         # base_date+tenor로 실제 만기일을 직접 계산해 채워 넣음(v5 포맷 대응)
    customPath: list[dict] = []         # [{day: int, bp: float}, ...] 웨이포인트 기반 커스텀 경로
    # s13 — 분포 팬의 σ (bp/√영업일). 생략 시 2.0 == s11의 상수와 바이트 동일.
    # 범위 밖(≤0, >25)은 422: σ=0은 폭 0의 "팬"(분포 주장으로서 거짓)이고,
    # 25bp/√일 초과는 어떤 KRW 금리 체계에서도 입력 실수다.
    sigma_bp: float = Field(default=2.0, gt=0, le=25)
    # SIM2-5 (ruling ④, 추가 전용): True + fundingRate 생략 → 고정 모드 조달이
    # 요청의 금통위 이벤트로 스테핑(base = 정책 상수 페어). 기본 False = 종전
    # 동작 바이트 동일. 명시적 fundingRate 경로(레거시 스테핑)에는 영향 없음.
    fundingStepping: bool = False
    # 분위수 팬을 계산할지. False면 건너뛰고 distribution=null로 응답한다.
    # 기본 True는 종전 동작과 바이트 동일 — 골든 패리티가 그 경로로 계속 검증된다.
    #
    # ── 이 필드는 이미 전송되고 있었다 ──────────────────────────────────────
    # 프론트엔드는 예전부터 `includeDistribution: false`를 페이로드에 실어
    # 보내고 있었다(골든 픽스처에도 박혀 있다). 그런데 **백엔드에 그 필드가
    # 없었다.** Pydantic은 모르는 필드를 조용히 버리므로, 프론트는 팬을 껐다고
    # 믿었고 백엔드는 계속 네 번 더 돌렸다. 요청 하나가 두 시스템에서 서로
    # 다른 뜻이었던 것이다.
    #
    # 그래서 새 이름을 만들지 않고 **이미 있던 이름을 듣게** 했다. 페이로드는
    # 한 바이트도 안 바뀌고, 골든 핀도 손댈 필요가 없다.
    #
    # 실측 근거: 프로파일에서 이 팬이 총 109.9초 중 **82.8초**(75%)였다.
    # 나머지 26초가 실제 손익 계산이다. 팬은 HARDEN-1에서 결과 화면을 떠났고
    # 이 배포는 그리지 않는다. 계산 능력은 남긴다 — 옵트아웃이지 삭제가 아니다.
    includeDistribution: bool = True


class SimulationChartPoint(BaseModel):
    """Total-Return 궤적의 하루치. `day` 외의 시리즈 키(mtmPnL, cumulativeCarry,
    swapPnL, totalPnL, swapThetaPnL, swapValuationPnL)와 BOK 이벤트 당일에만
    붙는 bokBreakdown은 열린 필드로 통과시킨다 — 프론트 DTO도 open row다."""
    model_config = ConfigDict(extra="allow")

    day: int


class SimulationSummary(BaseModel):
    finalMTM: int
    finalCarry: int
    finalSwap: int
    finalTotal: int
    breakEvenDay: int


class PvbpSensitivityRow(BaseModel):
    sector: str
    tenors: dict[str, float]   # KRD_NAMES 각 테너 + "합계"
    total: float


class BookDailyPnLRow(BaseModel):
    bookName: str
    dailyCarry: int
    fundingCost: int
    bondValuation: int
    swapValuation: int
    swapThetaPnL: int
    totalDailyPnL: int


class IrsSettlementEvent(BaseModel):
    day: int
    date: str | None
    positionName: str
    positionId: str
    notional: float
    direction: int
    fixedRate: float
    settledCf: int


class IrsDailyReconRow(BaseModel):
    date: str
    day: int
    pvbp: dict[str, int]
    cumulativeBp: dict[str, float]
    dailyDbp: dict[str, float]
    pnl: dict[str, int]
    totalEstPnl: int
    totalActual: int
    settleCf: int
    npvChange: int
    residual: int
    thetaPnl: int
    valuationPnl: int
    # [OWNER, 2026-08-11 — 교과서 3분해] 세타의 캐리/롤다운 분리(그날 증분).
    # carryPnl + rolldownPnl == thetaPnl (표시 정밀도에서 정확 — recon.py가
    # 라운딩 잔차로 롤다운을 잡는다). 구 캐시/구 응답 호환을 위해 기본 0.
    carryPnl: int = 0
    rolldownPnl: int = 0


class FundingCurvePoint(BaseModel):
    """s11 T4 — 시뮬레이션 타임스텝별 조달금리/포지션 운용수익률/캐리 bp.
    positionRate/carryBp는 살아있는 채권이 없으면 null (0이 아니라 미정의)."""
    day: int
    date: str
    fundingRate: float
    positionRate: float | None
    carryBp: float | None


class DistributionBand(BaseModel):
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


class SimulationDistribution(BaseModel):
    """s11 T3 — totalPnL 퍼센타일 팬. p50은 기본 시나리오 궤적과 동일하고,
    각 밴드는 '시나리오 + 만기 Δp 평행 충격'의 실제 엔진 런이다
    (simulation_service.build_distribution_bands의 가정 주석 참조).

    s18 T3 (이중축 분리): bands의 p-키는 '생성 금리 분위수 시나리오'의 수익
    궤적이며 순위 라벨이 아니다 — FE는 라인 + 시나리오 라벨로 렌더링한다.
    ratePaths는 각 시나리오의 국채 3Y 누적 충격 경로(bp)로, 금리는 분위수에
    단조라 절대 교차하지 않는다 — P5..P95 라벨이 진실인 축은 이쪽이다."""
    sigmaBpDaily: float
    sigmaTerminalBp: float
    percentiles: list[int]
    method: str
    bands: list[DistributionBand]
    # s18 확장 필드 (추가 전용) — 금리 분위수 경로, bands와 같은 day 축.
    ratePaths: list[DistributionBand]


class SimulationExclusion(BaseModel):
    """s15 T2 — 명시적 자산군 제외. 제외된 자산군은 0이 아니라 '표시 없음'으로
    렌더링돼야 한다(blank-MtM 정책): FE Results가 reason을 그대로 공지로 띄우고
    해당 손익 라인을 공란 처리한다."""
    assetClass: str   # 현재 "swap"만 발생
    reason: str       # 예: "당일 IRS 호가 없음"
    asOf: str         # 기준일 (ISO)


class TotalReturnDecomposition(BaseModel):
    """s15 T2 — 만기 시점 Total Return 성분 분해(비라운딩 float, 원화).
    문서화된 라인 셋(최소·명확): bondMtm(채권 평가) + bondCarry(채권 이자수익
    + 만기 재투자 수익, 조달 차감 전 총액) + fundingCost(조달 비용, 음수) +
    swapMtm(IRS 평가) + swapCarry(IRS 캐리). 합 == chartData 최종 totalPnL
    (±₩1, 라운딩 차이만 — test_simulate_api가 고정). 스왑이 제외된 요청에서는
    swapMtm/swapCarry가 null(미정의)이고 total은 채권 성분 합이다.

    HARDEN-1: 스왑 성분은 채권과 대칭인 세타/평가 분해였다(swapCarry = 세타
    전액). [OWNER, 2026-08-11 — 교과서 3분해] 세타 버킷이 문헌(Clarus carry,
    Tuckman unchanged-term-structure)대로 다시 갈렸다: swapCarry = 순캐리
    (동결 커브 경로의 쿠폰 차 액크루얼+정산 — carry_split.py), swapRolldown =
    세타 − 캐리(만기 압축의 클린 가격 변화), swapMtm = 평가손익(전체 − 세타,
    종전 그대로). swapCarry+swapRolldown == 종전 swapCarry(세타)이고 합·total·
    채권 성분·funding은 동일하다. 스왑 제외 요청에서는 셋 다 null."""
    bondMtm: float
    bondCarry: float
    fundingCost: float
    swapMtm: float | None
    swapCarry: float | None
    swapRolldown: float | None = None
    total: float


class DecompositionDailyPoint(BaseModel):
    """HARDEN-1 — 일별 누적 Total Return 성분 분해(비라운딩 float, 원화).
    TotalReturnDecomposition과 같은 엔진 누적기에서 나온 같은 float들의 일별
    스냅샷: 매일 fundingCost + bondMtm + bondCarry + swapMtm + swapCarry ==
    total (±₩1 핀), 마지막 날 == totalReturnDecomposition. 스왑 성분은
    평가/캐리/롤다운 3분해 [OWNER, 2026-08-11 — TotalReturnDecomposition
    doc 참조]; 스왑 제외 요청은 스왑 성분 셋이 매일 null(blank 정책 —
    게으른 0 금지)."""
    day: int
    fundingCost: float
    bondMtm: float
    bondCarry: float
    swapMtm: float | None
    swapCarry: float | None
    swapRolldown: float | None = None
    total: float


class FundingBasisOut(BaseModel):
    """SIM2-7 — 조달 기준 출처(프로버넌스). 고정 모드(fundingRate 생략)에서만
    applied=True: 시리즈 커버리지 내 날짜는 실적(BOK)+스프레드, 조인
    (joinDate) 이후는 정책 상수+스프레드, SIM2-5 이벤트는 그 위에 스택.
    stale = 시리즈 최신값 ≠ 정책 상수(시리즈가 결정에 뒤처짐)."""
    seriesStart: str | None
    joinDate: str | None
    seriesLatestRate: float | None
    policyRate: float
    spreadBp: int
    stale: bool
    applied: bool


class SwapContributionRow(BaseModel):
    """2026-08-06 — 스왑 한 건의 만기 시점 기여 (비라운딩 원화).

    엔진이 스왑마다 만들던 궤적의 **마지막 값**이다. 궤적 전체가 아니라 끝값만
    담는 이유: 377건 × 181일이면 이 배열 하나가 응답 전체보다 커지는데, 이
    표가 답하는 질문("어느 스왑이 손익을 끌었나")에는 끝값이면 충분하다."""
    positionId: str
    positionName: str
    book: str
    notional: float
    direction: int
    fixedRate: float
    maturityDate: str | None
    mtm: float
    carry: float
    total: float


class SimulateResponse(BaseModel):
    status: str
    chartData: list[SimulationChartPoint]
    summary: SimulationSummary
    pvbpSensitivity: list[PvbpSensitivityRow]
    bookDailyPnLs: list[BookDailyPnLRow]
    irsSettlementEvents: list[IrsSettlementEvent]
    irsDailyReconciliation: list[IrsDailyReconRow]
    # s11 확장 필드 — 기존 골든 계약에 대한 추가 전용(extend, don't mutate).
    fundingCurve: list[FundingCurvePoint]
    distribution: SimulationDistribution | None
    # s15 확장 필드 — 역시 추가 전용.
    exclusions: list[SimulationExclusion]
    totalReturnDecomposition: TotalReturnDecomposition
    # HARDEN-1 확장 필드 — 추가 전용: 일별 누적 성분 분해 경로.
    decompositionDaily: list[DecompositionDailyPoint]
    # SIM2-7 확장 필드 — 추가 전용: 조달 기준 프로버넌스.
    fundingBasis: FundingBasisOut
    # 2026-08-06 확장 필드 — 추가 전용: 포지션별 기여.
    swapContributions: list[SwapContributionRow] = []


# The Cloudflare tunnel that fronts this backend in the Vercel deployment enforces
# a ~100s origin-response wall (HTTP 524, not tunable below an Enterprise plan) that
# fires under even Vercel's 120s rewrite / 300s function budgets. So simulate is
# STREAMED: it flushes response headers + a whitespace byte immediately and again
# every HEARTBEAT_INTERVAL_S while the (seconds-to-minutes) engine run computes in a
# worker thread, keeping bytes flowing so neither Cloudflare (524) nor Vercel (504)
# times out for a run of any length. The client's res.json() ignores the leading
# whitespace, so the payload stays parse-identical to the golden; serialization
# still routes through SimulateResponse below, preserving the frozen contract shape.
#
# NOTE: `async def` here is deliberate and is NOT the event-loop-blocking anti-pattern
# the other CPU-bound routers avoid — run_simulation runs in loop.run_in_executor (a
# worker thread, exactly as a plain `def` endpoint would), while this coroutine only
# awaits and yields heartbeats. Do NOT call run_simulation() directly in this
# coroutine: that WOULD stall the event loop for the whole run.
#
# Error semantics changed by streaming: engine crashes ("FM Engine Crash …") now
# occur after the 200 headers are already on the wire, so they abort the stream
# (truncated body) instead of the app.py catch-all's clean 500. Request-validation
# 422s are unaffected — FastAPI validates the body before this handler runs.
HEARTBEAT_INTERVAL_S = 30.0


@router.post("/simulate")
async def simulate(req: SimulateRequest) -> StreamingResponse:
    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(
        None,
        lambda: simulation_service.run_simulation(
            positions=req.positions,
            shock_curves=req.shockCurves,
            daily_shock_curves=req.dailyShockCurves,
            funding_rate=req.fundingRate,
            funding_events=req.fundingEvents,
            sim_days=req.simDays,
            shock_type=req.shockType,
            shock_mode=req.shockMode,
            base_shock_bp=req.baseShockBp,
            base_date=req.baseDate,
            irs_curves=req.irsCurves,
            custom_path=req.customPath,
            sigma_bp=req.sigma_bp,
            funding_stepping=req.fundingStepping,
            want_distribution=req.includeDistribution,
        ),
    )

    async def body_stream():
        # First byte now: locks 200 + flushes headers so the ~100s TTFB 524 can't
        # fire; a leading space is ignored by any JSON parser downstream.
        yield b" "
        while True:
            try:
                result = await asyncio.wait_for(
                    asyncio.shield(fut), HEARTBEAT_INTERVAL_S
                )
                break
            except asyncio.TimeoutError:
                yield b" "  # keepalive while the engine run is still in flight
        # Serialize through the frozen response model so the payload shape and
        # typing match what response_model=SimulateResponse used to emit. An engine
        # crash re-raises out of wait_for here (headers already sent) → stream aborts.
        yield SimulateResponse.model_validate(result).model_dump_json().encode("utf-8")

    return StreamingResponse(body_stream(), media_type="application/json")
