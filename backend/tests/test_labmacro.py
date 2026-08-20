# -*- coding: utf-8 -*-
"""모형이 딛고 선 거시 실측 (`app/labmacro.py`).

이 파일에서 하중을 지는 것은 `test_the_hp_gap_reproduces_bigfoot` 다. 나머지는
페이로드의 모양을 기술하지만, 그 하나는 **같은 GDP 에 두 개의 갭이 생기는 것**을
막는다.

GDP 갭은 발표되는 통계가 아니라 필터의 산출물이다. 필터를 옮겨 적으면서 한
글자라도 갈리면, 화면은 BIGFOOT 이 모형을 세울 때 쓴 것과 **다른 경기 상태**를
보여주면서 같은 이름을 붙이게 된다. 그건 화면의 문제가 아니라 데이터의 문제로
보인다.

네트워크는 안 쓴다. BIGFOOT 의 캐시 CSV 를 입력으로 양쪽 구현을 돌린다 — 그게
포팅 검사의 올바른 모양이다(ECOS 가 살아 있는지는 이 검사가 답할 질문이 아니다).
"""

import pathlib
import sys

import pandas as pd
import pytest

from app import labmacro

#: BIGFOOT 리포. 없으면 대조를 건너뛴다 — 이 리포 밖의 파일이다.
BIGFOOT = pathlib.Path(r"C:\Users\infomax\Desktop\project_bigfoot")
GDP_CSV = BIGFOOT / "data" / "raw" / "bigfoot_gdp_real_sa_q.csv"
CPI_CSV = BIGFOOT / "data" / "raw" / "bigfoot_core_cpi_q.csv"


def _cached(path: pathlib.Path) -> pd.Series:
    """BIGFOOT 이 2026-08-05 에 받아 둔 원본. BOM 이 붙어 있다."""
    df = pd.read_csv(path, encoding="utf-8-sig")
    return labmacro.to_qseries(
        [{"TIME": t, "DATA_VALUE": v} for t, v in zip(df["TIME"], df["DATA_VALUE"])]
    )


needs_bigfoot = pytest.mark.skipif(
    not GDP_CSV.exists(), reason="BIGFOOT 리포가 이 PC 에 없음"
)


@needs_bigfoot
def test_the_hp_gap_reproduces_bigfoot():
    """우리 갭이 BIGFOOT 의 갭과 같은 숫자다.

    양쪽을 **같은 입력**으로 돌린다. 다르면 옮겨 적기가 갈린 것이고, 그러면 화면의
    «GDP 갭» 은 모형이 딛고 선 갭이 아니다.
    """
    sys.path.insert(0, str(BIGFOOT))
    try:
        from bigfoot.data.ecos import output_gap_hp as theirs
    except Exception as exc:  # noqa: BLE001 — venv 가 다르면 임포트가 안 될 수 있다
        pytest.skip(f"BIGFOOT 임포트 실패: {exc}")
    finally:
        sys.path.remove(str(BIGFOOT))

    gdp = _cached(GDP_CSV)
    mine = labmacro.output_gap_hp(gdp)
    ref = theirs(gdp)

    assert len(mine) == len(ref)
    # 같은 코드니 부동소수 오차 밖으로 갈릴 이유가 없다.
    assert (mine - ref).abs().max() < 1e-10


@needs_bigfoot
def test_the_gap_is_centred_and_small():
    """갭이 % 단위이고 상식적인 크기다 — 단위를 100배 틀리면 여기서 걸린다."""
    gap = labmacro.output_gap_hp(_cached(GDP_CSV))
    assert abs(gap.mean()) < 0.5, "갭 평균이 0 근처가 아니에요"
    assert gap.abs().max() < 15.0, "갭이 % 가 아니라 다른 단위 같아요"


@needs_bigfoot
def test_the_core_cpi_yoy_is_a_rate_not_an_index():
    """지수를 그대로 그리면 «물가 110%» 가 화면에 뜬다. YoY 로 바꾼 것을 낸다."""
    cpi = _cached(CPI_CSV)
    pi = (cpi / cpi.shift(4) - 1.0) * 100.0
    recent = pi.dropna().iloc[-8:]
    assert (recent.abs() < 12.0).all(), "YoY 변환이 안 된 것 같아요"


