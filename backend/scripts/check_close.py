"""아침 자동 굽기의 눈 — 오늘이 영업일인지, 전일 종가가 어디까지 와 있는지.

    python backend/scripts/check_close.py            # 사람이 읽는 한 줄씩
    python backend/scripts/check_close.py --json     # 오케스트레이터용

판정만 하고 아무것도 바꾸지 않는다. ops/morning_bake.ps1 이 이 출력을 읽어
기다릴지, 엑셀을 깨울지, 구울지를 정한다 [OWNER, 2026-08-11].

내보내는 상태:

  businessDay   오늘(서울)이 한국 영업일인가 — 아니면 아침 루프 전체가 no-op
  expected      기대하는 전일 종가의 날짜 (직전 영업일)
  sql.status    full | missing-1d | partial | absent | error
                partial 은 "기대일 행은 있는데 1D 외의 노드가 빈" 상태 —
                적재가 진행 중일 수 있으니 기다리는 쪽으로 읽어야 한다
  xlsx.status   fresh | stale | missing | error
                fresh = 기대일 행이 있고 값이 수치다 (전일종가 컷 뒤 기준)

종료 코드는 늘 0 이다 — 이 스크립트의 실패는 JSON 의 error 로 말한다.
파싱하는 쪽이 예외 스택을 상태로 오독하는 것보다 낫다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.dataset import (  # noqa: E402
    DEFAULT_XLSX,
    SQL_COLUMN_TENOR,
    load_dataset,
    market_today,
    prev_kr_business_day,
)


def sql_state(expected: dt.date) -> dict:
    try:
        from app.mysqldb import IRS_CLOSE_TABLE, read_sql

        rows = read_sql(
            f"SELECT * FROM {IRS_CLOSE_TABLE} WHERE irs_date = :d",
            {"d": expected.isoformat()},
        )
    except Exception as e:  # noqa: BLE001 — DB 다운도 상태다
        return {"status": "error", "detail": str(e)[:200]}

    if not rows:
        return {"status": "absent"}
    r = dict(rows[0]._mapping)
    missing = [t for c, t in SQL_COLUMN_TENOR.items() if r.get(c) is None]
    if not missing:
        return {"status": "full"}
    if missing == ["1D"]:
        return {"status": "missing-1d"}
    return {"status": "partial", "missing": sorted(missing)}


def xlsx_state(expected: dt.date, today: dt.date) -> dict:
    if not DEFAULT_XLSX.exists():
        return {"status": "missing"}
    try:
        ds = load_dataset(DEFAULT_XLSX, today)  # 전일종가 컷 포함 — 서버와 같은 눈
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "detail": str(e)[:200]}
    newest = ds.asof
    if newest < expected:
        return {"status": "stale", "newest": newest.isoformat()}
    # 기대일 행이 있어도 1D 가 비었으면 보충 소스 역할을 못 한다 — 적어 둔다.
    blank = [t for t in ds.series if ds.latest(t) is None]
    out: dict = {"status": "fresh", "newest": newest.isoformat()}
    if blank:
        out["blankAtNewest"] = sorted(blank)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    from app.engine_port import _is_kr_business_day

    today = market_today()
    business = _is_kr_business_day(today)
    report: dict = {
        "today": today.isoformat(),
        "businessDay": business,
    }
    if business:
        expected = prev_kr_business_day(today)
        report["expected"] = expected.isoformat()
        report["sql"] = sql_state(expected)
        report["xlsx"] = xlsx_state(expected, today)

    if a.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        for k, v in report.items():
            print(f"{k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
