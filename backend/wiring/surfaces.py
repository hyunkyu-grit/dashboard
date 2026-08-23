# -*- coding: utf-8 -*-
"""Model·Method 두 면이 읽는 정적 JSON 을 만든다 — 세션 3.

    python -m wiring.surfaces

내는 것 (모두 `backend/output/`, 그리고 프런트 슬롯으로 복사):

    model_surface.json     방정식 등록부 · 계수표 · 미인쇄 인구조사
    method_surface.json    해석 원장 · 한계 · 스코어카드 · 자유모수 공개
    basis_pre_0821.json    8/21 이전 기저 (순열 과적합판) — 비교 토글용
    backtest_2021_cycle.json  막는 것 목록 + 정합성 점검 실측

## 규율

- **UI 는 엔진을 import 하지 않는다.** 이 스크립트가 경계다.
- 스코어카드 값은 **엔진을 돌려서** 채운다. 다른 파일에서 베끼지 않는다 —
  베끼면 그 파일이 틀렸을 때 같이 틀린다(실제로 그런 자리를 하나 찾았다,
  `output/model_method_diagnosis.md` C.12).
- 원장의 모든 행은 **논문 인용과 코드 참조를 둘 다** 든다. 하나라도 없으면
  `guards/model-method-ledger.test.ts` 가 빌드를 세운다.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import yaml

from wiring.paper_pages import EQUATION_PAGE

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
FRONT = ROOT.parent / "src" / "lab" / "model"

OLD_BASIS_COMMIT = "3809d57"
OLD_BASIS_PATH = "src/lab/scenario/basis.json"


# ── 방정식 등록부 ────────────────────────────────────────────────────────────
#
# 44개 인쇄식. `printed` 는 논문이 인쇄한 형태를 말로 옮긴 것이고, `implemented`
# 는 코드가 실제로 계산하는 것이다. **둘이 다르면 둘 다 보여준다.**
#
# `wired` 는 배선 그래프에서 **유도한다** — 손으로 적지 않는다.
EQUATIONS = [
    ("1", "국내 블록 개요", "expenditure", "블록 구성", None),
    ("2", "PAC 목적함수", "framework", "다항조정비용 문제의 목적함수", None),
    ("3", "PAC 1계조건", "framework",
     "오차수정 + AR + 기대 목표변화의 할인합", None),
    ("4", "해외 블록 수입갭", "external",
     "블록 j 의 수입갭 = λ_j × 산출갭", "eq (4) 의 c·τ 를 읽은 대로 쓰면 "
     "무역탄력성이 믿기 어려울 만큼 작아져요. 그래서 수출수요 지수를 "
     "**수입갭이 아니라 산출갭**으로 세웠어요(WIRING_DEMAND_OUTPUTGAP)."),
    ("5", "해외 블록 산출갭 — 유가", "external",
     "유가가 블록마다 산출갭에 **음으로** 들어가요", None),
    ("6", "해외 블록 산출갭 — 스필오버", "external",
     "스필오버 항. 논문이 계수를 안 실었어요", "스필오버 대상을 미국 갭 "
     "하나로 뒀어요(WIRING_SPILLOVER)."),
    ("7", "민간소비 목표", "expenditure", "c* = β_c0 + β_c1·부채 + 더미 둘", None),
    ("8", "민간소비 PAC", "expenditure",
     "오차수정 + AR + **기대 목표변화 할인합** + Δŷ + 가계금리 + Δ부채 + 실질구매력",
     "실질구매력 항은 꺼져 있어요(WIRING_PURCH_OFF) — 논문 자신이 판단기반 "
     "외생이라 부르는 자리예요. 기대항은 **여기에만** 배선돼 있어요."),
    ("9", "설비투자 목표", "expenditure",
     "I* = β_I0 + β_I1·잠재산출 + β_I2·코로나더미 **− UC_I**",
     "2026-08-21 에 `− UC_I` 를 배선했어요. 편차 공간에서 앞의 셋은 상수·추세·"
     "더미라 전부 0 이 되고, **목표가 곧 `−UC_I`** 예요."),
    ("10", "설비투자 자본 사용자비용", "expenditure",
     "UC_I = (기업대출금리 + 회사채금리)/2 − CPI상승률/4 + 감가상각률",
     "배선돼 있어요. 감가상각률은 외생이라 편차가 0 이에요"
     "(DELTA_I_EXOGENOUS). 건설(eq 13)은 물가항의 부호가 반대인데, 그 비대칭은 "
     "논문 것이라 양쪽 다 인쇄된 대로 뒀어요."),
    ("11", "설비투자 PAC", "expenditure",
     "오차수정 + AR + **기대 할인합** + γ_I1 Δŷ + γ_I2 Δln P_I + γ_I3 ln DRAM",
     "배선된 것은 오차수정·AR·Δŷ 셋이고, 오차수정이 이제 **전분기 목표**를 "
     "읽어요(인쇄된 대로). 기대항 없음(PAC_EXPECTATION_OMITTED — 목표가 0 이 "
     "아니게 됐으니 이제 근사예요), 투자디플레이터는 외생이라 편차에서 0 "
     "(GAMMA_I2_EXOG_ZERO), DRAM 지수는 Gartner 유료라 없음."),
    ("12", "건설투자 목표", "expenditure",
     "IH* = β_IH0 + β_IH1·잠재산출 + β_IH2·건축착공 − UC_IH", None),
    ("13", "건설투자 사용자비용", "expenditure",
     "UC_IH — eq (10) 과 같은 꼴이되 물가항의 부호가 반대예요", None),
    ("14", "건설투자 PAC", "expenditure",
     "오차수정 + AR + 기대 할인합 + 갭 + 주택가격", "기대항이 없어요."),
    ("15", "정부소비 목표", "expenditure",
     "G* = β_G0 + β_G1·잠재산출 + β_G2·고령화율", "고령화율은 외생이라 "
     "편차 공간에서 0 이에요 — 화살표가 안 서는 것이 정상이에요."),
    ("16", "정부소비 성장", "expenditure", "오차수정 + 갭", None),
    ("17", "수출 목표", "expenditure", "X* = β_X0 + β_X1·세계수요", None),
    ("18", "세계 수출수요 지수", "external",
     "ζ^X 가중 해외 수요", "가중치로 **산출갭**을 씁니다 — eq (4) 참조."),
    ("19", "수출 성장", "expenditure",
     "오차수정 + 수요증가 + **Δ₄ ln 환율** + 기대 할인합",
     "8/21 에 Δ 를 Δ₄ 로 고쳤어요. 기대항은 없어요."),
    ("20", "수입 목표", "expenditure", "M* = β_M0 + β_M1·총흡수", None),
    ("21", "수입 수요 지수", "expenditure",
     "z_C·C + z_I·I + **z_IH·IH** + **z_G·G** + z_X·X",
     "8/21 에 건설(IH)과 정부(G)가 들어왔어요. 빠져 있던 자리예요."),
    ("22", "수입 성장", "expenditure",
     "오차수정 + 수요증가 + **Δ ln 환율** + 기대 할인합",
     "수출은 Δ₄, 수입은 Δ — 비대칭은 논문의 것이에요(인쇄 p.24)."),
    ("23", "근원물가 필립스", "price",
     "φ1·직전 + φ2·기대 + (1−φ1−φ2)·어트랙터 + φ3·갭",
     "8/21 에 인쇄된 배치로 되돌렸어요. 어트랙터 가중이 1−φ1−φ2 = 0.60 "
     "이라야 (탈)앵커링을 말할 수 있어요."),
    ("24", "물가 어트랙터", "price",
     "δ1·직전 어트랙터 + δ2·(직전 근원 − 직전 어트랙터)",
     "괄호가 **차**예요. 예전 두 판(raw·nested)은 둘 다 옮겨 적기 오류였어요."),
    ("25", "소비자물가 목표", "price", "ν·근원 + (1−ν)·비근원", None),
    ("26", "소비자물가 성장", "price", "오차수정 + Δ근원 + Δ수입물가", None),
    ("27", "주택가격 목표", "price",
     "HPI* = β_h0 + β_h1·CPI + β_h2·가계대출금리",
     "금리 계수가 **%p 당 −41.5** 라는 뜻이 되는데 믿기 어려워요. 논문이 "
     "금리 단위 규약을 안 박았고, 스코어카드 실패 넷이 전부 여기서 나와요."),
    ("28", "주택가격 성장", "price", "오차수정 + AR + 가계대출금리", None),
    ("29", "수출물가 목표", "price", "PX* = 세계 수출물가",
     "세계 수출물가 계열이 없어서 **환율이 그 자리에 서 있어요**"
     "(WIRING_PX_EXOG)."),
    ("30", "수출물가 성장", "price", "오차수정 + 기대 할인합", "안 배선."),
    ("31", "수입물가 목표", "price", "PM* = 세계 수출물가 + 유가", "〃"),
    ("32", "수입물가 성장", "price", "오차수정 + Δ환율 + Δ유가", None),
    ("33", "UIP", "financial", "환율 = 직전 − (국내 − 해외)/4",
     "기대환율을 랜덤워크로 뒀어요(WIRING_SEXP_RW)."),
    ("34", "UIP 기대항", "financial", "기대환율", "〃"),
    ("35", "정책준칙", "financial",
     "φ_i·직전 + (1−φ_i)·[r* + π* + (1+φ_π)(π−π*) + φ_y·갭]",
     "지속성 계수는 IMF QPM 2008 계열이에요(SOURCE_QPM2008 — 안 건드려요). "
     "준칙이 **헤드라인 CPI 전년비**에 반응하게 뒀어요(WIRING_RULE_CPI). "
     "r*·π* 는 편차 공간에서 소거돼요."),
    ("36", "기간구조 — 기대가설", "financial",
     "장기금리 = 기대 단기금리 평균", "40분기 평균이에요. 여기에 "
     "**β_sync × 미국 10년**을 더해요(각주 25, 계수 미공표)."),
    ("37", "기간구조 — 기간프리미엄", "financial", "기간프리미엄",
     "국고 10년에만 있고 **IRS 다리까지 안 와요**"
     "(V1_NO_TERM_PREMIUM_IN_IRS). 국고 3년은 기대가설 12분기 평균만이에요"
     "(KR3Y_EH_ONLY)."),
    ("38", "회사채 스프레드", "financial", "AR + 갭", None),
    ("39", "회사채 금리", "financial", "국고 + 스프레드", None),
    ("40", "가계 대출금리", "financial", "조달 혼합이 **1 대 1로** 전가돼요",
     "8/21 에 고쳤어요. 예전 판은 장기 전가가 0.54 였어요."),
    ("41", "기업 대출금리", "financial", "〃", None),
    ("42", "가계 대출 스프레드", "financial", "AR + 회사채 스프레드", None),
    ("43", "기업 대출 스프레드", "financial", "〃", None),
    ("44", "가계부채/GDP", "financial",
     "갭 + 주택가격 전년비 + 가계대출금리",
     "**비율**이에요. 논문 패널의 «명목 가계부채(조원)» 는 편차 공간에 "
     "없어서 대조할 수가 없어요."),
]


# ── 해석 원장 ────────────────────────────────────────────────────────────────
#
# 행마다 논문 인용(`paper`)과 코드 참조(`code`)를 **둘 다** 든다.
LEDGER = [
    {
        "key": "deviation-space",
        "title": "이 제품은 커브 델타예요 — 레벨 전망이 아니에요",
        "paper_says": "논문은 용도를 둘로 적어요 — 전망(Figure 15~17·Table 1)과 "
                      "반사실 분석(Figure 18~20). r* 는 상수로 두고요(각주 24).",
        "we_do": "**둘째만** 해요. 모형을 편차 공간에서 풀고, 베이스라인을 0 으로 "
                 "둬요. 그래서 화면이 파는 것은 «정책 경로에 대한 커브 델타» 지 "
                 "«절대 레벨 전망» 이 아니에요.",
        "why": "실측했어요. r* 를 1.5%·2.5% 로 바꿔 기저를 다시 풀었더니 15개 "
               "기저 전부의 10년 IRS 반응 최대 절대차가 **0.000000bp** 였어요. "
               "eq (35) 에서 r* 와 −φ_π·π* 는 가법 상수고, 베이스라인 0 인 편차 "
               "공간에서 상수는 소거돼요. 모형이 선형이라 상태의존성도 없어요"
               "(선형 게이트 1e-4). 같은 이유로 Layer 2 의 나머지도 델타를 "
               "안 움직여요 — 미 정책금리·유가·해외성장은 기저가 **단위 충격**으로 "
               "담아서, 오늘 수준을 새로 받아와도 기저의 숫자는 하나도 안 바뀌어요.",
        "could_be_wrong": "레벨 전망을 원하는 사람에게 이 화면은 답을 안 줘요. "
                          "그리고 Part B 의 외생 대체분(가처분소득·Gartner·세계 "
                          "수출물가·건축착공·중국)이 전부 **레벨에만** 물리는데, "
                          "레벨 제품을 세우는 날 그게 한꺼번에 청구돼요.",
        "paper": "각주 24 · Figure 18~20",
        "code": "backend/rebake/layer2.py::AssumptionEffect · "
                "backend/bigfoot/solve/system.py 모듈 주석",
        "node": "i_kr",
        "equation": "35",
    },
    {
        "key": "residual-tail",
        "title": "경로가 끝난 뒤의 준칙 잔차",
        "paper_says": "부록 C 는 잔차를 국소수준 UC 모형으로 두고, 부록 B 는 "
                      "조건 구간 **안**의 잔차만 이야기해요. 조건 구간이 끝난 "
                      "뒤 그 잔차를 어떻게 두는지는 논문에 없어요.",
        "we_do": "여덟 분기 경로가 끝나면 마지막 분기의 준칙 잔차가 0 으로 "
                 "떨어지는 게 아니라 AR(1) ρ=0.801 로 잦아들어요.",
        "why": "예전에는 q9 에서 정확히 0 이었는데, 그건 그렇게 정한 게 아니라 "
               "**못이 없는 분기의 잔차를 아무도 안 채웠기 때문**이었어요. "
               "같은 잔차의 역사 자기상관을 다시 재 보니 0.801 (Newey-West "
               "표준오차 0.0745, 2000Q1–2026Q2, n=106) 이라 급단절(ρ=0)은 "
               "10σ 밖이에요. 데이터가 감쇠 편이에요.",
        "could_be_wrong": "**ρ 는 우리가 잰 값이지 논문이 박은 값이 아니에요.** "
                          "그리고 그 잔차의 평균이 0 이 아니라(−0.19pp) 준칙이 "
                          "덜 맞는 부분을 같이 담고 있을 수 있어요 — 추세를 "
                          "빼면 0.78 로 내려가요. ρ=0 을 주면 예전 급단절이 "
                          "정확히 복원돼요.",
        "paper": "부록 B · 부록 C",
        "code": "backend/bigfoot/solve/system.py::RESIDUAL_TAIL · "
                "backend/scripts/p4_ar1.py · output/p4/ar1.json",
        "node": "i_kr",
        "equation": "35",
    },
    {
        "key": "policy-conditioning",
        "title": "정책금리에 조건을 거는 것",
        "paper_says": "부록 B 는 내생변수를 고정하고 잔차를 푸는 방법을 적어요. "
                      "각주 31 은 조건 변수마다 **조정할 충격을 수동으로 고른다**고 "
                      "해요 — 수입에 조건을 걸면 수입 충격만 조정하는 식이에요.",
        "we_do": "정책금리에 조건을 걸고, eq (35) 준칙 잔차 `u_{i,t}` 를 움직여요.",
        "why": "오너가 타이핑하는 유일한 입력이 정책 경로라서요. 부록 B 의 "
               "기계를 그대로 쓰되, 조건 변수만 논문이 안 든 것으로 골랐어요.",
        "could_be_wrong": "**논문은 정책금리 예를 들지 않아요.** 준칙 잔차를 "
                          "움직인다는 것은 «한은이 준칙에서 벗어난다» 는 뜻인데, "
                          "그 해석이 논문의 의도인지는 알 수 없어요.",
        "paper": "부록 B · 각주 31",
        "code": "backend/config/conditioning_map.yaml::kr_policy · "
                "backend/bigfoot/conditional/invert.py",
        "node": "i_kr",
        "equation": "35",
    },
    {
        "key": "beta-sync",
        "title": "β_sync 1.05 — 앵커에 **맞춘** 값이에요",
        "paper_says": "각주 25 는 동조화가 **같은 만기의 미–한 금리 격차**를 "
                      "잇는다고 하고, 계수는 안 실어요.",
        "we_do": "자유모수로 두고 격자탐색으로 1.05 에 핀했어요.",
        "why": "핀의 표적이 논문 본문의 «미 정책금리 +25bp → 한국 장기금리 "
               "+0.06%p» 예요. 격자 최소가 1.05 에서 +0.0592 를 내요.",
        "could_be_wrong": "**그래서 그 앵커는 시험이 아니라 핀이에요.** "
                          "스코어카드에서 이 칸을 «맞았다» 로 읽으면 안 돼요. "
                          "그리고 우리 배선은 격차가 아니라 미국 10년 편차에 "
                          "비례해요(WIRING_SYNC_US10Y) — 논문의 문장과 달라요.",
        "paper": "각주 25 · pp.39-40",
        "code": "backend/bigfoot/solve/phase3.py::BETA_SYNC_ADOPTED · "
                "backend/bigfoot/solve/irf.py::pin_beta_sync",
        "node": "kr10y",
        "equation": "36",
    },
    {
        "key": "rate-units",
        "title": "금리 단위 규약 — 논문이 안 박았어요",
        "paper_says": "금리를 %p 로 넣는지 소수로 넣는지 어디에도 안 적혀 있어요.",
        "we_do": "흐름식(소비 증가율·부채 축적)에는 분기 환산 r/4 로, 수준·목표식"
                 "(주택)에는 그대로 넣어요. 배율은 **안 지어냈어요**.",
        "why": "eq (27)(28) 을 %p 로 읽으면 주택 장기탄력성이 %p 당 **−41.5** 가 "
               "되는데 믿기 어려워요. 그렇다고 소수로 읽으면 다른 식이 깨져요.",
        "could_be_wrong": "**남은 스코어카드 실패 넷이 전부 이 사슬**이에요 — "
                          "금리→주택→부채→소비 진폭. 밴드를 맞추려고 배율을 "
                          "지어내면 애초에 고치러 온 잘못을 다시 하는 거예요.",
        "paper": "eq (27)(28), 인쇄 p.27",
        "code": "backend/bigfoot/solve/system.py::WIRING_QRATE_FLOWS",
        "node": "hpi",
        "equation": "27",
    },
    {
        "key": "no-term-premium-irs",
        "title": "IRS 다리에 기간프리미엄이 안 와요",
        "paper_says": "eq (36)(37) 은 기간구조를 기대가설 + 기간프리미엄으로 써요.",
        "we_do": "국고 10년에는 붙이고, **IRS 는 기대 CD 평균 + OU 스프레드로만** "
                 "값을 매겨요. 국고 3년은 기대가설 12분기 평균만이에요.",
        "why": "v1 조립기의 경계예요. 스왑 스프레드 위성이 시나리오 차분에서 "
               "상쇄된다는 가정 위에 서 있어요.",
        "could_be_wrong": "미국 장기금리가 움직이는 시나리오에서 **IRS 반응이 "
                          "체계적으로 작게 나와요.** 국고와 IRS 를 나란히 보면 "
                          "그 격차가 보여요.",
        "paper": "eq (36)(37), 인쇄 p.31",
        "code": "backend/bigfoot/irs_curve/assembler.py::"
                "V1_NO_TERM_PREMIUM_IN_IRS · KR3Y_EH_ONLY",
        "node": "kr10y",
        "equation": "37",
    },
    {
        "key": "ou-spread",
        "title": "비구조 테너는 OU 스프레드로 채워요",
        "paper_says": "논문에는 스왑 커브가 없어요. 국고 3년·10년까지예요.",
        "we_do": "테너별 스왑 스프레드를 일별 OU(평균회귀)로 세우고, 엔진의 "
                 "기대 CD 평균 위에 얹어요.",
        "why": "데스크가 보는 것은 IRS 커브라서요. 논문이 안 준 층이에요.",
        "could_be_wrong": "**논문에 없는 층이에요.** 스프레드가 평균회귀한다는 "
                          "것은 우리 가정이고, 국면이 바뀌면 틀려요. "
                          "시나리오 차분에서 상쇄된다고 봤지만 검증 안 했어요.",
        "paper": "해당 없음 — 논문 밖",
        "code": "backend/bigfoot/irs_curve/satellite.py::SPREAD_V1_OU",
        "node": "kr10y",
        "equation": "37",
    },
    {
        "key": "pac-asymmetry",
        "title": "PAC 기대항이 소비에만 있어요",
        "paper_says": "eq (11)(14)(19)(22)(30)(32) 이 전부 기대 목표변화의 "
                      "할인합 `E_t[Σ d_k Δ y*_{t+k}]` 를 인쇄해요.",
        "we_do": "**소비(eq 8)에만** 배선했어요. 나머지는 평범한 오차수정으로 "
                 "돌아요.",
        "why": "부록 A.11~A.16 의 정확한 d-가중을 소비에 대해 먼저 풀었고, "
               "다른 식은 각자의 목표 과정을 위성 VAR 에 태워야 하는데 안 했어요.",
        "could_be_wrong": "기대가 빠진 식은 **앞을 안 봐요.** 정책이 미리 "
                          "알려진 경로일 때 투자·무역·물가가 늦게 반응해요. "
                          "배선 그래프에서 「PAC 기대항」 통로를 켜 보면 소비 "
                          "말고는 화살표가 하나도 없어요.",
        "paper": "eq (3), 인쇄 p.10",
        "code": "backend/bigfoot/solve/phase3.py::"
                "PLAIN_ECM_NON_CONSUMPTION",
        "node": "c",
        "equation": "3",
    },
    {
        "key": "fi-usercost",
        "title": "설비투자에 금리를 다시 넣었어요 — eq (9) 의 `− UC_I` 배선",
        "paper_says": "eq (9) 는 설비투자 목표에 자본 사용자비용을 **계수 −1 로** "
                      "넣고, eq (10) 이 그 사용자비용을 기업대출금리·회사채금리·"
                      "물가·감가상각으로 정의해요.",
        "we_do": "인쇄된 대로 배선해요. 목표 편차 = `−[(기업대출금리 + 회사채"
                 "금리)/2 − 물가상승률/4]` 이고, eq (11) 이 인쇄한 대로 **전분기** "
                 "목표를 오차수정에 넣어요. 감가상각 `δ_I` 는 외생이라 편차가 "
                 "0 이에요.",
        "why": "2026-08-21 (P4) 이전에는 솔버가 목표 편차를 **문자 그대로 0** 으로 "
               "뒀어요. 그래서 정책금리가 설비투자에 닿는 통로가 산출갭 하나뿐"
               "이었고, 같은 사용자비용이 제대로 배선된 건설투자와 비대칭이었어요. "
               "새로 켜진 추정 계수는 **0개**예요 — 논문이 계수를 −1 로 인쇄했고 "
               "부록 D 에 슬롯이 없거든요.",
        "could_be_wrong": "**논문의 미국 +25bp 설비투자 −0.02% 에서 오히려 "
                          "멀어졌어요** — 배선 전 −0.032%, 배선 후 −0.036%. "
                          "점수가 아니라 인쇄된 식이 기준이라 그대로 뒀어요. "
                          "그리고 실패 넷(주택·부채·소비·유가GDP)은 **거의 안 "
                          "움직였어요**(전부 0.001 미만) — 진폭 문제의 뿌리가 "
                          "죽은 통로가 아니라는 뜻이에요.",
        "paper": "eq (9)(10)(11), 인쇄 p.18",
        "code": "backend/bigfoot/equations/korea.py::FIInvestment · "
                "backend/bigfoot/solve/system.py (`i_fi_star`) · "
                "backend/bigfoot/conditional/residuals.py",
        "node": "i_fi",
        "equation": "9",
    },
    {
        "key": "demand-outputgap",
        "title": "수출수요를 수입갭 아닌 산출갭으로 세웠어요",
        "paper_says": "eq (4) 가 블록별 수입갭을 정의하고, eq (18) 의 세계 "
                      "수출수요 지수가 그 수입갭들을 ζ^X 로 가중해요.",
        "we_do": "수입갭 대신 **산출갭**을 ζ^X 가중해서 세계 수출수요 지수를 "
                 "만들어요. eq (18) 의 자리에 eq (4) 의 산물이 아니라 각 블록의 "
                 "산출갭이 그대로 들어가요.",
        "why": "Table 1 의 c 와 τ 를 읽은 대로 쓰면 무역탄력성이 믿기 어려울 만큼 "
               "작아져요. 그 배치가 확정이 안 돼서(논문 미공표) 우회했어요.",
        "could_be_wrong": "2차 스필오버(미국 → 제3국 수입 → 한국 수출)가 "
                          "**한 겹 얕아져요.** 논문 Figure 2 가 그리는 구조의 "
                          "바깥쪽 고리예요.",
        "paper": "eq (4)(18) · Table 1",
        "code": "backend/bigfoot/solve/system.py::WIRING_DEMAND_OUTPUTGAP",
        "node": "x",
        "equation": "18",
    },
    {
        "key": "oil-sign",
        "title": "유가 부호를 뒤집었어요",
        "paper_says": "eq (5) 는 유가가 해외 산출갭에 들어간다고 하고, 부록 D 의 "
                      "계수는 **+0.0049** 예요.",
        "we_do": "`oil_sign = −1` 로 배선해서, 유가 상승이 해외 갭을 **내려요**.",
        "why": "인쇄된 부호 그대로면 유가 상승이 해외 수요를 올리는데, 그건 "
               "논문 자신의 IRF C 밴드와 어긋나요. 논문의 유가 «갭» 부호 규약이 "
               "안 적혀 있어요.",
        "could_be_wrong": "**밴드에 맞춰 고른 부호예요**(디버그 로그 W1). "
                          "유가 패널 셋이 이 선택 위에 서 있어요.",
        "paper": "eq (5) · 부록 D",
        "code": "backend/bigfoot/solve/system.py::"
                "DEFAULT_OPTIONS['oil_sign'] · output/phase3_debug_log.md W1",
        "node": "oil",
        "equation": "5",
    },
    {
        "key": "shares-data",
        "title": "GDP 갭을 실측 지출비중으로 조립해요",
        "paper_says": "지출 항목이 GDP 로 합쳐지는 항등식.",
        "we_do": "ECOS 국민계정에서 잰 비중(z_C·z_I·z_IH·z_G·z_X)으로 가중해요. "
                 "리베이크가 갱신하는 두 가지 중 하나예요.",
        "why": "논문은 이 항등식의 가중치를 안 실어요. 그래서 ECOS 국민계정에서 "
               "직접 재요 — 리베이크가 실제로 갱신하는 두 가지 중 하나가 "
               "이 비중이에요.",
        "could_be_wrong": "비중이 분기마다 조금씩 움직여서, 굽는 날에 따라 갭 "
                          "조립이 미세하게 달라져요.",
        "paper": "항등식 — 인쇄 번호 없음",
        "code": "backend/bigfoot/solve/system.py::WIRING_SHARES_DATA · "
                "backend/bigfoot/data/ecos.py::gdp_shares",
        "node": "y_gap",
        "equation": "항등식",
    },
    {
        "key": "qpm-rule",
        "title": "준칙 지속성은 IMF QPM 계열이에요",
        "paper_says": "eq (35) 준칙. 지속성 계수 φ_i 의 출처를 안 밝혀요.",
        "we_do": "IMF QPM(2008) 계열 값을 써요. **안 건드려요.**",
        "why": "논문 미공표 자리이고, 이 값을 흔들면 스코어카드 전체가 흔들려요.",
        "could_be_wrong": "미국 충격에서 한국 정책 되돌림이 QPM 의 성질을 "
                          "따라가요 — β_sync 핀이 오너의 사전 예측 구간을 "
                          "벗어난 이유가 여기예요.",
        "paper": "eq (35), 인쇄 p.30",
        "code": "backend/bigfoot/solve/phase3.py::ACTIVE_FLAGS "
                "(`SOURCE_QPM2008`)",
        "node": "i_kr",
        "equation": "35",
    },
    {
        "key": "self-bands",
        "title": "스코어카드 밴드는 우리가 그린 거예요",
        "paper_says": "논문은 점추정만 적어요 — «최대 0.05%p 까지» 같은 식으로요.",
        "we_do": "그 점추정 둘레에 `[lo, hi]` 밴드를 그려서 통과/실패를 판정해요.",
        "why": "점추정 하나로는 «맞았다» 를 정의할 수 없어서요.",
        "could_be_wrong": "**밴드 폭이 우리 선택이라 통과 개수도 우리 선택에 "
                          "달려 있어요.** `phase3.py::WAIVER_CAVEAT` 이 스스로 "
                          "«self-constructed band floor» 라고 적어 뒀어요.",
        "paper": "pp.37-42 본문 점추정",
        "code": "backend/bigfoot/solve/irf.py::SCORECARD",
        "node": None,
        "equation": None,
    },
]


# ── 한계: 외생 대체 ──────────────────────────────────────────────────────────
EXOGENOUS = [
    ("8", "실질 구매력", "논문 자신이 판단기반 외생이라고 불러요", "level"),
    ("11", "Gartner 반도체 초과수요 지수", "유료예요. ECOS 의 「DRAM」 계열은 "
     "**수출물가지수**라 다른 변수예요 — 2026-08-21 에 잘못 배선했다가 "
     "되돌렸어요", "level"),
    ("29", "세계 수출물가 (수출물가 목표식)",
     "쓸 만한 분기 계열이 없어서 환율이 그 자리에 서 있어요(WIRING_PX_EXOG)",
     "level"),
    ("30", "세계 수출물가 (수출물가 성장식)",
     "eq (29) 와 같은 계열이 필요해요. 없어서 수출물가 블록이 통째로 외생이에요",
     "level"),
    ("7", "가처분소득 2010Q1 이전", "ECOS 가 거기부터예요", "level"),
    ("12", "건축착공 2013 이전", "ECOS 가 2013Q1 부터예요", "level"),
    ("14", "건축착공 2013 이전 (건설 성장식)",
     "eq (12) 와 같은 계열이라 같이 비어요", "level"),
    ("4", "중국 2011 이전", "분기 실질 GDP 를 FRED 로 못 가져와요 — ECOS "
     "해외통계나 IMF 가 필요해요", "level"),
    ("5", "신흥아시아 6국 중 4국", "분기 계열이 없어요. 인도·인도네시아 둘로 "
     "바스켓을 세웠어요", "level"),
    ("6", "기타국(RW) 블록 전체", "논문이 계수를 안 실어요"
     "(PLACEHOLDER_RW)", "level"),
]


def _run_engine() -> dict:
    from bigfoot.solve.irf import SHOCKS, run_all, scorecard
    from bigfoot.solve.config import (BETA_SYNC_ADOPTED, FINAL_EQ24,
                                      FINAL_OPTIONS)
    res = run_all(BETA_SYNC_ADOPTED, FINAL_EQ24, FINAL_OPTIONS)
    return {"results": res, "rows": scorecard(res), "shocks": SHOCKS}


#: 논문 앵커 → (엔진 충격, 변수, 극값 방향). **지평을 안 맞추면 헛진단이 난다** —
#: 2026-08-21 의 «400배» 오진이 그 자리였다. 규약은 «논문 부호와 같은 쪽의 극값,
#: 24분기 전 구간» 하나다.
ANCHOR_MAP = {
    "kr_policy_25bp.gap": ("A", "y_gap", "min"),
    "kr_policy_25bp.cpi": ("A", "cpi_yoy", "min"),
    "kr_policy_25bp.hpi": ("A", "hpi", "min"),
    "kr_policy_25bp.debt_krw": (None, None, None),
    "kr_policy_25bp.debt_ratio": ("A", "debt", "min"),
    "us_policy_25bp.kr10y": ("B", "kr10y", "max"),
    "us_policy_25bp.gdp": ("B", "y_gap", "min"),
    "us_policy_25bp.fi": ("B", "i_fi", "min"),
    "us_policy_25bp.cpi": ("B", "cpi_yoy", "shape"),
    "oil_10pct.cpi": ("C", "cpi_yoy", "max"),
    "oil_10pct.consumption": ("C", "c", "min"),
    "oil_10pct.gdp": ("C", "y_gap", "min"),
    "oil_10pct.imports": ("C", "m", "min"),
}

#: `irf.py::SCORECARD` 의 밴드가 어느 앵커를 재는가. 밴드가 없는 앵커는
#: **«밴드 없음» 이라고 적는다.** 0 으로 채우거나 통과로 세지 않는다.
BAND_OF = {
    "kr_policy_25bp.gap": ("A", "gdp_gap_trough_pp"),
    "kr_policy_25bp.cpi": ("A", "cpi_yoy_trough_pp"),
    "kr_policy_25bp.hpi": ("A", "housing_trough_pct"),
    "kr_policy_25bp.debt_ratio": ("A", "debt_gdp_change_pp"),
    "us_policy_25bp.gdp": ("B", "gdp_gap_trough_pp"),
    "oil_10pct.cpi": ("C", "cpi_yoy_peak_pp"),
    "oil_10pct.gdp": ("C", "gdp_gap_trough_pp"),
    "oil_10pct.consumption": ("C", "consumption_trough_pct"),
}


#: 숫자가 아니라 모양으로 대조하는 앵커. 엔진의 모양 검사에 붙인다.
SHAPE_OF = {"us_policy_25bp.cpi": ("B", "shape:inflation_up_then_down")}


def build_scorecard(eng: dict, anchors: dict) -> dict:
    rows = []
    bands = {(r["irf"], r["metric"]): r for r in eng["rows"]}
    for shock in anchors["shocks"]:
        for a in shock["anchors"]:
            irf, var, how = ANCHOR_MAP[a["id"]]
            measured = measured_q = measured_12q = None
            if irf and var and how in ("min", "max"):
                path = np.asarray(eng["results"][irf]["korea"][var],
                                  dtype=float)
                pick = np.argmin if how == "min" else np.argmax
                i = int(pick(path))
                measured, measured_q = round(float(path[i]), 4), i
                # **지평을 안 밝히면 또 헛진단이 난다.** 논문 그림은 12분기
                # 근처까지고 우리 지평은 24분기라, 극값이 꼬리에서 나오는 칸이
                # 있다. 12분기 안의 극값을 나란히 실어 독자가 보게 한다.
                j = int(pick(path[:12]))
                measured_12q = round(float(path[j]), 4)
            b = BAND_OF.get(a["id"])
            band = bands.get(b) if b else None
            sh = SHAPE_OF.get(a["id"])
            shape_row = bands.get(sh) if sh else None
            if band is not None:
                verdict = "pass" if band["pass"] else "miss"
            elif shape_row is not None:
                verdict = "shape_pass" if shape_row["pass"] else "shape_miss"
            elif a["id"] == "us_policy_25bp.kr10y":
                verdict = "pinned"
            elif a["id"] == "kr_policy_25bp.debt_krw":
                verdict = "not_comparable"
            else:
                verdict = "no_band"
            rows.append({
                "anchor_id": a["id"],
                "shock": shock["label"],
                "panel": a["panel"],
                "page": shock["page"],
                "paper": a["value"],
                "unit": a["unit"],
                "kind": a["kind"],
                "measured": measured,
                "measured_q": measured_q,
                "measured_12q": measured_12q,
                "tail": measured_q is not None and measured_q >= 16,
                "band": band["band"] if band else None,
                "verdict": verdict,
                "note": a.get("note"),
            })
    shapes = [r for r in eng["rows"] if r["metric"].startswith("shape:")]
    return {
        "engine_total": len(eng["rows"]),
        "engine_passed": sum(1 for r in eng["rows"] if r["pass"]),
        "engine_rows": eng["rows"],
        "shape_rows": shapes,
        "anchor_rows": rows,
        "chain": "금리 → 주택 → 부채 → 소비 **진폭**",
        "root": "논문이 안 박은 금리 단위 규약이에요. 밴드를 맞추려고 배율을 "
                "지어내지 않았어요 — 그 자제가 결과의 일부예요.",
        "not_a_baseline": "예전 12/13 은 Table 8 값의 **순열을 이 밴드에 맞춰 "
                          "고른 결과**예요. 기준선이 아니에요. 정직한 순서는 "
                          "인쇄된 형태에서 9/13 이에요.",
        "horizon_rule": "규약은 하나예요 — **논문 부호와 같은 쪽의 극값, "
                        "24분기 전 구간**. 극값이 나온 분기를 같이 실어요. "
                        "q16 이후에서 나온 칸에는 표시를 달고 12분기 안의 값을 "
                        "나란히 놓아요. 지평을 안 맞추고 견주면 부호까지 "
                        "뒤집힌 진단이 나와요 — 2026-08-21 에 한 번 그랬어요.",
        "two_thirteens": "「13」이 둘이에요. 엔진 스코어카드는 수치 8 + 모양 5 "
                         "이고, 논문 앵커는 충격 셋의 패널 5+4+4 예요. 우연히 "
                         "같은 수예요.",
    }


FREE_PARAMS = [
    ("beta_sync", "1.05", "미 +25bp → 한국 장기금리 +0.06%p 앵커에 격자 핀",
     "fit", "us_policy_25bp.kr10y",
     "backend/bigfoot/solve/phase3.py::BETA_SYNC_ADOPTED"),
    ("oil_sign", "−1.0", "부호를 뒤집어야 IRF C 밴드와 맞아서 뒤집었어요"
     "(디버그 로그 W1)", "fit", "oil_10pct.*",
     "backend/bigfoot/solve/system.py::DEFAULT_OPTIONS"),
    ("qrate_cons", "False", "64-config 스윕의 통과 개수로 골랐어요", "fit",
     "kr_policy_25bp.* · oil_10pct.consumption",
     "output/phase3_debug_log.md sweep"),
    ("qrate_debt", "False", "〃", "fit", "kr_policy_25bp.debt_ratio",
     "output/phase3_debug_log.md sweep"),
    ("pac_beta", "0.99", "미시 스윕 {0.97, 0.975, 0.995} 을 돌려 봤어요", "fit",
     "us_policy_25bp.gdp", "output/phase3_debug_log.md micro"),
    ("core_form", "dev", "A.1 EC 형을 구현해 돌렸더니 **유일한 실패가 더 "
     "나빠져서**(−0.0788 → −0.0866) 기각했어요", "fit",
     "kr_policy_25bp.cpi", "backend/bigfoot/solve/phase3.py::A1_EC_RESULT"),
    ("us_shock_impl", "imposed", "오너 판정이에요. 다만 근거 문장이 «25bp 앵커가 "
     "실제 25bp 움직임을 보게» 예요", "mixed", "us_policy_25bp.*",
     "backend/bigfoot/solve/phase3.py (Phase 4.8)"),
    ("스코어카드 밴드", "[lo, hi] 8쌍", "논문은 점추정만 적어요. 밴드는 우리가 "
     "그렸어요", "fit", "밴드가 붙은 앵커 8개 전부",
     "backend/bigfoot/solve/irf.py::SCORECARD"),
    ("OIL_RHO", "0.90", "논문 미공표. 유가 AR(1) 지속성이에요", "unpublished",
     "oil_10pct.*", "backend/bigfoot/solve/system.py::OIL_RHO"),
    ("tp_us FIR 커널", "K=12", "pyfrbus 에 맞춰 적합했어요(보류 홀드아웃 "
     "평균 |gap| 0.4bp)", "external",
     "us_policy_25bp.kr10y", "backend/bigfoot/solve/tpus3.py"),
]


def backtest_blockers() -> dict:
    """C.8 — 막는 것 목록과 그 크기 실측. **백테스트가 아니다.**"""
    from bigfoot.conditional.residuals import build_variables
    from bigfoot.solve.config import (BETA_SYNC_ADOPTED, FINAL_EQ24,
                                      FINAL_OPTIONS)
    from bigfoot.solve.system import BigfootSystem

    d = build_variables()
    window = [f"{y}Q{q}" for y, q in
              [(2021, 3), (2021, 4), (2022, 1), (2022, 2),
               (2022, 3), (2022, 4), (2023, 1)]]
    ikr = d.loc[window, "i_kr"].to_numpy(dtype=float)
    k10 = d.loc[window, "kr10y"].to_numpy(dtype=float)
    start = {c: round(float(d.loc["2021Q2", c]), 3)
             for c in ("y_gap", "cpi_yoy", "hpi", "debt", "i_kr", "kr10y",
                       "c", "s")}

    T = 24
    sys_ = BigfootSystem(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                         T=T, options=FINAL_OPTIONS)
    pin = np.full(T, np.nan)
    pin[: len(ikr)] = ikr
    out = sys_.solve({}, pin={"i_kr": pin})
    m10 = np.asarray(out["korea"]["kr10y"], dtype=float)[: len(ikr)]
    err = m10 - k10
    rmse = float(np.sqrt((err ** 2).mean())) * 100
    rw = float(np.sqrt((k10 ** 2).mean())) * 100

    return {
        "module": "backtest_2021_cycle",
        "verdict": "infeasible",
        "headline": "2021Q3–2023Q1 인상 사이클 백테스트는 **아직 못 해요.** "
                    "기간을 바꾸지 않았고, 조건집합을 좁혀서 좋아 보이게 하지도 "
                    "않았어요. 못 하는 이유와 그 크기를 대신 실어요.",
        "window": window,
        "blockers": [
            {"id": "no-initial-state",
             "what": "초기상태 인자가 없어요",
             "detail": "`BigfootSystem.solve()` 는 모든 실행을 정상상태에서 "
                       "시작해요 — `v = zeros(T)` 이고 `lag()` 는 t<0 에서 "
                       "0 을 줘요. 2021Q3 판이 서려면 2021Q2 의 실제 상태에서 "
                       "출발해야 해요.",
             "measured": start,
             "measured_note": "이게 버려지는 상태예요. 주택 +2.98%·부채 "
                              "+2.08pp 가 정확히 스코어카드 실패 넷이 사는 "
                              "사슬이에요.",
             "needs": "엔진 재해 — `solve()` 에 초기상태를 받는 통로"},
            {"id": "two-sided-hp",
             "what": "양측 HP 필터라 미래를 봐요",
             "detail": "`residuals.py` 가 `LOOKAHEAD` 깃발을 스스로 달고 "
                       "있어요. 2021Q3 의 «실현 편차» 가 2026 까지의 데이터로 "
                       "만든 추세에서 나와요. 빈티지가 아니에요.",
             "needs": "단측(실시간) 추세 또는 빈티지별 필터"},
            {"id": "no-vintage-reestimation",
             "what": "빈티지별 재추정이 없어요",
             "detail": "계수는 논문 부록 D(전표본 2000Q1–2024Q2)이고 위성 VAR "
                       "은 2026Q2 까지로 추정돼요. 백테스트 창이 추정표본 "
                       "**안에** 있어요.",
             "needs": "빈티지마다 위성 VAR 재추정"},
            {"id": "no-level-product",
             "what": "레벨 경로가 없어요",
             "detail": "엔진은 편차만 내요. Table 1 의 RMSE 는 예측오차(레벨)"
                       "예요. 빈티지별 베이스라인 레벨을 만들 기계가 없어요.",
             "needs": "레벨 베이스라인 — 그리고 그때 외생 대체분이 한꺼번에 "
                      "청구돼요"},
            {"id": "exogenous-substitutions",
             "what": "외생 대체분이 레벨에만 물려요",
             "detail": "가처분소득·Gartner·세계 수출물가·건축착공·중국. 편차 "
                       "공간에서는 0 이라 지금 화면은 안 다치지만, 백테스트는 "
                       "레벨 제품이에요.",
             "needs": "계열 확보 (Gartner 는 유료)"},
        ],
        "coherence_check": {
            "what": "그래도 돌려 본 것 — **정합성 점검이지 백테스트가 아니에요.**",
            "how": "실현 정책금리 편차 7분기를 부록 B 핀으로 물리고"
                   "(`conditioning_map::kr_policy`) 모형 국고 10년을 실현치와 "
                   "견줬어요. 전표본 추정·양측 HP·초기상태 0 — 셋 다 그대로예요.",
            "realised_i_kr": [round(float(x), 3) for x in ikr],
            "realised_kr10y": [round(float(x), 3) for x in k10],
            "model_kr10y": [round(float(x), 3) for x in m10],
            "rmse_bp": round(rmse, 1),
            "benchmark": "편차 0 유지 (편차 공간에서 «아무 일 없음» = 랜덤워크)",
            "benchmark_rmse_bp": round(rw, 1),
            "ratio": round(rmse / rw, 2),
            "reads_as": "정확도가 아니라 **구조**예요. 실현 장기금리가 104bp "
                        "움직인 구간에서 모형은 "
                        f"{round(float(np.abs(m10).max()) * 100, 1)}bp 를 "
                        "내요. 국고 10년이 단기금리 경로의 **40분기 평균**이라 "
                        "7분기짜리 혹은 1/6 도 안 실려요. 여기에 초기상태 0 과 "
                        "IRS 기간프리미엄 부재가 겹쳐요.",
        },
        "error_shares": [
            ("기대가설 40분기 평균", "모형", "논문의 구조예요. 배율로 못 고쳐요"),
            ("IRS 다리에 기간프리미엄 없음", "구현",
             "V1_NO_TERM_PREMIUM_IN_IRS"),
            ("초기상태 0", "구현", "엔진 재해가 필요해요"),
            ("외생 대체분", "입력", "편차엔 0, **레벨엔 있어요**"),
            ("금리 단위 규약", "논문", "안 박았어요"),
        ],
        "benchmark_options": [
            ("편차 0 유지(랜덤워크)", True, "위에서 썼어요"),
            ("단순 VAR(2)", True, "위성 VAR 이 이미 그거예요. 다만 **같은 "
                                  "전표본**으로 추정돼 벤치마크도 같이 "
                                  "오염돼요"),
            ("BVAR(2) — Table 1 의 기준", False, "이 리포에 없어요"),
        ],
    }


def build_model_surface(graph: dict, cfg: dict) -> dict:
    wired = {e["equation"] for e in graph["edges"]}
    eqs = []
    for no, name, block, printed, differs in EQUATIONS:
        eqs.append({
            "no": no, "name": name, "block": block,
            "page": EQUATION_PAGE.get(no),
            "printed": printed,
            "differs": differs,
            "wired": no in wired,
        })

    coeffs = []
    for group in sorted(cfg):
        for slot in sorted(cfg[group], key=lambda k: (len(k), k)):
            v = cfg[group][slot]
            addr = f"{group}[{slot}]"
            coeffs.append({
                "slot": addr, "group": group, "symbol": v.get("symbol"),
                "value": v.get("value"), "status": v.get("status"),
                "basis": v.get("basis", ""),
                "candidates": v.get("candidates", []),
                "equation": _slot_eq(group),
            })
    used_slots = {e["coefficient_slot"] for e in graph["edges"]
                  if e["coefficient_slot"]}
    for c in coeffs:
        c["wired"] = c["slot"] in used_slots

    return {
        "module": "model_surface",
        "equations": eqs,
        "coefficients": coeffs,
        "coefficient_counts": _counts([c["status"] for c in coeffs]),
        "stale_exog": "`construction.*` 9슬롯과 `government.*` 6슬롯이 아직 "
                      "`EXOG_V1`(«Phase 2 에서 추세 고정»)로 적혀 있는데, "
                      "8/21 에 두 블록이 해동돼 **지금 배선돼 있어요.** "
                      "상태 라벨이 15건 낡았어요.",
        "unpublished": [
            ("β_sync", "각주 25 — 동조화 계수를 안 실어요"),
            ("r*", "각주 24 — 상수로 두고 Laubach–Williams 평균을 써요"),
            ("eq (4) ρ_M · β_M", "Table 1 의 c 와 τ 배치가 확정이 안 돼요"),
            ("eq (6) 스필오버 가중", "안 실려 있어요"),
            ("기타국(RW) 블록", "통째로 안 실려 있어요"),
            ("금리 단위 규약", "%p 인지 소수인지 어디에도 안 적혀 있어요"),
            ("pac_beta", "PAC 할인인자. 0.99 는 분기 관례예요"),
            ("OIL_RHO", "유가 AR(1) 지속성 0.90"),
        ],
        "census": {
            "total": 207, "printed": 44, "unprinted": 163,
            "partial": True,
            "note": "**부분이에요.** 논문이 163개를 열거하지 않아서, 셀 수 있는 "
                    "것만 세고 나머지는 회복 불가로 뒀어요. 채워 넣지 않았어요.",
            "buckets": [
                {"name": "인쇄된 일반형의 블록별 인스턴스화", "count": 24,
                 "how": "eq (4)(5)(6) 은 블록 j 에 대한 일반형이에요. 미국을 "
                        "뺀 블록이 9개(중국·EU·일본·신흥아시아 6국·기타)라 "
                        "3×9 = 27 인스턴스, 그중 3 이 인쇄돼요.",
                 "confidence": "셀 수 있어요"},
                {"name": "미국 블록 (IMF QPM 2008 계열)", "count": 5,
                 "how": "구현이 IS·필립스·준칙·수입갭·10년 다섯을 세워요. "
                        "논문은 안 인쇄해요.",
                 "confidence": "하한이에요"},
                {"name": "항등식·변환", "count": 14,
                 "how": "구현의 `KOREA_VARS` 31개 중 인쇄 짝이 없는 것 — "
                        "증분 여섯, 전년비 둘, 물가 수준 둘, 목표 하나, "
                        "대출 스프레드 둘, 어트랙터 하나.",
                 "confidence": "하한이에요"},
                {"name": "기대·해법 기계 (부록 A)", "count": 16,
                 "how": "A.1~A.16 — VECM·증강 VAR·컴패니언·k-step 예측·PAC "
                        "가중. 부록에 있지 본문 44 에는 없어요.",
                 "confidence": "셀 수 있어요"},
                {"name": "한국 데이터 정의", "count": None,
                 "how": "잠재산출·HP 추세·디플레이터·고령화율·감가상각률. "
                        "논문이 정의식을 안 적어서 **못 세요.**",
                 "confidence": "못 세요"},
                {"name": "회복 불가", "count": 104,
                 "how": "163 − (24+5+14+16). 논문에서 복원할 방법이 없어요.",
                 "confidence": "잔여예요"},
            ],
        },
        "eq_no_corrections": graph.get("eq_no_corrections", []),
    }


_SLOT_EQ_PREFIX = {
    "consumption.target": "7", "consumption.growth": "8",
    "investment_fi.target": "9", "investment_fi.growth": "11",
    "construction.target": "12", "construction.growth": "14",
    "government.target": "15", "government.growth": "16",
    "export.target": "17", "export.demand_weights": "18",
    "export.growth": "19", "import_.target": "20",
    "import_.demand_weights": "21", "import_.growth": "22",
    "core_cpi": "23", "cpi.target": "25", "cpi.growth": "26",
    "housing.target": "27", "housing.growth": "28",
    "export_price.target": "29", "export_price.growth": "30",
    "import_price.target": "31", "import_price.growth": "32",
    "fx": "33", "policy_rule": "35", "corp_bond": "38",
    "loan_rates": "40", "debt_gdp": "44", "calibration.r_star": "35",
    "foreign.china": "4", "foreign.japan": "4", "foreign.eu": "4",
    "foreign.ea": "4",
}


def _slot_eq(group: str):
    for pre, eq in sorted(_SLOT_EQ_PREFIX.items(), key=lambda kv: -len(kv[0])):
        if group.startswith(pre):
            return eq
    return None


def _counts(xs):
    out = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return out


def build_method_surface(eng: dict, anchors: dict) -> dict:
    return {
        "module": "method_surface",
        "ledger": LEDGER,
        "limitations": {
            "ships": "이 화면이 파는 것은 **정책 경로에 대한 커브 델타**예요. "
                     "절대 레벨 전망이 아니에요.",
            "ships_why": "모형을 편차 공간에서 풀고 베이스라인을 0 으로 둬요. "
                         "r* 를 1.5%·2.5% 로 바꿔 기저를 다시 풀어 봤더니 15개 "
                         "기저 전부의 10년 IRS 반응 최대 절대차가 "
                         "**0.000000bp** 였어요 — eq (35) 에서 상수는 소거되고, "
                         "Layer 2 의 나머지도 기저가 단위 충격으로 담아서 델타를 "
                         "안 움직여요.",
            "ledger_row": "deviation-space",
            "no_effect": [
                {"equation": eq, "what": what, "why": why}
                for eq, what, why, kind in EXOGENOUS if kind == "delta"],
            "level_only": [
                {"equation": eq, "what": what, "why": why}
                for eq, what, why, kind in EXOGENOUS if kind == "level"],
            "note": "위 목록은 전부 **외생**이라 편차 공간에서 0 이에요. 오너의 "
                    "경로에 대한 응답은 안 바뀌고, **레벨 전망만** 못 하게 "
                    "만들어요.",
        },
        "scorecard": build_scorecard(eng, anchors),
        "free_params": [
            {"name": n, "value": v, "chosen_by": how, "kind": kind,
             "contaminates": cont, "code": code}
            for n, v, how, kind, cont, code in FREE_PARAMS],
        "free_params_headline": "**9/13 은 독립적인 시험이 아니에요.** 순열 "
                                "탐색은 2026-08-21 에 은퇴했지만, 레버는 다시 "
                                "안 스윕했어요. 아래 레버가 전부 이 13개 밴드에 "
                                "대고 고른 것이에요"
                                "(`output/phase3_debug_log.md`).",
    }


def extract_old_basis() -> dict:
    """8/21 이전 기저를 **git 에서 꺼낸다.** 재구성하지 않는다."""
    raw = subprocess.run(
        ["git", "show", f"{OLD_BASIS_COMMIT}:{OLD_BASIS_PATH}"],
        cwd=ROOT.parent, capture_output=True, check=True).stdout
    old = json.loads(raw.decode("utf-8"))
    keep = ("policy_q1", "us_2q", "oil")
    vars_ = ("i_kr", "y_gap", "cpi_yoy", "s", "hpi", "debt", "kr10y")
    return {
        "module": "basis_pre_0821",
        "as_of": old["as_of"],
        "source": f"git show {OLD_BASIS_COMMIT}:{OLD_BASIS_PATH}",
        "why": "8/21 이전 판이에요. Table 8 값의 **순열을 스코어카드 밴드에 "
               "맞춰 고른** 기저라 기준선이 아니에요. 리베이크가 무엇을 "
               "바꿨는지 눈으로 보라고 싣는 것뿐이에요.",
        "bases": {k: {v: old["bases"][k][v] for v in vars_} for k in keep},
    }


def main() -> None:
    cfg = yaml.safe_load(
        (ROOT / "config" / "appendix_d_resolved.yaml").read_text("utf-8"))
    anchors = json.loads(
        (ROOT / "config" / "paper_anchors.json").read_text("utf-8"))
    graph = json.loads((OUT / "wiring_graph.json").read_text("utf-8"))

    print("엔진 IRF 를 돌려요 …", file=sys.stderr)
    eng = _run_engine()

    files = {
        "model_surface.json": build_model_surface(graph, cfg),
        "method_surface.json": build_method_surface(eng, anchors),
        "basis_pre_0821.json": extract_old_basis(),
        "backtest_2021_cycle.json": backtest_blockers(),
    }
    dest = {
        "model_surface.json": FRONT / "model",
        "basis_pre_0821.json": FRONT / "model",
        "method_surface.json": FRONT / "method",
        "backtest_2021_cycle.json": FRONT / "method",
    }
    for name, payload in files.items():
        text = json.dumps(payload, ensure_ascii=False, indent=1) + "\n"
        (OUT / name).write_text(text, encoding="utf-8")
        d = dest[name]
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(text, encoding="utf-8")
        print(f"  {name}  {len(text):,}B")

    # 배선 그래프도 프런트 슬롯으로
    gtext = (OUT / "wiring_graph.json").read_text("utf-8")
    (FRONT / "model" / "wiring_graph.json").write_text(gtext, encoding="utf-8")
    # 그리고 리포 루트의 output/ 에도 (과제지가 부르는 자리)
    (ROOT.parent / "output" / "backtest_2021_cycle.json").write_text(
        json.dumps(files["backtest_2021_cycle.json"], ensure_ascii=False,
                   indent=1) + "\n", encoding="utf-8")
    print("  wiring_graph.json 복사")


if __name__ == "__main__":
    main()
