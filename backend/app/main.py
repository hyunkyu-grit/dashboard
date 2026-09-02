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
from irs_pricer.loaders import irsdata as irsdata_loader
from irs_pricer.services.simulation import bond_roll

from . import instruments as instruments_mod
from . import calendar_cache
from . import df_cache
from . import mr as mr_mod
from . import mrbacktest as mrbt
from . import mrbook
from . import mrcarry as mrc
from . import mrdiag as mrd
from . import mrregime as mrg
from . import mrseries as mrs
from . import payloads
from . import rv as rv_mod
from . import schedule_cache
# 백테스트 엔진은 이제 `mixedbook` 을 통해서만 부른다 — 스왑만 있는 북은 저쪽이
# 그대로 위임한다. 여기서 `run_backtest` 를 직접 들고 있으면 «스왑 전용 길» 이
# 하나 더 열려 있는 셈이고, 그 길로 들어간 북에는 `kind` 가 안 붙는다.
from .backtest import BacktestError
from . import futures
from . import mixedbook
from .cache import cached
from .cors import allowed_origin_regex, allowed_origins
from . import dev_marker
from . import cashbond
from . import creditmatrix
from . import funding
from .curves import TENOR_T, build_basis_curves
from .dataset import load_dataset_merged
from .derive import basis_dates, derived_ids, ohlc_buckets, series_history
from .theta import theta_table
from .dv01 import build_dv01_table, pv01
from .events import detect_event_clusters
from .forwards import forwards_payload
from .issuance import IssuanceUnavailable, build as build_issuance, day_detail as issuance_day, months_from
from .labmacro import MacroUnavailable, build as build_macro
from .labscenario import build_anchors
from .policy import load_base_rate_auto, policy_step, MPC_DATES
from .staleness import dataset_freshness
from .surface import surface_payload
from .surface3d import build_surface3d, surface3d_watermark
from .universe import build_universe, universe_series
from .volatility import volatility_payload

# `DATA_PATH`(data/irsdata.xlsx)는 없어졌다 [OWNER, 2026-08-07] — IRS 종가는
# 이제 MySQL 에서 온다. 파일 자체는 남아 있고 정적 트리 빌드와 테스트가 계속
# 읽지만, **서버는 더 이상 열지 않는다**. 상수를 지운 이유는 남겨 두면 다음
# 사람이 "여기가 출처" 라고 읽기 때문이다.
#
# 기준금리는 2026-09-01 부터 ECOS 다 [OWNER — "굳이 엑셀을 참고하는게 아니라
# ECOS API에서 참조해오는게 편하잖아"]. 이 경로는 이제 폴백이다: 키·망·캐시가
# 전부 없을 때만 읽히고, 그때는 `policy_step` 의 warnings 가 그 사실을 말한다.
POLICY_PATH = Path(__file__).resolve().parents[2] / "data" / "bokbaserate.xlsx"


#: 시뮬 채권 롤다운 레인의 커브 공급자 [OWNER, 2026-08-25 — 엔진 단위 분리].
#: 시뮬(irs_pricer)은 SQL 을 모른다는 계층 규칙 때문에 app 이 여기서 민평
#: 최신 커브를 먹인다. `creditmatrix.load()` 는 워터마크 캐시라 호출마다
#: 싸고, 실패는 bond_roll 쪽이 삼켜 «롤 0 + provenance» 로 강등한다.
_ROLL_SECTOR_TYPES: dict[str, str] = {
    "국채": "KTB",
    "은행채": "BD",
    "특은채": "KDB",
    "카드채": "CARD",
    "회사채": "CB1",
}


def _bond_sector_curves() -> dict[str, list[tuple[float, float]]]:
    m = creditmatrix.load()
    i = len(m.dates) - 1
    out: dict[str, list[tuple[float, float]]] = {}
    for sector, bond_type in _ROLL_SECTOR_TYPES.items():
        pts = creditmatrix.curve_points(m, bond_type, i)
        if pts:
            out[sector] = pts
    return out


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
    # 채권 롤다운 커브 공급자 — 위 `_bond_sector_curves` 주석 참조. 여기(기동)
    # 서 등록해야 테스트·스크립트의 기본이 «미등록 = 롤 레인 꺼짐»으로 남는다
    # (curve_cache 들과 같은 원칙).
    bond_roll.set_sector_curve_provider(_bond_sector_curves)
    # 시뮬 IRS 스냅샷 = 이 앱의 병합 데이터셋 **그 인스턴스** [OWNER,
    # 2026-08-25 — 감사록 F2]. 시뮬의 DATA_DIR 워크북 복사가 멈춰(08-19)
    # 스왑이 «당일 IRS 호가 없음»으로 제외되던 병의 근본 수정 — 백테스트와
    # 시뮬이 같은 데이터 한 벌(SQL 우선)을 본다. 미주입(테스트·스크립트)은
    # 종전 워크북 경로 그대로다.
    irsdata_loader.set_dataset(_dataset)
    logging.getLogger("irs_pricer").info("simulation data dir: %s", DATA_DIR)
    # 개발용으로 띄웠다는 쪽지(app/dev_marker.py). `SAURON_DEV_LOCAL=1` 없이는
    # 아무것도 안 쓴다 — Funnel 로 공개된 라이브 인스턴스는 쪽지를 안 남기고,
    # 그래서 백엔드 테스트가 그것을 자기 것으로 착각하지 못한다.
    dev_marker.write(dev_marker.listening_port())
    try:
        yield
    finally:
        dev_marker.clear()


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
    # V2-LOCAL EDIT 1 of 5 — see ../../BACKEND.md.
    # This is sauron-v2's OWN COPY, served on :8200 for a frontend on :3200.
    # The :3100 origins stay because the copy must still be runnable in
    # isolation against v1's port layout while the two run side by side; the
    # comment below is v1's and is kept for provenance.
    #
    # (v1's note) braveworld runs on :3100/:8100 — :3000/:8000 belong to the
    # frozen krw-fi-pms deployment and must stay untouched.
    #
    # 2026-08-20 (배포 준비): 목록이 `app/cors.py` 로 나갔다. 배포되면 프런트가
    # Vercel 에 있어 출처가 달라지고, 프리뷰 주소는 커밋마다 바뀌어 목록에 적을
    # 수가 없다. 값은 환경변수로 들어오고 규칙은 tests/test_cors_origins.py 가
    # 고정한다. 전면 허용(`*`)은 하지 않는다 — 이 API 는 인증이 없다.
    allow_origins=allowed_origins(),
    allow_origin_regex=allowed_origin_regex(),
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
_policy = policy_step(load_base_rate_auto(POLICY_PATH), _dataset.asof)
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
# 라고 할 때 살걸: a 20-day event replay plus ~2 valuations per line — a
# couple of seconds over a file that changes once a day, so it caches the
# same way forwards does.
# `_regret` 이 여기 있었다 — 은퇴 [OWNER, 2026-08-20]. 디스크에 남은 v7
# `regret` 캐시 파일은 이제 아무도 열지 않는다. 모양이 바뀐 게 아니라
# 사라진 것이라 SCHEMA_VERSION 은 그대로다.
# 커브 표면(Lab). 주별로 솎은 격자 하나라 굽는 값이 싸지만, 캐시에 태우는
# 것은 값 때문이 아니라 **굽기와 서버가 같은 페이로드를 내도록** 하기
# 위해서다 — forwards 와 같은 자리, 같은 키.
# FORWARD-PORT from braveworld (2026-08-14, `app/surface.py` 바이트 동일).
_surface = cached("surface", _data_hash, lambda: surface_payload(_dataset))
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


