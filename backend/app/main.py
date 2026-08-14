"""braveworld backend — KRW IRS monitor API, plus the scenario simulation.

Stage-1 wall summary + stage-2 full series. All derived series (spreads,
flies) are computed here, never in the browser (design spec §4).

Forwards / curve bootstrapping are intentionally ABSENT: the module list to
port from the frozen engine is [TBD — owner]. /api/forwards is a stub that
documents the gate.

ONE SERVICE, TWO SURFACES [OWNER, 2026-08-07]. The simulation used to be its
own project (simulation_project, :8200/:3200) with its own FastAPI app. The
owner directed that it become a TAB on this monitor rather than a second
site, so `irs_pricer/` moved into this backend and its four routers are
registered here alongside this module's own. simulation_project stays alive
as the comparison copy until the merged surface has been seen working.

The route sets were disjoint except for `/api/health`, which both apps
defined and which is merged below into one response carrying both halves.

What this cost, and why it is written down: this repo's guardrail said
"braveworld has no database — it reads one xlsx", and the simulation's own
pyproject dropped sqlalchemy/pymysql/alembic on the way over for the same
reason. That guardrail is now on borrowed time — the owner is moving both
halves onto MySQL once the middle-office account arrives. Nothing here
depends on a database yet; the loaders that MySQL will replace are left
whole so the seam stays where it is (see CLAUDE.md).
"""

from __future__ import annotations

import logging
import logging.config

# Configured before anything else imports a logger, so `irs_pricer`'s DEBUG
# lines are not swallowed by the root default. Carried over from the
# simulation's app.py, which did the same thing at the same point and for the
# same reason; it also promotes this module's own INFO logging, which used to
# fall below the unconfigured root's WARNING threshold — the cache's LOUD
# recompute notice among them.
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"default": {"format": "%(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "default"}},
    "root": {"level": "INFO", "handlers": ["console"]},
    "loggers": {"irs_pricer": {"level": "DEBUG"}},
})

import datetime as dt
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from irs_pricer.api.routers import credit_curve, market_data, positions, simulate
from irs_pricer.config import DATA_DIR
from irs_pricer.core import data_watch, ttl_cache
from irs_pricer.core.errors import CurveBootstrapError
from irs_pricer.engine import curve_cache

from . import instruments as instruments_mod
from . import calendar_cache
from . import df_cache
from . import payloads
from . import schedule_cache
from .backtest import BacktestError, Position, book_recon, run_backtest
from .cache import cached
from . import cashbond
from . import creditmatrix
from . import funding
from .curves import build_basis_curves
from .dataset import load_dataset_merged
from .derive import basis_dates, derived_ids, series_history
from .theta import theta_table
from .dv01 import build_dv01_table
from .events import detect_event_clusters
from .forwards import forwards_payload
from .policy import load_base_rate, policy_step
from .staleness import dataset_freshness
from .volatility import volatility_payload

