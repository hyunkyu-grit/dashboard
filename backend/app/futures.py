# -*- coding: utf-8 -*-
"""국채선물·퓨처스왑 백테스트 엔진 [OWNER, 2026-08-25 — "선물이랑 선물스왑도
백테스트와 시뮬레이션에 추가하기"].

── 데이터 ──────────────────────────────────────────────────────────────────
`sim_portfolio.mkt_futures_investor_close` — KTB 3Y/10Y 연결(최근월물) 종가,
2016-01-04 부터. MR 세입자(app/mr.py)가 먼저 검증해 쓰는 그 표다. **연결
계열의 롤오버 갭 병은 실측으로 없다** (2026-08-25: 결제월 롤 주간의 일중
|Δ내재| 분포가 평상일과 통계적으로 동일 — 3Y 평균 3.19bp/3.05bp·p95
9.05/9.16, 최대 점프는 전부 시장 스트레스 실제 날짜) — 종가 변화를 그대로
손익으로 세도 된다. 캐시는 creditmatrix 와 같은 규율(워터마크 키).

── 상품과 방향 ────────────────────────────────────────────────────────────
    FUT:3Y / FUT:10Y   국채선물 아웃라이트. +1 = **매수**(가격 롱 — 금리가
                       내리면 이득). 손익 = 방향 × 액면/100 × Δ종가.
                       현금결제(CTD 없음)·연결 계열이라 만기 롤오프가 없고,
                       캐리·조달·롤다운은 존재하지 않는 성분이다(공란 정책;
                       근거는 futures_pricing 모듈 doc — 합성채는 늙지 않는다).
    FSW:3Y / FSW:10Y   퓨처스왑 = 선물 내재금리 − 같은 만기 IRS [OWNER,
                       2026-08-25 — "3선이면 3년 IRS, 10선이면 10년 IRS"].
                       +1 = 호가값(스프레드) 롱 = **선물 매도 + IRS 리시브**
                       (내재↑ = 선물 가격↓ 에서 이득 + IRS↓ 에서 이득).
                       두 다리는 진입일 DV01 중립으로 가중한다 — 엔진이
                       스프레드·플라이에 이미 쓰는 규칙(_build_legs)과 같다.
                       IRS 다리는 스왑 엔진(_run_one) 그대로다: 엔진을 새로
                       쓰지 않는다(mixedbook 의 그 규칙).

── 대사 ────────────────────────────────────────────────────────────────────
선물 대사표는 스왑 표와 같은 모양(전일 KRD × Δ내재 = est, 실측과의 차 =
잔차)이되, 캐리·롤다운·개시 열이 없다 — 잔차가 싣는 것은 컨벡시티다(추정은
선형 KRD, 실측은 실제 가격). FSW 의 IRS 다리는 **스왑 대사표에** 선다(자기
달력 위 자기 엔진 — 엔진 단위 분리 [OWNER, 2026-08-25]).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import text

from irs_pricer.services.simulation.futures_pricing import (
    FUT_YEARS,
    implied_yield,
    synth_pvbp,
)

from .backtest import (
    MAX_POINTS,
    RECON_MAX_DAYS,
    BacktestError,
    Position,
    _build_legs,
    _index_on_or_after,
    _index_on_or_before,
    _run_one,
    _span_of,
    _thin,
)
from .engine_port import next_kr_business_day
from .mysqldb import engine

KIND_FUT = "FUT"
KIND_FSW = "FSW"
FUT_TENORS: tuple[str, ...] = ("3Y", "10Y")

#: 표의 ktb_type ↔ 화면 라벨. MR 세입자의 용어(«KTB3 내재금리»·«퓨처스왑 3Y»)
#: 와 같은 계열이다 — 용어 동결.
FUT_LABELS = {"3Y": "KTB3 선물", "10Y": "KTB10 선물"}
FSW_LABELS = {"3Y": "퓨처스왑 3Y", "10Y": "퓨처스왑 10Y"}


class FuturesError(Exception):
    """선물 백테스트를 실행할 수 없다 — 라우트가 422 로 옮긴다."""


@dataclass(frozen=True)
class FuturesSeries:
    dates: list[dt.date]
    close: list[float]


@dataclass(frozen=True)
class FuturesData:
    series: dict[str, FuturesSeries]     # tenor → 연결 종가
    watermark: tuple[str, int]


# ── 적재 (creditmatrix 와 같은 규율: 워터마크 키 캐시 + 테스트 주입) ────────

_cached: FuturesData | None = None
_injected: FuturesData | None = None


def set_data(data: FuturesData | None) -> None:
    """테스트 주입 시임 — irsdata.set_dataset 과 같은 규율. None 이면 해제."""
    global _injected
    _injected = data


def watermark() -> tuple[str, int]:
    with engine().connect() as conn:
        row = conn.execute(text(
            "SELECT MAX(deal_date), COUNT(*) FROM mkt_futures_investor_close "
            "WHERE CLOSE IS NOT NULL"
        )).one()
    return (str(row[0]), int(row[1]))


def _fetch() -> FuturesData:
    with engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT deal_date, ktb_type, CLOSE FROM mkt_futures_investor_close "
            "WHERE CLOSE IS NOT NULL ORDER BY deal_date ASC"
        )).fetchall()
    series: dict[str, tuple[list[dt.date], list[float]]] = {t: ([], []) for t in FUT_TENORS}
    for d, typ, close in rows:
        if typ not in series or close is None:
            continue
        ds, cs = series[typ]
        ds.append(d)
        cs.append(float(close))
    return FuturesData(
        series={t: FuturesSeries(dates=ds, close=cs) for t, (ds, cs) in series.items()},
        watermark=watermark(),
    )


def load() -> FuturesData:
    """주입본이 있으면 그것, 없으면 SQL(워터마크 키 캐시)."""
    if _injected is not None:
        return _injected
    global _cached
    wm = watermark()
    if _cached is None or _cached.watermark != wm:
        _cached = _fetch()
    return _cached


def reset_cache() -> None:
    global _cached
    _cached = None


# ── id 문법 ─────────────────────────────────────────────────────────────────

def is_futures(series_id: str) -> bool:
    return series_id.startswith((f"{KIND_FUT}:", f"{KIND_FSW}:"))


def parse_id(series_id: str) -> tuple[str, str]:
    """`FUT:3Y` → ("FUT", "3Y"). 모르는 꼴은 422 감."""
    parts = series_id.split(":")
    if len(parts) != 2 or parts[0] not in (KIND_FUT, KIND_FSW) or parts[1] not in FUT_TENORS:
        raise FuturesError(f"unknown instrument {series_id!r}")
    return parts[0], parts[1]


@dataclass(frozen=True)
class FuturesPosition:
    kind: str          # FUT | FSW
    tenor: str         # 3Y | 10Y
    direction: int     # +1 = 호가값 롱 (FUT: 매수 / FSW: 스프레드 확대)
    notional: float    # 선물 액면 (원)
    entry: dt.date
    exit: dt.date | None = None

    @property
    def id(self) -> str:
        return f"{self.kind}:{self.tenor}"


def as_position(series_id: str, direction: int, notional: float,
                entry: dt.date, exit: dt.date | None) -> FuturesPosition:
    kind, tenor = parse_id(series_id)
    if direction not in (1, -1):
        raise FuturesError("direction must be +1 or -1")
    if notional <= 0:
        raise FuturesError("notional must be positive")
    return FuturesPosition(kind, tenor, direction, notional, entry, exit)


# ── 계열 (화면이 읽는 히스토리) ─────────────────────────────────────────────

def instrument_label(kind: str, tenor: str) -> str:
    return (FUT_LABELS if kind == KIND_FUT else FSW_LABELS)[tenor]


def series_payload(fut: FuturesData, dataset, series_id: str, res: str = "full") -> dict:
    """한 선물·퓨처스왑 계열의 전 기간 — `/api/series/{id}` 와 **같은 몸통**.

    ── 왜 이 함수가 생겼나 [OWNER, 2026-08-25] ────────────────────────────────
    백테스트 창의 진입 레벨이 선물 줄에서만 «—» 였고, 커서를 대도 손익이 안
    따라왔다. 원인은 하나였다: 창이 종목 히스토리를 `/api/series/{id}` 로 받는데
    **`FUT:3Y` 는 그 카탈로그에 없어 404** 였다(실측 2026-08-25). 히스토리가
    비면 진입 레벨이 «—» 로 서고, 「종목 추이 ↔ 누적 손익」 한 쌍 중 위 차트가
    아예 안 그려져서 스크러버·리드아웃까지 같이 사라진다. 데이터가 없어서가
    아니라 닿는 길이 없어서였다 — 같은 종가로 시뮬레이션은 이미 내재금리를
    찍고 있었다.

    `cashbond.series_for` 와 같은 규율이다: 몸통은 `derive.series_history` 를
    쓴다. 같은 차트 부품이 먹을 모양이어야 하기 때문이다(점마다 전일 대비 `d`,
    52주 min/max/avg).

    ── 두 단위를 한 번에 [OWNER 선택, 2026-08-25 — "가격 + 내재금리 둘 다"] ──
    선물은 **가격으로 거래되고 금리로 읽힌다**. 둘 중 하나만 실으면 한쪽 화면이
    딴 말을 한다(Main 국채선물 행은 「가격」 단위이고 백테스트 결과 줄은 이미
    내재금리로 적는다). 그래서 `points` 는 가격이고, 점마다 `y` 에 그 날의
    내재금리를 같이 싣는다 — 진입 레벨 칸이 두 줄로 그 둘을 적는다.
    다운샘플(res=preview)을 지나도 어긋나지 않게 **날짜로** 맞춘다.

    퓨처스왑은 가격이 아니라 **스프레드**(내재 − IRS, bp)라 `y` 가 없다. 그
    다리 결합은 MR 보드(`app/mr.py::_fut_bundle`)와 같은 정의이고, 같은 inner
    join 규율이다 — 양쪽 다 마킹이 있는 날만, 보간·이월 없음.
    """
    from .derive import series_history
    from .payloads import series_pairs

    kind, tenor = parse_id(series_id)
    fs = fut.series.get(tenor)
    if fs is None or not fs.dates:
        raise FuturesError(f"{tenor} 선물 종가가 없습니다.")
    years = FUT_YEARS[tenor]

    if kind == KIND_FUT:
        pairs = [(d.isoformat(), float(c)) for d, c in zip(fs.dates, fs.close)]
        unit = "가격"
        ylut = {t: round(implied_yield(v, years), 4) for t, v in pairs}
    else:
        # IRS 다리는 데이터셋의 그 테너 — 엔진이 다리를 세울 때 읽는 것과
        # 같은 출처다(두 번째 정의 금지).
        irs_pairs, _u = series_pairs(dataset, tenor)
        irs_by = dict(irs_pairs)
        pairs = []
        for d, c in zip(fs.dates, fs.close):
            t = d.isoformat()
            leg = irs_by.get(t)
            if leg is None:
                continue
            pairs.append((t, round((implied_yield(float(c), years) - float(leg)) * 100.0, 4)))
        unit = "bp"
        ylut = None
    if not pairs:
        raise FuturesError(f"{series_id}: 그릴 수 있는 날이 없습니다.")

    body = series_history(pairs, unit, res)
    if ylut is not None:
        for p in body["points"]:
            p["y"] = ylut.get(p["t"])
    return {
        "id": series_id,
        "label": instrument_label(kind, tenor),
        "asof": pairs[-1][0],
        **body,
    }


# ── 달력 ────────────────────────────────────────────────────────────────────

def calendar_of(fut: FuturesData, dataset, pos: FuturesPosition) -> list[dt.date]:
    """포지션이 사는 날짜들. FUT 는 그 테너의 선물 달력, FSW 는 선물 ∩ IRS
    (양쪽 다 마킹이 있는 날만 — MR 의 inner join 규율: 보간·이월 없음)."""
    fs = fut.series.get(pos.tenor)
    if fs is None or not fs.dates:
        raise FuturesError(f"{pos.tenor} 선물 종가가 없습니다.")
    if pos.kind == KIND_FUT:
        return fs.dates
    dset = set(dataset.dates)
    return [d for d in fs.dates if d in dset]


def _span_on(cal: list[dt.date], pos: FuturesPosition) -> tuple[int, int]:
    """(entry_i, exit_i) — 스왑 엔진과 같은 스냅(진입은 다음 거래일로,
    청산은 이전 거래일로). 연결 계열이라 만기 캡은 없다(FSW 는 호출부가
    스왑 다리의 만기로 따로 캡한다)."""
    try:
        entry_i = _index_on_or_after(cal, pos.entry)
        exit_i = _index_on_or_before(cal, pos.exit) if pos.exit else len(cal) - 1
    except BacktestError as exc:
        raise FuturesError(f"{pos.id}: {exc}")
    if exit_i < entry_i:
        raise FuturesError(f"{pos.id}: the exit date must not precede the entry date")
    return entry_i, exit_i


# ── FSW 의 IRS 다리 ────────────────────────────────────────────────────────

def fsw_swap_leg(
    fut: FuturesData, dataset, pos: FuturesPosition
) -> tuple[Position, float, float]:
    """(IRS 다리 Position, 진입 내재금리 %, 선물 DV01 원/bp).

    다리 규칙 [OWNER, 2026-08-25]: 같은 만기 IRS, 진입일 DV01 중립.
    +1(스프레드 롱) = IRS 리시브 = Position.direction −1 (스왑 엔진의 +1 은
    호가 롱 = 페이). 명목 = 선물 DV01 / 스왑 단위 DV01. run 과 recon 이 같은
    함수를 불러 같은 다리를 얻는다 — 두 번째 정의 금지.
    """
    cal = calendar_of(fut, dataset, pos)
    entry_i, _exit_i = _span_on(cal, pos)
    entry_date = cal[entry_i]
    fs = fut.series[pos.tenor]
    price0 = fs.close[fs.dates.index(entry_date)]
    years = FUT_YEARS[pos.tenor]
    y0 = implied_yield(price0, years)
    fut_dv01_won = (pos.notional / 100.0) * synth_pvbp(y0, years)

    j = _index_on_or_after(dataset.dates, entry_date)
    if dataset.dates[j] != entry_date:
        # calendar_of 의 FSW 달력은 ∩ 라 여기 못 온다 — 방어만.
        raise FuturesError(f"{pos.id}: {entry_date} 에 IRS 마킹이 없습니다.")
    unit_dv01 = _build_legs(dataset, pos.tenor, 1.0, j)[0].dv01
    if unit_dv01 <= 0:
        raise FuturesError(f"{pos.id}: 스왑 DV01 을 셀 수 없습니다.")
    # `Leg.dv01` 은 연금계수다(pv01 — 명목 1 의 1bp 가 아니라 ×10⁴ 스케일):
    # 실제 원/bp = dv01 × 명목 × 1e-4 (백테스트 창의 표시식이 그 규약의 핀).
    # 처음 이 나눗셈에 1e-4 가 없어 스왑 다리가 10⁴배 작게 섰다 — 실측
    # 2026-08-25: 100억 FSW 의 IRS 다리가 100만원. 그 결함이 이 주석의 이유다.
    swap_notional = fut_dv01_won / (unit_dv01 * 1e-4)
    swap_pos = Position(
        series_id=pos.tenor,
        direction=-pos.direction,
        notional=swap_notional,
        entry=entry_date,
        exit=pos.exit,
    )
    return swap_pos, y0, fut_dv01_won


# ── 실행 ────────────────────────────────────────────────────────────────────

def run_one(
    fut: FuturesData,
    dataset,
    pos: FuturesPosition,
    sample_dates: list[dt.date],
    cache: dict | None = None,
) -> tuple[dict, dict[dt.date, float], dict[dt.date, float]]:
    """한 줄: (record, 날짜→손익, 날짜→전거래일 손익).

    스왑 엔진의 (rec, own, prev) 프로토콜을 날짜 키로 든다 — 혼합 병합이
    달력이 다른 엔진들을 날짜로 합치기 때문이다. `prev` 의 "전거래일" 은
    **자기 달력**의 전 거래일이다(병합의 갭 판정이 이 사실을 쓴다).
    """
    cal = calendar_of(fut, dataset, pos)
    entry_i, exit_i = _span_on(cal, pos)
    fs = fut.series[pos.tenor]
    idx_of = {d: i for i, d in enumerate(fs.dates)}
    years = FUT_YEARS[pos.tenor]

    # 표본 날짜와, 자기 달력의 전 거래일들(아래 prev 가 묻는 날들) — 스왑
    # 다리 시리즈가 이 전부를 답할 수 있어야 한다(빠지면 조용한 0).
    ask_dates = set(sample_dates)
    for d in sample_dates:
        if d >= cal[0]:
            i = _index_on_or_before(cal, d)
            if i >= 1:
                ask_dates.add(cal[i - 1])

    swap_rec = None
    swap_ser: dict[int, float] = {}
    fut_dir = pos.direction
    if pos.kind == KIND_FSW:
        # 스프레드 롱 = 선물 매도 (+ IRS 리시브 — 아래 스왑 엔진 위임).
        fut_dir = -pos.direction
        swap_pos, y0, _dv = fsw_swap_leg(fut, dataset, pos)
        _s_entry, s_exit, _m = _span_of(dataset, swap_pos)
        # 스왑 다리가 만기로 끝나면 선물 다리도 그 마크에서 얼린다 — 안
        # 얼리면 만기 뒤가 벌거벗은 선물이 된다(스프레드가 아닌 것).
        swap_end = dataset.dates[s_exit]
        exit_i = min(exit_i, _index_on_or_before(cal, swap_end))
        ds_sample = sorted({
            _index_on_or_before(dataset.dates, d) for d in ask_dates
            if d >= dataset.dates[0]
        })
        swap_rec, swap_ser, _swap_prev = _run_one(dataset, swap_pos, ds_sample, cache)

    entry_date, exit_date = cal[entry_i], cal[exit_i]
    p_entry = fs.close[idx_of[entry_date]]

    def fut_pnl_at(d: dt.date) -> float:
        """자기 달력 밖 날짜는 직전 자기 거래일 마크로 — 얼린 값."""
        if d < entry_date:
            return 0.0
        mark = min(d, exit_date)
        i = idx_of.get(mark)
        if i is None:
            k = _index_on_or_before(fs.dates, mark)
            i = k
        return fut_dir * (pos.notional / 100.0) * (fs.close[i] - p_entry)

    def swap_pnl_at(d: dt.date) -> float:
        if swap_rec is None:
            return 0.0
        j = _index_on_or_before(dataset.dates, max(d, dataset.dates[0]))
        return swap_ser.get(j, 0.0)

    own: dict[dt.date, float] = {}
    prev: dict[dt.date, float] = {}
    for d in sample_dates:
        own[d] = fut_pnl_at(d) + swap_pnl_at(d)
        # 자기 달력의 전 거래일 마크.
        i = _index_on_or_before(cal, d) if d >= cal[0] else -1
        if i >= 1:
            pd = cal[i - 1]
            prev[d] = fut_pnl_at(pd) + swap_pnl_at(pd)
        elif i == 0:
            prev[d] = 0.0

    last = own[sample_dates[-1]] if sample_dates else 0.0
    p_exit = fs.close[idx_of[exit_date]]
    y_entry = implied_yield(p_entry, years)
    y_exit = implied_yield(p_exit, years)
    fut_leg_pnl = fut_dir * (pos.notional / 100.0) * (p_exit - p_entry)

    legs: list[dict] = [{
        "kind": "fut",
        "tenor": pos.tenor,
        "side": "long" if fut_dir > 0 else "short",
        "notional": round(pos.notional, 0),
        "entryRate": round(y_entry, 4),
        "entryPrice": round(p_entry, 2),
    }]
    if swap_rec is not None:
        for lg in swap_rec["legs"]:
            legs.append({"kind": "irs", **lg})

    record = {
        "id": pos.id,
        "direction": pos.direction,
        "notional": pos.notional,
        "entry": entry_date.isoformat(),
        "exit": exit_date.isoformat(),
        "closed": exit_date < cal[-1],
        # 연결 계열이라 선물 자체는 만기가 없다. FSW 는 스왑 다리 만기에서
        # 얼린다(위) — 그때 matured 를 스왑 다리의 사실로 싣는다.
        "matured": bool(swap_rec and swap_rec.get("matured")),
        "legs": legs,
        # 표시값 = 내재금리(%) — 스왑 아웃라이트의 % 표기와 같은 축.
        # FSW 는 스프레드(bp) = 내재 − IRS 진입 par.
        "entryValue": round(y_entry, 4) if pos.kind == KIND_FUT else round(
            (y_entry - swap_rec["legs"][0]["entryRate"]) * 100.0, 2
        ),
        "exitValue": round(y_exit, 4) if pos.kind == KIND_FUT else None,
        "pnl": round(last, 0),
        # 성분: 선물 다리는 전부 평가다(캐리·롤·개시 없음 — 모듈 doc). FSW 는
        # 스왑 다리의 4분해가 그대로 얹힌다 — 합이 pnl 로 닫힌다.
        "valuation": round(fut_leg_pnl + (swap_rec["valuation"] if swap_rec else 0.0), 0),
        "carry": swap_rec["carry"] if swap_rec else None,
        "rolldown": swap_rec["rolldown"] if swap_rec else None,
        "startup": swap_rec["startup"] if swap_rec else None,
    }
    return record, own, prev


def run_backtest(fut: FuturesData, dataset, positions: list[FuturesPosition]) -> dict:
    """선물만 있는 북 — 스왑 엔진 run_backtest 와 같은 응답 모양."""
    if not positions:
        raise FuturesError("at least one position is required")

    cals = [calendar_of(fut, dataset, p) for p in positions]
    spans = [_span_on(c, p) for c, p in zip(cals, positions)]
    # 북의 창 = 전체 진입~청산. 공통 달력 = 관련 달력의 교집합(그 창 안).
    starts = [c[a] for c, (a, _b) in zip(cals, spans)]
    ends = [c[b] for c, (_a, b) in zip(cals, spans)]
    lo, hi = min(starts), max(ends)
    common = sorted(set.intersection(*[set(c) for c in cals]))
    window = [d for d in common if lo <= d <= hi]
    if not window:
        raise FuturesError("포지션들이 함께 사는 날짜가 없습니다.")
    idxs = _thin(list(range(len(window))), MAX_POINTS)
    sample_dates = [window[i] for i in idxs]

    cache: dict = {}
    records, owns, prevs = [], [], []
    for p in positions:
        rec, own, prev = run_one(fut, dataset, p, sample_dates, cache)
        records.append(rec)
        owns.append(own)
        prevs.append(prev)

    points = []
    for k, d in enumerate(sample_dates):
        total = round(sum(o[d] for o in owns), 0)
        dd = (
            None if k == 0
            else round(total - sum(pv.get(d, 0.0) for pv in prevs), 0)
        )
        points.append({"t": d.isoformat(), "pnl": total, "d": dd})

    pnls = [p["pnl"] for p in points]
    return {
        "positions": records,
        "from": sample_dates[0].isoformat(),
        "to": sample_dates[-1].isoformat(),
        "complete": len(sample_dates) == len(window),
        "points": points,
        "pnl": pnls[-1] if pnls else 0.0,
        "maxProfit": max(pnls) if pnls else 0.0,
        "maxLoss": min(pnls) if pnls else 0.0,
    }


# ── 대사 ────────────────────────────────────────────────────────────────────

def book_recon(fut: FuturesData, dataset, positions: list[FuturesPosition]) -> dict:
    """선물 일별 대사 — {tenors, rows, truncated}. 스왑 표와 같은 관행(행의
    krd 는 est 가 곱한 전일 것), 열은 평가·잔차뿐이다(캐리·롤·개시 = 존재하지
    않는 성분 — None). FSW 는 **선물 다리만** 여기 선다(IRS 다리는 스왑 표 —
    모듈 doc)."""
    if not positions:
        raise FuturesError("at least one position is required")

    tenors = [t for t in FUT_TENORS if any(p.tenor == t for p in positions)]
    # 표의 달력 = 관련 테너 선물 달력의 교집합 (FSW 다리 값은 선물 종가만 쓴다).
    cals = []
    for t in tenors:
        fs = fut.series.get(t)
        if fs is None or not fs.dates:
            raise FuturesError(f"{t} 선물 종가가 없습니다.")
        cals.append(fs.dates)
    common = sorted(set.intersection(*[set(c) for c in cals]))
    if not common:
        raise FuturesError("선물 달력이 비었습니다.")

    # 포지션 준비: 자기 달력 위 스팬 → 공통 달력으로 옮긴다.
    infos = []
    first_d, last_d = None, None
    for p in positions:
        cal = calendar_of(fut, dataset, p)
        a, b = _span_on(cal, p)
        if p.kind == KIND_FSW:
            swap_pos, _y0, _dv = fsw_swap_leg(fut, dataset, p)
            _sa, s_exit, _m = _span_of(dataset, swap_pos)
            b = min(b, _index_on_or_before(cal, dataset.dates[s_exit]))
        fs = fut.series[p.tenor]
        fut_dir = -p.direction if p.kind == KIND_FSW else p.direction
        open_end = p.exit is None and cal[b] == cal[-1]
        infos.append({
            "pos": p, "fs": fs, "dir": fut_dir,
            "entry_d": cal[a], "exit_d": cal[b], "open_end": open_end,
        })
        first_d = cal[a] if first_d is None else min(first_d, cal[a])
        last_d = cal[b] if last_d is None else max(last_d, cal[b])

    window = [d for d in common if first_d <= d <= last_d]
    start = max(0, len(window) - RECON_MAX_DAYS)
    rows: list[dict] = []
    years = {t: FUT_YEARS[t] for t in tenors}

    def implied_at(fs: FuturesSeries, d: dt.date, t: str) -> float:
        return implied_yield(fs.close[_index_on_or_before(fs.dates, d)], years[t])

    prev_krd = {t: 0.0 for t in tenors}
    for k in range(max(start - 1, 0), len(window)):
        d = window[k]
        krd = {t: 0.0 for t in tenors}
        day_val = 0.0
        for info in infos:
            if d < info["entry_d"] or d > info["exit_d"]:
                continue
            fs, t = info["fs"], info["pos"].tenor
            i = _index_on_or_before(fs.dates, d)
            # 평가(백워드): 진입일 행은 0 (그날 종가로 struck — 스왑 표 규칙).
            if d > info["entry_d"]:
                p_prev = fs.close[max(i - 1, 0)]
                day_val += info["dir"] * (info["pos"].notional / 100.0) * (fs.close[i] - p_prev)
            # KRD (내일 아침 들고 갈 리스크): 청산 마크면 0 — 스왑 표 규칙.
            alive_fwd = d < info["exit_d"] or (d == window[-1] and info["open_end"])
            if alive_fwd:
                y = implied_yield(fs.close[i], years[t])
                krd[t] += info["dir"] * (info["pos"].notional / 100.0) * synth_pvbp(y, years[t])

        if k >= start:
            dbp: dict[str, float | None] = {}
            est: dict[str, float] = {}
            for t in tenors:
                fs = fut.series[t]
                i = _index_on_or_before(fs.dates, d)
                if i >= 1:
                    dy = (implied_yield(fs.close[i], years[t])
                          - implied_yield(fs.close[i - 1], years[t])) * 100.0
                    dbp[t] = round(dy, 2)
                    est[t] = -prev_krd[t] * dy
                else:
                    dbp[t] = None
                    est[t] = 0.0
            total_est = round(sum(est.values()))
            rows.append({
                "t": d.isoformat(),
                "krd": {t: round(prev_krd[t]) for t in tenors},
                "dbp": dbp,
                "est": {t: round(est[t]) for t in tenors},
                "estTotal": total_est,
                "actual": round(day_val),
                "valuation": round(day_val),
                # 존재하지 않는 성분 — 공란 정책 (모듈 doc).
                "carry": None,
                "rolldown": None,
                "startup": None,
                "residual": round(day_val) - total_est,
            })
        prev_krd = krd

    if rows:
        # 이월 앵커 — 종가 KRD. 날짜는 다음 선물 거래일이 데이터 밖이라
        # 달력상 다음 영업일로 적는다(스왑 표와 같은 처리).
        rows.append({
            "t": next_kr_business_day(window[-1]).isoformat(),
            "krd": {t: round(krd[t]) for t in tenors},
            "dbp": {},
            "est": {},
            "estTotal": None,
            "actual": None,
            "valuation": None,
            "carry": None,
            "rolldown": None,
            "startup": None,
            "residual": None,
            "carryover": True,
        })

    return {"tenors": tenors, "rows": rows, "truncated": start > 0}
