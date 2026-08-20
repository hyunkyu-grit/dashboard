"""한국은행 ECOS Open API — 기준금리의 출처 [OWNER, 2026-08-20].

## 왜 여기로 왔나

조달 기준을 한국은행 기준금리로 두기로 했는데 [OWNER, 2026-08-20], 그때까지
쓰던 두 출처가 **둘 다 낡아 있었다**. 2026-08-20 실측:

    SQL `infomax.기준금리`   2026-03-21 에서 멈춤, 마지막 2.50%
                             → 2026-07-16 인상(2.50→2.75%)이 **없다**
    `data/bokbaserate.xlsx`  2026-07-16 까지, 마지막 2.75%
                             → 값은 맞지만 갱신이 사람 손에 달려 있다
    **ECOS**                 2026-08-17 까지, 마지막 2.75%  ← 인상이 있고 신선하다

멈춘 계단을 평탄 연장하면 7월 이후 조달이 25bp 낮게 잡힌다 — 화면 어디에도 안
보이는 방식으로. 그래서 출처를 발표 기관 자신으로 옮긴다.

## 시리즈 코드는 추측이 아니다

    722Y001 / D / 0101000   한국은행 기준금리 (연%), 1999-05-06 ~

`project_bigfoot/bigfoot/data/ecos.py` 가 2026-08-05 에 StatisticTableList /
StatisticItemList 카탈로그 검색으로 확인해 둔 코드다. 이 파일은 그 코드를 그대로
쓰고, 응답의 `ITEM_NAME1` 이 "한국은행 기준금리" 인지 한 번 더 확인한다 — 코드가
바뀌는 날 조용히 다른 시리즈를 읽는 것을 막는다.

## 네트워크를 요청마다 타지 않는다

기준금리는 하루에 한 번도 안 바뀌는 값이다. 응답을 디스크에 적어 두고
`CACHE_TTL_HOURS` 안에는 그것을 읽는다. 망이 끊기면 **낡은 캐시라도 쓴다** —
그 편이 화면이 서는 것보다 낫고, 얼마나 낡았는지는 `provenance` 가 말한다.

## 키

`ECOS_API_KEY`. 기본값은 없다 — `mysqldb` 와 같은 규칙이다. 없으면 base 기준이
이름을 대며 죽고, 화면은 콜금리로 바꾸라고 말한다.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("app.ecos")

API_ROOT = "https://ecos.bok.or.kr/api"

#: 한국은행 기준금리(일별). 카탈로그 검증 코드 — 위 주석 참조.
BASE_RATE_STAT = "722Y001"
BASE_RATE_CYCLE = "D"
BASE_RATE_ITEM = "0101000"
BASE_RATE_START = "19990506"

#: 응답에 이 이름이 없으면 코드가 다른 시리즈를 가리키게 된 것이다.
BASE_RATE_ITEM_NAME = "한국은행 기준금리"

CACHE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "ecos-base-rate.json"
CACHE_TTL_HOURS = 12

#: 한 번에 받는 행 수. ECOS 는 페이지당 상한이 있어 나눠 받는다.
PAGE = 1000


class EcosError(RuntimeError):
    """ECOS 에서 기준금리를 가져오지 못했다."""


def api_key() -> str:
    key = (os.getenv("ECOS_API_KEY") or "").strip()
    if not key:
        raise EcosError(
            "ECOS_API_KEY 가 없습니다. 한국은행 ECOS Open API 키를 백엔드 셸에 "
            "설정하세요(.env.example 에 이름이 있습니다). 기본값은 두지 않습니다."
        )
    return key


def _fetch_page(
    key: str,
    stat: str,
    cycle: str,
    item: str,
    start: str,
    end: str,
    first: int,
    last: int,
) -> dict:
    url = (
        f"{API_ROOT}/StatisticSearch/{key}/json/kr/{first}/{last}/"
        f"{stat}/{cycle}/{start}/{end}/{item}"
    )
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise EcosError(f"ECOS 요청 실패: {exc}") from exc
    if "StatisticSearch" not in payload:
        # ECOS 는 오류도 200 으로 준다. 몸통 모양이 판별이다.
        raise EcosError(f"ECOS 응답에 StatisticSearch 가 없습니다: {str(payload)[:200]}")
    return payload["StatisticSearch"]


def fetch_series(
    stat: str,
    cycle: str,
    item: str,
    start: str,
    end: str | None = None,
    expect_name: str | None = None,
) -> list[dict]:
    """ECOS 계열 하나를 `{TIME, DATA_VALUE}` 행으로. 페이지를 이어 받는다.

    `expect_name` 은 응답의 `ITEM_NAME1` 에 들어 있어야 하는 조각이다. 코드가
    가리키는 계열이 바뀌면 **숫자는 멀쩡한데 뜻이 달라진다** — 그건 화면에서
    안 보이므로 여기서 막는다(기준금리가 이미 쓰던 규율이다).
    """
    key = api_key()
    end = end or _default_end(cycle)
    rows: list[dict] = []
    first = 1
    while True:
        block = _fetch_page(key, stat, cycle, item, start, end, first, first + PAGE - 1)
        page = block.get("row") or []
        if page and expect_name and expect_name not in str(page[0].get("ITEM_NAME1") or ""):
            raise EcosError(
                f"ECOS 시리즈가 기대와 다릅니다: {page[0].get('ITEM_NAME1')!r} "
                f"(코드 {stat}/{item} 이 {expect_name!r} 를 가리키지 않습니다)"
            )
        rows += page
        total = int(block.get("list_total_count") or 0)
        if first + PAGE - 1 >= total or not page:
            break
        first += PAGE
    if not rows:
        raise EcosError(f"ECOS 가 {stat}/{item} 행을 하나도 주지 않았습니다.")
    return [{"TIME": r["TIME"], "DATA_VALUE": r["DATA_VALUE"]} for r in rows]


def _default_end(cycle: str) -> str:
    """주기마다 끝값의 모양이 다르다 — 일별은 `YYYYMMDD`, 분기는 `YYYYQ4`."""
    y = dt.date.today().year + 1
    if cycle == "D":
        return f"{y}1231"
    if cycle == "M":
        return f"{y}12"
    if cycle == "Q":
        return f"{y}Q4"
    return str(y)


def fetch_rows(end: str | None = None) -> list[dict]:
    """기준금리 행 전부."""
    return fetch_series(
        BASE_RATE_STAT,
        BASE_RATE_CYCLE,
        BASE_RATE_ITEM,
        BASE_RATE_START,
        end,
        expect_name=BASE_RATE_ITEM_NAME,
    )


def _cache_age_hours(payload: dict) -> float | None:
    stamp = payload.get("retrieved_at")
    if not stamp:
        return None
    try:
        got = dt.datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return (dt.datetime.now() - got).total_seconds() / 3600.0


def _read_cache() -> dict | None:
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_cache(rows: list[dict]) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(
            json.dumps(
                {"retrieved_at": dt.datetime.now().isoformat(timespec="seconds"), "rows": rows},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except OSError as exc:  # 캐시를 못 써도 값은 이미 손에 있다
        log.warning("ECOS 캐시를 못 썼습니다: %s", exc)


def base_rate_series() -> list[tuple[dt.date, float]]:
    """(날짜, decimal) 오름차순. ECOS 는 연% 로 주므로 100 으로 나눈다.

    캐시가 신선하면 망을 안 탄다. 망이 끊기면 낡은 캐시라도 쓴다 — 화면이 서는
    것보다 낫고, 얼마나 낡았는지는 로그와 `provenance` 가 말한다.
    """
    cached = _read_cache()
    age = _cache_age_hours(cached) if cached else None
    if cached and age is not None and age < CACHE_TTL_HOURS:
        return _parse(cached["rows"])

    try:
        rows = fetch_rows()
    except EcosError as exc:
        if cached:
            log.warning("ECOS 갱신 실패(%s) — 캐시로 진행합니다(%.1f시간 전).", exc, age or -1)
            return _parse(cached["rows"])
        raise
    _write_cache(rows)
    return _parse(rows)


def _parse(rows: list[dict]) -> list[tuple[dt.date, float]]:
    out: list[tuple[dt.date, float]] = []
    for r in rows:
        t, v = r.get("TIME"), r.get("DATA_VALUE")
        if not t or v in (None, "", "-"):
            continue
        try:
            d = dt.date(int(t[0:4]), int(t[4:6]), int(t[6:8]))
            out.append((d, float(v) / 100.0))
        except (ValueError, IndexError):
            continue
    if not out:
        raise EcosError("ECOS 응답을 날짜/값으로 읽지 못했습니다.")
    out.sort(key=lambda x: x[0])
    return out


def cache_stamp() -> str | None:
    """캐시를 언제 받았는지. 화면의 출처 표시가 읽는다."""
    cached = _read_cache()
    return cached.get("retrieved_at") if cached else None
