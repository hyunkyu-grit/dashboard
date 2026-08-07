"""MySQL 연결 확인 — 붙는지, 무엇이 오는지, xlsx 와 어긋나는지.

    cd backend && python scripts/check_mysql.py

읽기만 한다. 이 스크립트가 초록이면 `app.mysqldb` 가 실제로 데이터를 가져온다는
뜻이고, 마지막 절이 **xlsx 를 대체할 수 있느냐**에 답한다 — 두 출처가 겹치는
날짜에서 같은 숫자를 말하는지 비교한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.dataset import load_dataset  # noqa: E402
from app.mysqldb import (  # noqa: E402
    IRS_CLOSE_TABLE,
    WriteAttempted,
    irs_close_rows,
    read_sql,
    watermark,
)

#: DB 컬럼 → 이 앱의 테너 id. `_tenor_id()` 가 엑셀 라벨에 하는 일을 컬럼명에
#: 대해 하는 것이고, 매핑이 1:1 이라 함수가 아니라 표다.
COLUMN_TENOR = {
    "call_rate": "1D",   # 콜금리
    "cd_rate": "3M",     # CD 91일 — 스펙의 3M 노드 (IRS 3M = CD91)
    "irs_6m": "6M",
    "irs_9m": "9M",
    "irs_1y": "1Y",
    "irs_18m": "1.5Y",
    "irs_2y": "2Y",
    "irs_3y": "3Y",
    "irs_4y": "4Y",
    "irs_5y": "5Y",
    "irs_6y": "6Y",
    "irs_7y": "7Y",
    "irs_8y": "8Y",
    "irs_9y": "9Y",
    "irs_10y": "10Y",
}


def main() -> int:
    print("── 연결 ─────────────────────────────────────────")
    v = read_sql("SELECT VERSION() AS v, DATABASE() AS db")[0]
    print(f"  {v.v} · {v.db}")

    print("\n── 읽기 전용인가 ────────────────────────────────")
    try:
        read_sql(f"UPDATE {IRS_CLOSE_TABLE} SET cd_rate = 0")
        print("  ✗ 쓰기가 통과했다 — read_sql 의 검사가 깨졌다")
        return 1
    except WriteAttempted as e:
        print(f"  ✓ 쓰기 차단: {str(e).splitlines()[0]}")

    print("\n── 워터마크 (캐시 키가 될 값) ───────────────────")
    d, n = watermark()
    print(f"  마지막 날짜 {d} · {n}행")

    print("\n── 가져온 데이터 ────────────────────────────────")
    rows = irs_close_rows()
    print(f"  {len(rows)}행, {rows[0]['irs_date']} … {rows[-1]['irs_date']}")
    missing = [c for c in COLUMN_TENOR if c not in rows[-1]]
    if missing:
        print(f"  ✗ 없는 컬럼: {missing}")
        return 1
    print(f"  컬럼 {len(COLUMN_TENOR)}개 전부 있음 → 테너 "
          f"{', '.join(COLUMN_TENOR.values())}")

    print("\n── xlsx 와 대조 ─────────────────────────────────")
    xlsx = REPO / "data" / "irsdata.xlsx"
    if not xlsx.exists():
        print(f"  (없음: {xlsx})")
        return 0
    ds = load_dataset(xlsx)
    print(f"  xlsx asof {ds.asof} · {len(ds.dates)}행")
    print(f"  db  마지막 {rows[-1]['irs_date']} · {len(rows)}행")

    by_date = {r["irs_date"]: r for r in rows}
    checked = diff = 0
    worst: tuple[float, str] = (0.0, "")
    for i, day in enumerate(ds.dates):
        r = by_date.get(day)
        if r is None:
            continue
        for col, tenor in COLUMN_TENOR.items():
            a, b = ds.series.get(tenor, [None] * len(ds.dates))[i], r[col]
            if a is None or b is None:
                continue
            checked += 1
            gap = abs(a - b)
            if gap > 1e-9:
                diff += 1
                if gap > worst[0]:
                    worst = (gap, f"{day} {tenor}: xlsx {a} vs db {b}")
    only_xlsx = [d for d in ds.dates if d not in by_date]
    print(f"  겹치는 날 {len(ds.dates) - len(only_xlsx)}일 · 값 {checked}개 비교")
    print(f"  불일치 {diff}개" + (f" · 최대 {worst[1]}" if diff else " ✓"))
    if only_xlsx:
        print(f"  xlsx 에만 있는 날 {len(only_xlsx)}일 "
              f"({only_xlsx[0]} … {only_xlsx[-1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