# `DATA_PATH`(data/irsdata.xlsx)는 없어졌다 [OWNER, 2026-08-07] — IRS 종가는
# 이제 MySQL 에서 온다. 파일 자체는 남아 있고 정적 트리 빌드와 테스트가 계속
# 읽지만, **서버는 더 이상 열지 않는다**. 상수를 지운 이유는 남겨 두면 다음
# 사람이 "여기가 출처" 라고 읽기 때문이다.
#
# 기준금리는 아직 워크북이다. 이 테이블에 없는 데이터이고, 옮기는 것은 별개의
# 결정이다.
POLICY_PATH = Path(__file__).resolve().parents[2] / "data" / "bokbaserate.xlsx"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Memoises the pure curve bootstrap that every simulation pricing/risk path
    # funnels through — see irs_pricer/engine/curve_cache.py for the
    # measurements (1409.7s -> 118.6s on a full book). IRS_PRICER_CURVE_CACHE=0
    # skips installation: the operational escape hatch, and the A/B mechanism
    # for byte-identity evidence against the frozen engine.
    #
    # This is the SIMULATION's cache and is unrelated to app/cache.py, which
    # persists this module's own forwards payload to disk. Two caches,
    # two lifetimes, no shared state — the name is the only thing they share.
    if os.environ.get(curve_cache.ENV_FLAG, "1") == "0":
        logging.getLogger("irs_pricer").warning(
            "curve_cache NOT installed (%s=0) — engine runs unmemoized", curve_cache.ENV_FLAG
        )
        curve_cache.uninstall()
    else:
        curve_cache.install()
    # The BACKTEST's equivalent, and a separate cache with a separate switch —
    # `BW_SCHEDULE_CACHE=0` (see app/schedule_cache.py). It memoises the ISDA
    # schedule build, which the reference book was doing 39,804 times to produce
    # 6 distinct schedules. Installed here rather than at import so the default
    # for tests and scripts stays the unmemoized engine, exactly as
    # curve_cache's does; `install()` reads the flag itself.
    schedule_cache.install()
    # MEMO-1C: the residual the schedule memo could not reach — `select_fixing`
    # walking back to F(R). 515,473 calls over 40 distinct inputs on the
    # reference book (app/calendar_cache.py). `BW_CALENDAR_CACHE=0` disables it.
    calendar_cache.install()
    # MEMO-2: the scalar discount-factor lookup, memoized PER CURVE. It was
    # 74% of simulation cost and ~4/5 of that is numpy dispatch, not
    # arithmetic; the same (curve, t) pair is asked 20-98x per run.
    # Installs on BOTH copies of the port (backtest + simulation) — they are
    # different function objects. `BW_DF_CACHE=0` disables it.
    df_cache.install()
    logging.getLogger("irs_pricer").info("simulation data dir: %s", DATA_DIR)
    yield


app = FastAPI(title="braveworld", version="0.1.0", lifespan=lifespan)

# This module's own routes. They used to hang off `@app.get` directly; they are
# on a router now for one reason — `include_router` is how the simulation's
# four routers arrive, and routes registered both ways in one file read as two
# conventions fighting. Same paths, same handlers, same order.
router = APIRouter()


class _DataWatchMiddleware(BaseHTTPMiddleware):
    """Clear the simulation's derived caches when its data folder changed.

    Carried over from the simulation's app.py. The source cleared these inside
    its upload endpoint; it sits in middleware rather than in each router so no
    future endpoint can forget it. Only stat() calls — the check never opens a
    workbook.

    It does NOT cover this module's own payloads. Those are bound to the
    dataset loaded once at import (below) and keyed by file hash in
    app/cache.py; a refresh of irsdata.xlsx still needs a restart, exactly as
    before. Nothing about the merge changed that, and pretending otherwise
    would be the silent-staleness defect this project keeps having.
    """

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            data_watch.check()
        return await call_next(request)


