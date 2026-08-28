# -*- coding: utf-8 -*-
"""평균회귀 백테스트의 **캐리** — 두 다리의 중간 현금흐름
[OWNER 2026-08-27 — "중간에 CF는 상쇄되는건가?" · "퓨처스왑도 마찬가지임"].

## 안 상쇄된다

`mrbacktest` 의 원본(PMS 이식) 산술은 손익이 **스프레드 변화뿐**이다. 실제
거래에는 다리마다 중간 현금흐름이 붙고, 두 다리를 합쳐도 **남는다**:

    BSS −1 = 국고 매수 · IRS 페이
        국고 매수 :  + 쿠폰 − 조달        ≈ +(국고금리 − 조달)
        IRS 페이  :  − 고정  + CD 91일    ≈ +(CD − 스왑고정)
        합계      = (국고 − 스왑) + (CD − 조달) = **BSS + (CD − 조달)**

    FSW −1 = 선물 매수 · IRS 페이
        선물 매수 :  **0**  ← 조달 현금흐름이 없다(아래)
        IRS 페이  :  +(CD − 스왑고정)
        합계      = **CD − 스왑고정**

    FUT −1 = 선물 매수
        합계      = **0**

부호 기준은 언제나 `position = -1` 이다(`mrbacktest.simulate` 의 `carry` 규약).
반대 방향은 엔진이 `-position` 으로 뒤집는다 — 같은 베이시스를 반대로 무는 것이
맞다.

## 선물에 조달 항을 붙이지 않는 이유

선물은 증거금만 걸고 일일정산한다 — 원금을 조달하지 않는다. 채권의 캐리는
**선물 가격에 이미 박혀 있고**(인도일로 가면서 베이시스가 수렴한다), 이 엔진이
재는 값은 그 가격에서 나온 **내재수익률**이다. 그래서 조달을 또 빼면
**이중계상**이다.

그 결과 BSS 와 FSW 는 캐리의 **부호가 다를 수 있다**: 커브가 우상향이면
`CD − 스왑 < 0` 이라 FSW 페이는 음의 캐리이고, BSS 는 거기에 `국고 − 조달` 이
더 붙어 대개 양이다. 둘의 차가 정확히 «현물을 조달해 들고 있는 값» 이다.

## 명목 환산 — 화면 노브는 `₩/bp`(DV01)다

캐리는 **원금**에 붙는데 노브는 DV01 이라 환산이 필요하다.

    DV01(₩/bp) = 명목 × pv01 × 1e-4       (`dv01.pv01` = 파스왑 연금계수)
    ⇒ 명목 = DV01 / (pv01 × 1e-4)

`pv01` 은 **지금 커브**에서 읽는다. 6년 표본 내내 그 값이 변하는데도 하나로
쓰는 것은 근사다 — 다만 이 환산은 캐리의 **크기만** 정하고 부호나 시점은 안
건드린다(pv01 이 5% 틀리면 캐리가 5% 틀리고, 그건 거래 손익의 0.5% 수준이다).
정확히 하려면 봉마다 커브를 다시 세워야 하는데, 이 엔진은 커브가 아니라 **한
계열의 시계열**만 받는 물건이라 그 자리가 없다. [알려진 근사]

## 하루가 아니라 실제 날수

봉 사이가 늘 하루는 아니다(금→월은 사흘). 캐리는 **달력 날수**로 쌓는다 —
`ACT/365`. 이 근사가 무해한 이유는 이 앱의 조달 모듈이 이미 같은 규약이기
때문이다(`funding.cost_between`).
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import text

from . import funding as fnd
from .universe import _fetch_curves, _fetch_irs  # noqa: PLC2701 — 같은 데이터 창구
from . import mrseries as mrs
from .mysqldb import engine
from .mr import FSW_IRS_COL


#: CD 91일 = 스펙의 **3M 노드**이고 SQL 열은 `cd_rate` 다
#: (`dataset.SQL_COLUMN_TENOR`: "cd_rate → 3M — IRS 3M = CD91").
#: `universe._fetch_irs` 의 매핑에는 6M~10Y 만 있어 여기서 따로 읽는다.
CD_COL = "cd_rate"


def _tenor_of(sid: str) -> str:
    """계열 id 에서 만기 라벨. `BSS-3Y` → `3Y`, `FSW-10Y` → `10Y`."""
    if sid.startswith("FSW-"):
        return FSW_IRS_COL[sid][0]
    return sid.split("-", 1)[1]


def carry_rates(sid: str, kind: str, dates: list[str],
                spec: fnd.FundingSpec) -> tuple[list[float | None], str]:
    """`position = -1` 을 하루 들고 있을 때의 **연 캐리(%)** — 봉마다 하나.

    돌려주는 둘째 값은 화면이 읽을 정의 문장이다(숫자 옆에 무엇인지가 없으면
    읽는 사람이 부호를 자기 방향으로 읽는다 — `mr.KIND_DEFN` 과 같은 규율).
    """
    if kind == "fut":
        return [0.0] * len(dates), "선물은 조달 현금흐름이 없어요 (캐리 0)"

    if kind == "bss":
        # 값 계열이 긴 출처로 옮겨갔으므로(`mrseries`) **캐리도 같은 출처**에서
        # 읽는다 [OWNER 2026-08-28 — "옮기고"]. 안 그러면 2014~2020 구간에서
        # 국고·IRS 를 못 찾아 캐리가 조용히 0 이 되고, 6년치 손익이 캐리 없이
        # 계산된다 — 없는 값을 0 으로 채우는 그 사고다.
        return _bss_rates(sid, dates, spec)

    tenor = _tenor_of(sid)
    with engine().connect() as conn:
        cdates, curves = _fetch_curves(conn)
        idates, irs = _fetch_irs(conn)
        rows = conn.execute(text(
            f"SELECT irs_date, {CD_COL} FROM sim_portfolio.mkt_irs_close ORDER BY irs_date"
        )).mappings().fetchall()

    ktb = curves.get("KTB", {})
    # 날짜 → 값. 없는 날은 아예 안 담는다 — 캐리를 지어내지 않는다.
    cd91 = {r["irs_date"].isoformat(): float(r[CD_COL])
            for r in rows if r[CD_COL] is not None}
    swap = {d.isoformat(): v for d, v in zip(idates, irs.get(tenor, [])) if v is not None}
    govt = ({d.isoformat(): v for d, v in zip(cdates, ktb.get(tenor, [])) if v is not None}
            if kind == "bss" else {})

    out: list[float | None] = []
    for t in dates:
        s = swap.get(t)
        c = cd91.get(t)
        if s is None or c is None:
            out.append(None)
            continue
        if kind == "fsw":
            out.append(c - s)                       # CD − 스왑고정
            continue
        g = govt.get(t)
        if g is None:
            out.append(None)
            continue
        # ⚠ **단위가 다르다.** 커브(국고·IRS·CD)는 **%**(3.817)이고
        # `funding.rate_on` 은 **소수**(0.0285)다 — 실측 2026-08-27 에 그대로
        # 빼서 100배 틀린 캐리(중앙 2.667%/년)를 냈다. 대수적으로 이 식은
        # `BSS + (CD − 조달)` 로 접히므로 **0.1% 안팎**이어야 하고, 그 항등이
        # 아래 `assert_units` 와 가드가 재는 것이다.
        f = fnd.rate_on(spec, dt.date.fromisoformat(t)) * 100.0
        out.append((g - f) + (c - s))               # (국고 − 조달) + (CD − 스왑)

    defn = ("(국고 − 조달) + (CD 91일 − IRS)" if kind == "bss"
            else "CD 91일 − IRS  (선물 다리는 조달이 없어요)")
    return out, defn


def _bss_rates(sid: str, dates: list[str],
               spec: fnd.FundingSpec) -> tuple[list[float | None], str]:
    """BSS 의 연 캐리(%) — `(국고 − 조달) + (CD 91일 − 스왑)`.

    ⚠ **단위가 다르다.** 커브(국고·IRS·CD)는 %(3.817)이고 `funding.rate_on` 은
    소수(0.0285)다 — 실측 2026-08-27 에 그대로 빼서 100배 틀린 캐리(중앙
    2.667%/년)를 냈다. 대수적으로 이 식은 `BSS + (CD − 조달)` 로 접히므로 0.1%
    안팎이어야 하고, 그 항등이 이 산술의 자기검사다.
    """
    d, govt, swap, cd = mrs.legs(sid, need_cd=True)
    g = dict(zip(d, govt))
    s = dict(zip(d, swap))
    c = dict(zip(d, cd))
    out: list[float | None] = []
    for t in dates:
        if t not in g or t not in s or t not in c:
            out.append(None)
            continue
        f = fnd.rate_on(spec, dt.date.fromisoformat(t)) * 100.0
        out.append((g[t] - f) + (c[t] - s[t]))
    return out, "(국고 − 조달) + (CD 91일 − IRS)"


def carry_krw(rates: list[float | None], dates: list[str], *,
              notional_per_bp: float, pv01: float) -> list[float]:
    """연 캐리(%) → **봉당 원(₩)**. `mrbacktest.simulate(carry=…)` 이 먹는 꼴.

    첫 봉은 앞 봉이 없어 0 이다. 값이 없는 날(휴일 사이 결측)도 0 으로 둔다 —
    «모르는 날» 에 캐리를 지어내지 않는다.
    """
    principal = notional_per_bp / (pv01 * 1e-4)
    out = [0.0]
    for i in range(1, len(dates)):
        r = rates[i]
        if r is None:
            out.append(0.0)
            continue
        d0 = dt.date.fromisoformat(dates[i - 1])
        d1 = dt.date.fromisoformat(dates[i])
        out.append(principal * (r / 100.0) * ((d1 - d0).days / 365.0))
    return out


def summarize(trades: list[dict[str, Any]]) -> dict[str, float]:
    """거래들의 삼분해 합 — 대사표의 바닥 줄."""
    return {
        "mtm": sum(t.get("mtm", 0.0) for t in trades),
        "carry": sum(t.get("carry", 0.0) for t in trades),
        "cost": sum(t.get("cost", 0.0) for t in trades),
    }


def assert_identity(sid: str, kind: str, dates: list[str],
                    rates: list[float | None], spread_bp: list[float],
                    spec: fnd.FundingSpec) -> None:
    """BSS 의 캐리는 대수적으로 **`BSS + (CD − 조달)`** 로 접힌다.

        (국고 − 조달) + (CD − 스왑) = (국고 − 스왑) + (CD − 조달)

    두 길로 같은 수가 나오는지를 재는 것이 이 함수다. 단위가 어긋나면(커브는
    %, 조달은 소수) 이 항등이 **가장 먼저** 깨진다 — 실측 2026-08-27 에 그
    사고가 났고, 그때 결과는 «그럴듯한 큰 수» 였지 예외가 아니었다.
    """
    if kind != "bss":
        return
    with engine().connect() as conn:
        rows = conn.execute(text(
            f"SELECT irs_date, {CD_COL} FROM sim_portfolio.mkt_irs_close ORDER BY irs_date"
        )).mappings().fetchall()
    cd91 = {r["irs_date"].isoformat(): float(r[CD_COL])
            for r in rows if r[CD_COL] is not None}
    for i, t in enumerate(dates):
        if rates[i] is None or t not in cd91:
            continue
        f = fnd.rate_on(spec, dt.date.fromisoformat(t)) * 100.0
        other = spread_bp[i] / 100.0 + (cd91[t] - f)
        if abs(other - rates[i]) > 1e-6:
            raise AssertionError(
                f"{sid} {t}: 캐리 항등이 깨졌어요 — "
                f"직접 {rates[i]:.6f}% vs BSS+(CD−조달) {other:.6f}%"
            )
