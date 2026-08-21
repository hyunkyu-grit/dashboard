# -*- coding: utf-8 -*-
"""Layer 2 — 가정. 자동으로 채우고, 보여주고, **절대 편집 못 하게 한다.**

## 진단이 계획을 뒤집은 자리 — 읽고 시작할 것

원래 설계는 「미 정책금리: FOMC 닷 8/20 · 유가: 브렌트 선물 8/21 · 해외성장:
컨센서스」 를 받아와 띠에 세우는 것이었다. **그 띠는 거짓말이 된다.**

실측(`output/foundation_diagnosis.md` §C.8):

    기저는 편차 공간의 **단위 충격 15개**다. `us_2q/4q/6q` 와 `oil` 은
    «가정된 경로» 가 아니라 «이만큼 때리면» 이다. 그러므로 FOMC 닷이나
    브렌트 선물을 새로 받아와도 **기저의 숫자는 하나도 안 바뀐다.**

    r* 를 1.5%·2.5% 로 바꿔 기저를 다시 풀어 봤다. 15개 기저 전부의 10년
    IRS 반응 최대 절대차가 **0.000000 bp** 였다. 구조적이다 — eq (35) 에서
    r* 와 −φ_π·π* 는 가법 상수이고, 베이스라인 0 인 편차 공간에서 상수는
    소거된다. 모형이 선형이라(게이트 1e-4) 상태의존성도 없다.

그래서 이 모듈은 두 가지를 분리해 싣는다:

    effect="delta"       이 값이 화면의 bp 를 실제로 움직인다
    effect="level_only"  레벨 전망에만 쓰인다. 이 앱은 델타를 파므로 영향 0
    effect="not_in_basis" 기저가 아예 안 쓴다 — 참고로만 보여준다

띠가 그 구분을 안 보여주면, 트레이더는 안 쓰인 숫자를 근거로 읽는다.

## 도달성 실측 (2026-08-21)

    ECOS StatisticSearch              HTTP 200
    FRED DFEDTARU  (미 정책금리 수준)  HTTP 200
    FRED DCOILBRENTEU (브렌트 현물)    HTTP 200
    미 정책 **선도 경로**              도달 불가 — SEP 닷은 분기 PDF,
                                       SOFR 선물은 CME 유료
    브렌트 **선물 커브**               도달 불가 — FRED 는 현물만
    해외성장 **컨센서스**              도달 불가 — 유료

셋 중 둘이 선도를 못 준다. 그런데 셋 다 기저에 안 들어가므로, 지금 단계에서는
**받을 수 있는 둘만 참고값으로 캐시**하고 못 받는 것은 못 받았다고 적는다.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import requests

BACKEND = Path(__file__).resolve().parents[1]
RAW_DIR = BACKEND / "data" / "raw"
CONFIG = BACKEND / "config"

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
TIMEOUT = 20

#: 못 받았을 때 쓰는 문장. **값을 대신 채우지 않는다** — 출처 자리에 이 문장이
#: 그대로 들어가고, 화면은 값 대신 이걸 읽는다.
UNREACHABLE = "받지 못했어요"


def _fred_latest(series_id: str) -> tuple[float | None, str | None, str]:
    """(값, 관측일, 출처문장). 실패해도 예외를 안 던지고 못 받았다고 말한다."""
    key = os.environ.get("FRED_API_KEY", "")
    if not key:
        return None, None, f"{UNREACHABLE} — FRED_API_KEY 가 없어요"
    try:
        r = requests.get(FRED_BASE, timeout=TIMEOUT, params={
            "series_id": series_id, "api_key": key, "file_type": "json",
            "sort_order": "desc", "limit": 1})
        r.raise_for_status()
        obs = r.json().get("observations", [])
        if not obs or obs[0].get("value") in (".", None):
            return None, None, f"{UNREACHABLE} — FRED {series_id} 가 비었어요"
        return (float(obs[0]["value"]), obs[0]["date"],
                f"FRED {series_id}")
    except Exception as exc:                       # noqa: BLE001
        return None, None, f"{UNREACHABLE} — FRED {series_id} ({type(exc).__name__})"


def _engine_constant(dotted: str) -> float:
    """`config/appendix_d_resolved.yaml` 에서 상수 하나. 코드에 베끼지 않는다."""
    import yaml
    with open(CONFIG / "appendix_d_resolved.yaml", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    group, name = dotted.rsplit(".", 1)
    return float(doc[group][name]["value"])


def collect(offline: bool = False) -> list[dict]:
    """Layer 2 항목 전부. 순서가 화면의 순서다."""
    items: list[dict] = []

    # ── 기저에 실제로 들어간 것 ────────────────────────────────────────────
    items.append({
        "key": "r_star",
        "label": "중립금리 r*",
        "value": _engine_constant("calibration.r_star.named.r_star") * 100.0,
        "unit": "%",
        "source": "논문 각주 24 — Laubach-Williams 한국 추정치의 평균 "
                  "(config/appendix_d_resolved.yaml · CALIBRATED_LW)",
        "as_of": "논문 2025-02 · 상수",
        "fetched": False,
        "effect": "level_only",
        "effect_note": "이 값을 1.5%·2.5% 로 바꿔 기저를 다시 풀어 봤더니 "
                       "10년 IRS 반응이 0.000000bp 달라졌어요. 편차 공간에서 "
                       "상수는 소거되거든요. 레벨 전망에만 쓰여요.",
    })
    items.append({
        "key": "pi_star",
        "label": "물가목표 π*",
        "value": _engine_constant("policy_rule.named.pi_star") * 100.0,
        "unit": "%",
        "source": "논문 Table 14 (eq 35) · config/appendix_d_resolved.yaml",
        "as_of": "논문 2025-02 · 상수",
        "fetched": False,
        "effect": "level_only",
        "effect_note": "r* 와 같은 이유로 편차에는 영향이 없어요. 다만 "
                       "필립스 어트랙터(eq 24)를 통해 **물가 손잡이를 놓았을 "
                       "때**의 경로 모양에는 들어가요.",
    })

    # ── 받아는 오지만 기저가 안 쓰는 것 ────────────────────────────────────
    if offline:
        us = (None, None, f"{UNREACHABLE} — 오프라인 빌드예요")
        oil = (None, None, f"{UNREACHABLE} — 오프라인 빌드예요")
    else:
        us = _fred_latest("DFEDTARU")
        oil = _fred_latest("DCOILBRENTEU")

    items.append({
        "key": "us_policy",
        "label": "미 정책금리",
        "value": us[0], "unit": "%",
        "source": us[2],
        "as_of": us[1],
        "fetched": us[0] is not None,
        "effect": "not_in_basis",
        "effect_note": "**수준**이에요. 기저가 담은 건 «미국이 +100bp 가면» "
                       "이라는 충격이라, 이 값은 화면 숫자에 안 들어가요. "
                       "선도 경로(SEP 닷·SOFR 선물)는 받을 데가 없어요.",
    })
    items.append({
        "key": "oil",
        "label": "유가 (브렌트)",
        "value": oil[0], "unit": "달러",
        "source": oil[2],
        "as_of": oil[1],
        "fetched": oil[0] is not None,
        "effect": "not_in_basis",
        "effect_note": "**현물**이에요. 기저가 담은 건 «유가가 +10% 가면» "
                       "이라는 충격이고요. 선물 커브는 FRED 에 없어요.",
    })
    items.append({
        "key": "foreign_growth",
        "label": "해외 성장",
        "value": None, "unit": None,
        "source": f"{UNREACHABLE} — 컨센서스는 유료예요. 엔진은 HP 추세를 써요",
        "as_of": None,
        "fetched": False,
        "effect": "not_in_basis",
        "effect_note": "해외 블록은 논문도 외생으로 둬요(각주 9 — 국제국 "
                       "성장 전망을 그대로 받아 써요).",
    })
    return items


def build_assumptions(basis_as_of: str, data_edge_q: str,
                      offline: bool = False) -> dict:
    """`assumptions.json` 페이로드. 기저와 함께 쓰여야 어긋나지 않는다."""
    items = collect(offline=offline)
    return {
        "module": "assumptions",
        "basis_as_of": basis_as_of,
        "data_edge_q": data_edge_q,
        "written_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "headline": (
            "이 화면의 bp 는 **정책금리 경로 하나**가 만들어요. 아래 값들은 "
            "모형이 딛고 선 가정이고, 그중 기저에 실제로 들어간 건 상수 둘뿐"
            "이에요."),
        "items": items,
    }


def validate(payload: dict) -> None:
    """출처 없는 칸이 하나라도 있으면 **빌드를 세운다**(빈칸으로 렌더 금지)."""
    required = {"key", "label", "source", "effect", "effect_note"}
    for it in payload["items"]:
        missing = required - set(it)
        if missing:
            raise ValueError(f"assumptions 항목 {it.get('key')!r} 에 "
                             f"{sorted(missing)} 가 없어요")
        if not it["source"]:
            raise ValueError(f"assumptions 항목 {it['key']!r} 에 출처 문장이 "
                             "없어요 — 빈칸으로 렌더하느니 빌드를 세워요")
        if it["effect"] not in {"delta", "level_only", "not_in_basis"}:
            raise ValueError(f"{it['key']!r} 의 effect 가 이상해요: "
                             f"{it['effect']!r}")
