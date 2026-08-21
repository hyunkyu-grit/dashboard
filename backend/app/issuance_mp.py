# -*- coding: utf-8 -*-
"""발행 당시 민평 대비 — 오버였나 언더였나 [OWNER, 2026-08-21].

## 무엇을 답하나

캘린더가 «누가 얼마를 찍었다» 까지만 말했다. 트레이더가 그 다음에 묻는 것은
하나다 — **그래서 비싸게 찍었나 싸게 찍었나.** 원화 시장의 표준 어휘로는
«민평 대비 오버/언더» 다.

    오버   발행금리가 민평보다 높다   발행자가 더 얹어 줬다 = 싸게 나왔다
    언더   발행금리가 민평보다 낮다   민평보다 세게 소화됐다

`issuance_strength.py` 가 자기 머리글에 이미 이 구멍을 적어 두었다 — "시장
코멘트가 낙찰금리를 읽는 표준이 '직전·민평 대비 bp' 인데, 여긴 민평이 없으니
직전 입찰이 잣대다". 이 모듈이 그 민평을 붙인다. 직전 입찰 대비는 그대로 둔다 —
둘은 다른 질문이다(하나는 시장 대비, 하나는 지난번 대비).

## 잣대는 등급민평이다 — 개별민평이 아니다

이 배포에 개별종목 민평은 **없다**. `sim_portfolio` 스키마의 표 여덟 장을 다
봤고(2026-08-21) 종목 단위 시가평가 표가 없다. 있는 것은 `credit_matrix` —
(종목군 × 등급) × 테너의 격자다.

그래서 이 화면이 말하는 «민평» 은 **그 등급 커브**이고, 화면이 커브 이름을
같이 적는다("은행채 AAA 민평 1.2Y"). 개별민평인 척하지 않는다. 같은 등급
안에서도 발행체마다 십수 bp 가 갈리는 것이 원화 크레딧의 사실이고, 그 차이가
여기 숫자에 섞여 있다.

## 커브가 곧 등급이다

`credit_matrix` 의 `bond_type` 은 섹터와 등급을 한 코드에 묶는다(BD = 은행채
AAA, CARD = 카드채 AA+, OFB = 캐피탈채 AA-). 그래서 **섹터가 맞아도 등급이
다르면 잣대가 아니다**. 실측(2026-08-21, 파이프라인 208건):

    은행 AAA · 카드 AA+ · 캐피탈 AA- · 공사 AAA        84건  등급까지 일치
    캐피탈 AA+/A0/A+ · 카드 AA0 · 은행 AA+ 등          40건  섹터만 일치
    증권 · 지주 · 보험 · 기타금융                       15건  커브 없음
    무등급(공시에 등급 칸이 빈 것)                      48건  등급 없음

등급이 갈리면 **숫자는 내되 오버/언더라고 부르지 않는다**. −24bp 의 대부분이
가격이 아니라 등급 차이인데 «언더 24bp» 라고 적으면 그건 거짓말이다. 화면은
"캐피탈채 AA- 민평 대비 −24bp · 이 종목은 AA+ 예요" 라고 말한다.

## 기준일은 그날이다

민평은 그날 종가로 고시된다. «발행 당시» 의 잣대로 그날 것을 쓰고, 그날 값이
없으면(휴일·데이터 지연) 직전 관측으로 물러선다.

**이 규약의 한계 하나:** 입찰은 오전에 서고 그날 민평은 그 뒤에 고시되므로,
입찰 결과가 이미 그 민평에 섞여 있다. 직전 영업일 민평을 쓰면 사전(ex-ante)
잣대가 되지만 하룻밤 시장 이동이 통째로 섞인다. 실측(2026-08-21, 국고 경쟁입찰
270건):

    당일 민평      중위 −1.2bp   사분위 [−2.8, +1.1]   최대 ±12.6
    직전 영업일    중위 −0.4bp   사분위 [−3.2, +2.2]   최대 +27.4

당일 쪽이 좁고, 「국고채 입찰은 민평보다 1~2bp 언더에서 낙찰된다」는 시장의
경험칙과도 맞는다. 그래서 당일을 쓰고, 이 한계는 `CAVEAT` 이 적는다.

## 원화 고정이표채가 아니면 못 잰다

표면금리 칸에 원화 금리가 아닌 것이 들어오는 날이 있다. 실측 2026-08-21:
현대커머셜 579 가 표면 2.2% 로 올라와 캐피탈채 AA- 민평 대비 −224bp 가 나왔다 —
**CNH 표시 채권**이다(`financial_bond_master.csv` 의 종목명이 «현대커머셜
579(CNH)»). DART 공시에는 통화 칸이 없어서 이걸 앞에서 거를 방법이 없다.

그래서 문턱 하나를 둔다: **±100bp 를 넘으면 판정을 안 낸다.** 외화표시·변동
금리·할인채·자료 오류를 한 규칙으로 걸러 내고, 실측 범위(국고 ±12.6bp,
크레딧 −13~+33bp)와 한참 떨어져 있어 멀쩡한 발행을 자르지 않는다.
"""

