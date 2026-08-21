# -*- coding: utf-8 -*-
"""`engine_status.json` — 엔진이 자기 상태를 한 곳에서 말한다.

세션 2(Strategy)와 세션 3(Model·Method)이 **둘 다** 여기서 렌더한다. 그래서
«신선한가 낡았나» 를 두 화면이 각자 판정하면 안 되고, 그 판정이 여기 있다.

## 왜 날짜가 둘인가 — 이게 이 파일의 하중이다

    basis_as_of   기저를 **구운 날**
    data_edge_q   모형이 **마지막으로 본 분기**

이관 전 기저는 `as_of: 2026-08-21` 하나만 들고 있었다. 화면이 그걸 「기준일」
이라고 부르면 **5개월 낡은 입력이 하루 전 것처럼 보인다.** 실측한 빈티지
(`output/foundation_diagnosis.md` §C.10):

    기준금리(일)                    2026-08-21   당일
    KTB·회사채(일)                  2026-08-20   D+1
    콜·CD91·통안1년(일)             2026-08-04   17일
    KB주택(월)                      2026-07
    건축착공 BCI(월)                2026-06
    국민계정·CPI·대출금리(분기)     2026Q2       2개월
    투자·건설 디플레이터·명목GDP    2026Q1       5개월

모형은 **분기 모형**이라 결정적인 끝은 분기 쪽이다.

## 상태 세 가지

    fresh    마지막 리베이크 뒤로 이벤트가 안 지났다
    stale    이벤트가 지났는데 다시 안 구웠다
    blocked  Layer 2 필수 입력을 못 받았거나 캐시로 때웠다

`blocked` 가 있는 이유: 이관 전 ECOS 로더는 실패하면 `print("[warn] … using
cache")` 하고 조용히 캐시로 진행했다(`bigfoot/data/ecos.py:154`). 산출물
어디에도 «이 빌드는 캐시로 구웠다» 가 안 남는다. 그 사실이 여기까지 올라와야
화면이 말할 수 있다.
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
from pathlib import Path

from . import cadence

BACKEND = Path(__file__).resolve().parents[1]
RAW_DIR = BACKEND / "data" / "raw"

#: 논문 IRF 텍스트 앵커와 스코어카드는 **코드에 안 베낀다.**
#:
#: `config/paper_anchors.json` 한 벌이 정본이고 여기서는 읽기만 한다. 예전에는
#: 이 상수가 코드에 있었고, 그래서 `engine_status.json` 이 12/13 을 싣고 있는데
#: 실제로는 9/13 인 상태가 오래 갔다 — 두 벌이면 한쪽만 낡는다.
#:
#: 그 12/13 은 Table 8 값의 **순열을 그 밴드에 맞춰 고른 결과**라 기준선도
#: 아니었다. 남은 실패 넷은 전부 금리→주택→부채→소비 **진폭** 사슬이고 뿌리는
#: 논문이 안 박은 금리 단위 규약이다. 밴드를 맞추려 배율을 지어내지 않았다.
PAPER_ANCHORS = BACKEND / "config" / "paper_anchors.json"


def scorecard() -> dict:
    """`paper_anchors.json` 의 스코어카드에 앵커 본문을 붙여 돌려준다."""
    doc = json.loads(PAPER_ANCHORS.read_text("utf-8"))
    by_id = {a["id"]: (sh, a)
             for sh in doc["shocks"] for a in sh["anchors"]}
    sc = dict(doc["scorecard"])
    sc["misses"] = [
        {
            "anchor_id": m["anchor_id"],
            "shock": by_id[m["anchor_id"]][0]["label"],
            "panel": by_id[m["anchor_id"]][1]["panel"],
            "anchor": f"{by_id[m['anchor_id']][1]['value']}"
                      f"{by_id[m['anchor_id']][1]['unit']}",
            "measured": m["measured"],
            "page": by_id[m["anchor_id"]][0]["page"],
            "why": m["why"],
        }
        for m in doc["scorecard"]["misses"]
    ]
    return sc


KNOWN_SEAMS = [
    {"flag": "V1_NO_TERM_PREMIUM_IN_IRS",
     "what": "엔진의 KTB 10년 기간프리미엄이 IRS 다리까지 안 옵니다. IRS 는 "
             "기대 CD 평균 + OU 스프레드로만 값이 매겨져요."},
    {"flag": "KR3Y_EH_ONLY",
     "what": "국고 3년은 기대가설 12분기 평균만이에요 — 기간프리미엄 없이요."},
    {"flag": "SOURCE_QPM2008",
     "what": "준칙의 지속성은 IMF QPM 2008 계열이고 논문이 안 박은 자리예요."},
]


def _last_quarter_in(name: str) -> str | None:
    p = RAW_DIR / f"{name}.csv"
    if not p.exists():
        return None
    try:
        import pandas as pd
        df = pd.read_csv(p)
        return str(df[df.columns[0]].iloc[-1])
    except Exception:                              # noqa: BLE001
        return None


def data_edges() -> dict:
    """계열군별 마지막 관측. **가장 늦은 것이 아니라 가장 이른 것이 구속한다.**"""
    quarterly = {
        "국민계정 실질": "bigfoot_gdp_real_sa_q",
        "근원 CPI": "bigfoot_core_cpi_q",
        "콜금리": "bigfoot_call_rate_q",
        "투자 디플레이터": "bigfoot_defl_fi_q",
        "건설 디플레이터": "bigfoot_defl_con_q",
        "명목 GDP": "bigfoot_gdp_nom_sa_q",
    }
    edges = {k: _last_quarter_in(v) for k, v in quarterly.items()}
    have = [v for v in edges.values() if v]
    binding = min(have) if have else None
    newest = max(have) if have else None
    return {"per_series": edges, "binding_quarter": binding,
            "newest_quarter": newest}


def as_of_sentence(edges: dict) -> str:
    """세션 2 가 **그대로** 렌더하는 문장. 여기 한 벌만 둔다."""
    newest = edges.get("newest_quarter") or "?"
    binding = edges.get("binding_quarter") or "?"
    if binding == newest:
        return (f"이 모형은 분기 모형이고, 마지막으로 본 분기는 {newest} 예요. "
                "기저를 구운 날짜는 데이터가 거기까지 왔다는 뜻이 아니에요.")
    return (f"이 모형은 분기 모형이고, 마지막으로 본 분기는 {newest} 예요. "
            "기저를 구운 날짜는 데이터가 거기까지 왔다는 뜻이 아니에요. "
            f"투자·건설 디플레이터는 {binding} 까지만 있어서 그 뒤는 "
            "추정으로 메워요.")


def _tests_passed() -> dict:
    """엔진 테스트 수. 못 세면 **0 으로 채우지 않고 없다고 말한다.**"""
    try:
        r = subprocess.run(
            ["python", "-m", "pytest", "tests/engine", "--collect-only", "-q"],
            cwd=BACKEND, capture_output=True, text=True, timeout=180)
        for line in reversed((r.stdout or "").splitlines()):
            if "collected" in line:
                return {"collected": int(line.split()[0]), "source": "pytest"}
    except Exception:                              # noqa: BLE001
        pass
    return {"collected": None, "source": "세지 못했어요"}


def build_status(basis_as_of: str, assumptions: dict, *,
                 cache_fallbacks: list[str] | None = None,
                 today: dt.date | None = None,
                 count_tests: bool = True) -> dict:
    today = today or dt.date.today()
    edges = data_edges()
    nxt = cadence.next_event(today)
    basis_d = dt.date.fromisoformat(basis_as_of)

    blocked_on = list(cache_fallbacks or [])
    for it in assumptions["items"]:
        if it["effect"] == "delta" and not it.get("fetched") \
                and it.get("value") is None:
            blocked_on.append(it["key"])

    if blocked_on:
        state, why = "blocked", ("필수 입력을 못 받았어요: "
                                 + ", ".join(sorted(set(blocked_on))))
    elif cadence.is_due(basis_d, today):
        state, why = "stale", ("마지막으로 구운 뒤에 이벤트가 지났어요 — "
                               "다시 구워야 해요.")
    else:
        state, why = "fresh", "마지막 이벤트 뒤로 다시 구웠어요."

    if nxt.get("missing_calendars"):
        why += (" 다만 " + ", ".join(nxt["missing_calendars"])
                + " 달력이 없어서 놓친 이벤트가 있을 수 있어요.")

    return {
        "module": "engine_status",
        "basis_as_of": basis_as_of,
        "data_edge": edges,
        "as_of_sentence": as_of_sentence(edges),
        "next_event": nxt,
        "staleness": {"state": state, "why": why,
                      "blocked_on": sorted(set(blocked_on))},
        "scorecard": scorecard(),
        "known_seams": KNOWN_SEAMS,
        "tests": _tests_passed() if count_tests
                 else {"collected": None, "source": "이 빌드에서 안 셌어요"},
        "engine": {
            "home": "backend/bigfoot",
            "moved_on": "2026-08-21",
            "source_commits": ["44ad37a", "eeca108", "446ae7a", "f888201"],
            "note": "BOK-LOOK(BOK WP 2025-3) 구현이에요. 예전 이름 BIGFOOT 은 "
                    "이제 현재형이 아니라 출처를 가리켜요.",
        },
    }