class _UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """Last-resort net for exception types no registered handler covers.

    A KeyError/TypeError/IndexError, or a numpy/scipy error, otherwise escapes
    to ServerErrorMiddleware and comes back as a bare 500 with no
    Access-Control-Allow-Origin — the browser then blames CORS and the client
    reports "cannot reach the server" though the server answered.

    This has to be middleware rather than @app.exception_handler(Exception):
    Starlette special-cases a handler keyed `Exception` (or 500) and hoists it
    into ServerErrorMiddleware, which sits *outside* CORSMiddleware. Middleware
    can sit inside it; that handler never can.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001 — being the last net is the point
            logging.getLogger("irs_pricer").exception("Unhandled error")
            return JSONResponse(status_code=500, content={"detail": f"서버 오류: {exc}"})


# ORDER IS LOAD-BEARING, and reads backwards: add_middleware() does
# user_middleware.insert(0, ...) and build_middleware_stack() wraps the list in
# reverse, so the LAST middleware added ends up OUTERMOST. CORS must therefore
# be added last to stay outside the catch-all — otherwise the catch-all's 500
# goes out without CORS headers and re-creates the very bug it exists to
# prevent. Resulting nesting, outside in:
#
#     CORS -> unhandled-error -> data-watch -> gzip -> routes
#
# GZip innermost is the one deviation from either source's order, and it is the
# right end: it compresses route responses, which is all it ever did here, and
# the error middleware's JSON payloads are a line long.

# Every response left here uncompressed (measured, Pass E: no Content-Encoding
# on any endpoint). These payloads are long lists of short numeric records and
# compress ~6x; the stage-2 series fetch, the one the reader actually waits on
# when opening a popup, goes 103 KB -> 17 KB. minimum_size skips the small
# ones, where the header costs more than it saves (/api/health is 156 bytes).
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(_DataWatchMiddleware)
app.add_middleware(_UnhandledErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    # braveworld runs on :3100/:8100 — :3000/:8000 belong to the frozen
    # krw-fi-pms deployment and must stay untouched. :3200 is NOT here: the
    # simulation's own frontend is not a client of this service, its screens
    # came over as a tab on :3100.
    allow_origins=["http://localhost:3100", "http://127.0.0.1:3100"],
    # POST joins GET for the simulation's three POST routes (/api/simulate,
    # /api/credit-curve/series, /api/market-data/live). GET-only would have
    # failed them at the preflight, before any handler ran.
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(CurveBootstrapError)
async def curve_bootstrap_error_handler(request: Request, exc: CurveBootstrapError) -> JSONResponse:
    """Every simulation endpoint routes through build_curve() at some point —
    handling this centrally means a bad market rate (corrupt snapshot, typo'd
    quote) comes back as one clean 400 everywhere instead of an opaque 500."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError) -> JSONResponse:
    """Catch unhandled RuntimeErrors before they escape as bare 500s without
    CORS headers. Same caveat as above — this MUST be a specific subclass,
    never bare `Exception`, or Starlette pulls it out of ExceptionMiddleware
    and puts it in ServerErrorMiddleware *outside* CORSMiddleware."""
    logging.getLogger("irs_pricer").exception("Unhandled runtime error")
    return JSONResponse(status_code=500, content={"detail": f"계산 오류: {exc}"})

