# -*- coding: utf-8 -*-
"""원화 채권 **발행** 캘린더 — Lab 의 세 번째 세입자.

`Codex/rawData` 의 이식이다. 그 리포의 `PRODUCT.md` 가 처음부터 이 이사를 적어
두었다("같은 화면이 곧 Sauron 연구실 탭으로 이식된다").

## 발행만 본다 [OWNER, 2026-08-20]

원본도 그렇다(`src/payload.py::day_detail` — "만기도래는 내보내지 않는다"). 만기
스케줄은 CSV 에 남아 있고 되살릴 일이 생기면 그때 여기만 되돌리면 된다.

## 수집은 안 옮겼다

수집기는 외부 사이트를 긁고 분 단위로 걸린다. 원본이 "수집과 서빙을 한 프로세스에
두지 않는다" 를 규칙으로 세웠고 그 규칙을 그대로 가져왔다 — `rawDataWatch`(평일
5분)와 `rawDataFullCollect`(평일 07:30)가 이미 CSV 를 새로 쓰고 있으므로, 이
모듈은 **읽기만** 한다. 파일 mtime 이 캐시 키라서 CSV 가 새로 쓰이면 다음 요청이
알아서 읽는다.

## 스크래핑도 안 옮겼다 [v1 판정]

원본의 정책 4레인(국고채 일정·금통위·지준·통안 계획)은 HTML 을 긁는다. 요청
경로에 두면 3개월치에 8초가 걸려서 원본은 기동 때 예열한다. 이 판은 그 넷을 다
빼고 **CSV 에 있는 것만** 쓴다:

    발행 파이프라인   issuance_pipeline.csv   DART 신고 — 공시된 것까지
    국고채 입찰       ktb_auction.csv          기재부 결과 — 나온 것까지
    공개시장운영      omo.csv                  한은 RSS
    금통위            `src/data/calendar.json`  ← **여기만 다르다**

금통위는 CSV(`mpc.csv`)에도 있지만 그건 **결정 결과**(인상/인하/변동폭)이고,
**일정**은 v2 의 손으로 검증한 달력이 유일한 출처다. 원본의 스크래퍼는 페이지에
없는 연도를 요청 연도로 찍는 결함이 있어(실측 2026-08-20: `mpc_meetings(2027)`
이 2026 과 글자 하나 안 다른 8건을 돌려줬다) 더더욱 그렇다.

그래서 앞날의 국고채 입찰 **예정**은 이 판에 없다. 결과가 나온 것까지만 보인다 —
화면이 그렇게 말한다.

## 시야가 두 칸 다르다

원본의 문장 그대로다: 발행 칸의 빈자리는 *'없음'이 아니라 '아직 공시 안 됨'* 이다.
은행채·여전채에는 발행계획이라는 것이 존재하지 않는다(민간 발행자에게 사전 공표
의무가 없다). DART 가 하루짜리 예고를 얹을 뿐이다.
"""

from __future__ import annotations

import csv
import datetime as dt
import functools
import os
import pathlib

from .engine_port import _is_kr_business_day, _next_business_day
from .issuance_strength import annotate as annotate_auctions

#: CSV 가 사는 곳. 수집기가 쓰는 그 디렉터리를 그대로 읽는다.
#: 없으면 이 화면만 서지 않고 나머지 앱은 멀쩡히 돈다.
DATA_DIR = pathlib.Path(
    os.environ.get("RAWDATA_DIR", r"C:\Users\infomax\Desktop\Codex\rawData\data")
)

#: 달력이 세는 섹터. 앞의 일곱이 금융채, 뒤의 셋이 DART C002 에 같이 올라오는
#: 것들이다(공사채·리츠·기타). 순서가 곧 화면 순서다 — 원본과 같다.
SECTORS = [
    "은행", "카드", "캐피탈", "증권", "지주", "보험", "기타금융",
    "공사", "리츠", "기타",
]
NONFIN = {"공사", "리츠", "기타"}

JO = 1e12  # 조원

FILES = {
    "pipeline": "issuance_pipeline.csv",
    "ktb": "ktb_auction.csv",
    "omo": "omo.csv",
    "mpc": "mpc.csv",
}