def test_the_full_sample_filter_is_not_cropped_first():
    """갭은 전 표본으로 돌린 뒤 잘라야 한다.

    HP 는 표본 전체를 보는 필터다. 자르고 돌리면 같은 분기가 다른 값을 갖는다 —
    «최근만 보여준다» 는 화면의 요구가 조용히 숫자를 바꾼다.

    화면이 원하는 8분기로는 아예 못 돌린다(AR(4) 에 표본이 모자라 statsmodels 가
    거절한다 — 실측). 그래서 10년(40분기)으로 잰다. 돌아가기는 하고, 값은 다르다.
    """
    if not GDP_CSV.exists():
        pytest.skip("BIGFOOT 리포가 이 PC 에 없음")
    gdp = _cached(GDP_CSV)

    with pytest.raises(ValueError):
        labmacro.output_gap_hp(gdp.iloc[-8:])

    full_then_crop = labmacro.output_gap_hp(gdp).iloc[-40:]
    crop_then_filter = labmacro.output_gap_hp(gdp.iloc[-40:])
    assert (full_then_crop - crop_then_filter).abs().max() > 0.1, (
        "두 방법이 같은 값을 내면 이 검사가 지키는 게 없어요"
    )


def test_the_series_list_names_what_each_knob_stands_on():
    """손잡이 셋과 계열 셋이 짝이다. 유가는 짝이 없고, 그 사실이 적혀 있다."""
    assert set(labmacro.SERIES) == {"core_cpi", "gdp_real_sa", "exports"}
    for stat, cycle, item, start, expect in labmacro.SERIES.values():
        assert cycle == "Q"
        assert expect, "항목 이름 검사가 없으면 코드가 바뀌어도 안 걸려요"


def test_the_gap_is_labelled_as_ours_not_the_boks(monkeypatch):
    """«ECOS 에서 가져온 실측» 과 «우리가 필터로 만든 값» 이 구분돼야 한다."""
    monkeypatch.setattr(
        labmacro,
        "load_raw",
        lambda: (
            {
                "core_cpi": [
                    {"TIME": f"{y}Q{q}", "DATA_VALUE": 100.0 + y - 2018 + q * 0.1}
                    for y in range(2018, 2027)
                    for q in (1, 2, 3, 4)
                ],
                "gdp_real_sa": [
                    {"TIME": f"{y}Q{q}", "DATA_VALUE": 500000.0 * (1.005 ** ((y - 1990) * 4 + q))}
                    for y in range(1990, 2027)
                    for q in (1, 2, 3, 4)
                ],
                "exports": [
                    {"TIME": f"{y}Q{q}", "DATA_VALUE": 200000.0 + (y - 2018) * 1000 + q}
                    for y in range(2018, 2027)
                    for q in (1, 2, 3, 4)
                ],
            },
            None,
        ),
    )
    p = labmacro.build(quarters=8)
    by = {s["key"]: s for s in p["series"]}
    assert by["cpi"]["official"] is True
    assert by["gap"]["official"] is False, "필터 산출물이 공식 통계로 서 있어요"
    assert "HP" in by["gap"]["source"]
    assert any("유가" in n for n in p["notes"]), "실측이 없는 손잡이를 안 밝혔어요"
    assert all(len(s["points"]) == 8 for s in p["series"])
    assert p["stale"] is False


def test_a_stale_cache_says_so(monkeypatch):
    """옛 숫자를 오늘 숫자인 척 내놓지 않는다."""
    monkeypatch.setattr(
        labmacro,
        "load_raw",
        lambda: (
            {
                "core_cpi": [{"TIME": "2026Q1", "DATA_VALUE": 110.0}],
                "gdp_real_sa": [
                    {"TIME": f"{y}Q{q}", "DATA_VALUE": 500000.0 * (1.005 ** ((y - 1990) * 4 + q))}
                    for y in range(1990, 2027)
                    for q in (1, 2, 3, 4)
                ],
                "exports": [{"TIME": "2026Q1", "DATA_VALUE": 200000.0}],
            },
            "ECOS 를 못 읽어 30시간 전 값을 쓰고 있어요",
        ),
    )
    p = labmacro.build()
    assert p["stale"] is True
    assert "못 읽어" in p["notes"][0]
