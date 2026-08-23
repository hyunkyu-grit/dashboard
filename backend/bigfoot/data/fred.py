# -*- coding: utf-8 -*-
"""FRED loader — same cache pattern as the ECOS loader. Used from Phase 2 for
US-side series; plain requests against the FRED REST API (no fredapi dep)."""
import os
from datetime import date
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"


class FredDataError(RuntimeError):
    """FRED 계열을 API 로도 캐시로도 못 얻었다.

    `bigfoot/data/ecos.py::EcosDataError` 와 같은 이유로 같은 모양이다 —
    `sys.exit` 는 `SystemExit` 라 인-프로세스 호출자가 못 잡는다.
    """


def _api_key() -> str:
    key = os.environ.get("FRED_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("FRED_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise FredDataError("FRED_API_KEY not set (env var or .env)")


def fetch_fred(series_id: str) -> pd.Series:
    """Fetch a FRED series (cached to data/raw/fred_<id>.csv, offline fallback)."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache = RAW_DIR / f"fred_{series_id}.csv"
    if os.environ.get("BIGFOOT_OFFLINE") != "1":
        try:
            r = requests.get(FRED_BASE, params={
                "series_id": series_id, "api_key": _api_key(),
                "file_type": "json"}, timeout=30)
            obs = r.json()["observations"]
            df = pd.DataFrame(obs)[["date", "value"]]
            df["retrieved_at"] = date.today().isoformat()
            df.to_csv(cache, index=False)
        except (requests.RequestException, KeyError, RuntimeError) as e:
            # `RuntimeError` 가 있는 이유: 키가 없는 것(`FredDataError`)도
            # 네트워크가 막힌 것과 같은 등급이다. 캐시가 있으면 굽는다.
            print(f"[warn] fetch failed for fred:{series_id} ({e}); "
                  "using cache")
    if not cache.exists():
        raise FredDataError(
            f"no cache for FRED {series_id} and API unavailable")
    df = pd.read_csv(cache)
    s = pd.Series(pd.to_numeric(df["value"], errors="coerce").values,
                  index=pd.to_datetime(df["date"]))
    return s.dropna()
