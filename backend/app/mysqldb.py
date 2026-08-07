"""IRS 종가의 두 번째 출처 — MySQL(MariaDB) `sim_portfolio` [OWNER, 2026-08-07].

CLAUDE.md 가 예고해 둔 이동이다: "Both halves move onto MySQL — the existing
database at miraebond2.kro.kr:4004". 이 파일은 그 첫 조각이고, **읽기 전용**이다.

## 읽기 전용이라는 말의 뜻

권한 이야기가 아니라 **코드 이야기**다. 이 모듈에는 INSERT/UPDATE/DELETE 를 낼
길이 없다 — `read_sql()` 하나만 내보내고, 그 함수는 `SELECT` 또는 `SHOW` 로
시작하지 않는 문장을 거부한다. 커넥션도 `autocommit=True` 로 열어 트랜잭션을
쌓지 않는다. 나중에 누가 쓰기를 붙이려면 이 파일을 고쳐야 하고, 그 diff 는
리뷰에서 보인다.

## 왜 SQLAlchemy 인가

풀 때문이다. FastAPI 워커가 넷이고 각 요청이 커브를 만들 때마다 연결을 새로
열면, 원격 MariaDB 왕복(수십 ms)이 캐시 미스마다 붙는다. `QueuePool` 이 연결을
재사용하고 `pool_pre_ping` 이 끊긴 연결을 조용히 되살린다 — 이 DB 는 사무실
네트워크 너머에 있어서 유휴 연결이 죽는다.

## 접속 정보를 코드에 두는 것에 대해

[OWNER, 2026-08-07 — "코드에 상수로 하드코딩해도 됨"]. read-only 계정이고 이
리포는 리모트가 하나(비공개)라 그 판단을 따른다. 다만 **환경변수가 있으면
그쪽이 이긴다** — 배포에서 계정을 바꿀 때 코드를 고치지 않아도 되는 값싼
탈출구이고, 하드코딩을 없애는 것이 아니라 덮을 수 있게 두는 것뿐이다.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Sequence

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, Row

log = logging.getLogger("app.mysqldb")

# [OWNER, 2026-08-07] read-only 계정. 환경변수가 있으면 그쪽이 이긴다.
HOST = os.getenv("BW_MYSQL_HOST", "miraebond2.kro.kr")
PORT = int(os.getenv("BW_MYSQL_PORT", "4004"))
USER = os.getenv("BW_MYSQL_USER", "bondman")
PASSWORD = os.getenv("BW_MYSQL_PASSWORD", "dws4004!")
DATABASE = os.getenv("BW_MYSQL_DB", "sim_portfolio")

#: IRS 종가 테이블. 같은 스키마에 이름이 뒤집힌 `irs_mkt_close` 도 있는데 그건
#: 이 테이블이 아니다 — 오너가 지목한 것은 `mkt_irs_close` 다.
IRS_CLOSE_TABLE = "mkt_irs_close"

_engine: Engine | None = None


def engine() -> Engine:
    """풀을 든 엔진 하나. 첫 호출에서 만들고 그다음부터 재사용한다."""
    global _engine
    if _engine is None:
        url = (
            f"mysql+pymysql://{USER}:{PASSWORD}@{HOST}:{PORT}/{DATABASE}"
            "?charset=utf8mb4"
        )
        _engine = create_engine(
            url,
            pool_size=5,
            max_overflow=5,
            pool_recycle=1800,   # 원격이라 유휴 연결이 죽는다
            pool_pre_ping=True,  # 죽은 연결을 조용히 되살린다
            future=True,
            # 트랜잭션을 쌓지 않는다. 읽기만 하므로 열어 둘 이유가 없고,
            # 열어 두면 MariaDB 쪽에 유휴 트랜잭션이 남는다.
            connect_args={"autocommit": True},
        )
        log.info("mysql engine: %s@%s:%s/%s", USER, HOST, PORT, DATABASE)
    return _engine


class WriteAttempted(RuntimeError):
    """읽기 전용 헬퍼로 쓰기를 시도했다."""


_ALLOWED = ("select", "show", "describe", "explain", "with")


def read_sql(sql: str, params: dict[str, Any] | None = None) -> Sequence[Row[Any]]:
    """읽기 전용 질의. `SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN`/`WITH` 만 통과한다.

    이 검사는 보안 장치가 아니다 — 계정 권한이 그 일을 한다. 이건 **실수
    장치**다: 나중에 누가 이 헬퍼로 UPDATE 를 보내려 하면 런타임에 걸리고,
    그 시점에 "이 모듈은 읽기 전용" 이라는 결정을 다시 만나게 된다.
    """
    head = sql.lstrip().split(None, 1)[0].lower() if sql.strip() else ""
    if head not in _ALLOWED:
        raise WriteAttempted(
            f"read_sql 은 {'/'.join(_ALLOWED)} 만 받는다 (받은 것: {head!r}). "
            "이 DB 는 읽기 전용으로 붙어 있다."
        )
    with engine().connect() as cx:
        return cx.execute(text(sql), params or {}).fetchall()


def watermark() -> tuple[str, int]:
    """(마지막 날짜, 행 수) — **디스크 캐시의 키**로 쓸 값.

    CLAUDE.md 가 이 이동에서 잊지 말라고 못 박은 것이 정확히 이것이다:

        `app/cache.py` keys the disk cache on a HASH OF THE XLSX BYTES. With
        the source in MySQL that key has nothing to hash, and a cache keyed to
        the wrong data is worse than no cache.

    바이트가 없으므로 **테이블 워터마크**가 그 자리를 대신한다. 행이 늘거나
    마지막 날짜가 밀리면 키가 바뀌고 캐시가 무효가 된다.

    이 테이블에는 `updated_at` 이 없어서(스키마 확인 2026-08-07: 컬럼이
    irs_date + 15개 값뿐, PK 도 인덱스도 없다) 과거 행이 **조용히 수정되는**
    경우는 이 워터마크가 못 잡는다. 잡으려면 값 전체의 해시가 필요하고 그건
    2,618행 × 16열을 매번 읽는 일이다 — 그 비용을 치를지는 별도 판단이라
    여기서는 사실만 적어 둔다. [미해결]
    """
    row = read_sql(
        f"SELECT MAX(irs_date) AS d, COUNT(*) AS n FROM {IRS_CLOSE_TABLE}"
    )[0]
    return (str(row.d), int(row.n))


def irs_close_rows() -> list[dict[str, Any]]:
    """`mkt_irs_close` 전량, **날짜 오름차순**.

    오름차순인 이유: `Dataset` 이 그 순서를 요구하고(`dates` ascending,
    `asof = dates[-1]`), 로더가 순서를 검사한다. 정렬을 여기서 해 두면 그
    검사가 DB 쪽 실수도 같이 잡는다.

    2,618행 × 16열이라 전량을 한 번에 읽어도 몇 백 KB다. 페이지네이션을 두면
    커브 부트스트랩이 여러 왕복으로 갈라져서 오히려 느려진다.
    """
    rows = read_sql(f"SELECT * FROM {IRS_CLOSE_TABLE} ORDER BY irs_date ASC")
    return [dict(r._mapping) for r in rows]
