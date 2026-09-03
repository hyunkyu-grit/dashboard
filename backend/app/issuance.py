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

from . import issuance_mp as mp
from . import reserve
from .engine_port import _is_kr_business_day, _next_business_day
from .issuance_gloss import (
    BIAS_CAVEAT,
    BOTH,
    EVENT_BIAS,
    MPC_BIAS,
    STRENGTH_BIAS,
    explain,
    for_event,
    net_dir,
    speak,
)
from .issuance_strength import annotate as annotate_auctions
from .issuance_strength import annotate_omo

#: CSV 가 사는 곳. 수집기가 쓰는 그 디렉터리를 그대로 읽는다.
#: 없으면 이 화면만 서지 않고 나머지 앱은 멀쩡히 돈다.
DATA_DIR = pathlib.Path(
    os.environ.get("RAWDATA_DIR", r"C:\Users\infomax\Projects\apps\rawdata\data")
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


#: 레인마다 «어디서 온 숫자인가». **원본이 화면 바닥에 한 줄씩 적던 것**이고,
#: v2 는 그걸 빼먹은 채로 판정만 보여 주고 있었다 — 응찰 강도가 «약한 수요» 라고
#: 말하는데 그 숫자가 어느 공고에서 왔는지가 화면에 없었다.
#:
#: 링크는 **레인의 원문 목록**이다. 종목 하나로 가는 길은 따로 있다(발행은
#: DART 접수번호가 그 자리다 — `dartUrl`).
SRC: dict[str, dict[str, str]] = {
    "iss": {
        "who": "DART 전자공시",
        "what": "수치는 증권신고서·일괄신고추가서류 원문이에요.",
        "url": "https://dart.fss.or.kr",
    },
    "ktb": {
        "who": "기획재정부 국채시장",
        "what": "수치는 「국고채 입찰결과」 공고 원문이에요.",
        "url": "https://ktb.moef.go.kr/mnbyIsuCldr.do",
    },
    "omo": {
        "who": "한국은행 공개시장운영 공지",
        "what": "수치는 「공개시장운영」 공지 원문이에요.",
        "url": "https://www.bok.or.kr/portal/bbs/P0001773/list.do?menuNo=200037",
    },
    "mpc": {
        "who": "한국은행 통화정책방향",
        "what": "결정과 요지는 통화정책방향 의결문 원문이에요.",
        "url": ("https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/"
                "listYear.do?mtgSe=A"),
    },
    "res": {
        "who": reserve.SOURCE,
        "what": "적립기간은 한국은행이 해마다 한 장으로 공표하는 표예요.",
        "url": reserve.SOURCE_URL,
    },
}

#: DART 원문 한 건으로 가는 길. 접수번호가 그 열쇠다.
DART_DOC = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={}"


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


def _yyyymmdd(x) -> str | None:
    """`20260814` -> `2026-08-14`. 파이프라인의 **제출일만** 이 모양이다.

    같은 CSV 안에서 납입기일·만기일은 이미 ISO 인데 제출일 하나가 붙여 쓴
    여덟 자리다(수집기가 DART 원문의 표기를 그대로 실었다). `_date` 는 열 자를
    보므로 이 칸을 통째로 못 읽는다 — 실측 2026-08-21: 그대로 넘겼더니 민평
    기준일이 전부 납입기일로 물러섰다.
    """
    s = str(x or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s or None


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
    """공개시장운영 + 강도.

    `annotate_omo` 는 이식할 때 같이 왔지만 첫 판에서 안 불렀다. 그래서 이
    레인은 «RP매각 2조» 까지만 말하고 «그게 평년보다 큰가» 를 못 말했다.
    방향 판정을 붙이면서 같이 켠다 [OWNER 2026-08-21] — 방향만 있고 규모가
    없으면 흡수 1천억과 흡수 3조가 화면에서 같은 무게로 읽힌다.

    `base_at` 은 그날 유효한 기준금리다. 없으면 그 모듈이 스프레드 행을 안
    그린다 — 모르는 채로 «+85bp» 라고 쓰지 않는다(그쪽의 규율).
    """
    rows = [
        {
            **r,
            "일자": str(r.get("일자") or "")[:10],
            "예정금액": _num(r.get("예정금액")),
            "응찰금액": _num(r.get("응찰금액")),
            "낙찰금액": _num(r.get("낙찰금액")),
            "금리": _num(r.get("금리")),
        }
        for r in _read("omo")
    ]
    return annotate_omo(rows, _base_at(stamp))


def _base_at(stamp: float):
    """`iso -> 그날 유효한 기준금리`. 출처는 금통위 **결과표**다.

    `policy.load_base_rate` 는 엑셀을 읽는데 이 화면의 다른 모든 것이 CSV 라,
    엑셀이 없는 PC 에서 캘린더 전체가 같이 죽는다. 여기 필요한 것은 «그날의
    수준» 하나뿐이고 결과표가 그걸 이미 들고 있다.
    """
    steps = sorted(
        (iso, v["after"])
        for iso, v in _mpc(stamp).items()
        if v.get("after") is not None
    )

    def at(iso: str) -> float | None:
        got = None
        for d, rate in steps:
            if d <= iso:
                got = rate
            else:
                break
        return got

    return at


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

    # 칸에 붙는 방향 [OWNER, 2026-08-21]. **이 앱에서 색은 방향만 나른다** —
    # 달력 칸이 그 규칙을 지금까지 «색을 안 쓴다» 로 지켰는데, 이제 나를 방향이
    # 생겼으므로 쓴다.
    #
    # 국고채 입찰의 방향은 «입찰이 있다» 가 아니라 **응찰이 얼마나 들어왔나**
    # 라서, 결과가 나온 날에만 선다. 그날 연물이 여럿이고 서로 갈리면(3년물은
    # 셌는데 10년물은 약했다) 한 글자로 못 누르므로 «양방향» 이다 — 자세한
    # 것은 눌러서 본다.
    auc_dir: dict[str, str] = {}
    for r in _auctions(stamp):
        iso = r.get("입찰일")
        if not iso:
            continue
        auc_dir.setdefault(iso, [])
        st = r.get("강도") or {}
        b = STRENGTH_BIAS.get(st.get("tone") or "")
        if b:
            auc_dir[iso].append(b["dir"])
    # 등급이 하나도 없는 날(그날 경쟁입찰 없이 비경쟁인수만 있던 날)은 방향이
    # **없다** — «중립» 이 아니다. 중립은 «평년 수준이라 안 민다» 는 판정이고,
    # 여기는 잰 것이 없다. 둘을 한 값으로 접으면 화면이 안 잰 것을 판정으로
    # 읽는다.
    auc_dir = {k: (net_dir(v) if v else None) for k, v in auc_dir.items()}

    omo_by_day: dict[str, set[str]] = {}
    for r in _omo(stamp):
        if r["일자"]:
            omo_by_day.setdefault(r["일자"], set()).add((r.get("구분") or "").strip())
    mpc_set = set(mpc_dates)
    mpc_done = _mpc(stamp)
    # 지준은 한국은행 공표표 단독이다 — 규칙으로 찍으면 열둘 중 둘이 어긋난다
    # (`reserve.py` 머리글의 실측). 표 밖의 달에는 아무것도 안 선다.
    res_by_day = reserve.events()

    months = {}
    for y, m in span:
        first = dt.date(y, m, 1)
        n_days = (dt.date(y + (m == 12), m % 12 + 1, 1) - first).days
        days = []
        for i in range(n_days):
            d = first + dt.timedelta(days=i)
            iso = d.isoformat()
            sec = by_day.get(d, {})
            # **순서가 곧 위계다.** 칸에는 두 줄까지만 적히고 나머지는 «+N»
            # 이라(달력의 관례이고, 셋을 다 적으면 다섯 주가 카드에 안 들어
            # 간다), 뒤에 놓인 것은 안 보인다. 첫 판은 입찰 → 공개시장운영 →
            # 금통위 순이었고, 그래서 **2026-07-16 인상 결정이 «+2» 뒤에
            # 숨었다**(실측 2026-08-21). 그날 하나만 볼 수 있다면 그건 금통위다.
            events = []
            if iso in mpc_set:
                # 열린 회의와 안 열린 회의는 다른 사실이다. 결정이 아직이면
                # 방향은 «양방향» — 그날 갈린다는 뜻이지 중립이 아니다.
                dec = (mpc_done.get(iso) or {}).get("decision")
                b = MPC_BIAS.get(dec or "")
                events.append(
                    {"lane": "mpc", "label": "금통위", "dir": b["dir"] if b else BOTH}
                )
            # 지준은 금통위 다음이다. 마감일은 콜금리가 조이는 날이라 그날
            # 하나만 볼 수 있다면 입찰보다 이쪽이 먼저다.
            for label in res_by_day.get(iso, ()):
                events.append(
                    {"lane": "res", "label": label, "dir": EVENT_BIAS.get(label)}
                )
            if iso in auc_dir:
                events.append(
                    {"lane": "ktb", "label": "국고채 입찰", "dir": auc_dir[iso]}
                )
            for kind in sorted(omo_by_day.get(iso, ())):
                # 모르는 구분은 방향도 모른다 — 한국은행이 새 조작을 들고
                # 나오면 여기가 비고, 그게 사실이다.
                events.append(
                    {"lane": "omo", "label": kind, "dir": EVENT_BIAS.get(kind)}
                )
            if d.weekday() >= 5:
                # 토·일은 격자에서 뺀다 [OWNER, 2026-08-20]. 잃는 것이 없다 —
                # 입찰·공개시장운영·금통위는 영업일에만 서고, 발행 납입일은
                # Following 으로 이미 영업일로 밀려 있다. **평일 공휴일은 남는다**
                # (그날은 정말로 «거래가 없던 날» 이라 자리를 지켜야 한다).
                continue
            days.append(
                {
                    "d": d.day,
                    "iso": iso,
                    # 0=월 … 4=금. 화면이 날짜를 다시 파싱하지 않게 여기서 준다.
                    "dow": d.weekday(),
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
        # 5열 격자의 앞 여백. 1일이 토·일이면 그 이틀은 빠졌으므로 여백이 0 이다.
        months[f"{y}-{m:02d}"] = {
            "lead": first.weekday() if first.weekday() < 5 else 0,
            "days": days,
        }

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
        "auctionThrough": max(auc_dir) if auc_dir else None,
        "caveats": [
            "ISSUANCE_ONLY: 만기도래는 이 화면이 보지 않아요.",
            "SHELF_HORIZON: 은행채·여전채에는 발행계획이 없어요. 앞날의 빈칸은 "
            "«없음» 이 아니라 «아직 공시 안 됨» 이에요.",
            "AUCTION_RESULTS_ONLY: 국고채 입찰은 결과가 나온 것까지만 보여요. "
            "앞날의 입찰 예정은 아직 안 붙였어요.",
            # 칸에 방향색이 붙었으므로 그 한계도 달력에서 말해야 한다 —
            # 상세를 안 열어 본 사람이 색만 보고 간다.
            f"BIAS_IS_THE_MATERIAL: {BIAS_CAVEAT}",
        ],
    }


def _muted_if_nothing_moved(events: list[dict], allotted: float | None) -> list[dict]:
    """낙찰이 0 이면 방향을 걷는다. **아무것도 안 오간 날은 판정할 것이 없다.**

    이 열쇠말들의 방향은 그 일이 «일어났다» 가 아니라 «얼마나 일어났다» 에서
    나온다. 비경쟁인수가 그 표본이다 — 국고채전문딜러가 옵션을 행사했다는 것은
    그 사이 시장 금리가 낙찰금리 아래로 내려왔다는 뜻이라 강세 방증인데,
    **행사가 0 이면 그 방증이 없는 것**이다. 그런데 라벨은 행사가 있든 없든
    똑같이 «비경쟁인수 Ⅲ» 이라 정적인 표로는 못 가른다(실측 2026-07-16:
    0억 행사에 «강세 요인» 이 붙었다).

    바이백도 같은 성질이다(되산 물량이 0 이면 줄어든 물량도 없다). 그래서
    열쇠말을 하나씩 세지 않고 **금액으로 한 번에** 가른다 —
    `issuance_strength._analyse_omo_unit` 이 공개시장운영에 대해 이미 세운
    규칙과 같은 것이다.

    설명은 걷지 않는다. 그건 «이게 무엇인가» 라 행사액과 무관하게 참이다.
    """
    if allotted:
        return events
    return [{**e, "dir": None} for e in events]


def day_detail(iso: str, mpc_dates: list[str]) -> dict:
    """그날 하루 — 발행 종목 · 국고채 입찰 결과(+강도) · 공개시장운영 · 금통위.

    두 가지가 줄마다 따라붙는다 [OWNER, 2026-08-21]:

        민평 대비   그때 그 금리가 시장보다 오버였나 언더였나 (`issuance_mp`)
        방향        그 재료가 금리를 어느 쪽으로 미나 (`issuance_gloss`)

    **민평은 없어도 화면이 선다.** SQL 이 안 잡히는 PC 가 있고(CSV 는 잡힌다),
    거기서 캘린더 전체가 같이 죽으면 안 된다. 그래서 `matrix()` 는 삼키고,
    `mp` 블록이 «왜 없는지» 를 대신 말한다.
    """
    stamp = data_stamp()
    d = _date(iso)
    if d is None:
        raise IssuanceUnavailable(f"{iso} 는 날짜가 아니에요")

    try:
        cm = mp.matrix()
        mp_note = None
    except mp.Unavailable as e:
        cm = None
        mp_note = f"민평을 못 읽어서 오버·언더를 못 재요 — {e}"

    res_detail = reserve.detail(iso)

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
            # 그때 그 금리가 시장보다 오버였나 언더였나. 기준일은 **제출일**
            # 이다 — 금리가 정해져 공시에 실리는 날이 그날이다.
            "mp": (
                None
                if cm is None
                else mp.for_issue(
                    cm,
                    sector=r["_sector"],
                    grade_raw=r.get("신용등급"),
                    filed=_date(_yyyymmdd(r.get("제출일"))),
                    paid=r["_d"],
                    maturity=_date(r.get("만기일")),
                    coupon=_num(r.get("표면금리")),
                )
            ),
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
            # `issuance_strength` 는 원본의 글자 그대로라 합니다체다. 그 파일은
            # 못 고치므로(사본 대조가 잠근다) **경계에서 옮긴다** — 안 그러면
            # 한 화면에 두 목소리가 선다(실측 2026-08-21: 문장 19개).
            "strength": speak(r.get("강도")),
            # 종목의 성격에 걸리는 «설명 + 방향» (물가채·외평채·비경쟁인수·
            # 교환·바이백 …). **한 벌이다** — 따로 내면 같은 문단이 두 번 찍힌다.
            "events": _muted_if_nothing_moved(
                for_event(f"{r.get('구분') or ''} {r.get('종목명') or ''}"),
                r.get("낙찰금액"),
            ),
            # 그날의 방향. 응찰 강도가 정한다 — 발행 자체는 미리 공표돼 이미
            # 반영돼 있고, 새로 알게 되는 사실은 «얼마나 들어왔나» 뿐이다.
            "bias": STRENGTH_BIAS.get((r.get("강도") or {}).get("tone") or ""),
            "mp": (
                None
                if cm is None
                else mp.for_auction(
                    cm,
                    code=r.get("종목코드"),
                    bid_date=d,
                    issue_date=_date(r.get("발행일")),
                    wavg=r.get("가중평균낙찰금리"),
                )
            ),
        }
        for r in _auctions(stamp)
        if r.get("입찰일") == iso
    ]

    omo = [
        {
            "kind": (r.get("구분") or "").strip(),
            "name": (r.get("종목") or "").strip() or None,
            "code": (r.get("종목코드") or "").strip() or None,
            # 결과인가 공고인가. 공고만 뜬 날은 아직 아무것도 안 오갔다.
            "stage": (r.get("단계") or "").strip() or None,
            "planned": r.get("예정금액"),
            # 응찰금액 — 예정 대비 얼마나 몰렸나가 이 줄의 다른 사실이다.
            "bid": r.get("응찰금액"),
            "allotted": r.get("낙찰금액"),
            "rate": r.get("금리"),
            # 통안증권 경쟁입찰은 금리가 구간으로 낙찰된다. 상단이 하단과
            # 다를 때만 뜻이 있다.
            "rateHigh": _num(r.get("금리상단")),
            # 흡수인가 공급인가 — 설명과 방향이 한 벌로 온다. 이건 해석이
            # 아니라 사실이라 라벨만으로 선다.
            "events": for_event((r.get("구분") or "").strip()),
            # 그리고 그게 평년보다 큰 규모인가. 방향만 있고 규모가 없으면
            # 흡수 1천억과 흡수 3조가 같은 무게로 읽힌다. 여기도 사본의
            # 합니다체를 경계에서 옮긴다.
            "strength": speak(r.get("강도")),
        }
        for r in _omo(stamp)
        if r["일자"] == iso
    ]

    return {
        "date": iso,
        # 레인이 무엇이고 왜 보는지. **서버가 문장의 단일 출처다** — 프런트에
        # 문장을 두면 두 벌이 되고 한쪽만 고치면 조용히 갈린다(원본의 규칙).
        #
        # 첫 이식에서 이걸 빼먹었더니 응찰 강도가 «강한 수요/약한 수요» 라는
        # 판정만 남고 그 판정이 무엇을 잰 것인지가 화면에서 사라졌다.
        "gloss": {
            "iss": explain("iss"),
            "ktb": explain("ktb"),
            "omo": explain("omo"),
            "mpc": explain("pol"),
        },
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
            {
                "scheduled": True,
                "decision": _mpc(stamp).get(iso),
                # 인하는 강세, 인상은 약세, 동결은 중립. 결정이 아직이면
                # 방향도 아직이다 — 열린 회의와 안 열린 회의는 다른 사실이다.
                "bias": MPC_BIAS.get(
                    (_mpc(stamp).get(iso) or {}).get("decision") or ""
                ),
            }
            if iso in set(mpc_dates)
            else None
        ),
        # 민평이 붙었는지, 그리고 그 잣대가 무엇인지. 화면이 «등급 커브» 라고
        # 말할 수 있어야 한다 — 개별민평인 척하면 그게 거짓말이다.
        "mp": {"note": mp_note, "caveat": None if cm is None else mp.CAVEAT},
        # 지급준비금 적립기간의 시작·마감. 한국은행 공표표 단독이다.
        "res": (
            {**res_detail, "gloss": explain("res", res_detail["kind"])}
            if res_detail
            else None
        ),
        # 열자마자 그날 규모가 보이게. **날짜별로 흩어진 것을 여기서만 더한다** —
        # 원본이 달 단위로 하던 일의 하루판이다. 단위를 섞지 않는다: 발행은
        # 조원(달력 칸과 같은 단위), 입찰·공개시장운영은 억원(원문 단위)이다.
        "sum": {
            # **발행은 여기서 안 센다.** 화면의 섹터 필터가 목록을 줄이는데
            # 서버가 전량으로 세어 두면 머리의 «7건» 과 아래 목록의 길이가
            # 어긋난다. 화면이 자기가 그리는 것을 센다 — 한 벌만 존재한다.
            #
            # 국고채는 **낙찰**금액이다 — 입찰금액은 예정이라 미달이면 다르다.
            # 비경쟁인수도 그날 실제로 나간 물량이라 같이 센다.
            "ktbWon": round(sum(a["allotted"] or 0 for a in auctions)),
            "ktbN": len(auctions),
            # 흡수와 공급을 상계하지 않는다. 둘은 같은 시장에 닿지만 순액
            # 하나로 누르면 «3조 흡수 + 3조 공급» 이 «0» 이 된다.
            "omoAbsorb": round(sum(
                o["allotted"] or 0 for o in omo
                if (EVENT_BIAS.get(o["kind"]) == "약세")
            )),
            "omoSupply": round(sum(
                o["allotted"] or 0 for o in omo
                if (EVENT_BIAS.get(o["kind"]) == "강세")
            )),
        },
        # 어디서 온 숫자인가. **원본이 레인마다 한 줄씩 적던 것**이고, v2 는
        # 그걸 빼먹은 채로 판정만 보여 주고 있었다.
        "src": SRC,
    }
