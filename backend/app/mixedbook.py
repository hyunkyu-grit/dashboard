# -*- coding: utf-8 -*-
"""현금채권과 스왑을 **한 북**에 담는 백테스트 [OWNER, 2026-08-21 —
"현금채권이랑 스왑을 섞어서 백테스팅이나 시뮬레이션"].

시뮬레이션은 이미 섞였다 — `app/instruments.py` 가 `CB:`·`ASW:` 를 스왑과 같은
페이로드에 실어 보내고 엔진이 `bondType != "swap"` 갈래로 채권을 값매긴다.
막혀 있던 것은 백테스트였다: 라우트도 엔진도 창도 둘이었고, `CB:KTB:3Y` 를 IRS
쪽에 넣으면 `_validate` 가 `unknown instrument` 로 세웠다.

이 모듈은 **엔진을 새로 쓰지 않는다.** 스왑 줄은 `backtest._run_one`, 채권 줄은
`cashbond.run_bond_position` 이 그대로 값매긴다 — 같은 상품이 두 화면에서 다른
수를 내는 순간 비교가 끝나기 때문이고, 그것이 이 리포가 `instruments.py` 에서
이미 지키고 있는 규칙이다. 여기서 새로 정하는 것은 **어느 날짜 위에서 더하느냐**
하나뿐이다.

── 달력 ────────────────────────────────────────────────────────────────────

두 달력이 다르다. `cashbond.book_recon` 이 이미 이 문제에 답을 내놨다 (그 함수의
주석, 2026-08-14 실측): 두 백테스트를 각자의 달력에서 돌린 뒤 날짜로 합치는 길은
**손익을 흘린다** — IRS 에만 있는 날 9일(12/25·1/1·3/2·5/1·5/5·5/25·6/3·7/17·
12/31), 민평에만 있는 날 3일. 그래서 자산스왑의 스왑 다리를 민평 달력 위에서
직접 값매기는 쪽을 택했다.

혼합 북도 같은 규칙이다. **한 달력 = 민평 ∩ IRS**, 그 위에서 두 엔진을 같은
날짜들로 부른다. 양쪽에 다 마킹이 있는 날만 세므로 없는 마크를 지어내지 않고,
빠진 날의 손익은 다음 공통 마킹의 차이에 그대로 들어 있다.

`d`(그날 변화)만 한 자리 더 조심한다. 두 엔진이 각자 "전영업일" 을 자기 달력에서
세므로, 공통 달력의 어제가 양쪽에서 같은 날일 때만 그 둘이 같은 밤을 가리킨다.
다른 밤이면(위의 12일) 그 자리에서는 **직전 공통 영업일 대비**로 바꿔 잰다 —
그 날짜를 평가 표본에 하나 더 넣는 값싼 대가로, 화면이 "당일" 이라고 부르는
숫자가 두 계열의 서로 다른 밤을 섞지 않게 된다.

── 대사 ────────────────────────────────────────────────────────────────────

`book_recon` 은 KRD 격자를 **두 블록**으로 낸다 [OWNER, 2026-08-21]. 스왑 KRD 는
IRS 제로커브 노드에, 채권 KRD 는 민평 노드에 실린 감도다 — 같은 "3Y" 라는 이름을
쓰지만 다른 위험이고, 한 칸에 더하면 그 둘을 하나로 부르는 셈이 된다. 손익
3분해(평가·롤다운·캐리·조달)는 원이라 그냥 더해지므로 한 벌만 선다.
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left, bisect_right
from dataclasses import dataclass

from . import cashbond as cb
from . import funding as fd
from .backtest import (
    MAX_POINTS,
    MAX_POSITIONS,
    Position,
    _run_one,
    _span_of,
    _thin,
)
from .backtest import book_recon as swap_book_recon
from .backtest import run_backtest as swap_run_backtest
from .creditmatrix import CreditMatrix

#: 대사표에서 두 KRD 격자를 가르는 열쇠 접두사. 화면은 접두사를 떼고 테너만
#: 보여주고(그룹 머리가 어느 쪽인지 말한다), 열쇠는 겹치지 않아야 한다.
SWAP_COL = "S"
BOND_COL = "B"


class MixedBookError(Exception):
    """혼합 북을 실행할 수 없다 — 라우트가 422 로 옮긴다."""


@dataclass(frozen=True)
class MixedPosition:
    """한 줄. `series_id` 가 스왑 문법(`10Y`·`3Y-10Y`)이거나 채권 문법
    (`CB:KTB:3Y`·`ASW:KTB:3Y`)이다 — 어느 쪽인지는 **id 만 보고** 안다
    (`instruments.kind_of` 와 같은 규칙)."""

    series_id: str
    direction: int
    notional: float
    entry: dt.date
    exit: dt.date | None = None


def is_bond(series_id: str) -> bool:
    return series_id.startswith((f"{cb.KIND_CASH}:", f"{cb.KIND_ASW}:"))


def has_bond(positions: list[MixedPosition]) -> bool:
    return any(is_bond(p.series_id) for p in positions)


def has_swap(positions: list[MixedPosition]) -> bool:
    return any(not is_bond(p.series_id) for p in positions)


def _as_swap(p: MixedPosition) -> Position:
    return Position(
        series_id=p.series_id,
        direction=p.direction,
        notional=p.notional,
        entry=p.entry,
        exit=p.exit,
    )


def _as_bond(p: MixedPosition) -> cb.BondPosition:
    kind, bond_type, tenor = cb.parse_id(p.series_id)
    return cb.BondPosition(
        kind=kind,
        bond_type=bond_type,
        tenor=tenor,
        direction=p.direction,
        notional=p.notional,
        entry=p.entry,
        exit=p.exit,
    )


def _check(positions: list[MixedPosition]) -> None:
    if not positions:
        raise MixedBookError("포지션이 하나는 있어야 합니다.")
    if len(positions) > MAX_POSITIONS:
        raise MixedBookError(f"포지션은 최대 {MAX_POSITIONS}개입니다.")


# ── 기록의 한 모양 ──────────────────────────────────────────────────────────
#
# 두 엔진의 기록이 다르게 생겼다(스왑은 `legs`·`entryValue`, 채권은 `tenor`·
# `entryYield`·`funding`). 화면 하나가 둘 다 그리려면 **무엇인지 말하는 칸**이
# 있어야 한다 — `kind` 다. 없는 칸을 0 으로 채우지 않는 이유는 이 리포의 공란
# 정책과 같다: 스왑에 조달이 0 이라고 적으면 "조달이 0 원이었다" 로 읽힌다.


def _tag_swap(rec: dict) -> dict:
    return {"kind": "swap", "label": rec["id"], "funding": None, **rec}


def _tag_bond(rec: dict) -> dict:
    kind = "assetswap" if rec.get("kind") == cb.KIND_ASW else "cashbond"
    return {**rec, "kind": kind, "legs": []}


def _same_night(
    m: CreditMatrix, dataset, mi: list[int], di: list[int], k: int
) -> bool:
    """공통 달력의 어제가 두 달력에서 **같은 날**인가.

    참이면 두 엔진의 `prev` 가 같은 밤을 가리키므로 그 둘을 더한 것이 그대로
    하루치 변화다. 거짓이면 한쪽만 그 사이에 마킹이 하나 더 있었다는 뜻이다.
    """
    b, s = mi[k], di[k]
    if b == 0 or s == 0:
        return False
    return m.dates[b - 1] == dataset.dates[s - 1]


def _common(m: CreditMatrix, dataset) -> tuple[list[int], list[int]]:
    """(민평 자리들, 같은 날의 IRS 자리들) — 두 달력이 다 가진 날만, 오름차순.

    `cashbond._irs_index_map` 과 같은 사상이고 모양만 리스트다(k → 두 자리의
    쌍이 필요해서). 겹치는 날이 없으면 세운다 — 그때 아무 날짜나 골라 합치면
    표가 조용히 틀린다.
    """
    if dataset is None:
        raise MixedBookError("혼합 북에는 IRS 데이터셋이 필요합니다.")
    where = {d: j for j, d in enumerate(dataset.dates)}
    mi: list[int] = []
    di: list[int] = []
    for i, d in enumerate(m.dates):
        j = where.get(d)
        if j is not None:
            mi.append(i)
            di.append(j)
    if len(mi) < 2:
        raise MixedBookError(
            "민평과 IRS 달력이 겹치는 날이 없습니다 — 데이터를 확인하세요."
        )
    return mi, di


def _k_span(idx: list[int], entry_i: int, exit_i: int, label: str) -> tuple[int, int]:
    """엔진 자리 구간 → 공통 달력 자리 구간. 진입은 **이후 첫** 공통일,
    청산은 **이전 마지막** 공통일로 스냅한다 — 양쪽 다 그 포지션이 실제로
    살아 있던 날이다."""
    a = bisect_left(idx, entry_i)
    b = bisect_right(idx, exit_i) - 1
    if a > b or a >= len(idx):
        raise MixedBookError(
            f"{label}: 두 달력이 겹치는 날 중에 이 포지션이 살아 있는 날이 없습니다."
        )
    return a, b


def _dropped_days(m: CreditMatrix, dataset, a: dt.date, b: dt.date) -> int:
    """구간 안에서 **한쪽 달력에만** 있는 날의 수. 화면이 한 줄로 말한다."""
    ms = {d for d in m.dates if a <= d <= b}
    ds = {d for d in dataset.dates if a <= d <= b}
    return len(ms ^ ds)


# ── 실행 ────────────────────────────────────────────────────────────────────


def run_backtest(
    m: CreditMatrix | None,
    dataset,
    positions: list[MixedPosition],
    spec: fd.FundingSpec,
) -> dict:
    """섞인 북을 매일 재평가해 합친다.

    한 종류만 있는 북은 **그 엔진에 그대로 넘긴다** — 숫자가 종전과 한 원도
    달라지지 않아야 하고(정적 쌍둥이·가드가 그것을 핀으로 박고 있다), 스왑만
    있는 북이 민평 SQL 에 닿아야 할 이유도 없다. 섞인 북만 아래 병합 경로로
    간다.
    """
    _check(positions)
    if not has_bond(positions):
        out = swap_run_backtest(dataset, [_as_swap(p) for p in positions])
        out["positions"] = [_tag_swap(r) for r in out["positions"]]
        return out
    if m is None:
        raise MixedBookError(
            "채권 줄에는 민평이 필요합니다 — 백엔드가 SQL 에 닿는지 확인해 주세요."
        )
    if not has_swap(positions):
        out = cb.run_backtest(m, dataset, [_as_bond(p) for p in positions], spec)
        out["positions"] = [_tag_bond(r) for r in out["positions"]]
        return out
    return _mixed(m, dataset, positions, spec)


def _mixed(
    m: CreditMatrix, dataset, positions: list[MixedPosition], spec: fd.FundingSpec
) -> dict:
    spec = spec.validated()
    mi, di = _common(m, dataset)
    imap = dict(zip(mi, di))

    swaps: dict[int, Position] = {}
    bonds: dict[int, cb.BondPosition] = {}
    legs: dict[int, cb._BondLeg] = {}
    spans: dict[int, tuple[int, int]] = {}

    entered: list[dt.date] = []      # 각 줄이 **실제로** 들어간 날 (스냅 뒤)
    for n, p in enumerate(positions):
        if is_bond(p.series_id):
            bp = _as_bond(p)
            if bp.direction != 1:
                # 백테스트·시뮬레이션 쪽과 같은 거절 [OWNER, 2026-08-14].
                raise MixedBookError(
                    "현금채권은 매수만 됩니다 — 공매도는 대차료가 필요한데 그 값이 없습니다."
                )
            leg = cb._bond_leg(m, bp)
            bonds[n], legs[n] = bp, leg
            spans[n] = _k_span(mi, leg.entry_i, leg.exit_i, bp.id)
            entered.append(m.dates[leg.entry_i])
        else:
            sp = _as_swap(p)
            entry_i, exit_i, _matured = _span_of(dataset, sp)
            swaps[n] = sp
            spans[n] = _k_span(di, entry_i, exit_i, sp.series_id)
            entered.append(dataset.dates[entry_i])

    first_k = min(a for a, _b in spans.values())
    last_k = max(b for _a, b in spans.values())
    sample_k = _thin(list(range(first_k, last_k + 1)), MAX_POINTS)

    # 두 달력이 어긋난 자리 — 모듈 주석의 `d` 절. 그 날만 직전 공통일을 평가
    # 표본에 더한다(전체에 더하지 않는 이유: 롤다운 체인의 걸음 폭이 바뀐다).
    gaps = {
        k for k in sample_k if k > first_k and not _same_night(m, dataset, mi, di, k)
    }
    eval_k = sorted(set(sample_k) | {k - 1 for k in gaps})
    swap_sample = [di[k] for k in eval_k]
    bond_sample = [mi[k] for k in eval_k]

    records: dict[int, dict] = {}
    own_k: dict[int, dict[int, float]] = {}
    prev_k: dict[int, dict[int, float]] = {}

    curve_cache: dict[int, object] = {}
    for n, sp in swaps.items():
        rec, own, prev = _run_one(dataset, sp, swap_sample, curve_cache)
        records[n] = _tag_swap(rec)
        own_k[n] = {k: own[di[k]] for k in eval_k}
        prev_k[n] = {k: prev[di[k]] for k in eval_k if di[k] in prev}

    swap_cache: dict[int, object] = {}
    for n, bp in bonds.items():
        rec, own, prev = cb.run_bond_position(
            m, dataset, bp, legs[n], bond_sample, spec, imap, swap_cache
        )
        records[n] = _tag_bond(rec)
        own_k[n] = {k: own[mi[k]] for k in eval_k}
        prev_k[n] = {k: prev[mi[k]] for k in eval_k if mi[k] in prev}

    points = []
    for k in sample_k:
        total = round(sum(own_k[n][k] for n in own_k), 0)
        if k == first_k:
            d = None
        elif k in gaps:
            # 양쪽의 "어제" 가 다른 날이라 하루치를 그대로 못 더한다 — 직전
            # 공통 영업일 대비로 잰다(모듈 주석).
            d = round(total - sum(own_k[n][k - 1] for n in own_k), 0)
        else:
            d = round(total - sum(prev_k[n].get(k, 0.0) for n in prev_k), 0)
        points.append({"t": m.dates[mi[k]].isoformat(), "pnl": total, "d": d})

    pnls = [p["pnl"] for p in points]
    a, b = m.dates[mi[first_k]], m.dates[mi[last_k]]
    return {
        "positions": [records[n] for n in range(len(positions))],
        "from": a.isoformat(),
        "to": b.isoformat(),
        "complete": len(sample_k) == last_k - first_k + 1,
        "points": points,
        "pnl": pnls[-1] if pnls else 0.0,
        "maxProfit": max(pnls) if pnls else 0.0,
        "maxLoss": min(pnls) if pnls else 0.0,
        "funding": fd.provenance(spec),
        # 화면이 한 줄로 말한다 — 무엇을 안 세었는지는 데이터 사실이다.
        "calendar": {
            "basis": "민평 ∩ IRS",
            "dropped": _dropped_days(m, dataset, a, b),
            # **선이 늦게 시작하는가.** 민평은 2020-01-02 부터인데 IRS 는 그보다
            # 앞이라, 2019년에 들어간 스왑을 채권과 섞으면 공통 달력이 그 진입을
            # 못 담는다. 그때도 **총액은 옳다**(각 줄의 누적은 자기 진입일부터
            # 세고, 첫 점이 그 값을 그대로 싣는다) — 그림만 중간부터 시작한다.
            # 0 에서 출발하지 않는 선은 설명 없이 두면 오독이라 여기서 말한다.
            "clippedFrom": min(entered).isoformat() if entered and min(entered) < a else None,
        },
    }


# ── 대사 ────────────────────────────────────────────────────────────────────


def book_recon(
    m: CreditMatrix | None,
    dataset,
    positions: list[MixedPosition],
    spec: fd.FundingSpec,
) -> dict:
    """일별 대사. 한 종류뿐인 북은 그 엔진의 블록을 **그대로** 돌려준다."""
    _check(positions)
    if not has_bond(positions):
        return swap_book_recon(dataset, [_as_swap(p) for p in positions])
    if m is None:
        raise MixedBookError("채권 줄에는 민평이 필요합니다.")
    if not has_swap(positions):
        return cb.book_recon(m, dataset, [_as_bond(p) for p in positions], spec)

    sr = swap_book_recon(
        dataset, [_as_swap(p) for p in positions if not is_bond(p.series_id)]
    )
    br = cb.book_recon(
        m, dataset, [_as_bond(p) for p in positions if is_bond(p.series_id)], spec
    )

    s_rows = {r["t"]: r for r in sr["rows"] if not r.get("carryover")}
    b_rows = {r["t"]: r for r in br["rows"] if not r.get("carryover")}
    s_at = {d.isoformat(): i for i, d in enumerate(dataset.dates)}
    b_at = {d.isoformat(): i for i, d in enumerate(m.dates)}

    # 창을 맞춘다. 두 대사가 각자 **자기 달력의 · 자기 북의** 최근 250영업일을
    # 싣고 오므로 양 끝이 다 다르다.
    #
    #   시작 — 잘린 창의 바닥이다. 그 앞은 «달력이 어긋나서» 빠진 것이 아니라
    #          그냥 안 계산된 것이고, 그 사실은 `truncated` 가 이미 말한다.
    #          그래서 **늦은 쪽**을 바닥으로 쓴다.
    #   끝  — 그 북이 **끝난 날**이다. 한쪽이 먼저 끝났으면 그 뒤로 그 줄의
    #          일별 손익은 0 이고 KRD 도 0 이다(누적은 얼어붙어 있다). 지어내는
    #          숫자가 아니라 참인 0 이므로 채워 넣고 **늦은 쪽**까지 간다.
    #
    # 종전에는 끝도 min 이었다. 그 판에서 「2020년에 산 국고채 3Y(2023 만기) +
    # 지금도 들고 있는 10Y 스왑」 이 대사표를 **통째로 비웠다**(실측 2026-08-21:
    # 스왑 창 2025-08-25~2026-08-19 · 채권 창 2021-12-28~2023-01-02 → lo > hi).
    # 화면에는 "이 실행에는 일별 대사가 없어요" 만 떴고, 그건 병이 아니라 답이
    # 있는데 못 찾은 것이었다.
    if not s_rows or not b_rows:
        lo = hi = None
        s_end = b_end = ""
    else:
        lo = max(min(s_rows), min(b_rows))
        s_end, b_end = max(s_rows), max(b_rows)
        hi = max(s_end, b_end)

    def _zero(tenors: list[str]) -> dict:
        """끝난 쪽의 하루 — 손익도 리스크도 0 이다(누적은 얼어붙어 있다).

        `dbp` 만 0 이 아니라 **빈칸**이다. 그날 시장은 움직였겠지만 그 줄의
        엔진은 이제 아무것도 안 재고 있고, 여기서 노드 변화를 다시 구하면 이
        모듈이 피하려던 것 — Δbp 의 두 번째 정의 — 이 생긴다. KRD 가 0 이라
        추정(krd × dbp)은 어차피 0 이므로 표의 산술은 그대로 닫힌다.
        """
        return {
            "krd": {lb: 0 for lb in tenors},
            "dbp": {},
            "est": {},
            "estTotal": 0,
            "actual": 0,
            "valuation": 0,
            "rolldown": 0,
            "carry": 0,
            "startup": 0,
            "funding": 0,
        }

    # 그 창 안에서: **살아 있는 쪽**이 다 선 날만, 그리고 그 쪽들의 **어제가 같은
    # 날인** 날만 [모듈 주석]. 뒤 조건이 하루를 더 먹는다 — 한쪽만 쉰 날의
    # **다음 날**은 두 계열이 서로 다른 밤을 재고 있어서, 더한 값이 어느 하루에도
    # 속하지 않는다. 이미 끝난 쪽은 달력에 아무 요구도 하지 않는다(0 이라서).
    keep: list[str] = []
    dropped = 0
    for t in sorted(set(s_rows) | set(b_rows)):
        if lo is None or t < lo or t > hi:
            continue
        s_live, b_live = t <= s_end, t <= b_end
        if (s_live and t not in s_rows) or (b_live and t not in b_rows):
            dropped += 1
            continue
        si, bi = s_at.get(t), b_at.get(t)
        if s_live and b_live:
            if si is None or bi is None or si == 0 or bi == 0:
                dropped += 1
                continue
            if dataset.dates[si - 1] != m.dates[bi - 1]:
                dropped += 1
                continue
        keep.append(t)

    s_cols = [f"{SWAP_COL}:{lb}" for lb in sr["tenors"]]
    b_cols = [f"{BOND_COL}:{lb}" for lb in br["tenors"]]

    def _grid(row: dict, field: str, tenors: list[str], prefix: str) -> dict:
        src = row.get(field) or {}
        return {f"{prefix}:{lb}": src.get(lb) for lb in tenors}

    zero_s, zero_b = _zero(sr["tenors"]), _zero(br["tenors"])
    rows: list[dict] = []
    for t in keep:
        s, b = s_rows.get(t, zero_s), b_rows.get(t, zero_b)
        total_est = (s["estTotal"] or 0) + (b["estTotal"] or 0)
        valuation = s["valuation"] + b["valuation"]
        rows.append(
            {
                "t": t,
                "krd": {
                    **_grid(s, "krd", sr["tenors"], SWAP_COL),
                    **_grid(b, "krd", br["tenors"], BOND_COL),
                },
                "dbp": {
                    **_grid(s, "dbp", sr["tenors"], SWAP_COL),
                    **_grid(b, "dbp", br["tenors"], BOND_COL),
                },
                "est": {
                    **_grid(s, "est", sr["tenors"], SWAP_COL),
                    **_grid(b, "est", br["tenors"], BOND_COL),
                },
                "estTotal": total_est,
                "actual": s["actual"] + b["actual"],
                "valuation": valuation,
                "rolldown": s["rolldown"] + b["rolldown"],
                "carry": s["carry"] + b["carry"],
                # 개시는 스왑 줄만 낸다(채권은 진입일에 발행돼 결제 시차의 밤이 없다).
                "startup": s.get("startup", 0),
                # 조달은 채권 줄만 낸다 — 서버가 이미 음수로 준다.
                "funding": b.get("funding"),
                "residual": valuation - total_est,
            }
        )

    # 이월 앵커 둘을 한 줄로. 날짜가 갈리면 **늦은 쪽**이다 — 둘 다 "다음
    # 영업일" 인데 한쪽 달력에만 있는 날이면 그날 아침에 둘 다 들고 있다.
    s_anchor = next((r for r in sr["rows"] if r.get("carryover")), None)
    b_anchor = next((r for r in br["rows"] if r.get("carryover")), None)
    if rows and (s_anchor or b_anchor):
        at = max(r["t"] for r in (s_anchor, b_anchor) if r)
        rows.append(
            {
                "t": at,
                "krd": {
                    **_grid(s_anchor or {}, "krd", sr["tenors"], SWAP_COL),
                    **_grid(b_anchor or {}, "krd", br["tenors"], BOND_COL),
                },
                "dbp": {},
                "est": {},
                "estTotal": None,
                "actual": None,
                "valuation": None,
                "rolldown": None,
                "carry": None,
                "startup": None,
                "funding": None,
                "residual": None,
                "carryover": True,
            }
        )

    return {
        "tenors": s_cols + b_cols,
        # 두 격자를 가르는 머리 [OWNER, 2026-08-21]. 열쇠는 접두사가 붙어 있고
        # 화면에 적히는 것은 테너뿐이다 — 어느 커브인지는 그룹 머리가 말한다.
        "groups": [
            {
                "label": "스왑 KRD",
                "cols": [
                    {"key": k, "label": lb} for k, lb in zip(s_cols, sr["tenors"])
                ],
            },
            {
                "label": "채권 KRD",
                "cols": [
                    {"key": k, "label": lb} for k, lb in zip(b_cols, br["tenors"])
                ],
            },
        ],
        "rows": rows,
        "truncated": sr["truncated"] or br["truncated"],
        "dropped": dropped,
    }
