# -*- coding: utf-8 -*-
"""리베이크 파이프라인 — 계약과 원자성.

세션 2·3 이 이 산출물에 코드를 맞춰 짠다. 그래서 모양이 흔들리면 두 세션이
동시에 깨진다. 여기가 그 모양을 붙든다.

하중이 실린 테스트 넷:

    test_a_failed_rebake_leaves_the_previous_artifacts_untouched
        중간에 죽어도 이전 기저가 **바이트 그대로**여야 한다. 이관 전에는
        `write_text` 로 최종 경로에 바로 써서 잘린 기저가 남을 수 있었다.

    test_two_rebakes_are_byte_identical
        결정성. 자동화의 전제이고, 이게 깨지면 «다시 구웠더니 숫자가
        달라졌다» 를 데이터 탓인지 코드 탓인지 못 가른다.

    test_every_assumption_carries_a_source_and_an_effect
        출처 없는 칸으로 렌더하느니 빌드를 세운다.

    test_r_star_is_marked_level_only_because_it_measurably_is
        가정 띠가 «r* 2.0%» 를 델타의 근거처럼 보이게 두면 안 된다.
        실측으로 0.000000bp 였다.
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from rebake import cadence, layer2, status  # noqa: E402

OUT = BACKEND / "output"
ARTIFACTS = ("scenario_basis.json", "assumptions.json", "engine_status.json")


def _has_artifacts() -> bool:
    return all((OUT / a).exists() for a in ARTIFACTS)


needs_artifacts = pytest.mark.skipif(
    not _has_artifacts(), reason="아직 한 번도 안 구운 트리")


# ── 계약 모양 ───────────────────────────────────────────────────────────────


@needs_artifacts
def test_every_assumption_carries_a_source_and_an_effect():
    asm = json.loads((OUT / "assumptions.json").read_text("utf-8"))
    layer2.validate(asm)                    # 던지면 실패
    assert asm["items"], "가정이 하나도 없어요"
    for it in asm["items"]:
        assert it["source"].strip(), it["key"]
        assert it["effect_note"].strip(), it["key"]


@needs_artifacts
def test_r_star_is_marked_level_only_because_it_measurably_is():
    """실측 근거: r* 를 1.5·2.5 로 바꿔 기저를 다시 풀면 15개 기저 전부의
    10년 IRS 반응 최대 절대차가 0.000000bp 였다(2026-08-21).

    구조적 이유 — eq (35) 에서 r* 와 −φ_π·π* 는 가법 상수이고, 베이스라인 0 인
    편차 공간에서 상수는 소거된다. 모형이 선형이라 상태의존성도 없다.

    그러므로 이 값을 `delta` 로 표시하는 순간 화면이 거짓말을 한다.
    """
    asm = json.loads((OUT / "assumptions.json").read_text("utf-8"))
    by = {it["key"]: it for it in asm["items"]}
    assert by["r_star"]["effect"] == "level_only"
    assert by["pi_star"]["effect"] == "level_only"


@needs_artifacts
def test_shock_assumptions_are_not_claimed_to_be_in_the_basis():
    """미 정책금리·유가·해외성장은 기저가 **단위 충격**으로 담는다. 받아온
    현재 수준은 그 숫자에 안 들어간다."""
    asm = json.loads((OUT / "assumptions.json").read_text("utf-8"))
    by = {it["key"]: it for it in asm["items"]}
    for k in ("us_policy", "oil", "foreign_growth"):
        assert by[k]["effect"] == "not_in_basis", k


@needs_artifacts
def test_status_separates_the_bake_date_from_the_data_edge():
    """`basis_as_of` 하나만 싣던 시절에는 5개월 낡은 입력이 하루 전 것처럼
    보였다. 두 날짜는 따로 서야 한다."""
    st = json.loads((OUT / "engine_status.json").read_text("utf-8"))
    assert st["basis_as_of"]
    edge = st["data_edge"]
    assert edge["newest_quarter"], "분기 끝을 못 읽었어요"
    assert edge["binding_quarter"] <= edge["newest_quarter"]
    assert "분기 모형" in st["as_of_sentence"]


@needs_artifacts
def test_scorecard_is_nine_of_thirteen_and_names_its_misses():
    """예전 `engine_status.json` 은 12/13 을 싣고 있었는데 그건 Table 8 값의
    순열을 그 밴드에 맞춰 고른 과적합이라 기준선이 아니다."""
    st = json.loads((OUT / "engine_status.json").read_text("utf-8"))
    sc = st["scorecard"]
    assert (sc["passed"], sc["total"]) == (9, 13)
    assert len(sc["misses"]) == 4
    for m in sc["misses"]:
        assert m["panel"] and m["anchor"] and m["why"] and m["page"]
        # `measured` 는 **None 이어도 된다** — 유가 충격의 소비·수입은 아직
        # 재 보지 않았다. 0 으로 채우면 «밴드 정중앙» 처럼 보이므로 비워 둔다.
        assert "measured" in m
    # 그 12/13 이 왜 기준선이 아닌지가 문장에 남아 있어야 한다.
    assert "순열" in sc["note"] and "기준선이 아니" in sc["note"]


@needs_artifacts
def test_the_scorecard_is_not_a_second_copy_of_the_anchors():
    """앵커가 코드와 JSON 두 벌이면 한쪽만 낡는다 — 실제로 그렇게 낡아서
    `engine_status.json` 이 12/13 을 싣고 있었다. 스코어카드의 모든 실패는
    `config/paper_anchors.json` 의 앵커를 **가리키기만** 해야 한다."""
    doc = json.loads((BACKEND / "config" / "paper_anchors.json").read_text("utf-8"))
    ids = {a["id"] for sh in doc["shocks"] for a in sh["anchors"]}
    st = json.loads((OUT / "engine_status.json").read_text("utf-8"))
    for m in st["scorecard"]["misses"]:
        assert m["anchor_id"] in ids, m["anchor_id"]


# ── 달력 ────────────────────────────────────────────────────────────────────


def test_the_mpc_calendar_has_one_source_not_two():
    """`app/policy.py::MPC_DATES` 가 정본이다. 두 번째 상수 테이블을 만들면
    한쪽만 고쳐지는 날이 온다."""
    from app.policy import MPC_DATES
    mpc = next(c for c in cadence.calendars() if c.key == "mpc")
    assert mpc.dates == list(MPC_DATES)
    assert "policy.py" in mpc.source


def test_missing_calendars_are_named_not_invented():
    """FOMC·CPI 날짜는 이 리포 어디에도 없다. 지어내는 대신 «없다» 고 말한다."""
    nxt = cadence.next_event(dt.date(2026, 8, 21))
    assert set(nxt["missing_calendars"]) == {"fomc", "cpi"}
    assert "없어서" in nxt["note"]
    for c in cadence.calendars():
        if not c.available:
            assert c.source == cadence.SOURCE_NEEDED


def test_next_event_ending_follows_the_final_consonant():
    """「금통위이에요」 가 아니라 「금통위예요」. 받침 산술은 이 리포에 한 벌
    (`app/issuance_gloss.to_haeyo`) 뿐이어야 한다."""
    nxt = cadence.next_event(dt.date(2026, 8, 21))
    assert "금통위예요" in nxt["note"]
    assert "금통위이에요" not in nxt["note"]


def test_is_due_flips_after_an_mpc_passes():
    from app.policy import MPC_DATES
    d = MPC_DATES[0]
    assert not cadence.is_due(d, d)
    assert cadence.is_due(d - dt.timedelta(days=1), d)


# ── 원자성과 결정성 ─────────────────────────────────────────────────────────
#
# 아래 둘은 리베이크를 실제로 돌린다(각 ~10초). 이 리포에는 마커 규약이 없어서
# `@pytest.mark.slow` 를 붙여 봐야 **경고만 나고 아무것도 안 걸러진다** — 붙여
# 두면 걸러지는 줄 알게 되므로 안 붙인다.


@needs_artifacts
def test_a_failed_rebake_leaves_the_previous_artifacts_untouched(monkeypatch):
    """중간 실패를 심고 이전 산출물이 바이트 그대로인지 본다."""
    from rebake import __main__ as rb
    before = {a: (OUT / a).read_bytes() for a in ARTIFACTS}

    def boom(*_a, **_k):
        raise rb.RebakeError("심어 둔 실패")

    monkeypatch.setattr(rb.layer2, "build_assumptions", boom)
    with pytest.raises(rb.RebakeError):
        rb.rebake(count_tests=False)

    for a in ARTIFACTS:
        assert (OUT / a).read_bytes() == before[a], f"{a} 가 바뀌었어요"


def test_two_rebakes_are_byte_identical():
    """결정성 잠금. 딕셔너리 순서·HP 필터 끝점·RNG 중 어느 하나라도 흔들리면
    여기서 걸린다."""
    from rebake import __main__ as rb
    rb.rebake(offline=True, count_tests=False)
    first = (OUT / "scenario_basis.json").read_bytes()
    rb.rebake(offline=True, count_tests=False)
    assert (OUT / "scenario_basis.json").read_bytes() == first