from __future__ import annotations

import calendar as _cal
import datetime as dt
import logging
import re

from . import creditmatrix as cmx

log = logging.getLogger("app.issuance_mp")

#: 판정을 «같다» 로 부르는 폭. 민평은 소수 셋째 자리까지 고시되므로 0.5bp 아래는
#: 반올림의 영역이다.
FLAT_BP = 0.5

#: 이 밖은 원화 고정이표채가 아니라고 본다(머리글의 CNH 실측).
SANE_BP = 100.0

#: 화면이 **그대로 찍는** 문장이라 `KEY:` 접두어가 없다. 그 접두어는 페이로드의
#: `caveats` 목록 규약인데(기계가 잡을 수 있게), 이건 시트 바닥에 그냥 서는
#: 문장이다 — 붙여 뒀더니 화면에 «MP_BENCHMARK:» 가 떴다(실측 2026-08-21).
CAVEAT = (
    "여기 민평은 «등급 커브» 예요. 개별종목 민평은 이 데이터에 "
    "없어서, 같은 등급 안의 발행체별 차이가 숫자에 섞여 있어요. 입찰의 경우 "
    "그날 민평은 장 마감 뒤에 고시돼 입찰 결과가 이미 반영돼 있어요."
)

#: 섹터 → (커브 코드, 그 커브의 등급). **등급까지 같아야 잣대다** — 머리글 참조.
SECTOR_CURVE: dict[str, tuple[str, str]] = {
    "은행": ("BD", "AAA"),
    "카드": ("CARD", "AA+"),
    "캐피탈": ("OFB", "AA-"),
    "공사": ("SPB", "AAA"),
}

#: 일반 회사채는 등급별 커브가 있다. CB1~CB5 의 등급 배정은 값으로 확인했다
#: (2026-08-19 3Y: CB1 4.282 < CB2 4.377 < CB3 4.418 < CB4 4.469 < CB5 4.855,
#: 그리고 CARD AA+ 4.352 ≈ CB2 · OFB AA- 4.508 ≈ CB4 — 사다리가 배정을 강제한다).
#: **다만 `creditmatrix.TYPE_ORDER` 가 CB1 만 싣는다** — CB2~CB5 를 쓰려면 그
#: 표의 유니버스를 넓혀야 하고, 그건 RV·현금채권 화면의 표 순서까지 건드린다.
#: 지금 파이프라인에 일반 회사채가 한 건도 안 들어오므로(기타·리츠 11건 전부
#: 표면금리 없음) 넓히지 않는다. 필요해지면 여기 네 줄과 그 표 한 줄이다.
CORP_SECTORS = {"기타", "리츠"}
CORP_CURVE: dict[str, str] = {"AAA": "CB1"}

