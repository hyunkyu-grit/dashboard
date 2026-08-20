# -*- coding: utf-8 -*-
"""RV Analysis — Strategy 섹션의 세 구성 (rv2) [OWNER — "RV = v2 Strategy 섹션"].

근거 문서는 v1 `docs/diagnostics/REPORT_rv1.md`(커밋 25f293ac)와 그 측정
스크립트 `rv1_probe.py` 다. 이 모듈은 그 프로브의 **앵커 검증된 규약**
(Appendix B 8행 재현: carry ≤0.01bp · roll ≤0.37bp · 스왑점 13.0 vs 13.2bp)을
제품 코드로 올린 것이고, `tests/test_rv.py` 의 상주 앵커가 그 재현을 지킨다.

## 재사용 경계 — 롤·가격·DV01 재구현 금지 [세션 규칙]

    가격       cashbond.price
    DV01       cashbond.dv01_at
    이표 수     cashbond.periods_for
    커브/보간   creditmatrix.curve_points / interp
    조달       funding.rate_on (Setting 의 스펙 그대로 — v2 기본 = 콜금리.
               기준금리 테이블이 멈춰 base 가 실패 상태인 결정을 그대로 경유한다)
    금통위 달력 policy.MPC_DATES (calendar.json 이중사본 + 대조테스트 구조)

이 파일이 새로 적는 수식은 Appendix A 의 조달 레그(`avg_funding`·`path_rate`),
워크북 K열의 par 듀레이션(`par_duration` — 독스트링에 경계의 근거),
볼록껍질/스왑점/백분위뿐이다. `roll` 은 `cashbond.price` 호출 한 줄이다.

## 그레인 [rv1 C7 확정, OWNER]

후보 = **섹터×테너 커브 격자**(신용 종목 민평은 DB 에 존재하지 않는다 —
kbond.marketvalue 는 국고·통안 ~99종목뿐). 종목 단위는 쓰지 않는다.

## 세 구성

  A. 동일섹터 레인 — 만기 × Δy 격자, 칸 = H 보유 총수익 bp. 여기에
     **비평행 경로 열**이 붙는다(워크북 케이스 C/C-2 — `tr_path`).
     **결정 숫자는 밴드가 아니라 스왑점 목록이다** — 1bp 격자는 껍질 멤버를
     건너뛴다(rv1 실측: KDB 10Y 의 승리 구간 +5.2~+5.7bp 는 정수 bp 를 하나도
     안 품는다). 섹터 안은 선형화로 충분(C12: 1위 불일치 0), **풀 경계만
     재가격 이분법으로 다듬는다**(C12: 선형화 경계가 ±1bp 이동, 그 ±1bp 가
     화면의 결정 숫자로 나가므로).
  B. 동일테너 레인 — 섹터 × 만기 히트맵, 칸 = 스프레드의 **랭크 백분위**
     [OWNER — 총수익 절대 금지: 풀 껍질 6장 중 5장을 최고 스프레드 섹터(OFB)가
     독점하는 실측이 그 이유의 형태다]. 스프레드의 앵커는 섹터마다 다르다
     (`SPREAD_BASE`) — 한 히트맵에 두 앵커가 섞이므로 행마다 이름을 싣는다.
  C. 크레딧 RV — 트레이더 설계안(2026-08-18, "참고사항" 명시) 반영. 아래
     "크레딧 RV 의 계산 정의" 절이 코드보다 먼저 쓰인 문서다.

## 용어 규율

"껍질"(전 Δy 상단 볼록껍질)과 "창 안 승자"(Δy ∈ [−50,+50]bp 에서 실제로
이기는 것)는 **다른 집합이다** — 앵커 커브의 6M(D=0)은 껍질에 있지만 스왑점이
+128bp 라 창 밖이다(rv1 PN-2). 페이로드가 둘을 딴 이름으로 싣고, 화면도 딴
이름으로 부른다.

## 워크북 정렬 [OWNER 2026-08-20] — 이 모듈의 기준 문서가 하나 더 있다

트레이더 워크북 `크레딧 채권 상대우위 비교.xlsx`(만기선택·금통위·노트)가
rv1 Appendix A/B 의 **원본**이다. `tests/test_rv.py` 의 SHEET/EXPECT 8행이 그
워크북의 특은채 커브와 H/L/M/S열 그대로다. 2026-08-20 에 아래 넷을 워크북
기준으로 맞췄다 [OWNER — "엑셀이 트레이더가 제작한 것이므로 트레이더의 의사를
최대한 반영"]:

  1. **BEP 는 아웃라이트 금리축** — 아래 참조. 전신인 스프레드축(국고 헤지
     페어)은 같은 트레이더의 2026-08-18 설계안이었고, 두 문서가 다른 축을
     말하고 있었다. 워크북 쪽으로 통일했다.
  2. **매도시점 듀레이션 = 워크북 K열의 par 폐형**(`par_duration`), 달력
     잔존만기에서. 9M 후보의 BEP 가 166.3 → 169.0bp 로 워크북과 맞는다.
  3. **재투자** 3갈래(워크북 B11) — `candidate(reinvest=…)`.
  4. **비평행 커스텀 커브**(워크북 케이스 C/C-2) — `tr_path` · `parse_paths`.
  5. **H 를 한 벌로**(`H_DEFAULT_MONTHS`) — 워크북은 `만기선택!B7` 하나이고
     상수가 아니라 읽는 사람이 채우는 칸이다. 레인 A 6M / 크레딧 3M 의 두 벌을
     합치고 화면 컨트롤로 올렸다.
  6. **스프레드 앵커를 섹터별로 가름**(`SPREAD_BASE`) — 워크북 밖의 트레이더
     피드백이지만 같은 사람의 같은 논리다: 수준이 아니라 **상대 위치**로 재라.
     확산 섹터(은행·회사·카드·캐피탈)는 특은채 대비로 옮겼다.

워크북과 남는 차이는 하나다: 롤의 가격 스케줄이 이상화 격자(진입일 + k/4년)라
달력 잔존과 미세하게 갈린다(9M 0.37bp). 공용 커널(`cashbond.price`)을 지키는
쪽을 골랐다 — `candidate` 독스트링에 이유가 있다.

**안 옮긴 것**: 워크북 O열의 재투자 조달은 base 를 오늘 기준금리로 놓아 매수
만기일까지의 인상을 빼먹는다(앵커에서 6.3bp). `path_rate` 가 그 자리를 제대로
적는다 — 결함을 이식하지 않았다.

## 크레딧 RV 의 계산 정의 [트레이더 설계안 + 2026-08-20 워크북 정렬]

**원칙 넷**: ① 절대축(버퍼)·상대축(RV)을 독립 숫자로 먼저, 합성은 그 다음
② ~~BEP 는 크레딧 스프레드 축~~ → **아웃라이트 금리축**(워크북 정렬 1) —
조달이 더 이상 상쇄되지 않고 캐리에 남는다 ③ 점수화는 level 이 아니라
**deviation 만**(수준을 점수화하면 최고 스프레드 섹터가 늘 이긴다 — 레인 B
금지의 같은 실측) ④ ~~σ 병기~~ → 사분면 두 축이 그 자리를 대신한다(아래).

**BEP Buffer (금리 bp)** — H(기본 6M, 화면 컨트롤) 보유의 캐리&롤을 몇 bp 의 불리한 평행
상승까지 견디는가로 옮긴 값. 워크북 Q/R/S열 그대로다:

    carry_bp  = (y − f)·t          ÷ 매도시점 D_mod × 10⁴     f = funding 모듈
    roll_bp   = price(j) − 1        ÷ 매도시점 D_mod × 10⁴
    buffer_bp = carry_bp + roll_bp                              (= 워크북 S열)

**사분면 두 축** [OWNER 2026-08-20 — 트레이더 피드백 "BEP·상대 RV 가 무슨 말인지
모르겠다"]:

    x  월환산 총수익 (bp/월) = (캐리 + 롤 + 재투자) × 10⁴ ÷ H
       **듀레이션으로 안 나눈다** — "한 달에 몇 bp 버나". 버퍼와 순서가 반대로
       나오는 별개 숫자다(앵커 실측: 버퍼는 9M 이 1등, 월수익은 3Y 가 1등).
    y  지난주 스프레드의 창 백분위 = mid_rank_pct(창, 직전 5영업일 평균)

전신인 x=Relative RV(σ) · y=BEP Coverage(σ) 는 은퇴했다. Coverage 는 버퍼가
아웃라이트로 옮겨 가면서 분자·분모가 다른 축이 되어 σ 가 뜻을 잃었고, 그
자기 이력 근사(covProxy = s ÷ vol3m, "buffer ≈ k·s" 가 근거였다)도 같이 깨졌다.

**Relative RV (σ)** = z 3성분 합성, 가중 40/40/20 (출발값 — 조건 바에 노출):

    ① 절대 스프레드 RV   z(자기 이력) + 백분위 + Fair(창 평균) 대비 Cheapness bp
    ② 섹터 상대 RV       같은 테너의 **횡단면(같은 앵커 섹터 간) 평균 대비 편차**의 z
    ③ 커브 RV            같은 섹터 **커브(테너 간) 평균 대비 편차**의 z

셋 다 `SPREAD_BASE` 가 정한 앵커 위의 스프레드에서 잰다 — 그 표가 2026-08-20
트레이더 피드백의 자리이고, ② 의 모집단이 "전 크레딧" 에서 "같은 앵커 동료"로
줄어든 것도 거기서 온다.

셋 다 deviation 이라 원칙 ③ 을 지킨다. 창 = 52주 기본·전체(2020~, 6.6년) 토글,
0=결측 규칙은 상류(creditmatrix)가 이미 지킨다.

**Total RV Score (0~100)** = 절대축과 상대축을 50:50 [출발값]. **랭킹이지
투자판단이 아니다** — 화면이 그 명구를 의무로 달고, 별·메달·추천 문구는 없다.

절대축의 점수 입력은 **spreadVolPct**(s ÷ vol3m 의 자기 이력 백분위)다 — 옛
이름이 covPct 이고, Coverage 이 은퇴할 때 **이름만** 바꿔 살아남았다. 2026-08-20 에
이 자리를 사분면 y축(`pctLastWeek`)으로 바꿨다가 되돌렸다(지시는 축이었지 점수
입력이 아니었다 — 되돌린 경위는 합성 자리의 주석, A/B 표는 `spread_vol_hist_series`).
**`pctLastWeek` 는 보는 축일 뿐 점수에 안 들어간다.** 둘 다 deviation 이라
원칙 ③ 은 어느 쪽이든 지켜진다.

여기에 사분면 x축(월환산 총수익)을 넣으면 안 된다 — 캐리가 큰 = 스프레드가
넓은 섹터가 표를 독식하는 병리가 되살아난다 [OWNER 2026-08-19 — "크레딧
리스크가 반영되지 않아 회사채 단기물이 가장 매력적으로 보인다"; 레인 B 가
총수익 셀을 금지한 그 실측(OFB 가 풀 껍질 6장 중 5장 독점)의 합성층 판이다].
x축은 **보는 숫자**이고 점수에는 안 들어간다.

동률은 midrank 로 센다(`mid_rank_pct` — 상수 계열이 100%로 읽히면 "늘 넓다"가
되는 왜곡; 기존 `rank_pct` 와 **다른 통계라 다른 이름**).

**랭크 Δ** [OWNER 2026-08-19] = 전 영업일 랭크 − 오늘 랭크(양수 = 올라옴).
전일 랭크는 전일까지의 이력만 아는 세계에서 통째로 다시 계산한다(`_credit_items`
의 end_i) — 미래 참조 금지의 형태다.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from . import creditmatrix as cm
from . import funding as fd
from .cashbond import FREQ, periods_for, price
from .policy import MPC_DATES

# ── Δy 창과 격자 ────────────────────────────────────────────────────────────
#: 창 [−50, +50]bp — rv1 의 측정 창 그대로. 화면의 격자 열은 10bp 걸음이지만
#: (읽는 밀도), 결정 숫자는 아래 스왑점 목록이다.
WINDOW_BP = 50
GRID_STEP_BP = 10

#: 숏(헤지) 가능 만기와 수단 [OWNER — 주간 세션 제약 그대로. 5년 숏 불가].
SHORTABLE: dict[float, str] = {1.0: "IRS", 1.5: "IRS", 2.0: "IRS", 3.0: "IRS·선물", 10.0: "선물"}

#: 보유 호라이즌의 **기본값**(개월) — 워크북 `만기선택!B7` 의 값.
#:
#: 2026-08-20 이전에는 레인 A 가 6M, 크레딧 RV 가 3M 으로 **두 벌**이었다
#: (후자는 트레이더 2026-08-18 설계안의 출발값). 워크북에는 H 가 하나뿐이고
#: 그것도 상수가 아니라 **읽는 사람이 채우는 칸**이다 — 그 논리를 따라
#: [OWNER 2026-08-20 "엑셀에서 밝힌 트레이더의 논리가 우선"] 한 벌로 합치고
#: 화면 컨트롤로 올렸다. 두 레인이 같은 H 를 쓰므로 "버퍼"와 "월환산 수익"이
#: 같은 기간을 말한다.
H_DEFAULT_MONTHS = 6

#: **RV 섹션 전체의 만기 상한** [OWNER 2026-08-20 — "v2 에서도 최대 테너는
#: 3년까지만"]. 전신은 크레딧 RV 랭킹에만 걸리던 `RANK_MAX_YEARS = 10.0`
#: [OWNER 2026-08-19] 이고, 이번에 세 레인 전부로 넓히면서 값도 3Y 로 내렸다 —
#: 트레이더 워크북(`크레딧 채권 상대우위 비교.xlsx`)의 커브가 3M~3Y 여덟 노드고,
#: 이 화면이 그 워크북과 같은 유니버스를 말해야 하기 때문이다.
#:
#: **여기서만 자른다** — 공용 격자(`creditmatrix.TENOR_COLS`, 3M~30Y)는 그대로다.
#: 그 테이블은 Lab 3D 표면(3M~30Y [OWNER 2026-08-18])·Cash Bond ASW(10Y)·
#: Backtest 가 같이 읽으므로, 거기를 자르면 이 결정이 닿을 이유가 없는 화면
#: 셋이 같이 잘린다.
MAX_YEARS = 3.0

#: 랭크 백분위의 창 — 52주는 기존 수준 통계(derive.ANNUAL_OBS)와 같은 252관측,
#: 전체 이력은 movePct 와 같은 규칙(민평은 2020~ 라 6.6년이 된다 — rv1 PN-1).
ANNUAL_OBS = 252

#: "지난주" = 직전 5영업일 [OWNER 2026-08-20 — 사분면 y축]. 한 값이 아니라
#: 평균을 쓰는 이유는 하루치 민평이 고시 잡음을 그대로 싣기 때문이다 —
#: 백분위는 그 잡음에 계단으로 반응한다.
LAST_WEEK_OBS = 5

#: **스프레드의 앵커** — 섹터마다 무엇 대비로 재나 [트레이더 피드백 2026-08-20].
#:
#: 전에는 전 섹터가 국고 대비였다. 그 세계에서는 특은채와 카드채가 **둘 다**
#: 자기 이력의 75~80% 에 있어도 일드가 높은 카드가 늘 이긴다 — 두 백분위가
#: 같으니 남는 차이가 캐리뿐이기 때문이다. 트레이더의 지적이 그 형태였고,
#: 해법은 **특은채를 앵커로 세우는 것**이다: 그러면 카드채의 숫자가 "특은 대비
#: 붙었나 벌어졌나"가 되어 크레딧 사다리를 한 칸 올라탄 값이 된다.
#:
#:     앞단  통안·특은·공사  →  국고 대비   (준정부 묶음. 공사채도 정부 보증성
#:                                        이라 여기 [OWNER 2026-08-20 선택])
#:     확산  은행·회사·카드·캐피탈 → 특은 대비  (트레이더가 지목한 "시은/카드/
#:                                        캐/회사")
#:
#: 통안채를 특은 대비로 두지 않은 이유는 부호다 — 통안이 특은보다 타이트해서
#: 전 구간 음수가 되고, 화면의 "넘으면 넓다" 어휘와 뒤집힌다 [OWNER 2026-08-20].
#:
#: 앵커 자신(특은)은 국고 대비로 남는다. 자기 대비로 재면 항상 0 이다.
SPREAD_BASE: dict[str, str] = {
    "MSB": "KTB",
    "KDB": "KTB",
    "SPB": "KTB",
    "BD": "KDB",
    "CB1": "KDB",
    "CARD": "KDB",
    "OFB": "KDB",
}


def base_of(bt: str) -> str:
    """그 섹터의 앵커. 표에 없으면 국고 — 새 종목군이 조용히 빠지지 않게."""
    return SPREAD_BASE.get(bt, "KTB")


def peers_of(bt: str, sectors: list[str]) -> list[str]:
    """같은 앵커를 쓰는 섹터들 — 횡단면(섹터 상대) 비교의 모집단.

    앵커가 갈린 뒤로는 **같은 앵커끼리만** 평균을 낼 수 있다. 특은 대비 6bp 와
    국고 대비 33bp 를 한 평균에 넣으면 그 평균은 아무 양도 아니다.
    """
    b = base_of(bt)
    return [o for o in sectors if base_of(o) == b]


#: 사람이 넣는 bp 값의 한도. **판정의 주인은 서버다** — 화면도 같은 값으로
#: 막지만(RvPage), URL·API 로 우회하면 화면 클램프는 없는 것과 같다.
#: 넘으면 자르지 않고 **거절한다**: 조용히 잘린 값으로 계산해 주면 읽는 사람은
#: 자기가 넣은 숫자가 쓰인 줄 안다(`parse_meetings` 의 "반쯤 해석" 규칙과 같은
#: 판단). 2026-08-20 감사에서 둘 다 무방비였다 — 금통위 9999bp 가 200 으로
#: 통과했고 조달이 102% 인 화면이 아무 말 없이 그려졌다.
MPC_LIMIT_BP = 100.0
PATH_LIMIT_BP = 200.0

#: 재투자 방식 — 워크북 `만기선택!B11` 의 세 갈래 그대로.
#:   none      재투자X (기본 — 앵커 8행이 이 갈래다)
#:   manual    재투자(수기입력) — `reinvest_rate` 를 그대로 쓴다
#:   residual  재투자(잔존만기) — 남은 일수를 테너로 보고 커브에서 보간
REINVEST_MODES = ("none", "manual", "residual")

_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def add_months(d: dt.date, months: int) -> dt.date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    cap = 29 if (m == 2 and leap) else _DAYS[m - 1]
    return dt.date(y, m, min(d.day, cap))


def _clean(y: float, coupon: float, n: int, elapsed: float) -> float:
    d, a, _cp, rd = price(y, coupon, n, elapsed)
    return d - a + rd


def avg_funding(
    base: float, meetings: list[tuple[dt.date, float]], start: dt.date, sale: dt.date, eff: int
) -> float:
    """Appendix A 의 조달 레그: base + Σ(Δbp × 회의 뒤 남은 날)/유효일/10⁴.

    base·반환은 decimal. 후보별 유효기간(만기 보유는 자기 만기까지) 안의 회의만
    친다 — 조달 3.091% 역산(시작 2026-08-14, +25bp 회의 08-27·11-26, 오차
    0.003bp)이 이 식의 앵커다.

    ## 회의 **당일**은 안 센다 — 워크북과 일부러 다르다 [2026-08-20 실측]

        여기      start <  md <= sale
        워크북    start <= md <  sale        (만기선택!F열)

    `md == sale` 은 가중치가 0 이라 어느 쪽이든 같다. 갈리는 것은 **회의가 분석
    시작일 당일인 경우**(연 8일)이고, 그때 워크북은 인상분을 전 구간에 얹고
    여기는 통째로 뺀다 — 앵커 조건에서 25bp 차이다.

    이유는 **base 의 출처가 다르기 때문**이다. 워크북 B6 은 사람이 손으로 적는
    기준금리라 회의 당일 아침에는 아직 옛 값이고, 그래서 그날 회의를 세야 맞다.
    여기 base 는 `funding.rate_on` 의 피드이고 **그 피드는 회의 당일에 이미 새
    값을 싣는다**(2026-07-16 실측: 전일 2.60% → 당일 2.85%). 같은 날 회의를 또
    더하면 25bp 를 두 번 센다.

    두 규약 다 각자 맞다. **워크북에 맞춘다고 이 부등호를 바꾸면 이중계상이
    된다** — `test_rv.py::TestMeetingDayBoundary` 가 그 자리를 지킨다.
    같은 규약이 `path_rate` 와 페이로드의 `meetings` 목록(`d > start`)에도 있고,
    셋은 같이 움직여야 한다.
    """
    extra = 0.0
    for md, dbp in meetings:
        if start < md <= sale:
            extra += (dbp / 10000.0) * (sale - md).days
    return base + (extra / eff if eff else 0.0)


def path_rate(
    base: float, meetings: list[tuple[dt.date, float]], start: dt.date, d: dt.date
) -> float:
    """`d` 시점의 조달 경로 **레벨** (평균이 아니라 그날의 값).

    재투자 구간의 조달을 세울 때 쓴다. 워크북 `만기선택!O열` 은 이 자리에
    `$B$6`(오늘 기준금리)을 그대로 놓아서, 매수 만기일까지 이미 지나간 인상을
    빼먹는다 — 앵커 조건에서 3M 후보의 재투자 조달이 25bp 싸게 잡히고 그 하나로
    수익이 6.3bp 부풀었다(실측). 캐리 쪽(`avg_funding`)은 같은 워크북이 제대로
    적어 두었으므로, **그 규약을 재투자 구간에도 그대로 적용한 것**이 이 함수다.
    """
    # 부등호는 `avg_funding` 과 같아야 한다 — 회의 당일 규약(그 독스트링).
    return base + sum(bp for md, bp in meetings if start < md <= d) / 10000.0


def par_duration(j: float, m: float) -> float:
    """워크북 `만기선택!K열` 의 매도시점 수정듀레이션 — (1/J)·(1 − (1+J/n)^(−n·m)).

    **가격 재구현이 아니다** [세션 규칙의 경계]. `price()` 의 미분을 새로 적는
    것이라면 금지 대상이지만, 이건 워크북이 BEP 분모로 쓰는 **별개 규약**이고
    그 규약이 곧 화면에 나가는 결정 숫자다 [OWNER 2026-08-20 — "엑셀 기준의
    BEP 로 고치기"]. `dv01_at` 과의 일치는 테스트가 잰다(앵커 커브 6행에서
    1e-3년 안).

    `m` 은 **달력 잔존만기**(ACT/365)이고 0.25 플로어를 **안 받는다** — 워크북
    K열이 `MAX(I,0.25)` 가 아니라 `I` 를 그대로 쓴다. 플로어는 매도금리 보간
    (J열)에만 걸린다. 9M 후보에서 이 차이가 듀레이션 0.2481 → 0.2420, BEP
    166.3 → 169.0bp 를 가른다(앵커 실측).
    """
    if j <= 0.0 or m <= 0.0:
        return 0.0
    return (1.0 - (1.0 + j / FREQ) ** (-FREQ * m)) / j


def candidate(
    points: list[tuple[float, float]],
    label: str,
    start: dt.date,
    base: float,
    meetings: list[tuple[dt.date, float]],
    h_months: int = 6,
    reinvest: str = "none",
    reinvest_rate: float = 0.0,
) -> dict[str, Any]:
    """한 후보(커브 노드 합성 채권)의 Appendix A 값 일습. 수익률은 decimal.

    규약은 앵커가 채택한 grid/grid 다: elapsed = H(년), 매도시점 잔존 =
    격자년수 − H. 이 규약 쌍이 Appendix B 와 carry 0.01bp 이내로 맞았다
    (다른 조합은 최대 0.4bp) — 바꾸면 앵커 테스트가 막는다.

    ## 잔존만기가 둘인 이유 [OWNER 2026-08-20 — 워크북 기준]

        m_res  = max(0.25, 격자년수 − H)      매도금리 보간용 (K열 `MAX(I,0.25)`)
        m_cal  = (만기일 − 호라이즌)/365       듀레이션·BEP 용 (K열의 `I` 그대로)

    워크북은 이 둘을 갈라 쓴다. 하나로 합치면 9M 후보의 BEP 가 169.0 → 166.3bp
    로 어긋난다 — 그 2.7bp 가 화면의 결정 숫자다.

    `m_cal` 은 달력이고 `roll` 의 가격 스케줄은 이상화 격자(진입일 + k/4년)라 두
    잔존이 완전히 같지는 않다. **롤은 공용 커널(`price`)을 그대로 쓴다** —
    워크북의 닫힌 식을 여기 다시 적으면 이 리포의 가격 정의가 둘이 되고, 둘이
    어긋나도 아무도 모른다(`cashbond.dv01_at` 이 해석해를 마다한 그 이유).
    남는 차이는 9M 에서 0.37bp 이고 앵커 허용오차가 그것을 잰다(rv1 UV-C).
    """
    if reinvest not in REINVEST_MODES:
        raise ValueError(f"알 수 없는 재투자 방식입니다: {reinvest!r} ({', '.join(REINVEST_MODES)})")
    years = cm.TENOR_YEARS[label]
    y0 = cm.interp(points, years)
    horizon = add_months(start, h_months)
    maturity = add_months(start, round(years * 12))
    sale = min(maturity, horizon)
    eff = (sale - start).days
    f = avg_funding(base, meetings, start, sale, eff)
    carry = (y0 - f) * eff / 365.0
    n = periods_for(label)
    h_years = h_months / 12.0

    if maturity <= horizon:
        # ── 만기 보유 ─────────────────────────────────────────────────────
        # 롤 없음. 듀레이션 0 이라 BEP 는 정의되지 않는다 — 금리 위험이 없다.
        # 대신 만기일부터 호라이즌까지 **재투자 구간**이 산다(워크북 N·O열).
        n_re = (horizon - maturity).days
        residual = reinvest == "residual"
        if reinvest == "none" or n_re <= 0:
            return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                        roll=(lambda dy: 0.0), reinv=(lambda dy: 0.0), dur=0.0,
                        n=n, m_res=0.0, m_cal=0.0, j=None,
                        n_reinv=max(0, n_re), reinvest=reinvest,
                        reinv_rate=None, f_reinv=None, reinv_residual=False)
        # 잔존만기 방식은 남은 일수를 테너로 보고 커브에서 읽는다(0.25Y 플로어 —
        # 워크북의 `MAX(N/365, 0.25)`).
        rate = reinvest_rate if reinvest == "manual" else cm.interp(points, max(0.25, n_re / 365.0))
        # 조달 base 는 **만기일 시점의 경로 레벨**이다(path_rate 독스트링).
        f_re = avg_funding(
            path_rate(base, meetings, start, maturity), meetings, maturity, horizon, n_re
        )
        gain = (rate - f_re) * n_re / 365.0

        def reinv(dy: float, _g: float = gain, _n: int = n_re, _r: bool = residual) -> float:
            # 평행이동은 **잔존만기 방식에만** 닿는다 — 수기입력 금리는 시장이
            # 움직여도 안 바뀐다(워크북 격자의 IF 가지 그대로).
            return _g + (dy * _n / 365.0 if _r else 0.0)

        return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                    roll=(lambda dy: 0.0), reinv=reinv, dur=0.0,
                    n=n, m_res=0.0, m_cal=0.0, j=None,
                    n_reinv=n_re, reinvest=reinvest,
                    reinv_rate=rate, f_reinv=f_re, reinv_residual=residual)

    # ── H 시점 매도 ───────────────────────────────────────────────────────
    m_cal = (maturity - horizon).days / 365.0
    m_res = max(0.25, years - h_years)
    j = cm.interp(points, m_res)
    elapsed = h_years

    def roll(dy: float) -> float:
        return _clean(j + dy, y0, n, elapsed) - 1.0

    dur = par_duration(j, m_cal)  # 워크북 K열 — 매도시점 수정듀레이션(년)
    return dict(label=label, years=years, y0=y0, eff=eff, f=f, carry=carry,
                roll=roll, reinv=(lambda dy: 0.0), dur=dur,
                n=n, m_res=m_res, m_cal=m_cal, j=j,
                n_reinv=0, reinvest=reinvest,
                reinv_rate=None, f_reinv=None, reinv_residual=False)


def tr(c: dict, dy: float = 0.0) -> float:
    """H 보유 총수익(decimal) — 완전 재가격이다(롤이 price 호출이므로).

    워크북 M열 = 캐리 + 롤 + 재투자수익. 세 항의 합이라는 것이 화면의 항등식이고
    `_sector_block` 이 셋을 따로 싣는다.
    """
    return c["carry"] + c["roll"](dy) + c["reinv"](dy)


def tr_path(c: dict, path: list[tuple[float, float]]) -> float:
    """**비평행** 커브 경로에서의 H 보유 총수익 — 워크북 케이스 C/C-2.

    `path` 는 (년수, Δbp) 정렬 목록이다. 평행이동이 스칼라 Δy 하나를 매도금리에
    더하는 자리에, 이건 **그 후보의 잔존만기 지점에 보간한 Δ** 를 더한다
    (워크북 E열 = `Δ보간(bp) @잔존 m`). 그래서 같은 경로가 후보마다 다른 크기로
    닿는다 — 베어 플래트닝이 단기물은 안 건드리고 3Y 만 때리는 그 모양이다.

    만기 보유 후보에는 매도금리가 없으므로 Δ 는 **재투자 구간에만** 닿는다
    (그것도 잔존만기 방식일 때만 — `reinv` 의 IF 가지와 같은 규칙).
    """
    if c["dur"] == 0.0:
        if not c["reinv_residual"]:
            return tr(c, 0.0)
        d = cm.interp(path, max(0.25, c["n_reinv"] / 365.0))
        return c["carry"] + c["reinv"](d / 1e4)
    d = cm.interp(path, c["m_res"])
    return tr(c, d / 1e4)


def upper_hull(cands: list[dict]) -> list[dict]:
    """(dur, TR₀) 상단 볼록껍질 — dur 오름차순, 기울기 감소열만 남긴다.

    **오른쪽(고듀레이션) 가장자리도 껍질이다.** TR 이 낮아도 충분히 음의
    Δy(랠리)에서는 이긴다 — 지배 필터를 걸면 KTB 30Y 같은 승자를 잘못
    지운다(rv1 실측 그대로).
    """
    pts = sorted(cands, key=lambda c: (c["dur"], -tr(c)))
    ded: list[dict] = []
    for c in pts:  # 같은 dur 는 TR 최대만
        if ded and abs(ded[-1]["dur"] - c["dur"]) < 1e-12:
            continue
        ded.append(c)
    hull: list[dict] = []
    for c in ded:
        while len(hull) >= 2:
            a, b = hull[-2], hull[-1]
            s1 = (tr(b) - tr(a)) / (b["dur"] - a["dur"])
            s2 = (tr(c) - tr(b)) / (c["dur"] - b["dur"])
            if s2 >= s1:
                hull.pop()
            else:
                break
        hull.append(c)
    return hull


def breakpoints(hull: list[dict]) -> list[tuple[dict, dict, float]]:
    """dur 내림차순 이웃 간 **선형화** 스왑점 Δy*(bp) — Δy 가 커질수록 낮은
    dur 로 간다. 섹터 안은 이걸로 충분하다(C12: 1위 불일치 0)."""
    hs = sorted(hull, key=lambda c: -c["dur"])
    out = []
    for a, b in zip(hs, hs[1:]):
        dy = (tr(a) - tr(b)) / (a["dur"] - b["dur"]) * 1e4
        out.append((a, b, dy))
    return out


def refine_breakpoint(a: dict, b: dict, dy_lin: float, span_bp: float = 5.0) -> float:
    """풀 경계의 스왑점을 **재가격 이분법**으로 다듬는다(C12: 선형화 경계가
    최대 ±1bp 이동하고, 그 숫자가 그대로 화면의 결정 숫자다).

    g(dy) = TR_a(dy) − TR_b(dy) 의 부호가 [dy*−span, dy*+span] 안에서 바뀌는
    구간을 찾아 1e-3bp 까지 좁힌다. 안 바뀌면(순수 접선 등) 선형화 값을 그대로
    돌려준다 — 지어내지 않는다.
    """
    def g(dy_bp: float) -> float:
        d = dy_bp / 1e4
        return tr(a, d) - tr(b, d)

    lo, hi = dy_lin - span_bp, dy_lin + span_bp
    glo, ghi = g(lo), g(hi)
    if glo == 0.0:
        return lo
    if ghi == 0.0:
        return hi
    if glo * ghi > 0:
        return dy_lin
    for _ in range(40):
        mid = (lo + hi) / 2.0
        gm = g(mid)
        if gm == 0.0:
            return mid
        if glo * gm < 0:
            hi, ghi = mid, gm
        else:
            lo, glo = mid, gm
    return (lo + hi) / 2.0


def winners_in_window(cands: list[dict], lo: int = -WINDOW_BP, hi: int = WINDOW_BP) -> dict:
    """1bp 격자에서 재가격 승자와 그 구간. **표시 보조**다 — 결정 숫자는 스왑점
    목록이다(격자는 껍질 멤버를 건너뛸 수 있다 — 모듈 독스트링의 실측)."""
    win: dict[tuple[str, str], list[int]] = {}
    for dy in range(lo, hi + 1):
        best = max(cands, key=lambda c: tr(c, dy / 1e4))
        key = (best.get("sector", "-"), best["label"])
        win.setdefault(key, []).append(dy)
    return win


# ── 스프레드 통계 (레인 B 와 크레딧 RV) ─────────────────────────────────────


def aligned_spread(m: cm.CreditMatrix, bt: str, label: str) -> list[float | None] | None:
    """섹터 − **그 섹터의 앵커** 동일 테너 스프레드(bp), `m.dates` 에 자리 맞춤.

    앵커는 `SPREAD_BASE` 가 정한다 — 앞단은 국고, 확산 섹터는 특은채다(그 표의
    독스트링에 근거). 한 다리가 빈 날은 None — 이월하면 없던 스프레드를
    지어낸다(universe._align 의 판단). 자리를 맞추는 이유는 횡단면(섹터 간·
    테너 간) 평균이 **같은 날끼리** 서야 하기 때문이다.
    """
    a = m.values.get((bt, label))
    k = m.values.get((base_of(bt), label))
    if a is None or k is None:
        return None
    out: list[float | None] = [
        None if x is None or y is None else (x - y) * 100.0 for x, y in zip(a, k)
    ]
    return out if any(v is not None for v in out) else None


def spread_series(m: cm.CreditMatrix, bt: str, label: str) -> list[float] | None:
    """위의 압축판 — 관측이 있는 날만. 레인 B 백분위가 먹는 모양."""
    al = aligned_spread(m, bt, label)
    if al is None:
        return None
    out = [v for v in al if v is not None]
    return out or None


def window_vals(seq: list[float | None], window: str) -> list[float]:
    """창 적용 후 관측만 — 52주는 마지막 252**일**(자리 기준), 전체는 전부."""
    xs = seq if window == "all" else seq[-ANNUAL_OBS:]
    return [v for v in xs if v is not None]


def vol_3m(seq: list[float | None], window: str) -> float | None:
    """3M(63영업일) 실현 스프레드 변동성 — 겹침 변화의 표준편차(bp).

    Score 절대축 입력의 분모다(`spread_vol_hist_series`). 관측이 얇으면
    (변화 26개 = 약 한 분기 미만) None — 지어낸 σ 로 나눈 배수는 숫자처럼
    보이는 잡음이다.

    표시축이었던 Coverage(σ)는 2026-08-20 에 은퇴했지만 **이 분모는 살아
    남았다** — 그것이 Score 에서 하는 일은 σ 를 보여 주는 게 아니라 수준을
    깎는 것이고, 그 일은 축이 바뀌어도 그대로 필요하다(아래 실측)."""
    step = 63
    ch = [seq[i] - seq[i - step]  # type: ignore[operator]
          for i in range(step, len(seq))
          if seq[i] is not None and seq[i - step] is not None]
    ch = ch if window == "all" else ch[-ANNUAL_OBS:]
    if len(ch) < 26:
        return None
    mean = sum(ch) / len(ch)
    var = sum((v - mean) ** 2 for v in ch) / (len(ch) - 1)
    return var ** 0.5 if var > 0 else None


def spread_vol_hist_series(seq: list[float | None]) -> list[float | None]:
    """proxy(t) = s(t) ÷ vol3m(t) — **Score 절대축의 점수 입력**.

    vol3m(t) 는 t 까지의 겹침 63일 변화 중 마지막 252자리 창의 σ(최소 26관측)
    — 오늘 하나만 계산하던 `vol_3m` 의 시점별 판이고, 롤링 누적합으로 O(n)
    이다(74계열 × 1,600일 × 2회가 요청 경로에 있다).

    ## 이 나눗셈이 남은 이유, 그리고 남지 않은 이유 [2026-08-20 실측]

    한때 이름이 `coverage_hist_series` 였고 근거가 "buffer ≈ k·s 라 Coverage 의
    분포 위치는 s/vol3m 의 위치와 같다" 였다. 버퍼가 아웃라이트로 옮겨 가며 그
    **근거는 깨졌지만 양 자체는 안 깨졌다** — s/vol3m 은 버퍼를 안 쓴다.

    남긴 이유는 **연속성**이다: [OWNER 2026-08-19] 가 고른 통계이고, 2026-08-20
    의 지시는 사분면 축이었지 점수 입력이 아니었다.

    **감쇠 효과는 오늘 데이터에서 확인되지 않았다.** 같은 항목 집합(3Y 상한 49개)
    에서 Score 의 절대축 입력만 갈아 끼운 A/B:

        입력                        수준 ↔ Score 상관   최광폭 섹터 상위10 점유
        s/vol3m 백분위 (현행)            +0.798                3개
        지난주 스프레드 백분위             +0.790                3개
        월환산 총수익 (안 쓰는 것)          +0.796                3개

    입력 자체의 수준 상관도 s/vol3m +0.724 vs 스프레드 +0.685 로, 나눗셈이
    **오히려 조금 더 붙어 있다**. 셋 중 무엇을 넣든 상관이 ~+0.79 인 것은 Score
    의 나머지 절반(relRv)과 그날의 시장 상태가 그 값을 지배하기 때문이다.

    (이 A/B 를 처음 쟀을 때 +0.255 vs +0.790 이 나왔는데, 그건 옛 판이 10Y 까지
    보고 새 판이 3Y 까지 봐서 **유니버스가 달랐던** 교란이었다. 상한을 맞추면
    차이가 사라진다. 입력을 바꿀 근거로 쓸 수 있는 측정이 아니었다.)

    그래서 이 자리는 "수준 오염을 막는 장치"로 **선전하지 않는다**. 원칙 ③ 을
    지키는 것은 이 나눗셈이 아니라 세 입력 다 자기 이력 백분위라는 사실이다.

    ## 수준 상관을 실제로 낮춘 것은 앵커였다 [2026-08-20, 같은 날 실측]

    같은 날 데이터로, 스프레드 앵커를 갈기 전/후:

        Score ↔ 신용위험 프리미엄(국고 대비 bp)   +0.79 → **+0.60**
        최광폭 섹터(캐피탈)의 상위 10 점유          3개 → **1개**
        사다리 하단−상단 Score 평균 차               —  → **17.9**(독식이면 25↑)

    점수 입력이 아니라 **재는 자**를 바꾼 것이 답이었다(`SPREAD_BASE`).

    대조로 남겨 둘 숫자: 월환산 총수익(사분면 x축)은 같은 축과 **+0.743** 으로
    붙어 있다 — 캐리는 신용위험을 따라갈 수밖에 없다. 그래서 그 축은 보는
    숫자로만 두고 점수에 안 넣는다.

    사분면 y축(`pctLastWeek`)과 이 통계는 그래도 **다른 값이다**(위 상관 차이가
    그 증거) — 하나는 보는 축, 하나는 점수 입력이라 다른 이름으로 산다."""
    step = 63
    win = ANNUAL_OBS
    n = len(seq)
    out: list[float | None] = [None] * n
    # 창 안 유효 변화의 (개수, 합, 제곱합) — 자리 기준 롤링.
    ch: list[float | None] = [None] * n
    m = 0
    s1 = 0.0
    s2 = 0.0
    for i in range(n):
        if i >= step and seq[i] is not None and seq[i - step] is not None:
            ch[i] = seq[i] - seq[i - step]  # type: ignore[operator]
            m += 1
            s1 += ch[i]  # type: ignore[arg-type]
            s2 += ch[i] * ch[i]  # type: ignore[operator]
        j = i - win  # 창을 벗어나는 자리
        if j >= 0 and ch[j] is not None:
            m -= 1
            s1 -= ch[j]  # type: ignore[arg-type]
            s2 -= ch[j] * ch[j]  # type: ignore[operator]
        if seq[i] is None or m < 26:
            continue
        var = (s2 - s1 * s1 / m) / (m - 1)
        if var <= 0:
            continue
        out[i] = seq[i] / (var**0.5)  # type: ignore[operator]
    return out


def last_week_mean(seq: list[float | None], end_i: int) -> float | None:
    """직전 `LAST_WEEK_OBS` 영업일의 스프레드 평균 — 사분면 y축의 랭크 대상.

    `end_i` 를 포함해 뒤로 5자리를 보고, **관측이 있는 것만** 평균한다(0=결측
    규칙은 상류가 이미 지켰고 여기서는 자리 결측만 남는다). 5자리가 전부 비면
    None — 이월해 지어내지 않는다(`aligned_spread` 와 같은 판단).
    """
    lo = max(0, end_i + 1 - LAST_WEEK_OBS)
    vals = [v for v in seq[lo : end_i + 1] if v is not None]
    return sum(vals) / len(vals) if vals else None


def rank_pct(series: list[float], now: float) -> float:
    """랭크 백분위 — now 이하 관측의 비율(%). 기존 `pct`(52주 min-max 위치)와
    **다른 통계라 다른 이름**을 쓴다. 중앙(50)에서의 이탈이 레인 B 틴트다."""
    n = len(series)
    if n == 0:
        return 50.0
    return sum(1 for v in series if v <= now) / n * 100.0


def mid_rank_pct(series: list[float], now: float) -> float:
    """midrank 백분위 — 동률을 절반으로 센다. `rank_pct`(≤ 전부)와 **다른
    통계라 다른 이름**: covPct 처럼 동률이 정상 상태인 계열(변화 없는 날들)에서
    ≤-셈은 상수 구간을 100%("늘 후하다")로 읽는 왜곡이 있다."""
    n = len(series)
    if n == 0:
        return 50.0
    less = sum(1 for v in series if v < now)
    ties = sum(1 for v in series if v == now)
    return (less + ties / 2.0) / n * 100.0


def z_score(series: list[float], now: float) -> float | None:
    n = len(series)
    if n < 2:
        return None
    mean = sum(series) / n
    var = sum((v - mean) ** 2 for v in series) / (n - 1)
    sd = var ** 0.5
    return (now - mean) / sd if sd > 0 else None


# ── 페이로드 ────────────────────────────────────────────────────────────────


def parse_meetings(raw: str) -> list[tuple[dt.date, float]]:
    """`2026-08-27:-25;2026-10-22:0` → [(date, bp)]. 모양이 안 맞는 조각은
    **거절한다**(422 로) — 반쯤 해석한 경로로 계산하면 조용히 틀린다.

    크기도 거절한다(±`MPC_LIMIT_BP`) — 그 상수의 독스트링에 근거가 있다."""
    out: list[tuple[dt.date, float]] = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        d, sep, bp = part.partition(":")
        if not sep:
            raise ValueError(f"날짜:bp 모양이 아니에요: {part!r}")
        v = float(bp)
        if abs(v) > MPC_LIMIT_BP:
            raise ValueError(f"금통위 변동이 범위를 벗어나요: {v:g}bp (±{MPC_LIMIT_BP:g})")
        out.append((dt.date.fromisoformat(d), v))
    return out


def rv_labels(m: cm.CreditMatrix, bt: str, asof_i: int) -> list[str]:
    """이 화면이 쓰는 테너 목록 — 그 섹터가 그날 실제로 가진 것 ∩ `MAX_YEARS`.

    세 레인이 같은 상한을 보게 하는 한 자리다 [OWNER 2026-08-20]. 상한을 세 곳에
    따로 적으면 하나만 안 고쳐지고, 그 하나가 조용히 다른 유니버스를 말한다.
    """
    return [lab for lab in cm.TENOR_LABELS
            if cm.TENOR_YEARS[lab] <= MAX_YEARS
            and (bt, lab) in m.values and m.values[(bt, lab)][asof_i] is not None]


def parse_paths(raw: str) -> list[list[tuple[float, float]]]:
    """`3M:0,6M:5,9M:10|3M:20,6M:15` → 경로별 (년수, Δbp) 정렬 목록.

    워크북 케이스 C/C-2 의 D열(테너별 Δbp) 두 벌이다. `parse_meetings` 와 같은
    엄격함 — 모양이 안 맞으면 **거절한다**(422). 반쯤 읽은 커브로 재평가하면
    "안 넣은 테너는 0" 처럼 보이는 조용한 오답이 나온다.

    적어 준 테너만 노드가 되고 나머지는 그 사이 **보간**이다(워크북 E열과 같은
    선형 규칙). 노드 하나면 그 값이 전 구간이 된다 — 평행이동과 같아진다.
    """
    out: list[list[tuple[float, float]]] = []
    for chunk in raw.split("|"):
        chunk = chunk.strip()
        if not chunk:
            continue
        pts: list[tuple[float, float]] = []
        for part in chunk.split(","):
            part = part.strip()
            if not part:
                continue
            lab, sep, bp = part.partition(":")
            lab = lab.strip()
            if not sep or lab not in cm.TENOR_YEARS:
                raise ValueError(f"테너를 읽지 못했어요: {part!r}")
            years = cm.TENOR_YEARS[lab]
            if years > MAX_YEARS:
                raise ValueError(f"{lab} 은 이 화면의 만기 상한({MAX_YEARS:g}년) 밖이에요.")
            v = float(bp)
            if abs(v) > PATH_LIMIT_BP:
                raise ValueError(f"{lab} 변동이 범위를 벗어나요: {v:g}bp (±{PATH_LIMIT_BP:g})")
            pts.append((years, v))
        if not pts:
            raise ValueError("경로가 비어 있어요.")
        pts.sort(key=lambda p: p[0])
        out.append(pts)
    return out


def _sector_block(
    m: cm.CreditMatrix, bt: str, asof_i: int, start: dt.date,
    base: float, meetings: list[tuple[dt.date, float]], h_months: int,
    dys: list[int],
    reinvest: str = "none", reinvest_rate: float = 0.0,
    paths: list[list[tuple[float, float]]] | None = None,
) -> tuple[dict[str, Any], list[dict]]:
    points = cm.curve_points(m, bt, asof_i)
    labels = rv_labels(m, bt, asof_i)
    cands = [candidate(points, lab, start, base, meetings, h_months, reinvest, reinvest_rate)
             for lab in labels]
    for c in cands:
        c["sector"] = bt

    hull = upper_hull(cands)
    hull_set = {id(c) for c in hull}
    bps = breakpoints(hull)
    win = winners_in_window(cands)

    paths = paths or []
    rows = []
    for c in cands:
        key = (bt, c["label"])
        rng = win.get(key)
        rows.append({
            "tenor": c["label"],
            "years": c["years"],
            # 매도시점 수정듀레이션 — BEP 의 분모이자 격자의 기울기.
            "dur": round(c["dur"], 4),
            "carryBp": round(c["carry"] * 1e4, 2),
            "rollBp": round(c["roll"](0.0) * 1e4, 2),
            # 재투자수익(워크북 O열) — 만기가 H 안에 드는 후보에만 산다.
            "reinvBp": round(c["reinv"](0.0) * 1e4, 2),
            "reinvDays": c["n_reinv"],
            "trBp": round(tr(c) * 1e4, 2),
            # 비평행 경로별 총수익 bp — 워크북 케이스 C/C-2 의 F열. 경로가 없으면
            # 빈 배열이고, 화면은 열 자체를 안 그린다.
            "pathTr": [round(tr_path(c, p) * 1e4, 1) for p in paths],
            # 그 경로가 이 후보의 잔존만기 지점에서 실제로 몇 bp 였나(E열) —
            # 같은 경로가 후보마다 다른 크기로 닿는다는 사실을 표가 말한다.
            "pathDy": [
                None if c["dur"] == 0.0 else round(cm.interp(p, c["m_res"]), 1)
                for p in paths
            ],
            # 불리 평행이동을 몇 bp 버티나. 만기 보유는 금리 위험이 없어 None.
            "bepBp": round(tr(c) / c["dur"] * 1e4, 1) if c["dur"] else None,
            "maturityHold": c["dur"] == 0.0,
            "inHull": id(c) in hull_set,
            "winFrom": rng[0] if rng else None,
            "winTo": rng[-1] if rng else None,
            # 격자 열 — 완전 재가격(롤이 price 호출이므로 공짜다). 표시 밀도용.
            "tr": [round(tr(c, dy / 1e4) * 1e4, 1) for dy in dys],
        })

    block = {
        "id": bt,
        "label": cm.BOND_TYPES[bt],
        "candidates": rows,
        # 결정 숫자 — 선형화 스왑점(C12: 섹터 안은 1위 불일치 0). 창 안만 싣되
        # 전 구간 껍질 구성은 candidates.inHull 이 말한다.
        "swapPoints": [
            {"from": a["label"], "to": b["label"], "dyBp": round(dy, 1)}
            for a, b, dy in bps if -WINDOW_BP <= dy <= WINDOW_BP
        ],
        "filtered": len(cands) - len(win),
    }
    return block, cands


def build_rv(
    m: cm.CreditMatrix,
    dataset,
    spec: fd.FundingSpec,
    h_months: int = H_DEFAULT_MONTHS,
    meetings: list[tuple[dt.date, float]] | None = None,
    window: str = "52w",
    reinvest: str = "none",
    reinvest_rate: float = 0.0,
    paths: list[list[tuple[float, float]]] | None = None,
) -> dict[str, Any]:
    """세 구성의 페이로드 전부 — 다섯 파생량(carry_net·roll·매도 듀레이션·BEP·
    스왑점)을 서버가 끝낸다(§16). 프런트는 틴트만.

    `dataset` 은 IRS 싱글턴(main._dataset) — 자산스왑 버퍼와 **소스별 as-of**
    (IRS 와 민평이 1영업일 갈라진 실측 — rv1 C11/B-2)에 쓴다.
    """
    meetings = meetings or []
    asof_i = len(m.dates) - 1
    start = m.dates[asof_i]
    # 조달 = Setting 의 스펙 그대로 (v2 기본 콜금리 — funding.py V2 절의 결정을
    # 경유한다). 금통위 Δbp 는 avg_funding 이 그 위에 얹는다.
    base = fd.rate_on(spec, start)

    dys = list(range(-WINDOW_BP, WINDOW_BP + 1, GRID_STEP_BP))

    paths = paths or []
    sectors = []
    pool: list[dict] = []
    for bt in cm.TYPE_ORDER:
        block, cands = _sector_block(
            m, bt, asof_i, start, base, meetings, h_months, dys,
            reinvest, reinvest_rate, paths,
        )
        sectors.append(block)
        pool.extend(cands)

    # ── 풀 — 껍질은 선형화로, 경계는 재가격 이분법으로 (C12) ────────────────
    pool_hull = upper_hull(pool)
    pool_bps = []
    for a, b, dy_lin in breakpoints(pool_hull):
        dy = refine_breakpoint(a, b, dy_lin)
        pool_bps.append({
            "from": {"sector": a["sector"], "tenor": a["label"]},
            "to": {"sector": b["sector"], "tenor": b["label"]},
            "dyBp": round(dy, 1),
            "dyLinearBp": round(dy_lin, 1),
        })
    pool_win = winners_in_window(pool)

    # ── 레인 B — 섹터 × 테너 랭크 백분위 히트맵 ────────────────────────────
    credit = [bt for bt in cm.TYPE_ORDER if bt != "KTB"]
    heat_tenors = [lab for lab in cm.TENOR_LABELS
                   if cm.TENOR_YEARS[lab] <= MAX_YEARS
                   and any((bt, lab) in m.values for bt in credit)]
    heat_rows = []
    for bt in credit:
        cells: list[dict | None] = []
        for lab in heat_tenors:
            s = spread_series(m, bt, lab)
            if s is None or len(s) < 2:
                cells.append(None)
                continue
            now = s[-1]
            w52 = s[-ANNUAL_OBS:]
            cells.append({
                "tenor": lab,
                "nowBp": round(now, 1),
                "pct52": round(rank_pct(w52, now), 1),
                "pctAll": round(rank_pct(s, now), 1),
                "z52": (lambda z: None if z is None else round(z, 2))(z_score(w52, now)),
                "zAll": (lambda z: None if z is None else round(z, 2))(z_score(s, now)),
                "obs": len(s),
            })
        # 앵커를 행마다 싣는다 — 히트맵 한 장에 두 앵커가 섞이므로 열 머리
        # 하나로는 못 적는다(크레딧 RV 표와 같은 이유).
        heat_rows.append({
            "id": bt,
            "label": cm.BOND_TYPES[bt],
            "base": base_of(bt),
            "baseLabel": cm.BOND_TYPES[base_of(bt)],
            "cells": cells,
        })

    # ── C — 크레딧 RV (정의는 모듈 독스트링 — 코드보다 먼저 쓴 문서) ───────
    credit_payload = credit_block(
        m, spec, meetings, window, reinvest, reinvest_rate, h_months
    )

    return {
        # 소스별 as-of — 장식이 아니라 차단 사항(rv1 B-2: IRS 08-17 vs 민평
        # 08-14 실측). 두 숫자가 다른 날짜를 말하면 화면이 그렇다고 말해야 한다.
        "asof": {
            "creditMatrix": m.asof.isoformat(),
            "irs": dataset.asof.isoformat() if dataset is not None else None,
        },
        "funding": fd.provenance(spec),
        "hMonths": h_months,
        "windowBp": WINDOW_BP,
        # 남은 회의만 — **당일 회의는 안 싣는다**(`d > start`). 조달 피드가 그날
        # 이미 새 값을 싣기 때문이고, 칸을 열어 두면 사용자가 이중계상을 입력할
        # 수 있게 된다. 부등호의 근거는 `avg_funding` 독스트링.
        "meetings": [
            {"date": d.isoformat(), "bp": next((bp for md, bp in meetings if md == d), 0.0)}
            for d in MPC_DATES if d > start
        ],
        "window": window,
        "candidates": len(pool),
        "dys": dys,
        # 이 화면의 만기 상한 — 화면이 "왜 5Y 가 없나"를 스스로 답한다.
        "maxYears": MAX_YEARS,
        # 재투자 규약 — 만기가 H 안에 드는 후보에만 닿는다(워크북 B11).
        "reinvest": {
            "mode": reinvest,
            "rate": reinvest_rate if reinvest == "manual" else None,
        },
        # 비평행 경로 — 화면이 입력한 그대로 되돌려 준다(열 머리에 쓴다).
        "paths": [
            {"nodes": [{"years": y, "bp": bp} for y, bp in p]} for p in paths
        ],
        "sectors": sectors,
        "pool": {
            "hull": [{"sector": c["sector"], "tenor": c["label"]}
                     for c in sorted(pool_hull, key=lambda c: -c["dur"])],
            "swapPoints": [p for p in pool_bps
                           if -WINDOW_BP <= p["dyBp"] <= WINDOW_BP],
            "winners": [
                {"sector": k[0], "tenor": k[1], "from": v[0], "to": v[-1]}
                for k, v in sorted(pool_win.items(), key=lambda kv: kv[1][0])
            ],
        },
        "heat": {"tenors": heat_tenors, "sectors": heat_rows},
        "credit": credit_payload,
    }


# ── 크레딧 RV — 절대축(버퍼)·상대축(RV) 독립, 합성은 그 다음 [원칙 ①] ───────

#: Relative RV 의 가중 (절대·섹터상대·커브) [트레이더 출발값 — 조건 바에 노출].
RV_WEIGHTS = (0.40, 0.40, 0.20)



def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _cross_sector_rel(
    sp: dict[tuple[str, str], list[float | None]], credit: list[str],
    bt: str, lab: str, n_dates: int,
) -> list[float | None]:
    """② 섹터 상대 — 같은 테너의 **횡단면 평균 대비 편차**, 날짜별.

    모집단은 **같은 앵커를 쓰는 섹터들**이다(`peers_of`) — 앵커가 갈린 뒤로
    국고 대비 값과 특은 대비 값을 한 평균에 넣을 수 없다. 그날 그 테너를 가진
    동료가 하나뿐이면 편차 0 이 아니라 None(비교 상대가 없다).
    """
    mine = sp.get((bt, lab))
    if mine is None:
        return [None] * n_dates
    peers = peers_of(bt, credit)
    out: list[float | None] = []
    for i in range(n_dates):
        xs = [sp[(o, lab)][i] for o in peers
              if (o, lab) in sp and sp[(o, lab)][i] is not None]
        v = mine[i]
        out.append(None if v is None or len(xs) < 2 else v - _mean(xs))
    return out


def _curve_rel(
    sp: dict[tuple[str, str], list[float | None]],
    bt: str, lab: str, labs: list[str], n_dates: int,
) -> list[float | None]:
    """③ 커브 — 같은 섹터의 **테너 간 평균 대비 편차**, 날짜별."""
    mine = sp.get((bt, lab))
    if mine is None:
        return [None] * n_dates
    out: list[float | None] = []
    for i in range(n_dates):
        xs = [sp[(bt, o)][i] for o in labs
              if (bt, o) in sp and sp[(bt, o)][i] is not None]
        v = mine[i]
        out.append(None if v is None or len(xs) < 2 else v - _mean(xs))
    return out


def _credit_items(
    m: cm.CreditMatrix,
    spec: fd.FundingSpec,
    meetings: list[tuple[dt.date, float]],
    window: str,
    end_i: int,
    reinvest: str = "none",
    reinvest_rate: float = 0.0,
    h_months: int = H_DEFAULT_MONTHS,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """`end_i` 자리를 "오늘"로 놓은 크레딧 RV 항목 일습 — 시계열을 전부
    `[:end_i+1]` 로 자른 세계에서 계산한다. credit_block 이 오늘과 **전
    영업일**을 이 함수로 두 번 계산해 랭크 Δ 를 만든다(전일의 z·σ·랭크는
    전일까지의 이력만 알아야 한다 — 오늘 관측이 섞이면 미래 참조다)."""
    asof_i = end_i
    start = m.dates[asof_i]
    base = fd.rate_on(spec, start)
    n_dates = asof_i + 1

    credit = [bt for bt in cm.TYPE_ORDER if bt != "KTB"]
    sp: dict[tuple[str, str], list[float | None]] = {}
    for bt in credit:
        for lab in cm.TENOR_LABELS:
            al = aligned_spread(m, bt, lab)
            if al is not None:
                sp[(bt, lab)] = al[:n_dates]

    ktb_points = cm.curve_points(m, "KTB", asof_i)

    items: list[dict[str, Any]] = []
    excl: list[dict[str, str]] = []
    for bt in credit:
        points = cm.curve_points(m, bt, asof_i)
        labs = [lab for lab in cm.TENOR_LABELS if (bt, lab) in sp]
        for lab in labs:
            if cm.TENOR_YEARS[lab] > MAX_YEARS:
                # 만기 상한 밖 [OWNER 2026-08-20] — 조용히 빼지 않는다.
                excl.append({
                    "id": f"{bt}:{lab}",
                    "label": f"{cm.BOND_TYPES[bt]} {lab}",
                    "reason": f"{MAX_YEARS:g}년 초과 — 이 화면은 3년까지만 봐요.",
                })
                continue
            seq = sp[(bt, lab)]
            now = seq[asof_i]
            if now is None:
                continue  # 그날 스프레드가 없다 — 이월하지 않는다

            # ── 절대축: **아웃라이트 금리축 BEP** (워크북 Q/R/S열) ──────────
            # [OWNER 2026-08-20 — "엑셀 기준의 BEP 로 고치기"]. 전신은 국고 헤지
            # 페어의 스프레드축 버퍼(트레이더 설계안 원칙 ②)였고, 조달이 두
            # 다리에서 소거되어 금리 효과가 이 축에 안 남는 것이 그 설계의 요점
            # 이었다. 워크북은 같은 트레이더의 것이면서 **아웃라이트**로 잰다 —
            # 두 문서가 다른 축을 말하고 있었고, 워크북 쪽으로 통일했다.
            # 결과: 조달이 더 이상 상쇄되지 않고 캐리에 그대로 남는다.
            cb = candidate(points, lab, start, base, meetings, h_months,
                           reinvest, reinvest_rate)
            if cb["dur"] == 0.0:
                excl.append({
                    "id": f"{bt}:{lab}",
                    "label": f"{cm.BOND_TYPES[bt]} {lab}",
                    "reason": "만기 보유(H 안에 만기) — 금리 위험이 없어 버퍼가 정의되지 않아요.",
                })
                continue
            carry_bp = cb["carry"] / cb["dur"] * 1e4
            roll_bp = cb["roll"](0.0) / cb["dur"] * 1e4
            buffer_bp = carry_bp + roll_bp

            # ── 사분면 x축: **월환산 총수익** [OWNER 2026-08-20] ─────────────
            # 듀레이션으로 **안 나눈** 값이다 — "한 달에 몇 bp 버나". 버퍼(위)와
            # 순서가 반대로 나오는 별개 숫자이고(짧은 만기는 듀가 작아 버퍼가
            # 크지만 버는 돈은 적다), 트레이더가 BEP 를 읽기 어렵다고 한 자리를
            # 이 숫자가 대신한다. H 로 나누므로 레인 A(6M)와 크레딧(3M)의 H 가
            # 달라도 같은 자로 읽힌다.
            tr_month_bp = tr(cb) * 1e4 / h_months

            # ── 사분면 y축: **지난주 스프레드의 52주 백분위** [OWNER 2026-08-20]
            # "지난주 벌어진 스프레드가 과거 52주 대비 백분위 몇이었냐". 오늘
            # 한 값이 아니라 직전 5영업일 **평균**을 랭크한다(LAST_WEEK_OBS).
            # 분포는 창(52주/전체) 규칙을 그대로 따른다.
            # 동률은 midrank — 상수 계열이 100%로 읽히면 "늘 넓다"가 되는 왜곡
            # (`mid_rank_pct` 를 세운 그 이유, 8/19).
            # Score 절대축 입력 — 표시축이 아니다(독스트링의 두 백분위 구분).
            proxy = spread_vol_hist_series(seq)
            p_now = proxy[asof_i]
            p_hist = window_vals(proxy, window)
            sv_pct = (
                mid_rank_pct(p_hist, p_now)
                if p_now is not None and len(p_hist) >= 26
                else None
            )

            lw = last_week_mean(seq, asof_i)
            hist = window_vals(seq[: asof_i + 1], window)
            pct_last_week = (
                mid_rank_pct(hist, lw) if lw is not None and len(hist) >= 2 else None
            )

            # ── 상대축: z 3성분 (전부 deviation — 원칙 ③) ───────────────────
            w = window_vals(seq, window)
            z1 = z_score(w, now)
            pct = rank_pct(w, now)
            fair = _mean(w) if w else None
            cheap = None if fair is None else now - fair

            rel = _cross_sector_rel(sp, credit, bt, lab, n_dates)
            rel_now = rel[asof_i]
            z2 = z_score(window_vals(rel, window), rel_now) if rel_now is not None else None

            cur = _curve_rel(sp, bt, lab, labs, n_dates)
            cur_now = cur[asof_i]
            z3 = z_score(window_vals(cur, window), cur_now) if cur_now is not None else None

            w1, w2, w3 = RV_WEIGHTS
            rel_rv = (
                None if z1 is None or z2 is None or z3 is None
                else w1 * z1 + w2 * z2 + w3 * z3
            )

            via = SHORTABLE.get(cm.TENOR_YEARS[lab])
            items.append({
                "sector": bt,
                "sectorLabel": cm.BOND_TYPES[bt],
                # 앵커 — 화면이 "무엇 대비 스프레드인지"를 행마다 말해야 한다.
                # 한 표에 두 앵커가 섞이므로 열 머리 하나로는 못 적는다.
                "base": base_of(bt),
                "baseLabel": cm.BOND_TYPES[base_of(bt)],
                "tenor": lab,
                "years": cm.TENOR_YEARS[lab],
                "nowBp": round(now, 1),
                # 절대축 — 워크북 Q/R/S열(아웃라이트 금리축). 조달은 캐리에 남는다.
                "carryBp": round(carry_bp, 1),
                "rollBp": round(roll_bp, 1),
                "bufferBp": round(buffer_bp, 1),
                # ── 사분면 두 축 [OWNER 2026-08-20] ─────────────────────────
                # x — 월환산 총수익 bp(듀레이션으로 안 나눔)
                "trMonthBp": round(tr_month_bp, 2),
                # y — 지난주 스프레드의 창 백분위
                "pctLastWeek": None if pct_last_week is None else round(pct_last_week, 1),
                "lastWeekBp": None if lw is None else round(lw, 1),
                # Score 절대축 입력 — 사분면 y축과 **다른 통계**다(수준 감쇠가
                # 들어간다). 화면은 이력창에서만 이 값을 보여 준다.
                "spreadVolPct": None if sv_pct is None else round(sv_pct, 1),
                # 상대축 — 성분을 따로 싣는다(독립 숫자 먼저 — 원칙 ①)
                "pct": round(pct, 1),
                "cheapBp": None if cheap is None else round(cheap, 1),
                "zAbs": None if z1 is None else round(z1, 2),
                "zSector": None if z2 is None else round(z2, 2),
                "zCurve": None if z3 is None else round(z3, 2),
                "relRv": None if rel_rv is None else round(rel_rv, 2),
                "shortable": via is not None,
                "shortVia": via,
                "seriesId": f"CRD-{bt}-{lab}",
            })

    # ── 합성은 그 다음 — Total RV Score 50:50 [출발값] ─────────────────────
    # 절대축 = **spreadVolPct**(s/vol3m 의 자기 이력 백분위),
    # 상대축 = relRv 의 오늘 후보 간 랭크 백분위.
    #
    # 2026-08-20 에 이 자리를 사분면 y축(`pctLastWeek`)으로 바꿨다가 되돌렸다.
    # 지시는 사분면 축이었고 점수 입력은 범위 밖이었다 — 그 이유 하나로 되돌린
    # 것이지, 새 입력이 나빠서가 아니다. A/B 는 셋이 사실상 같다고 말한다
    # (`spread_vol_hist_series` 독스트링의 표).
    #
    # 월환산 총수익(사분면 x축)만은 별개로 안 들어간다 — 자기 이력 백분위가
    # 아니라 **오늘의 크기**라, 원칙 ③(deviation 만 점수화)을 정면으로 어긴다.
    rels = [it["relRv"] for it in items if it["relRv"] is not None]
    for it in items:
        if it["spreadVolPct"] is None or it["relRv"] is None or len(rels) < 2:
            it["score"] = None
            continue
        it["score"] = round(
            0.5 * it["spreadVolPct"] + 0.5 * rank_pct(rels, it["relRv"]), 1
        )

    return items, excl


def _rank_map(items: list[dict[str, Any]]) -> dict[str, int]:
    """seriesId → 랭크(1 = 최고 Score). Score 없는 항목은 랭크가 없다.
    동점은 seriesId 로 갈라 결정적으로 — 표시 순서가 날마다 흔들리면 안 된다."""
    scored = sorted(
        (it for it in items if it["score"] is not None),
        key=lambda it: (-it["score"], it["seriesId"]),
    )
    return {it["seriesId"]: i + 1 for i, it in enumerate(scored)}


def credit_block(
    m: cm.CreditMatrix,
    spec: fd.FundingSpec,
    meetings: list[tuple[dt.date, float]],
    window: str,
    reinvest: str = "none",
    reinvest_rate: float = 0.0,
    h_months: int = H_DEFAULT_MONTHS,
) -> dict[str, Any]:
    """크레딧 RV 페이로드 — 정의는 모듈 독스트링의 "크레딧 RV 의 계산 정의".

    랭크와 **랭크 Δ**(전 영업일 대비, 양수 = 올라옴)까지 서버가 끝낸다(§16)
    [OWNER 2026-08-19 — "매일 보는 화면에 어제 대비가 없으면 정적 사진"].
    전일 랭크는 전일까지의 이력만 아는 세계(`_credit_items(end_i-1)`)에서
    다시 계산한다 — 오늘 커브·오늘 관측이 섞이면 미래 참조다. 어제 없던
    항목(신규·전일 결측)은 Δ 가 None 이다.
    """
    asof_i = len(m.dates) - 1
    items, excl = _credit_items(
        m, spec, meetings, window, asof_i, reinvest, reinvest_rate, h_months
    )
    rank = _rank_map(items)
    prev_rank: dict[str, int] = {}
    if asof_i >= 1:
        prev_items, _ = _credit_items(
            m, spec, meetings, window, asof_i - 1, reinvest, reinvest_rate, h_months
        )
        prev_rank = _rank_map(prev_items)
    for it in items:
        r = rank.get(it["seriesId"])
        p = prev_rank.get(it["seriesId"])
        it["rank"] = r
        it["rankDelta"] = None if r is None or p is None else p - r

    return {
        "hMonths": h_months,
        "weights": {"abs": RV_WEIGHTS[0], "sector": RV_WEIGHTS[1], "curve": RV_WEIGHTS[2]},
        "items": items,
        "exclusions": excl,
    }


def credit_history(m: cm.CreditMatrix, bt: str, lab: str, window: str) -> dict[str, Any]:
    """클릭 상세의 두 소형 차트 — 스프레드 이력과 섹터 상대(횡단면 평균 대비)
    이력, 각각의 창 통계(평균·σ — ±σ 밴드가 이걸 그린다).

    **points 도 창으로 자른다** — 통계만 창을 적용하고 그림은 전체를 실으면
    밴드와 선이 다른 모집단이 되고, 화면 라벨("52주")이 거짓이 된다
    (2026-08-19 크리틱 P0: 라벨 52주 아래 2020~ 전체 1,625점이 그려져 있었다).
    자르는 규칙은 `window_vals` 와 같은 자리 기준(마지막 252일)이다."""
    if bt == "KTB" or bt not in cm.BOND_TYPES:
        raise cm.CreditMatrixError(f"크레딧 섹터가 아닙니다: {bt!r}")
    seq = aligned_spread(m, bt, lab)
    if seq is None:
        raise cm.CreditMatrixError(f"스프레드 계열이 없습니다: {bt} {lab}")
    credit = [x for x in cm.TYPE_ORDER if x != "KTB"]
    sp = {(bt, lab): seq}
    for o in credit:
        al = aligned_spread(m, o, lab)
        if al is not None:
            sp[(o, lab)] = al
    rel = _cross_sector_rel(sp, credit, bt, lab, len(m.dates))

    def stats(xs: list[float | None]) -> dict[str, float | None]:
        w = window_vals(xs, window)
        nowv = next((v for v in reversed(xs) if v is not None), None)
        if len(w) < 2 or nowv is None:
            return {"now": nowv, "mean": None, "sd": None}
        mean = _mean(w)
        var = sum((v - mean) ** 2 for v in w) / (len(w) - 1)
        return {"now": round(nowv, 2), "mean": round(mean, 2),
                "sd": round(var ** 0.5, 2) if var > 0 else None}

    i0 = 0 if window == "all" else max(0, len(m.dates) - ANNUAL_OBS)
    pts = [
        {"t": d.isoformat(), "s": None if s is None else round(s, 2),
         "rel": None if r is None else round(r, 2)}
        for d, s, r in zip(m.dates[i0:], seq[i0:], rel[i0:])
        if s is not None
    ]
    return {
        "sector": bt,
        "sectorLabel": cm.BOND_TYPES[bt],
        # 앵커 — 차트 제목이 "국고 대비"로 고정돼 있으면 확산 섹터에서 거짓이
        # 된다(그쪽은 특은 대비다). 제목이 이 값을 읽는다.
        "base": base_of(bt),
        "baseLabel": cm.BOND_TYPES[base_of(bt)],
        # 횡단면 동료 수 — "같은 테너 횡단면"이 몇 개짜리인지 화면이 말해야
        # 한다. 앵커가 갈리며 모집단이 7 → 3/4 로 줄었다.
        "peers": len(peers_of(bt, credit)),
        "tenor": lab,
        "window": window,
        "points": pts,
        "spread": stats(seq),
        "rel": stats(rel),
    }