# IRS 종가의 출처는 **MySQL** 이다 [OWNER, 2026-08-07 — "무조건 SQL 쪽이 정답임"].
#
# `data/irsdata.xlsx` 는 지웠거나 옮기지 않았다 — 백테스트의 정적 트리 빌드
# (scripts/build_static.py)와 테스트가 아직 그 파일을 읽고, 대조 스크립트
# (scripts/check_mysql.py)도 그것을 기준으로 두 출처를 비교한다. 서버가 읽는
# 것만 옮겼다.
#
# 대조 근거는 dataset.py 의 `load_dataset_sql` 주석에 있다: 3M~10Y 는 2,616일이
# 소수점 끝까지 일치했고, 1D(콜금리)만 80.8% 어긋났다(다른 계열). 오너가 SQL 을
# 정답으로 정했으므로 1D 도 그대로 받는다 — 과거 짧은 끝 커브가 달라지고 그건
# 의도된 변경이다.
#
# 2026-08-11 부터는 **병합 로더**다 [OWNER — 아침 자동 굽기]: SQL 이 기대
# 전영업일을 온전히 들고 있으면 위와 동작이 같고, 1D 만 비면 그 칸을, 하루가
# 통째로 없으면 그 하루를 엑셀(irsdata.xlsx)에서 보충한다. 정적 빌드
# (scripts/build_static.py)도 같은 로더를 지난다 — 한쪽만 병합을 알면 폴백한
# 날마다 static-agreement 가 갈라진다.
_dataset = load_dataset_merged()
_bases = basis_dates(_dataset)
# The policy step, resolved ONCE against this dataset's as-of date — the carry
# bound depends on both files, so it cannot be decided by policy.py alone (see
# its docstring). Two dozen corners; it rides in the summary rather than
# earning an endpoint, because every %-unit chart needs it and the summary is
# already the first thing fetched.
_policy = policy_step(load_base_rate(POLICY_PATH), _dataset.asof)
_curves = build_basis_curves(_dataset)
_events = detect_event_clusters(_dataset)
_volatility = volatility_payload(_dataset, _bases)
_dv01_table = build_dv01_table(_curves["now"], derived_ids)
# The own-history distributions are the slow part (§D) — bootstrap each
# historical curve once and reprice all forwards (~13s) — over a file that
# changes once a day. Persist them keyed by the data-file hash; recompute only
# when the data changes (loudly logged).
# 바이트가 없으므로 **테이블 워터마크**가 캐시 키다 (cache.sql_data_hash) —
# CLAUDE.md 가 이 이동에서 잊지 말라고 못 박은 자리다. 키는 병합 로더가 만든다:
# 순수 SQL 이면 워터마크 그대로, 엑셀이 섞이면 병합분 지문이 붙는다.
_data_hash = _dataset.data_key
_forwards = cached("forwards", _data_hash, lambda: forwards_payload(_dataset, _curves))
# 라고 할 때 살걸(`_regret`)이 여기 있었다 — Lab 탭이 비면서 내려갔다 [OWNER,
# 2026-08-14]. 20일 이벤트 리플레이 + 줄마다 ~2회 평가라 굽는 값이 실했는데,
# 그걸 읽는 화면이 없어졌다. 디스크에 남은 v7 `regret` 캐시 파일은 이제 아무도
# 열지 않는다 — 모양이 바뀐 게 아니라 사라진 것이라 SCHEMA_VERSION 은 그대로다.
# Two things that used to sit here are gone, both from this region of the
# popup: the curve heatmap (its 어제-column question was answered faster by
# the table, and daily resolution over ten years was noise) and carry & roll
# after it (see DESIGN — removed for a repeated figure and components that
# did not sum). `forwards` is the only cached payload now.


@router.get("/api/health")
def health() -> dict:
    """Liveness for both halves of the service.

    The monitor's five fields are FIRST and unchanged: the frontend reads them
    (lib/api.ts), and test_static_agreement pins `asof` against the static
    manifest. The simulation's app.py had its own /api/health — the only route
    the two apps collided on — and its fields are appended rather than merged
    into the ones above, because they answer a different question: is the data
    folder there, and are the caches doing anything.

    It also doubles as the cheapest way to confirm the event loop is free: if
    this doesn't answer instantly while a simulation is computing, something
    heavy is back on the loop again.
    """
    return {
        # freshness recomputed per request (its age advances with the wall clock
        # while the file does not) — see staleness.py.
        "status": "ok",
        "asof": _dataset.asof.isoformat(),
        "rows": len(_dataset.dates),
        "missingNodes": _dataset.missing_nodes,
        # 어디서 온 데이터인가 — "sql" 이 아니면 프론트가 엑셀 연결 칩을 단다
        # [OWNER, 2026-08-11 "엑셀데이터에 연결되어있다고 말은 해줘야 해"].
        "source": _dataset.source,
        "freshness": dataset_freshness(_dataset.asof),
        "simulation": {
            "dataDir": str(DATA_DIR),
            "dataPresent": DATA_DIR.is_dir(),
            "curveCache": curve_cache.stats(),
            "ttlCache": ttl_cache.stats(),
        },
    }


@router.get("/api/wall/summary")
def wall_summary() -> dict:
    return payloads.wall_summary(_dataset, _bases, _events, _policy)


@router.get("/api/series/{series_id}")
def series_detail(series_id: str, res: str = "full", interval: str | None = None) -> dict:
    # Content comes from payloads.py so the static build cannot drift from this
    # (Pass B). All that is left here is turning an unknown id into a 404.
    try:
        return payloads.series_detail(_dataset, series_id, res, interval)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown series {series_id}")