@router.get("/api/universe")
def universe() -> dict:
    """V2-LOCAL route. The expanded universe — 국고 현물, 크레딧 스프레드, 본드스왑
    스프레드, 국채선물 — read from live tables. Cached like the other payloads: the
    inputs only move once a day."""
    return cached("universe", _dataset.data_key, build_universe)


@router.get("/api/universe/series/{series_id:path}")
def universe_series_route(series_id: str, interval: str | None = None) -> dict:
    """V2-LOCAL. History for one expanded-universe row, for the preview pane.

    `interval=w|m` returns weekly/monthly OHLC bars instead of daily points,
    the same shape `/api/series/{id}` returns and built by the SAME function
    (`derive.ohlc_buckets`). The chart type is a global reader preference, so a
    route that could not answer it would leave 국고/크레딧/선물 rows drawing a
    line while the control said 주봉 — the screen would be lying about which
    series it is showing. Aggregation stays on this side (§16): the browser
    never buckets a series.
    """
    try:
        body = universe_series(series_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown universe series {series_id}")
    if interval in ("w", "m"):
        pairs = [(p["t"], p["v"]) for p in body.get("points", [])]
        return {"id": body["id"], "unit": body["unit"], "interval": interval,
                "bars": ohlc_buckets(pairs, interval)}
    return body


@router.get("/api/forwards")
def forwards() -> dict:
    return _forwards


@router.get("/api/surface")
def surface() -> dict:
    # 커브 표면 — 테너 × 날짜 × 금리 (Lab). 리더 입력 없음 → 통째로 굽힌다.
    return _surface


@router.get("/api/surface3d")
def surface3d() -> dict:
    """V2-LOCAL. Lab 3D 커브 표면 — 국고·크레딧·스왑 3풀, 1~10Y (surface3d.py).

    universe 처럼 라우트 안에서 게으르게 캐시한다 — SQL 이 절반이라 임포트
    시점(모듈 상수)에 태우면 기동이 DB 에 묶인다. 키는 dataset 워터마크 +
    credit_matrix 워터마크 둘 다다: universe 는 dataset 키만 쓰지만 이
    페이로드는 크레딧이 절반이라 크레딧 쪽 낡음도 잡아야 한다.
    """
    # 키의 마지막 조각은 **페이로드 판 번호**다 — 데이터 워터마크만으로는 코드가
    # 바뀐 것을 못 본다(실측 2026-08-18: 일별 전환 후 디스크 캐시가 주별을 그대로
    # 돌려줬다). 전역 SCHEMA 범프는 forwards 등 남의 캐시까지 태우므로 국소로 적는다.
    key = f"{_dataset.data_key}|{surface3d_watermark()}|p5-tenors"
    return cached("surface3d", key, lambda: build_surface3d(_dataset))


@router.get("/api/scenario/anchors")
def scenario_anchors() -> dict:
    """V2-LOCAL. Lab 시나리오가 오늘의 시장에 닿는 자리 (labscenario.py).

    캐시하지 않는다 — 포워드 par 금리 여덟 번이라 커브가 이미 서 있는 이 시점엔
    공짜다. 손잡이는 프런트가 돌리고 여기는 **앵커만** 답한다.

    기준금리는 `_policy` 에서 넘긴다. 이 모듈이 두 번째 사본을 만들면 `MPC_DATES`
    가 이미 겪은 «조용히 갈리는 사본» 이 하나 더 생긴다.
    """
    return build_anchors(_dataset, _curves, _policy.get("latest"))


@router.get("/api/scenario/macro")
def scenario_macro() -> dict:
    """V2-LOCAL. 모형이 딛고 선 거시 실측 — 한국은행 ECOS (labmacro.py).

    손잡이 셋(물가·갭·수출)이 무엇에 얹히는 값인지를 화면이 같이 보여주기 위한
    것이다. 캐시는 모듈이 진다(분기 계열이라 TTL 12시간).

    ECOS 가 죽어도 **화면은 서야 한다** — 시나리오의 본체는 구운 기저와 오늘의
    커브라 이 실측이 없어도 계산은 그대로다. 그래서 503 이 아니라 빈 목록을 주고
    화면이 그 자리에 이유를 적는다.
    """
    try:
        return build_macro()
    except MacroUnavailable as exc:
        logging.getLogger("app.main").warning("거시 실측 없음: %s", exc)
        return {"asof": None, "quarters": 0, "series": [], "notes": [str(exc)], "stale": True}


@router.get("/api/issuance/calendar")
def issuance_calendar(ym: str = "", months: int = 2) -> dict:
    """V2-LOCAL. 발행 캘린더 (issuance.py) — Lab 의 세 번째 세입자.

    `ym` 은 `YYYY-MM`, 비우면 오늘 달. 수집기가 CSV 를 새로 쓰면 mtime 이 캐시 키라
    다음 요청이 알아서 읽는다 — 서버를 건드릴 필요가 없다.

    금통위 날짜는 `policy.MPC_DATES` 가 준다. 그 목록은 `src/data/calendar.json` 의
    사본이고 둘의 일치는 테스트가 본다 — 이 모듈이 세 번째 사본을 만들지 않는다.
    """
    today = _dataset.asof
    try:
        y, m = (int(ym[:4]), int(ym[5:7])) if len(ym) >= 7 else (today.year, today.month)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{ym} 는 YYYY-MM 이 아니에요")
    span = months_from(y, m, max(1, min(6, months)))
    mpc = [d.isoformat() for d in MPC_DATES]
    try:
        return build_issuance(span, mpc)
    except IssuanceUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/issuance/day/{iso}")
def issuance_day_detail(iso: str) -> dict:
    """그날 하루 — 발행 종목 · 국고채 입찰(+응찰 강도) · 공개시장운영 · 금통위."""
    try:
        return issuance_day(iso, [d.isoformat() for d in MPC_DATES])
    except IssuanceUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/dv01/{series_id}")
def dv01(series_id: str) -> dict:
    # Per-leg DV01 + DV01-neutral notional ratio at the current curve (§B).
    # Forwards/vol/unknown ids get an empty block (kind null).
    return _dv01_table.get(series_id, payloads.empty_dv01(series_id))


@router.get("/api/backtest")
def backtest(
    positions: str = "",
    basis: str = funding.DEFAULT_BASIS,
    spreadBp: float = funding.DEFAULT_SPREAD_BP,
) -> dict:
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

    스왑과 현금채권을 **한 북에** 담는다 [OWNER, 2026-08-21]. `id` 가 `CB:`/`ASW:`
    로 시작하면 채권 줄이다 — 같은 문자열이 시뮬레이션·모니터에서 뜻하는 것과
    같고(`instruments.kind_of`), 조달은 채권 줄이 있을 때만 읽힌다. 한 종류뿐인
    북은 종전 엔진에 그대로 위임되므로 답이 한 원도 달라지지 않는다
    (`app/mixedbook.py`).
    """
    if not positions.strip():
        raise HTTPException(status_code=422, detail="at least one position is required")

    parsed: list[mixedbook.MixedPosition] = []
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
                mixedbook.MixedPosition(
                    series_id=parts[0],
                    direction=int(parts[1]),
                    notional=float(parts[2]),
                    entry=dt.date.fromisoformat(parts[3]),
                    exit=dt.date.fromisoformat(parts[4]) if len(parts) == 5 and parts[4] else None,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"bad position {raw!r}: {exc}")

    # 민평은 **채권 줄이 있을 때만** 읽는다 — 스왑만 있는 북이 SQL 에 닿아야 할
    # 이유가 없고, 닿게 만들면 그 테이블이 죽은 날 스왑 백테스트까지 같이 죽는다.
    # 선물 종가도 같은 규율이다 [OWNER, 2026-08-25 — 선물·퓨처스왑 합류].
    spec = _funding_spec(basis, spreadBp)
    matrix = None
    if mixedbook.has_bond(parsed):
        try:
            matrix = creditmatrix.load()
        except creditmatrix.CreditMatrixError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    fut_data = None
    if mixedbook.has_futures(parsed):
        try:
            fut_data = futures.load()
        except Exception as exc:
            raise HTTPException(
                status_code=422, detail=f"선물 종가를 읽지 못했습니다: {exc}"
            )

    try:
        # 일별 대사(`recon`)는 별도 패스다 — KRD 범프가 백테스트 본체보다
        # 비싸서 엔진 함수를 둘로 나눴다(backtest.book_recon doc). 응답은
        # 종전 그대로 한 덩어리에 `recon`만 얹는다.
        result = mixedbook.run_backtest(matrix, _dataset, parsed, spec, fut=fut_data)
        result["recon"] = mixedbook.book_recon(matrix, _dataset, parsed, spec, fut=fut_data)
        return result
    except (
        BacktestError,
        mixedbook.MixedBookError,
        cashbond.CashBondError,
        creditmatrix.CreditMatrixError,
        funding.FundingError,
        futures.FuturesError,
    ) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ── Cash Bond [OWNER, 2026-08-14] ───────────────────────────────────────────
# Backtest 섹션의 여섯 번째 종목군. IRS 쪽 라우트와 같은 성질이다: 표는
# 서버가 다 계산해 내려보내고(§16), 백테스트는 **라이브 전용**이다 — 읽는
# 사람이 고르는 입력에 답이 달려 있어 정적 쌍둥이를 만들 수 없다.
#
# 민평은 워크북이 아니라 SQL 이다(`app/creditmatrix.py` 의 주석이 근거를
# 든다). 조달 기준의 기본이 v1(base)과 달리 call 인 것은 `app/funding.py`
# 의 V2 절 — infomax.기준금리 가 멈춰 있어 base 는 실패 상태다.


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
    base 가 게이트에 걸려 있으면 여기서 422 로 그 사실이 그대로 나간다 —
    폴백 없이 실패 상태를 보여주는 것이 규칙이다 [OWNER 2026-08-18].
    """
    spec = _funding_spec(basis, spreadBp)
    try:
        prov = funding.provenance(spec)
    except funding.FundingError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {
        "options": [
            {"id": k, "label": v} for k, v in funding.BASIS_LABEL.items()
        ],
        "default": {"basis": funding.DEFAULT_BASIS, "spreadBp": funding.DEFAULT_SPREAD_BP},
        **prov,
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


@router.get("/api/futures/series/{series_id}")
def futures_series(series_id: str, res: str = "full") -> dict:
    """국채선물·퓨처스왑 한 계열의 전 기간 — 백테스트 창의 진입 레벨과
    「종목 추이」 차트가 읽는다 [OWNER, 2026-08-25].

    `/api/cashbond/series/{id}` 와 같은 자리의 같은 규율이다: 현금채권도 선물도
    `/api/series/{id}`(IRS 카탈로그)에 없는 계열이라 자기 길을 가지되, **몸통은
    같은 `derive.series_history`** 를 쓴다. 사유와 단위 규약은 `futures.py::
    series_payload` 머리에 있다.
    """
    try:
        return futures.series_payload(futures.load(), _dataset, series_id, res)
    except futures.FuturesError as exc:
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
    except funding.FundingError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ── RV Analysis — Strategy 섹션 (rv2) ───────────────────────────────────────
# 라이브 전용이다: 민평이 SQL 에만 있고(Cash Bond 와 같은 성질), 조달·금통위
# 경로가 읽는 사람의 입력이다. `creditmatrix.load()` 는 워터마크 캐시라 요청마다
# 전량을 다시 긁지 않는다(그 모듈의 규약).


@router.get("/api/rv/analysis")
def rv_analysis(
    h: int = rv_mod.H_DEFAULT_MONTHS,
    basis: str = funding.DEFAULT_BASIS,
    spreadBp: float = funding.DEFAULT_SPREAD_BP,
    window: str = "52w",
    mpc: str = "",
    reinvest: str = "none",
    reinvestRate: float = 0.0,
    paths: str = "",
) -> dict:
    """세 구성(동일섹터 격자·동일테너 히트맵·크레딧 산점) 페이로드 전부.

    파생량(carry·roll·재투자·매도 듀레이션·BEP·스왑점·경로별 총수익)을 서버가
    끝낸다(§16).

        mpc          `날짜:bp;…` — 달력 회의의 오버라이드, 기본 전부 0
        reinvest     none | manual | residual (워크북 만기선택!B11)
        reinvestRate manual 일 때의 연 이자율(%). 화면 단위 그대로 받아 decimal 로
        paths        `3M:0,6M:5,…|3M:20,…` — 비평행 경로(워크북 케이스 C/C-2)
    """
    if window not in ("52w", "all"):
        raise HTTPException(status_code=422, detail=f"알 수 없는 이력 창입니다: {window!r} (52w 또는 all)")
    if not 1 <= h <= 24:
        raise HTTPException(status_code=422, detail=f"호라이즌이 범위를 벗어납니다: {h}개월 (1~24)")
    if reinvest not in rv_mod.REINVEST_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"알 수 없는 재투자 방식입니다: {reinvest!r} ({', '.join(rv_mod.REINVEST_MODES)})",
        )
    # 재투자 금리는 화면이 퍼센트로 준다 — 손이 미끄러진 300%가 조용히 계산되지
    # 않도록 여기서 자른다(funding.spread_bp·금통위 ±100bp 와 같은 판단).
    if not -10.0 <= reinvestRate <= 30.0:
        raise HTTPException(
            status_code=422, detail=f"재투자금리가 범위를 벗어납니다: {reinvestRate}% (−10~30)"
        )
    spec = _funding_spec(basis, spreadBp)
    try:
        meetings = rv_mod.parse_meetings(mpc)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"금통위 오버라이드를 읽지 못했어요: {exc}")
    try:
        curve_paths = rv_mod.parse_paths(paths)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"커스텀 커브를 읽지 못했어요: {exc}")
    try:
        return rv_mod.build_rv(
            creditmatrix.load(), _dataset, spec,
            h_months=h, meetings=meetings, window=window,
            reinvest=reinvest, reinvest_rate=reinvestRate / 100.0,
            paths=curve_paths,
        )
    except (creditmatrix.CreditMatrixError, funding.FundingError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/api/rv/history")
def rv_history(sector: str, tenor: str, window: str = "52w") -> dict:
    """크레딧 RV 클릭 상세의 두 소형 차트 — 스프레드 이력·섹터 상대 이력과
    각각의 창 통계(±σ 밴드 재료). 숫자는 서버가 끝낸다(§16)."""
    if window not in ("52w", "all"):
        raise HTTPException(status_code=422, detail=f"알 수 없는 이력 창입니다: {window!r} (52w 또는 all)")
    try:
        return rv_mod.credit_history(creditmatrix.load(), sector, tenor, window)
    except creditmatrix.CreditMatrixError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _mr_payload(window: int, k: float) -> dict:
    """검증된 (window, k) 조합의 페이로드 — 조합마다 캐시 이름이 다르다.

    universe 캐시와 같은 판단으로 `_dataset.data_key` 에 태운다: BSS 는 호출 시
    SQL 이지만 하루 한 번 움직이는 입력이다. 조합은 WINDOWS×KS 로 유한하므로
    캐시 파일도 유한하다.
    """
    if window not in mr_mod.WINDOWS:
        raise HTTPException(
            status_code=422,
            detail=f"알 수 없는 룩백입니다: {window}일 ({', '.join(map(str, mr_mod.WINDOWS))})",
        )
    if k not in mr_mod.KS:
        raise HTTPException(
            status_code=422,
            detail=f"알 수 없는 밴드 폭입니다: {k}σ ({', '.join(map(str, mr_mod.KS))})",
        )
    return cached(f"mr-w{window}-k{k}", _dataset.data_key,
                  lambda: mr_mod.build_mr(_dataset, window=window, k=k))


@router.get("/api/mr/board")
def mr_board(window: int = mr_mod.WINDOW, k: float = mr_mod.K) -> dict:
    """Mean Reversion 측정면의 보드 — BSS 전 테너의 밴드 위치·상태·랭킹(§16).

    룩백·밴드 폭은 화면 선택지(WINDOWS·KS — 근거는 mr.py 머리)이고, 히스토리는
    무겁고 행마다 필요하지도 않아 `/api/mr/history` 가 따로 썬다.
    """
    p = _mr_payload(window, k)
    return {key: v for key, v in p.items() if key != "history"}


@router.get("/api/mr/history/{series_id:path}")
def mr_history(series_id: str, window: int = mr_mod.WINDOW, k: float = mr_mod.K) -> dict:
    """한 계열의 값+밴드 이력(약 1년) — 클릭 상세 차트의 재료. 밴드가 룩백·폭을
    따라가므로 보드와 같은 파라미터를 받는다."""
    p = _mr_payload(window, k)
    body = p["history"].get(series_id)
    if body is None:
        raise HTTPException(status_code=404, detail=f"unknown mr series {series_id}")
    return body


def _mr_neighbors(dates: list[str], vals: list[float], base: dict,
                  allow: tuple[int, ...], *,
                  carry: list[float] | None = None,
                  entry_mode: str = "level",
                  gate: list[bool] | None = None,
                  time_stop: int | None = None,
                  cost_bp_series: list[float] | None = None,
                  reverse_exit: bool = False,
                  close_open_at_end: bool = False) -> list[dict]:
    """노브를 한 칸씩 옮겼을 때의 결과 — 「이 칸이 얼마나 튼튼한가」.

    화면은 고른 칸 하나만 보여 준다. 그러면 손절 3.5 의 +2,605만은 보이고 손절
    3.0 의 +1,120만은 안 보이므로, 한 칸 차이가 결과를 절반으로 만든다는 사실이
    노브를 눌러 보기 전까지 감춰진다 — 재현 도구가 그 사실을 감추면 재현이
    아니라 주장이 된다 [OWNER 2026-08-26].

    **머리 숫자와 같은 규칙으로 돈다** [2026-08-28]. 종전에는 캐리를 안 넘겨서
    「현재」 칸이 머리의 총손익과 달랐다 — 실측 BSS-3Y 에서 머리 +4,443만 ·
    현재 칸 +4,160만(SR 0.812 대 0.762). 이웃 표는 «한 칸 옮기면 얼마나
    달라지는가» 를 재는 물건인데, 기준점이 머리와 다르면 그 차이가 노브 탓인지
    항이 빠진 탓인지 화면이 구분해 주지 못한다.

    격자는 `mr.STRATEGY_PRESETS` 위에서만 돈다(화면이 고를 수 있는 칸 = 견고성을
    재야 하는 칸). 현재 값이 프리셋 밖이면(딥링크·자유 룩백) 그 값도 한 칸으로
    끼워 넣는다 — 안 그러면 「현재」가 어느 칸인지 못 가리킨다. 계산은 노브당
    셋이라 열둘, 밀리초라 캐시를 안 태운다.
    """
    rows: list[dict] = []
    for knob, (label, suffix) in mr_mod.STRATEGY_KNOB_LABELS.items():
        cur = base[knob]
        opts = list(mr_mod.STRATEGY_PRESETS[knob])
        if cur not in opts:
            opts = sorted(opts + [cur])
        cells = []
        for v in opts:
            lb = int(v) if knob == "lookback" else base["lookback"]
            if len(vals) < lb + 1 or lb < 2:
                continue
            p = dict(base, **{knob: v})
            r = mrbt.simulate(dates, vals, lookback=int(p["lookback"]),
                              entry_z=p["entryZ"], exit_z=p["exitZ"],
                              stop_z=p["stopZ"], cost_bp=p["costBp"],
                              notional=p["notional"], allow_dirs=allow,
                              carry=carry, entry_mode=entry_mode, gate=gate,
                              time_stop=time_stop, cost_bp_series=cost_bp_series,
                              reverse_exit=reverse_exit,
                              close_open_at_end=close_open_at_end)
            sm = r["summary"]
            cells.append({
                "v": v,
                "totalPnl": round(sm["totalPnl"], 2),
                "sharpe": round(sm["sharpe"], 3) if sm["sharpe"] is not None else None,
                "winRate": round(sm["winRate"], 4) if sm["winRate"] is not None else None,
                "numTrades": sm["numTrades"],
                "current": v == cur,
            })
        if cells:
            rows.append({"knob": knob, "label": label, "suffix": suffix, "cells": cells})
    return rows


def _mr_check_knobs(lookback: int, entryZ: float, warnZ: float, exitZ: float,
                    stopZ: float, costBp: float, notional: float,
                    entryMode: str, timeStop: int, costModel: str,
                    regime: str) -> None:
    """노브의 범위·허용값 — `/api/mr/strategy` 와 `/api/mr/book` 이 **같은 문**을
    쓴다. 두 벌이면 한쪽만 통과하는 조합이 생기고, 그때 통합의 수와 낱개의 수가
    다른 규칙에서 나온 것이 된다."""
    if not 2 <= lookback <= 600:
        raise HTTPException(status_code=422, detail=f"룩백이 범위를 벗어나요: {lookback}일 (2~600)")
    for name, v in (("entry", entryZ), ("watch", warnZ), ("exit", exitZ), ("stop", stopZ)):
        if not 0.0 <= v <= 20.0:
            raise HTTPException(status_code=422, detail=f"{name} σ가 범위를 벗어나요: {v} (0~20)")
    if not 0.0 <= costBp <= 10.0:
        raise HTTPException(status_code=422, detail=f"비용이 범위를 벗어나요: {costBp}bp (0~10)")
    if not 0.0 <= notional <= 1e12:
        raise HTTPException(status_code=422, detail=f"명목이 범위를 벗어나요: {notional} (0~1e12)")
    if entryMode not in mrbt.ENTRY_MODES:
        raise HTTPException(status_code=422,
                            detail=f"진입 규칙이 이상해요: {entryMode} ({'|'.join(mrbt.ENTRY_MODES)})")
    # ── 실전 운용 손잡이 넷 [OWNER 2026-08-28] ─────────────────────────────────
    # 전부 기본이 꺼짐이라 안 주면 원본 PMS 재현 그대로다. 근거와 실측은
    # `docs/MR_LANE_STATE.md` 와 `backend/scripts/mr_live_report.py`.
    if not 0 <= timeStop <= 500:
        raise HTTPException(status_code=422, detail=f"타임스탑이 범위를 벗어나요: {timeStop} (0~500)")
    if costModel not in mrg.COST_MODELS:
        raise HTTPException(status_code=422,
                            detail=f"비용 모델이 이상해요: {costModel} ({'|'.join(mrg.COST_MODELS)})")
    if regime not in mrg.REGIMES:
        raise HTTPException(status_code=422,
                            detail=f"레짐 필터가 이상해요: {regime} ({'|'.join(mrg.REGIMES)})")


def _mr_leg(id: str, *, lookback: int, entryZ: float, exitZ: float, stopZ: float,
            costBp: float, notional: float, carry: bool, entryMode: str,
            timeStop: int, costModel: str, regime: str, reverseExit: bool,
            countOpen: bool, spec: funding.FundingSpec) -> dict:
    """한 계열의 **준비 + 시뮬** — 낱개 창과 통합 장부가 같은 것을 쓴다.

    2026-09-01 에 통합 밴드 워치(`/api/mr/book`)가 생기면서 갈라 냈다. 아홉
    만기를 한 장부로 더하는 화면에서 **통합의 수가 낱개 아홉의 합과 갈리면**
    그 화면은 아무 말도 못 하게 되므로, 계열 하나를 준비하는 자리는 하나여야
    한다: 단위 환산(%→bp)·방향·캐리·레짐 게이트·비용 경로·엔진 호출까지.

    반환은 화면 모양이 아니라 **재료**다 — 라우트가 각자의 페이로드로 썬다.
    """
    # 보드와 같은 유도 창구 — 선물·퓨처스왑도 여기서 같은 환산을 지난다.
    kinds = {s: kd for s, _, kd in mr_mod.SERIES}
    labels = {s: l for s, l, _ in mr_mod.SERIES}
    body = mr_mod.series_points(id)
    pts = [p for p in body["points"] if p.get("v") is not None]
    dates = [p["t"] for p in pts]
    # ⚠ **손익 산술은 bp 위에서 한다** [2026-08-28].
    #
    # 명목 노브의 단위는 `₩/bp` 인데 엔진은 `명목 × Δ값` 을 그대로 곱한다.
    # 계열의 값이 bp 면 맞지만 **선물 내재금리는 `%`** 라, 15.7bp 움직임이
    # Δ값 0.157 로 들어가 평가가 100배 작게 나왔다. 비용(`명목 × costBp`)과
    # 캐리(원금 환산이 `₩/bp` 기준)는 제 단위라, 결과는 «비용만 100배 무거운
    # 판» 이었다 — 실측 FUT-KTB3 승률 17%·SR −1.25 는 신호가 아니라 그것이다.
    # (`docs/MR_LANE_STATE.md` 의 «선물 넷은 전부 음수» 도 이 산술의 산물이다.)
    #
    # z·밴드는 눈금 변환에 불변이라 값이 안 바뀐다 — 바뀌는 것은 돈뿐이다.
    # 화면에 되돌려 줄 때는 계열의 자기 단위(%)로 나눠 보낸다.
    unit = body["unit"]
    scale = 100.0 if unit == "%" else 1.0
    vals = [float(p["v"]) * scale for p in pts]
    disp = (lambda v: round(v / scale, 4)) if scale != 1.0 else (lambda v: round(v, 4))
    if len(vals) < lookback + 1:
        raise HTTPException(status_code=422, detail=f"이력이 룩백보다 짧아요: {len(vals)} < {lookback + 1}")

    # 실행할 수 있는 방향만 재현한다 [OWNER 2026-08-25 — "BSS에서 숏은 없는거야,,
    # 현물대차매도는 안할거거든"]. 노브가 아니라 이 데스크의 사실이라 화면에
    # 스위치를 두지 않는다 — 백테스트의 현금채권이 매수만 받는 것과 같은 자리다.
    dirs = mr_mod.dirs_for(kinds[id])

    # ── 캐리 [OWNER 2026-08-27 — "중간에 CF는 상쇄되는건가?"] ──────────────────
    # 안 상쇄된다(`app/mrcarry.py` 머리에 다리별 산술). 원본 PMS 산술에는 이 항이
    # 없으므로 **끌 수 있게** 둔다 — `carry=false` 면 예전 수 그대로다.
    carry_krw: list[float] | None = None
    carry_defn: str | None = None
    if carry:
        rates, carry_defn = mrc.carry_rates(id, kinds[id], dates, spec)
        if kinds[id] == "fut":
            # 선물은 캐리가 0 이다(증거금·일일정산 — `mrcarry` 머리). 원금 환산이
            # 없으므로 pv01 도 필요 없다. 종전에는 그걸 먼저 읽으려 해서
            # `TENOR_T["KTB3"]` 로 500 이 났다 — `FUT-KTB3` 의 「KTB3」은 만기
            # 라벨이 아니라 상품명이다. 기본이 `carry=true` 라 **선물 두 계열은
            # 전략 실험 창에서 아예 열리지 않았다**(실측 2026-08-28).
            carry_krw = [0.0] * len(dates)
        else:
            # 명목 노브가 ₩/bp(DV01)라 원금 환산이 필요하다 — 그 근거도 그 파일에.
            pv = pv01(_curves["now"], TENOR_T[mrc._tenor_of(id)])
            carry_krw = mrc.carry_krw(rates, dates, notional_per_bp=notional, pv01=pv)

    # 필터·비용 경로는 **서버가** 만든다(§16, 브라우저는 계산하지 않는다).
    # 값은 bp 로 환산한 `vals` 위에서 잰다 — 화면 단위(%)로 재면 선물 계열의
    # 변동성 백분위가 딴 계열이 된다.
    gate = mrg.gate_for(regime, vals)
    cost_series = mrg.cost_for(costModel, vals)

    r = mrbt.simulate(dates, vals, lookback=lookback, entry_z=entryZ,
                      exit_z=exitZ, stop_z=stopZ, cost_bp=costBp,
                      notional=notional,
                      allow_dirs=tuple(dirs["allowed"]),
                      carry=carry_krw, entry_mode=entryMode,
                      gate=gate,
                      time_stop=timeStop or None,
                      cost_bp_series=cost_series,
                      reverse_exit=reverseExit,
                      close_open_at_end=countOpen)
    return {"id": id, "label": labels[id], "kind": kinds[id], "unit": unit,
            "dates": dates, "vals": vals, "disp": disp, "dirs": dirs,
            "carryKrw": carry_krw, "carryDefn": carry_defn,
            "gate": gate, "costSeries": cost_series, "r": r}


@router.get("/api/mr/strategy")
def mr_strategy(id: str, lookback: int = 60, entryZ: float = 2.0,
                warnZ: float = 1.5, exitZ: float = 0.5, stopZ: float = 3.5,
                # 편도 비용 기본값 0.05 → 0.5 [OWNER 2026-08-28]. 0.05 은 첫 PMS 의
                # 값이고 이 데스크의 실측이 아니다 — 국고3Y·IRS3Y 패키지 실제 편도가
                # ≤0.5bp 라는 오너 답이 있으므로 **보수적인 쪽을 기본**으로 둔다.
                # 싸게 잡은 비용은 결론을 통째로 뒤집는다(볼린저 레인의 그 자리).
                costBp: float = 0.5, notional: float = 1_000_000.0,
                carry: bool = True, entryMode: str = "level",
                timeStop: int = 0, costModel: str = "flat",
                regime: str = "none", reverseExit: bool = False,
                countOpen: bool = False,
                fundingBasis: str = funding.DEFAULT_BASIS,
                fundingSpreadBp: float = funding.DEFAULT_SPREAD_BP) -> dict:
    """전략 실험 창 — 첫 PMS entry-signals 의 z-스코어 백테스트 재현(§16).

    산술은 `mrbacktest.py`(PMS 원본 이식·적합성 벡터로 잠금), 기본값도 그쪽
    기본(s16) 그대로다. warnZ 는 엔진엔 안 들어가고 오실레이터 가이드가 쓴다.
    캐시 없음 — 파라미터가 자유값이고 계산이 밀리초라 태울 이유가 없다.

    방향은 계열이 정한다(`mr.dirs_for`) — BSS 는 국고 매수 쪽 한 방향뿐이다.
    파라미터가 아니라 이 데스크의 사실이라 쿼리로 열지 않는다.
    """
    labels = {s: l for s, l, _ in mr_mod.SERIES}
    if id not in labels:
        raise HTTPException(status_code=404, detail=f"unknown mr series {id}")
    _mr_check_knobs(lookback, entryZ, warnZ, exitZ, stopZ, costBp, notional,
                    entryMode, timeStop, costModel, regime)

    # 준비·시뮬은 **공용 자리**가 한다(`_mr_leg`) — 통합 장부(`/api/mr/book`)가
    # 같은 함수를 아홉 번 부르므로, 통합의 수가 낱개 아홉의 합과 갈릴 수 없다.
    spec = _funding_spec(fundingBasis, fundingSpreadBp)
    leg = _mr_leg(id, lookback=lookback, entryZ=entryZ, exitZ=exitZ, stopZ=stopZ,
                  costBp=costBp, notional=notional, carry=carry,
                  entryMode=entryMode, timeStop=timeStop, costModel=costModel,
                  regime=regime, reverseExit=reverseExit, countOpen=countOpen,
                  spec=spec)
    dates, vals, disp = leg["dates"], leg["vals"], leg["disp"]
    dirs, carry_defn = leg["dirs"], leg["carryDefn"]
    carry_krw, gate, cost_series = leg["carryKrw"], leg["gate"], leg["costSeries"]
    r = leg["r"]

    # ── 액면 환산 [OWNER 2026-09-02 — "진입 레벨과 기준 노셔널과 같은 것들이
    # 전부 나올 수 있게 해야 이게 직접 대사가 가능하므로"] ────────────────────
    # 명목 노브는 DV01(₩/bp)인데 데스크의 주문 단위는 액면(억원)이다. 환산은
    # 캐리의 그 식(`mrcarry.carry_krw`: 원금 = 명목 / (pv01 × 1e-4))이고, 같은
    # 한계도 그대로다 — **지금 커브의 pv01 하나**를 전 기간에 쓰는 근사라
    # (위 «pv01 근사» 주석·`docs/MR_LANE_STATE.md` §6 ⑤) 화면이 「근사」를 같이
    # 적는다. 선물은 원금이 없다(증거금·일일정산) — 지어내지 않고 null 로 보낸다.
    principal = None
    if leg["kind"] != "fut":
        pv = pv01(_curves["now"], TENOR_T[mrc._tenor_of(id)])
        # pv01 은 8자리 — 4자리로 내보냈더니 받은 쪽이 «원금 × pv01 × 1e-4 =
        # 명목» 을 되곱할 때 14.66원/bp 어긋났다(2026-09-02 독립 대사가 잡음).
        # 페이로드가 항등의 양변을 다 내보내면 그 항등은 페이로드 안에서
        # 닫혀야 한다 — 화면 «약 35.4억» 은 못 보는 차이지만 손 대사는 본다.
        principal = {"krw": round(notional / (pv * 1e-4)), "pv01": round(pv, 8)}

    # ── 다리 레벨 [OWNER 2026-09-02 — "델타, 노셔널, 스왑 파 커브 상의 레벨,
    # 채권 커브 상의 레벨, CD금리 레벨이 진입시점에 확인되고 … 대사도 명확하게"]
    # 캐리가 읽는 그 출처(`mrseries` — 국고 커브·IRS 파·CD 91일)를 날짜로
    # 조인해 점마다 싣는다. BSS 의 값은 정확히 (국고 − IRS) × 100 이므로
    # (`mrseries.points`) 화면에서 «국고 − IRS = 레벨» 이 그대로 닫힌다.
    # CD 는 값의 전제(교집합)가 아니라 참고라, 없는 날은 null — 지어내지 않는다
    # (`legs(need_cd=False)` 의 넷째 값은 결측을 0.0 으로 채우므로 안 쓴다).
    # 선물·퓨처스왑은 다리가 이 셋이 아니라서 null 이다(선물내재 다리는 별도).
    leg_lv: dict[str, tuple[float, float]] = {}
    cd_lv: dict[str, float] = {}
    if leg["kind"] == "bss":
        ld, lg, ls, _ = mrs.legs(id)
        leg_lv = {d: (lg[i], ls[i]) for i, d in enumerate(ld)}
        cd_lv = mrs.bundle()["cd"]
    roll = r["roll"]
    points = [
        {
            "t": dates[i], "v": disp(vals[i]),
            "z": round(r["points"][i]["z"], 4) if r["points"][i]["z"] is not None else None,
            "ma": disp(roll["mean"][i]) if roll["mean"][i] is not None else None,
            # 밴드 배수는 entryZ 다 — PMS 의 «노브 하나, 뜻 둘» 그대로.
            "up": disp(roll["mean"][i] + entryZ * roll["std"][i])
                  if roll["mean"][i] is not None else None,
            "lo": disp(roll["mean"][i] - entryZ * roll["std"][i])
                  if roll["mean"][i] is not None else None,
            # ── 대사표가 곱셈을 눈으로 닫게 하는 둘 [OWNER 2026-08-28] ────────
            # `hold` = 그 봉을 **통과해서 들고 있던** 포지션(엔진 부호). 봉이 끝난
            # 뒤의 `pos` 와 다르다 — 진입 봉은 0, 청산 봉은 ±1 이다. 백테스트
            # 대사표가 「전일 종가 KRD」를 싣는 것과 같은 자리이고, 이유도 같다:
            # 감도 × 변화 = 평가 가 **한 줄 안에서** 닫혀야 한다.
            # `dv` = 전 봉 대비 변화(**bp**). 브라우저는 계산하지 않는다(§16).
            "hold": r["points"][i]["hold"],
            "dv": round(vals[i] - vals[i - 1], 4) if i > 0 else None,
            # 거래 안 누적 — 대사표의 세로합을 줄마다 적는다(마지막 줄 = 거래 손익).
            "tradePnl": round(r["points"][i]["tradePnl"], 2),
            # 밴드 밖 여부와 연속 일수 — 측정 보드(`mr._state`)와 같은 어휘로,
            # 「지금 어디에 서 있나」를 오실레이터의 판독이 말할 수 있게.
            "out": r["points"][i]["out"], "outRun": r["points"][i]["outRun"],
            "cum": round(r["points"][i]["cumulativePnl"], 2),
            # 그날의 분해 — 거래를 누르면 화면이 이 셋으로 **일별 대사**를 편다.
            # 셋의 합 = `pnl`(그날 손익)이고, 대사표가 그 항등을 잰다.
            "mtm": round(r["points"][i]["mtm"], 2),
            "carry": round(r["points"][i]["barCarry"], 2),
            "cost": round(r["points"][i]["barCost"], 2),
            "pnl": round(r["points"][i]["dailyPnl"], 2),
            "pos": r["points"][i]["position"],
        }
        for i in range(len(vals))
    ]
    # 다리 레벨을 점에 붙인다(위 주석) — 스프레드(bp)와 달리 **%** 그대로다.
    # 반올림 4자리 = 이 앱의 % 레벨 문법(fmtLevel)과 같은 자리라, 화면의
    # (국고 − IRS) × 100 이 레벨 칸(2자리 bp)과 표시 정밀도에서 닫힌다.
    for p in points:
        gv = leg_lv.get(p["t"])
        c = cd_lv.get(p["t"])
        p["govt"] = round(gv[0], 4) if gv else None
        p["irs"] = round(gv[1], 4) if gv else None
        p["cd"] = round(c, 4) if c is not None else None
    trades = [
        {
            "entryT": t["entryDate"], "exitT": t["exitDate"],
            "dir": t["direction"],
            "entryZ": round(t["entryZ"], 2), "exitZ": round(t["exitZ"], 2),
            "entryV": disp(t["entryValue"]), "exitV": disp(t["exitValue"]),
            # 진입 직전의 밴드 밖 구간 — 「무엇을 보고 들어갔나」. `touch` 에서는
            # 진입 z 가 밴드 선 언저리라 이것 없이는 4σ 까지 갔다 온 것과 2.01σ 를
            # 살짝 넘었다 온 것이 같은 줄로 보인다.
            "outFrom": t["outFrom"], "outDays": t["outDays"],
            "peakZ": round(t["peakZ"], 2) if t["peakZ"] is not None else None,
            # 보유 동안의 총 변화(bp) — 대사표 합계 줄의 Δ.
            "dv": round(t["dv"], 4),
            "pnl": round(t["pnl"], 2), "why": t["exitReason"],
            # 대사용 삼분해 — 셋의 합이 `pnl` 이다. 거래 한 줄을 눌렀을 때
            # 화면이 그 항등을 그대로 보여 준다(이 앱의 3분해 문법).
            "mtm": round(t["mtm"], 2),
            "carry": round(t["carry"], 2),
            "cost": round(t["cost"], 2),
            "bars": t["bars"],
        }
        for t in r["trades"]
    ]
    s = r["summary"]
    return {
        "id": id, "label": labels[id], "unit": leg["unit"],
        "asof": dates[-1] if dates else None,
        "params": {"lookback": lookback, "entryZ": entryZ, "warnZ": warnZ,
                   "exitZ": exitZ, "stopZ": stopZ, "costBp": costBp,
                   "notional": notional, "entryMode": entryMode,
                   "timeStop": timeStop, "costModel": costModel,
                   "regime": regime, "reverseExit": reverseExit,
                   "countOpen": countOpen},
        # 명목(₩/bp)의 액면 환산 — 위 주석의 근사. 거래 표·대사표가 「이 손익을
        # 내려면 실제로 몇 억을 걸어야 했나」를 적을 수 있게 낸다.
        "principal": principal,
        # 비용이 봉마다 다르면 「편도 몇 bp」가 한 숫자로 안 나온다 — 실제로 쓴
        # 범위와 중앙값을 화면이 적을 수 있게 낸다.
        "cost": ({"model": "flat", "bp": costBp} if cost_series is None else {
            "model": "dynamic",
            "lo": round(min(cost_series), 3), "hi": round(max(cost_series), 3),
            "mid": round(sorted(cost_series)[len(cost_series) // 2], 3),
        }),
        # 필터가 지운 진입 신호 — 조용히 빠지면 「신호가 없었다」로 읽힌다.
        # 방향 때문에 못 한 것(`dirs.blocked`)과 **따로** 센다.
        "gated": r["gated"],
        # ── 진단 [OWNER 2026-08-28 — "승률이 이렇게 높을 수 있다는게 이해가 잘
        # 안간다" · "과거에 Overfitting 된거 아닌가"] ──────────────────────────
        # 의심 둘 다 화면 밖에서만 답할 수 있었다. 산술은 `app/mrdiag.py`.
        "diag": {
            "exits": mrd.exit_tally(r["trades"], notional),
            "payoff": mrd.payoff(r["trades"], notional),
            # 청산 규칙을 떼고 신호일의 고정 보유 수익을 잰다 — 승률이 진입의
            # 공로인지 청산 구조의 산물인지가 여기서 갈린다.
            "forward": mrd.forward_edge(
                vals, roll["z"], entry_z=entryZ,
                allow_dirs=tuple(dirs["allowed"]), entry_mode=entryMode),
            # 구간을 갈라 같은 규칙을 잰다 — 과거적합이면 최근이 무너지고,
            # 엣지 소멸이면 크기만 단조로 줄어든다. 모양이 다르다.
            "periods": mrd.period_split(dates, r["points"]),
        },
        # 캐리가 무엇인지 화면이 읽을 문장 — 부호 기준이 −1 이라 정의가 없으면
        # 읽는 사람이 자기 방향으로 읽는다(`mr.KIND_DEFN` 과 같은 규율).
        "carry": {"on": carry, "defn": carry_defn, "funding": spec.label} if carry else {"on": False},
        "points": points,
        "trades": trades,
        # 방향의 이름과 «못 들어간 신호» — 조용히 빠진 진입은 «신호가 없었다»
        # 로 읽히므로 세어서 같이 보낸다(엔진의 blocked).
        "dirs": {**dirs, "blocked": r["blocked"]},
        # 표본 끝의 미청산 다리 — 거래·승률에는 원본 규약대로 안 들어가고,
        # 「안 들어갔다」는 사실만 화면이 승률 옆에 적을 수 있게 낸다.
        "open": ({
            "entryT": r["open"]["entryDate"],
            # 방향 — 화면이 미청산 다리를 차트에 세우려면 필요하다(마커의 색이
            # 방향이다). 승률·거래 수에 안 들어가는 것과 별개의 사실이다.
            "dir": r["open"]["direction"],
            "entryZ": round(r["open"]["entryZ"], 2),
            "entryV": disp(r["open"]["entryValue"]),
            "outFrom": r["open"]["outFrom"], "outDays": r["open"]["outDays"],
            "peakZ": (round(r["open"]["peakZ"], 2)
                      if r["open"]["peakZ"] is not None else None),
            "pnl": round(r["open"]["pnl"], 2),
            "bars": r["open"]["bars"],
        } if r["open"] else None),
        # 한 칸 옆 — 고른 칸이 이웃보다 얼마나 나은지가 그 칸의 신뢰도다.
        # **머리 숫자와 같은 규칙으로** 돈다(필터·비용·타임스탑까지) — 기준점이
        # 다르면 그 차이가 노브 탓인지 규칙 탓인지 화면이 구분해 주지 못한다.
        "neighbors": _mr_neighbors(
            dates, vals,
            {"lookback": lookback, "entryZ": entryZ, "exitZ": exitZ,
             "stopZ": stopZ, "costBp": costBp, "notional": notional},
            tuple(dirs["allowed"]), carry=carry_krw, entry_mode=entryMode,
            gate=gate, time_stop=timeStop or None, cost_bp_series=cost_series,
            reverse_exit=reverseExit, close_open_at_end=countOpen),
        "summary": {
            "totalPnl": round(s["totalPnl"], 2),
            "maxDrawdown": round(s["maxDrawdown"], 2),
            "winRate": round(s["winRate"], 4) if s["winRate"] is not None else None,
            "sharpe": round(s["sharpe"], 3) if s["sharpe"] is not None else None,
            "numTrades": s["numTrades"],
            "openPnl": round(s["openPnl"], 2) if s["openPnl"] is not None else None,
            # 총손익이 0 이 되는 편도 비용 — 노브를 돌려 찾는 대신 닫힌형으로.
            "breakevenCostBp": (round(s["breakevenCostBp"], 3)
                                if s["breakevenCostBp"] is not None else None),
            # 비용이 봉마다 다르면 「몇 bp」가 한 숫자로 안 나온다 — 대신 **그
            # 경로의 몇 배까지 견디는가**를 답한다. 안 내보내면 동적 비용 판에서
            # 화면의 손익분기 칸이 통째로 비어 버린다(실측 2026-08-28).
            "breakevenCostMult": (round(s["breakevenCostMult"], 3)
                                  if s.get("breakevenCostMult") is not None else None),
        },
    }


def _mr_cost_span(legs: list[dict]) -> dict | None:
    """아홉 다리가 **실제로 문** 비용의 범위와 중앙값 — 동적 비용일 때만.

    첫 다리의 경로만 적으면 안 된다: 동적 비용은 그 만기의 변동성 백분위에
    연동하므로 만기마다 다른 경로다. 화면이 「편도 0.15~0.25bp」라고 적을 때
    그건 장부 전체가 문 비용이어야 한다.
    """
    paths = [c for leg in legs if leg["costSeries"] is not None for c in leg["costSeries"]]
    if not paths:
        return None
    return {"model": "dynamic", "lo": round(min(paths), 3), "hi": round(max(paths), 3),
            "mid": round(sorted(paths)[len(paths) // 2], 3)}


@router.get("/api/mr/book")
def mr_book(lookback: int = 60, entryZ: float = 2.0,
            warnZ: float = 1.5, exitZ: float = 0.5, stopZ: float = 3.5,
            costBp: float = 0.5, notional: float = 1_000_000.0,
            carry: bool = True, entryMode: str = "level",
            timeStop: int = 0, costModel: str = "flat",
            regime: str = "none", reverseExit: bool = False,
            countOpen: bool = False,
            fundingBasis: str = funding.DEFAULT_BASIS,
            fundingSpreadBp: float = funding.DEFAULT_SPREAD_BP) -> dict:
    """BSS 테너 **통합** 밴드 워치 [OWNER 2026-09-01 — "BSS 테너 통합 밴드 워치를
    하나 만들어서 승률 및 세부사항들을 확인할 수 있게"].

    같은 규칙을 아홉 만기에 **동시에** 걸었을 때의 한 장부다. 계열 하나의 준비·
    시뮬은 낱개 창과 **같은 함수**(`_mr_leg`)가 하고, 이 라우트는 그 아홉을
    `mrbook.aggregate` 로 더하기만 한다 — 통합의 수와 낱개 아홉의 합이 갈릴 수
    있는 자리를 아예 안 만든다.

    노브는 `/api/mr/strategy` 와 **완전히 같다**(`id` 만 없다). 두 창이 다른
    기본값에서 열리면 「낱개로는 벌고 통합으로는 잃는다」가 규칙 탓인지 기본값
    탓인지 화면이 구분해 주지 못한다.

    캐시 없음 — 파라미터가 자유값이고 아홉 번 돌아도 초 단위다.
    """
    _mr_check_knobs(lookback, entryZ, warnZ, exitZ, stopZ, costBp, notional,
                    entryMode, timeStop, costModel, regime)
    spec = _funding_spec(fundingBasis, fundingSpreadBp)

    legs: list[dict] = []
    excluded: list[dict] = []
    for sid, label in mrbook.bss_series():
        try:
            legs.append(_mr_leg(
                sid, lookback=lookback, entryZ=entryZ, exitZ=exitZ, stopZ=stopZ,
                costBp=costBp, notional=notional, carry=carry,
                entryMode=entryMode, timeStop=timeStop, costModel=costModel,
                regime=regime, reverseExit=reverseExit, countOpen=countOpen,
                spec=spec))
        except (HTTPException, KeyError, ValueError) as exc:
            # 못 선 만기는 **조용히 빠지지 않는다**(보드의 exclusions 문법).
            # 여덟 만기의 합을 「BSS 통합」이라 부르면서 그 사실을 안 적으면
            # 화면이 거짓말을 한다.
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            excluded.append({"id": sid, "label": label, "reason": str(detail)})
    if not legs:
        raise HTTPException(status_code=422,
                            detail="통합할 수 있는 만기가 하나도 없어요 — "
                                   + (excluded[0]["reason"] if excluded else "이력이 없어요"))

    span = _mr_cost_span(legs)
    out = mrbook.aggregate(legs, notional=notional, cost_bp=costBp,
                           dynamic_cost=span is not None)
    first = legs[0]
    # 막힌 진입은 방향 사전 안으로 들어간다(낱개 라우트와 같은 자리) — 집계에서
    # 꺼내 두고 나머지를 펼친다. 딕셔너리 안에서 pop 하면 평가 순서에 기대게 된다.
    blocked = out.pop("blocked")
    return {
        "id": mrbook.BOOK_ID, "label": mrbook.BOOK_LABEL, "defn": mrbook.BOOK_DEFN,
        # 값 단위는 아홉이 다 bp 다(국고 − IRS). 손익 단위와 헷갈리지 않게 적어 둔다.
        "unit": first["unit"],
        "params": {"lookback": lookback, "entryZ": entryZ, "warnZ": warnZ,
                   "exitZ": exitZ, "stopZ": stopZ, "costBp": costBp,
                   "notional": notional, "entryMode": entryMode,
                   "timeStop": timeStop, "costModel": costModel,
                   "regime": regime, "reverseExit": reverseExit,
                   "countOpen": countOpen},
        # 방향은 아홉이 같다(전부 BSS) — 낱개 창과 같은 사전을 쓰고, 막힌 진입
        # 수만 아홉을 더한 것이다.
        "dirs": {**first["dirs"], "blocked": blocked},
        "cost": span if span is not None else {"model": "flat", "bp": costBp},
        "carry": ({"on": True, "defn": first["carryDefn"], "funding": spec.label}
                  if carry else {"on": False}),
        "excluded": excluded,
        **out,
    }


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