#: 신용평가사 꼬리표. 같은 등급을 세 회사가 각자 적어 «AA-NICE» 같은 것이 온다.
_AGENCY = re.compile(r"(NICE|KIS|KR|한신평|한기평|나이스)\s*$")

#: 국고채 종목코드. `국고03375-3206` = 표면 3.375%, 만기 2032년 06월.
#: 만기 **일**은 코드에 없다 — 원발행일의 일자가 그 자리다(국고채는 발행일과
#: 만기일의 일자가 같다).
_KTB_CODE = re.compile(r"^(국고|물가|외평)(\d{5})-(\d{2})(\d{2})$")


class Unavailable(RuntimeError):
    """민평을 못 읽는다. 캘린더는 이것 없이도 서야 하므로 호출부가 삼킨다."""


def normalize_grade(raw: str | None) -> str | None:
    """공시의 등급 문자열을 커브의 등급 어휘로. 없으면 None.

    «AA0» 과 «AA» 는 같은 등급의 두 표기다(원화 관행은 AA0 이 정식). 평가사
    꼬리표는 등급이 아니라 출처라 뗀다.
    """
    s = (raw or "").strip().upper().replace(" ", "")
    s = _AGENCY.sub("", s).strip()
    if not s:
        return None
    if s == "AA":
        return "AA0"
    if s == "A":
        return "A0"
    return s


def _years(frm: dt.date, to: dt.date) -> float:
    return (to - frm).days / 365.0


def _judge(bp: float, matched: bool) -> tuple[str | None, str | None]:
    """(판정, 판정을 못 낸 이유). 둘 중 하나만 차 있다."""
    if abs(bp) > SANE_BP:
        return None, (
            f"민평과 {abs(bp):,.0f}bp 벌어져 있어요 — 원화 고정이표채가 아닌 것 "
            f"같아요(외화표시·변동금리 같은 것). 판정을 안 낼게요."
        )
    if not matched:
        return None, None  # 숫자는 냈다. 오버/언더라고 부르지만 않는다.
    if abs(bp) < FLAT_BP:
        return "민평", None
    return ("오버" if bp > 0 else "언더"), None


def _point(
    m: cmx.CreditMatrix,
    bond_type: str,
    on: dt.date,
    years: float,
    rate_pct: float,
    *,
    curve: str,
    matched: bool,
    grade: str | None,
) -> dict | None:
    """한 종목의 민평 대비 한 줄. 그날 커브가 없으면 None."""
    i = cmx.index_on_or_before(m.dates, on)
    if i < 0:
        return None
    try:
        mp = cmx.yield_at(m, bond_type, i, years) * 100.0
    except cmx.CreditMatrixError:
        return None
    bp = (rate_pct - mp) * 100.0
    side, why = _judge(bp, matched)
    return {
        "curve": curve,
        "grade": grade,
        "match": matched,
        "years": round(years, 2),
        "rate": round(mp, 3),
        "asof": m.dates[i].isoformat(),
        "bp": round(bp, 1),
        "side": side,
        "why": why,
    }


# ── 발행 (DART 파이프라인) ──────────────────────────────────────────────────