@router.get("/api/forwards")
def forwards() -> dict:
    return _forwards


@router.get("/api/dv01/{series_id}")
def dv01(series_id: str) -> dict:
    # Per-leg DV01 + DV01-neutral notional ratio at the current curve (§B).
    # Forwards/vol/unknown ids get an empty block (kind null).
    return _dv01_table.get(series_id, payloads.empty_dv01(series_id))


@router.get("/api/backtest")
def backtest(positions: str = "") -> dict:
    """Revalue a BOOK of positions daily and sum them (§backtest).

    `positions` is a `;`-separated list, one position per entry, each
    `id,direction,notional,entry[,exit]` — e.g.

        10Y,1,1e10,2025-07-30;3Y-10Y,1,5e9,2026-01-02,2026-05-01

    A query string rather than a POST body because every other route here is a
    GET and a backtest is a question, not a submission: this way a book is a
    URL somebody can paste to a colleague, which is the same property `?tile=`
    gives the rest of the product.

    LIVE ONLY, by design. Every other endpoint has a static twin under
    `frontend/public/api/**` that the deployed site serves; this one cannot,
    because the answer depends on inputs the reader chooses. Vercel runs the
    frontend and this backend runs behind it [OWNER, 2026-07-31], which is also
    what keeps §16 intact — the browser still computes nothing.
    """
    if not positions.strip():
        raise HTTPException(status_code=422, detail="at least one position is required")

    parsed: list[Position] = []
    for raw in positions.split(";"):
        raw = raw.strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) not in (4, 5):
            raise HTTPException(
                status_code=422,
                detail=f"bad position {raw!r}: expected id,direction,notional,entry[,exit]",
            )
        try:
            parsed.append(
                Position(
                    series_id=parts[0],
                    direction=int(parts[1]),
                    notional=float(parts[2]),
                    entry=dt.date.fromisoformat(parts[3]),
                    exit=dt.date.fromisoformat(parts[4]) if len(parts) == 5 and parts[4] else None,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"bad position {raw!r}: {exc}")

    try:
        # 일별 대사(`recon`)는 별도 패스다 — KRD 범프가 백테스트 본체보다
        # 비싸서 엔진 함수를 둘로 나눴다(backtest.book_recon doc). 응답은
        # 종전 그대로 한 덩어리에 `recon`만 얹는다.
        result = run_backtest(_dataset, parsed)
        result["recon"] = book_recon(_dataset, parsed)
        return result
    except BacktestError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ── Cash Bond [OWNER, 2026-08-14] ───────────────────────────────────────────
# Backtest 섹션의 여섯 번째 종목군. IRS 쪽 라우트와 같은 성질이다: 표는
# 서버가 다 계산해 내려보내고(§16), 백테스트는 **라이브 전용**이다 — 읽는
# 사람이 고르는 입력에 답이 달려 있어 정적 쌍둥이를 만들 수 없다.
#
# 민평은 워크북이 아니라 SQL 이다(`app/creditmatrix.py` 의 주석이 근거를
# 든다: 이 배포의 `data/` 에는 Credit Matrix 워크북이 없다).


def _funding_spec(basis: str, spread_bp: float) -> funding.FundingSpec:
    try:
        return funding.FundingSpec(basis=basis, spread_bp=spread_bp).validated()
    except funding.FundingError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/api/settings/funding")
def funding_settings(
    basis: str = funding.DEFAULT_BASIS,
    spreadBp: float = funding.DEFAULT_SPREAD_BP,
) -> dict:
    """Setting 탭이 조달 기준을 고르고 그 결과를 미리 보는 자리.

    화면이 값을 저장하는 곳은 아니다 — 스펙은 URL 로 다니고 백테스트 요청에
    실려 온다. 이 라우트는 "그 스펙이 유효한가, 지금 몇 %인가" 만 답한다.
    """
    spec = _funding_spec(basis, spreadBp)
    return {
        "options": [
            {"id": k, "label": v} for k, v in funding.BASIS_LABEL.items()
        ],
        "default": {"basis": funding.DEFAULT_BASIS, "spreadBp": funding.DEFAULT_SPREAD_BP},
        **funding.provenance(spec),
    }


@router.get("/api/cashbond/instruments")
def cashbond_instruments() -> dict:
    """표의 행 전부, 세타까지 계산해서.

    조달을 안 받는다 [OWNER, 2026-08-14 — "채권에서는 조달 차감하지 않는 걸로"].
    세타가 쿠폰캐리 + 롤다운이라 Setting 과 무관해졌고, 안 쓰는 인자를 남겨 두면
    다음 사람이 그것이 쓰인다고 믿는다. 조달은 백테스트 쪽 라우트가 여전히 받는다.
    """
    try:
        # IRS 세타는 자산스왑 행이 자기 스왑 다리 몫으로 쓴다. 커브 하나로
        # 닫힌 식이라 매 요청 다시 계산해도 싸고(측정 33ms), 데이터가 갱신되면
        # 자동으로 따라온다 — 여기 캐시를 두면 그 갱신을 놓친다.
        irs_theta, _basis = theta_table(_dataset)
        return cashbond.instruments(creditmatrix.load(), _dataset, irs_theta)
    except (cashbond.CashBondError, creditmatrix.CreditMatrixError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/api/cashbond/series/{series_id}")
def cashbond_series(series_id: str) -> dict:
    """한 종목의 전 기간 시계열 — 표를 눌렀을 때 뜨는 차트가 읽는다.

    IRS 쪽 `/api/series/{id}` 와 **같은 몸통**(`derive.series_history`)을 쓴다.
    같은 차트 컴포넌트(PreviewChart)가 먹을 모양이어야 하기 때문이다: 점마다
    전일 대비(`d`, 늘 bp)와 52주 min/max/avg 가 붙어야 툴팁이 선다. 여기서
    직접 만들면 두 화면이 같은 질문에 다른 정밀도로 답하게 된다.

    `unit` 을 넘기는 것이 요점이다 — 현금채권은 %(그래서 `d` 가 ×100 되어 bp),
    자산스왑은 이미 bp(그대로)다.
    """
    try:
        m = creditmatrix.load()
        kind, bond_type, tenor = cashbond.parse_id(series_id)
        values = cashbond.series_for(m, _dataset, series_id)
    except (cashbond.CashBondError, creditmatrix.CreditMatrixError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    unit = "%" if kind == cashbond.KIND_CASH else "bp"
    pairs = [
        (d.isoformat(), v) for d, v in zip(m.dates, values) if v is not None
    ]
    return {
        "id": series_id,
        "label": cashbond.instrument_label(kind, bond_type, tenor),
        "unit": unit,
        **series_history(pairs, unit),
    }


@router.get("/api/cashbond/backtest")
def cashbond_backtest(
    positions: str = "",
    basis: str = funding.DEFAULT_BASIS,
    spreadBp: float = funding.DEFAULT_SPREAD_BP,
) -> dict:
    """현금채권 북을 매일 재평가한다.

    `positions` 문법은 IRS 백테스트와 같다 — `;` 로 나열하고 하나는
    `id,direction,notional,entry[,exit]`. id 는 `CB:KTB:3Y` 또는
    `ASW:KTB:3Y` 다. 조달은 쿼리로 따라온다(Setting 탭이 채운다).
    """
    if not positions.strip():
        raise HTTPException(status_code=422, detail="포지션이 하나는 있어야 합니다.")

    spec = _funding_spec(basis, spreadBp)
    parsed: list[cashbond.BondPosition] = []
    for raw in positions.split(";"):
        raw = raw.strip()
        if not raw:
            continue
        parts = [x.strip() for x in raw.split(",")]
        if len(parts) not in (4, 5):
            raise HTTPException(
                status_code=422,
                detail=f"잘못된 포지션 {raw!r}: id,direction,notional,entry[,exit] 형식입니다.",
            )
        try:
            kind, bond_type, tenor = cashbond.parse_id(parts[0])
            parsed.append(
                cashbond.BondPosition(
                    kind=kind,
                    bond_type=bond_type,
                    tenor=tenor,
                    direction=int(parts[1]),
                    notional=float(parts[2]),
                    entry=dt.date.fromisoformat(parts[3]),
                    exit=dt.date.fromisoformat(parts[4]) if len(parts) == 5 and parts[4] else None,
                )
            )
        except (ValueError, cashbond.CashBondError) as exc:
            raise HTTPException(status_code=422, detail=f"잘못된 포지션 {raw!r}: {exc}")

    try:
        m = creditmatrix.load()
        result = cashbond.run_backtest(m, _dataset, parsed, spec)
        # 일별 대사는 별도 패스다 — KRD 범프가 본체보다 비싸서 IRS 쪽도 함수를
        # 둘로 나눴다(`backtest.book_recon` 의 근거). 응답은 한 덩어리에 얹는다.
        result["recon"] = cashbond.book_recon(m, _dataset, parsed, spec)
        return result
    except (cashbond.CashBondError, creditmatrix.CreditMatrixError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/api/volatility")
def volatility() -> dict:
    # Relative-ATR list rows + across-tenor curve, all precomputed (§16).
    return payloads.volatility(_dataset, _bases, _volatility)


@router.get("/api/instruments")
def instruments() -> dict:
    """What the 시뮬레이션 tab can book, grouped the way the tabs are.

    The monitor already divides the world into 아웃라이트/스프레드/버터플라이/
    포워드; the simulation's position entry offers the same list rather than a
    bare tenor picker, so "3s10s" means one thing in this product.
    """
    return instruments_mod.catalog()


@router.post("/api/instruments/expand")
def expand_instrument(body: dict) -> dict:
    """One instrument line → the swap legs the engine prices.

    LIVE, and it has to be: the leg weights are DV01-neutral at the base date's
    curve, and §16 says the browser computes nothing. The response rows are
    already in the shape /api/simulate takes.
    """
    try:
        series_id = str(body["seriesId"])
        direction = int(body.get("direction", 1))
        notional = float(body["notional"])
        base = dt.date.fromisoformat(str(body["baseDate"])[:10])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"seriesId·notional·baseDate가 필요해요 ({exc})",
        )
    if notional <= 0:
        raise HTTPException(status_code=422, detail="명목은 0보다 커야 해요.")
    try:
        legs = instruments_mod.expand(_dataset, series_id, direction, notional, base)
    except BacktestError as exc:
        # 다리를 못 세우는 이유는 사용자가 고칠 수 있는 것들이다 — 그 날 호가가
        # 없거나, 데이터 범위를 벗어난 날짜거나. 500이 아니라 이유를 말한다.
        raise HTTPException(status_code=422, detail=str(exc))
    return {"seriesId": series_id, "kind": instruments_mod.kind_of(series_id), "legs": legs}


# The monitor first, then the simulation — the order the reader meets them, and
# the order the tabs sit in. FastAPI matches on the full path and the two sets
# are disjoint, so nothing here depends on the order; it is for whoever reads
# the file next.
#
#     this module   /api/health  /api/wall/summary  /api/series/{id}
#                   /api/forwards  /api/dv01/{id}  /api/backtest
#                   /api/volatility
#     market_data   /api/market-data/range  /api/market-data/live
#                   /api/market-data/{valuation_date}
#     credit_curve  /api/credit-curve/taxonomy  /api/credit-curve/series
#     positions     /api/positions  /api/positions/summary
#     simulate      /api/simulate
app.include_router(router)
app.include_router(market_data.router)
app.include_router(credit_curve.router)
app.include_router(positions.router)
app.include_router(simulate.router)
