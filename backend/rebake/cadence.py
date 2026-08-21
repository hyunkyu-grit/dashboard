# -*- coding: utf-8 -*-
"""리베이크 케이던스 — 언제 다시 굽나.

## 왜 이벤트 구동인가

리베이크 실측이 **10.8초**다(온라인, 2026-08-21). 야간 배치를 돌릴 이유가 없다.
발표 직후에 굽고 그 사이에는 아무것도 안 한다.

## 굽는다고 «숫자가 새로 온다» 는 뜻이 아니다 — 화면이 이걸 뒤집으면 안 된다

기저는 **편차 공간의 단위 충격 15개**다. 리베이크가 실제로 갱신하는 것은 딱
두 가지다(`foundation_diagnosis.md` §C.8 의 open 추적으로 실측):

    지출 비중 z_C·z_I·z_IH·z_G·z_X   ECOS 국민계정에서 계산 — 분기물
    위성 VAR                          근원CPI·콜금리·실질GDP 로 추정 — 분기물

둘 다 **분기 데이터**다. 그래서 MPC 날짜에 굽는 것은 «달력을 맞추는 일»이지
«새 숫자를 받는 일»이 아니다. 분기 국민계정이 확정될 때에야 기저가 실제로
움직인다. `engine_status.json` 의 `data_edge_q` 가 그 사실을 진다.

## 달력의 출처

MPC 는 이 리포가 이미 갖고 있다 — `app/policy.py::MPC_DATES` 가 정본이고
`app/reserve.py::MPC_IN_TABLE` 이 한은 연간 PDF 원문으로 그것을 8/8 검증한다.
**두 번째 출처를 만들지 않는다.**

FOMC 와 CPI 는 **이 리포 어디에도 없다.** 지어내지 않는다 — 빈 채로 두고
`engine_status.json` 이 «이 달력이 없어요» 라고 말한다. 날짜를 상상해서 넣으면
그 순간부터 화면이 틀린 «다음 이벤트» 를 자신 있게 표시한다.
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.issuance_gloss import to_haeyo  # noqa: E402  받침 산술 한 벌만 쓴다
from app.policy import MPC_DATES  # noqa: E402  정본 — 사본을 만들지 않는다


class Calendar:
    """이벤트 하나의 출처와 날짜. 출처 없는 달력은 만들지 않는다."""

    def __init__(self, key: str, label: str, source: str,
                 dates: list[dt.date] | None):
        self.key = key
        self.label = label
        self.source = source
        #: `None` 은 «날짜가 없는 게 아니라 **출처가 없다**» 는 뜻이다.
        self.dates = dates

    @property
    def available(self) -> bool:
        return self.dates is not None

    def next_after(self, today: dt.date) -> dt.date | None:
        if not self.dates:
            return None
        later = [d for d in self.dates if d > today]
        return min(later) if later else None


#: FOMC·CPI 는 출처가 없다. 상수 테이블을 지어내는 것이 제일 쉬운 유혹이고,
#: 그래서 여기 이름을 달아 막아 둔다. 채우려면 한은 연간 PDF 를 읽은
#: `app/reserve.py` 와 **같은 방식**으로 — 원문을 소비해 검증하고 — 채운다.
SOURCE_NEEDED = "출처 미확보"


def calendars() -> list[Calendar]:
    return [
        Calendar("mpc", "금통위",
                 "app/policy.py::MPC_DATES (calendar.json 사본, "
                 "app/reserve.py 가 한은 연간 PDF 로 8/8 검증)",
                 list(MPC_DATES)),
        Calendar("fomc", "FOMC", SOURCE_NEEDED, None),
        Calendar("cpi", "소비자물가 공표", SOURCE_NEEDED, None),
    ]


def next_event(today: dt.date | None = None) -> dict:
    """다음 리베이크 트리거. 달력이 하나라도 비면 그 사실을 같이 돌려준다."""
    today = today or dt.date.today()
    cals = calendars()
    hits = [(c, c.next_after(today)) for c in cals]
    live = [(c, d) for c, d in hits if d is not None]
    missing = [c.key for c in cals if not c.available]

    if not live:
        return {"date": None, "kind": None, "label": None,
                "missing_calendars": missing,
                "note": "다음 이벤트를 모르겠어요 — 달력이 없어요."}

    cal, when = min(live, key=lambda p: p[1])
    return {
        "date": when.isoformat(),
        "kind": cal.key,
        "label": cal.label,
        "source": cal.source,
        "missing_calendars": missing,
        # 「금통위이에요」 가 아니라 「금통위예요」 — 받침이 어미를 가른다.
        # 그 산술은 `app/issuance_gloss.to_haeyo` 에 이미 한 벌 있다.
        "note": (to_haeyo(f"다음은 {when.isoformat()} {cal.label}입니다.")
                 + (f" 다만 {', '.join(missing)} 달력이 없어서 그 사이에 더 "
                    "이른 이벤트가 있을 수 있어요."
                    if missing else "")),
    }


def is_due(basis_as_of: dt.date, today: dt.date | None = None) -> bool:
    """마지막으로 구운 뒤로 이벤트가 지났나.

    **달력이 없는 이벤트는 못 센다.** 그래서 이 함수가 `False` 를 돌려준다고
    «최신» 이라는 뜻이 아니고, `engine_status` 가 `missing_calendars` 를 같이
    실어야 하는 이유가 그것이다.
    """
    today = today or dt.date.today()
    for c in calendars():
        for d in (c.dates or []):
            if basis_as_of < d <= today:
                return True
    return False