class IssuanceUnavailable(RuntimeError):
    """CSV 를 못 읽는다. 화면이 이유를 말할 수 있게 경로를 담아 던진다."""


def _path(key: str) -> pathlib.Path:
    return DATA_DIR / FILES[key]


def data_stamp() -> float:
    """캐시 키. 수집기가 CSV 를 새로 쓰면 값이 바뀌고 다음 요청이 다시 읽는다."""
    stamps = []
    for k in FILES:
        p = _path(k)
        if not p.exists():
            raise IssuanceUnavailable(f"{p} 가 없어요")
        stamps.append(p.stat().st_mtime)
    return max(stamps)


def _read(key: str) -> list[dict]:
    """CSV 한 장. `utf-8-sig` 는 수집기가 그렇게 쓰기 때문이다(BOM)."""
    with _path(key).open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _num(x) -> float | None:
    if x is None:
        return None
    s = str(x).strip().replace(",", "")
    if not s or s.lower() in {"nan", "none"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _date(x) -> dt.date | None:
    s = str(x or "").strip()[:10]
    if len(s) != 10:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def _adjust(d: dt.date) -> dt.date:
    """Following. 규약은 추측이 아니라 신고서 본문에 적혀 있다(원본 README) —
    상환기일이 휴업일이면 다음 첫 영업일로 미루고 그날까지의 이자를 준다.

    Modified Following 이 아니다. 월말을 넘겨도 그냥 다음 영업일로 민다."""
    return _next_business_day(d)


@functools.lru_cache(maxsize=4)
def _pipeline(stamp: float) -> list[dict]:
    """발행 파이프라인. 납입기일을 영업일 보정해 `날짜` 로 붙인다."""
    out = []
    for r in _read("pipeline"):
        pay = _date(r.get("납입기일"))
        if pay is None:
            continue  # 납입기일이 없는 신고는 달력에 놓을 자리가 없다
        amt = _num(r.get("발행액"))
        if amt is None:
            continue
        sector = (r.get("섹터") or "").strip()
        out.append({**r, "_d": _adjust(pay), "_amt": amt, "_sector": sector})
    return out


@functools.lru_cache(maxsize=4)
def _auctions(stamp: float) -> list[dict]:
    """국고채 입찰 결과 + 강도.

    `annotate` 는 표 전체를 한 번에 본다(같은 연물 52주를 훑어야 하므로). 그래서
    여기서 한 번 붙이고 캐시에 담는다 — 하루치를 볼 때마다 1,000행을 다시 훑지
    않는다.
    """
    rows = []
    for r in _read("ktb"):
        rows.append(
            {
                **r,
                "입찰일": (str(r.get("입찰일") or "")[:10]),
                "응찰률": _num(r.get("응찰률")),
                "입찰금액": _num(r.get("입찰금액")),
                "응찰금액": _num(r.get("응찰금액")),
                "낙찰금액": _num(r.get("낙찰금액")),
                "최저낙찰금리": _num(r.get("최저낙찰금리")),
                "최고낙찰금리": _num(r.get("최고낙찰금리")),
                "가중평균낙찰금리": _num(r.get("가중평균낙찰금리")),
                "부분낙찰률": _num(r.get("부분낙찰률")),
                "인수기관수": _num(r.get("인수기관수")),
            }
        )
    return annotate_auctions(rows)


@functools.lru_cache(maxsize=4)
def _omo(stamp: float) -> list[dict]:
    return [
        {
            **r,
            "일자": str(r.get("일자") or "")[:10],
            "예정금액": _num(r.get("예정금액")),
            "낙찰금액": _num(r.get("낙찰금액")),
            "금리": _num(r.get("금리")),
        }
        for r in _read("omo")
    ]


@functools.lru_cache(maxsize=4)
def _mpc(stamp: float) -> dict[str, dict]:
    """금통위 **결정 결과**. 일정이 아니다 — 일정은 `calendar.json` 이 든다."""
    out = {}
    for r in _read("mpc"):
        iso = str(r.get("일자") or "")[:10]
        if iso:
            out[iso] = {
                "decision": (r.get("결정") or "").strip() or None,
                "before": _num(r.get("이전")),
                "after": _num(r.get("이후")),
                "changePp": _num(r.get("변동폭")),
                "gist": (r.get("요지") or "").strip() or None,
            }
    return out


def months_from(y: int, m: int, n: int) -> list[tuple[int, int]]:
    out = []
    for i in range(n):
        k = (y * 12 + (m - 1)) + i
        out.append((k // 12, k % 12 + 1))
    return out


def build(
    span: list[tuple[int, int]],
    mpc_dates: list[str],
    today: dt.date | None = None,
) -> dict:
    """월별 페이로드 — 일자 × 섹터 분해 + 그날의 일정 표시.

    `mpc_dates` 는 호출부가 넘긴다(v2 의 검증된 달력). 이 모듈이 두 번째 사본을
    만들지 않는다 — `MPC_DATES` 가 이미 겪은 종류의 표류다.

    섹터 합계를 **미리 더하지 않는다**. 화면의 섹터 필터가 달력을 실제로 바꾸려면
    하루치가 섹터별로 갈려 있어야 하고, 서버가 더해 두면 필터가 화면을 못 건드린다
    (원본의 판단 그대로).
    """
    today = today or dt.date.today()
    stamp = data_stamp()

    pipe = _pipeline(stamp)
    by_day: dict[dt.date, dict[str, list[float]]] = {}
    for r in pipe:
        s = r["_sector"]
        if s not in SECTORS:
            continue
        by_day.setdefault(r["_d"], {}).setdefault(s, []).append(r["_amt"])

    auc_days = {r["입찰일"] for r in _auctions(stamp) if r.get("입찰일")}
    omo_by_day: dict[str, set[str]] = {}
    for r in _omo(stamp):
        if r["일자"]:
            omo_by_day.setdefault(r["일자"], set()).add((r.get("구분") or "").strip())
    mpc_set = set(mpc_dates)

    months = {}
    for y, m in span:
        first = dt.date(y, m, 1)
        n_days = (dt.date(y + (m == 12), m % 12 + 1, 1) - first).days
        days = []
        for i in range(n_days):
            d = first + dt.timedelta(days=i)
            iso = d.isoformat()
            sec = by_day.get(d, {})
            events = []
            if iso in auc_days:
                events.append({"lane": "ktb", "label": "국고채 입찰"})
            for kind in sorted(omo_by_day.get(iso, ())):
                events.append({"lane": "omo", "label": kind})
            if iso in mpc_set:
                events.append({"lane": "mpc", "label": "금통위"})
            days.append(
                {
                    "d": d.day,
                    "iso": iso,
                    "biz": _is_kr_business_day(d),
                    "past": d < today,
                    "today": d == today,
                    # 섹터별 조원. 화면이 고른 섹터만 더한다.
                    "isec": {
                        s: round(sum(v) / JO, 4) for s, v in sorted(sec.items())
                    },
                    "isn": {s: len(v) for s, v in sorted(sec.items())},
                    "ev": events,
                }
            )
        months[f"{y}-{m:02d}"] = {"lead": first.weekday(), "days": days}

    # 사이드바 섹터 목록. 이 구간에 발행이 0 인 섹터도 **자리를 지킨다** —
    # 목록이 날마다 늘었다 줄었다 하면 체크박스가 어디 있었는지 못 찾는다.
    lo = dt.date(span[0][0], span[0][1], 1)
    hy, hm = span[-1]
    hi = dt.date(hy + (hm == 12), hm % 12 + 1, 1) - dt.timedelta(days=1)
    tot: dict[str, list[float]] = {}
    for r in pipe:
        if lo <= r["_d"] <= hi and r["_sector"] in SECTORS:
            tot.setdefault(r["_sector"], []).append(r["_amt"])

    return {
        "months": months,
        "order": [f"{y}-{m:02d}" for y, m in span],
        "sectors": [
            {
                "k": s,
                "v": round(sum(tot.get(s, ())) / JO, 4),
                "n": len(tot.get(s, ())),
                "fin": s not in NONFIN,
            }
            for s in SECTORS
        ],
        "today": today.isoformat(),
        # 발행 공시가 닿는 마지막 날. 그 뒤의 빈칸은 «없음» 이 아니라 «아직 공시
        # 안 됨» 이고, 화면이 그 경계를 그린다.
        "issuanceThrough": max((r["_d"] for r in pipe), default=None)
        and max(r["_d"] for r in pipe).isoformat(),
        # 국고채 입찰은 **결과**만 있다(예정 일정은 스크래핑이라 안 옮겼다).
        "auctionThrough": max(auc_days) if auc_days else None,
        "caveats": [
            "ISSUANCE_ONLY: 만기도래는 이 화면이 보지 않아요.",
            "SHELF_HORIZON: 은행채·여전채에는 발행계획이 없어요. 앞날의 빈칸은 "
            "«없음» 이 아니라 «아직 공시 안 됨» 이에요.",
            "AUCTION_RESULTS_ONLY: 국고채 입찰은 결과가 나온 것까지만 보여요. "
            "앞날의 입찰 예정은 아직 안 붙였어요.",
        ],
    }


def day_detail(iso: str, mpc_dates: list[str]) -> dict:
    """그날 하루 — 발행 종목 · 국고채 입찰 결과(+강도) · 공개시장운영 · 금통위."""
    stamp = data_stamp()
    d = _date(iso)
    if d is None:
        raise IssuanceUnavailable(f"{iso} 는 날짜가 아니에요")

    issuing = [
        {
            "issuer": (r.get("발행인") or "").strip(),
            "sector": r["_sector"],
            "round": (r.get("회차") or "").strip() or None,
            "eok": round(r["_amt"] / 1e8, 1),
            "coupon": _num(r.get("표면금리")),
            "maturity": (str(r.get("만기일") or "")[:10] or None),
            "rating": (r.get("신용등급") or "").strip() or None,
            "stage": (r.get("단계") or "").strip() or None,
            "report": (r.get("보고서") or "").strip() or None,
            # DART 원문으로 가는 길. 이 화면의 모든 숫자가 거기서 나왔다.
            "rcept": (str(r.get("접수번호") or "").strip() or None),
        }
        for r in _pipeline(stamp)
        if r["_d"] == d and r["_sector"] in SECTORS
    ]

    auctions = [
        {
            "kind": (r.get("구분") or "").strip(),
            "name": (r.get("종목명") or "").strip(),
            "code": (r.get("종목코드") or "").strip() or None,
            "offered": r.get("입찰금액"),
            "bid": r.get("응찰금액"),
            "ratio": r.get("응찰률"),
            "allotted": r.get("낙찰금액"),
            "lowRate": r.get("최저낙찰금리"),
            "highRate": r.get("최고낙찰금리"),
            "wavgRate": r.get("가중평균낙찰금리"),
            "partial": r.get("부분낙찰률"),
            "dealers": r.get("인수기관수"),
            "issueDate": (str(r.get("발행일") or "")[:10] or None),
            "strength": r.get("강도"),
        }
        for r in _auctions(stamp)
        if r.get("입찰일") == iso
    ]

    omo = [
        {
            "kind": (r.get("구분") or "").strip(),
            "name": (r.get("종목") or "").strip() or None,
            "planned": r.get("예정금액"),
            "allotted": r.get("낙찰금액"),
            "rate": r.get("금리"),
        }
        for r in _omo(stamp)
        if r["일자"] == iso
    ]

    return {
        "date": iso,
        "issuing": issuing,
        "auctions": auctions,
        "omo": omo,
        # 금통위가 **있는 날**인지는 검증된 달력이 말하고, 그날 **무엇을 정했는지**는
        # 수집기의 결과표가 말한다. 두 출처가 각자 자기 것만 답한다.
        #
        # 둘을 한 필드에 접으면 «회의가 없는 날» 과 «회의는 있는데 아직 안 열린 날»
        # 이 구분되지 않는다(실측 2026-08-27: 달력에는 있고 결과표에는 없다). 그래서
        # 열림 여부와 결정을 따로 답한다 — 화면이 «오늘 금통위예요, 결과는 아직» 을
        # 말할 수 있어야 한다.
        "mpc": (
            {"scheduled": True, "decision": _mpc(stamp).get(iso)}
            if iso in set(mpc_dates)
            else None
        ),
    }