def for_issue(
    m: cmx.CreditMatrix,
    *,
    sector: str,
    grade_raw: str | None,
    filed: dt.date | None,
    paid: dt.date | None,
    maturity: dt.date | None,
    coupon: float | None,
) -> dict | None:
    """발행 한 건의 민평 대비. 못 재면 이유를 담은 사전, 아예 자리가 없으면 None.

    기준일은 **제출일**이다 — 금리가 정해져 공시에 실리는 날이 그날이고,
    납입기일은 돈이 오가는 날이라 하루 이틀 뒤다.
    """
    if coupon is None:
        return None  # 금리가 아직 없는 신고. 화면이 «—» 로 둔다.
    if paid is None or maturity is None:
        return None
    grade = normalize_grade(grade_raw)

    bt: str | None = None
    curve_grade: str | None = None
    if sector in SECTOR_CURVE:
        bt, curve_grade = SECTOR_CURVE[sector]
    elif sector in CORP_SECTORS and grade in CORP_CURVE:
        bt, curve_grade = CORP_CURVE[grade], grade
    if bt is None:
        return {"why": f"{sector} 섹터는 견줄 민평 커브가 없어요.", "side": None}
    if grade is None:
        return {
            "why": (
                f"공시에 신용등급이 없어서 {cmx.BOND_TYPES[bt]} 민평과 견줄지를 "
                f"정할 수 없어요."
            ),
            "side": None,
        }

    years = _years(paid, maturity)
    if years <= 0:
        return None
    out = _point(
        m,
        bt,
        filed or paid,
        years,
        coupon,
        curve=cmx.BOND_TYPES[bt],
        matched=(grade == curve_grade),
        grade=grade,
    )
    if out is None:
        return {"why": f"그날 {cmx.BOND_TYPES[bt]} 민평이 없어요.", "side": None}
    return out


# ── 국고채 입찰 ─────────────────────────────────────────────────────────────


def _ktb_maturity(code: str, issued: dt.date) -> tuple[str, dt.date] | None:
    """종목코드에서 (종류, 만기일). 코드가 그 모양이 아니면 None.

    재정증권(`재정증권2023-001`)은 코드에 만기가 없다 — 제목의 «63일물» 이
    유일한 단서라 여기서는 안 잰다.
    """
    mm = _KTB_CODE.match((code or "").strip())
    if not mm:
        return None
    kind, _cpn, yy, mo = mm.groups()
    y, mo = 2000 + int(yy), int(mo)
    if not 1 <= mo <= 12:
        return None
    day = min(issued.day, _cal.monthrange(y, mo)[1])
    return kind, dt.date(y, mo, day)


def for_auction(
    m: cmx.CreditMatrix,
    *,
    code: str | None,
    bid_date: dt.date | None,
    issue_date: dt.date | None,
    wavg: float | None,
) -> dict | None:
    """입찰 한 건의 민평 대비. 잣대는 국고 민평이다.

    **물가채는 안 잰다** — 낙찰금리가 실질금리라 명목 커브와 견줄 수 없다.
    **외평채는 국고 커브로 잰다** — 발행자가 같은 정부라 신용이 같고, 따로 고시
    되는 민평이 없다. 실측(2026-08-21, 19건)으로 중위 +8.6bp 로 국고보다 꾸준히
    오버인데 그건 유동성 차이라 진짜 스프레드다. 화면이 잣대 이름을 적는다.
    """
    if wavg is None or bid_date is None or issue_date is None:
        return None
    got = _ktb_maturity(code or "", issue_date)
    if got is None:
        return None
    kind, mat = got
    if kind == "물가":
        return {
            "why": "물가채 낙찰금리는 실질금리라 명목 민평과 못 견줘요.",
            "side": None,
        }
    years = _years(bid_date, mat)
    if years <= 0:
        return None
    out = _point(
        m,
        "KTB",
        bid_date,
        years,
        wavg,
        curve="국고채",
        matched=True,
        grade=None,
    )
    if out is None:
        return {"why": "그날 국고채 민평이 없어요.", "side": None}
    if kind == "외평":
        out["note"] = (
            "외평채는 따로 고시되는 민평이 없어서 국고 민평이 잣대예요. "
            "발행자는 같은 정부지만 유동성이 얕아 꾸준히 오버로 나와요."
        )
    return out


# ── 적재 ────────────────────────────────────────────────────────────────────


def matrix() -> cmx.CreditMatrix:
    """민평 격자. SQL 이 없으면 `Unavailable` — 캘린더는 이것 없이도 서야 한다."""
    try:
        return cmx.load()
    except Exception as e:  # noqa: BLE001 — SQL 계층의 예외가 여러 갈래다
        log.info("민평을 못 읽어 발행 캘린더가 오버/언더 없이 선다: %s", e)
        raise Unavailable(str(e)) from e
