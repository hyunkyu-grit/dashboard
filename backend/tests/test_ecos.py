"""ECOS 기준금리 클라이언트 — 파싱·캐시·거절.

망을 타는 테스트는 하나도 없다. `fetch_rows` 를 가로채고 나머지를 검사한다 —
게이트가 인터넷에 매달리면 그건 게이트가 아니다.

이 파일이 지키는 명제는 하나로 줄면 이렇다: **조용히 틀린 값을 내놓지 않는다.**
멈춘 출처를 평탄 연장해 7월 인상을 놓친 것이 이 모듈이 생긴 이유다
(`app/funding.py` V2 절).
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from app import ecos


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """캐시를 임시 폴더로 — 개발 기계의 진짜 캐시를 건드리지 않는다."""
    monkeypatch.setattr(ecos, "CACHE_PATH", tmp_path / "ecos-base-rate.json")
    monkeypatch.setenv("ECOS_API_KEY", "test-key")


ROWS = [
    {"TIME": "20260101", "DATA_VALUE": "2.5"},
    {"TIME": "20260715", "DATA_VALUE": "2.5"},
    {"TIME": "20260716", "DATA_VALUE": "2.75"},
    {"TIME": "20260817", "DATA_VALUE": "2.75"},
]


class TestParse:
    def test_percent_becomes_decimal(self):
        s = ecos._parse(ROWS)
        assert s[0] == (dt.date(2026, 1, 1), 0.025)
        assert s[-1] == (dt.date(2026, 8, 17), 0.0275)

    def test_the_july_hike_survives(self):
        """이 한 줄이 이 모듈의 존재 이유다."""
        s = dict(ecos._parse(ROWS))
        assert s[dt.date(2026, 7, 15)] == 0.025
        assert s[dt.date(2026, 7, 16)] == 0.0275

    def test_sorted_even_if_the_feed_is_not(self):
        s = ecos._parse(list(reversed(ROWS)))
        assert [d for d, _ in s] == sorted(d for d, _ in s)

    def test_blanks_are_dropped_not_zeroed(self):
        """빈 칸을 0 으로 읽으면 그날 조달이 0% 가 된다 — 조용한 거짓말."""
        s = ecos._parse([*ROWS, {"TIME": "20260818", "DATA_VALUE": "-"},
                         {"TIME": "20260819", "DATA_VALUE": ""}])
        assert [v for _, v in s] == [0.025, 0.025, 0.0275, 0.0275]

    def test_nothing_parseable_raises(self):
        with pytest.raises(ecos.EcosError):
            ecos._parse([{"TIME": "nope", "DATA_VALUE": "x"}])


class TestKey:
    def test_missing_key_names_itself(self, monkeypatch):
        monkeypatch.delenv("ECOS_API_KEY", raising=False)
        with pytest.raises(ecos.EcosError) as e:
            ecos.api_key()
        assert "ECOS_API_KEY" in str(e.value)

    def test_blank_key_is_missing(self, monkeypatch):
        monkeypatch.setenv("ECOS_API_KEY", "   ")
        with pytest.raises(ecos.EcosError):
            ecos.api_key()


class TestCache:
    def test_fresh_cache_skips_the_network(self, monkeypatch):
        ecos._write_cache(ROWS)
        monkeypatch.setattr(
            ecos, "fetch_rows", lambda *a, **k: pytest.fail("망을 탔다")
        )
        assert ecos.base_rate_series()[-1][1] == 0.0275

    def test_stale_cache_refetches(self, monkeypatch):
        old = dt.datetime.now() - dt.timedelta(hours=ecos.CACHE_TTL_HOURS + 1)
        ecos.CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        ecos.CACHE_PATH.write_text(
            json.dumps({"retrieved_at": old.isoformat(), "rows": ROWS[:1]}),
            encoding="utf-8",
        )
        monkeypatch.setattr(ecos, "fetch_rows", lambda *a, **k: ROWS)
        assert len(ecos.base_rate_series()) == 4

    def test_network_failure_falls_back_to_cache(self, monkeypatch):
        """망이 끊겼다고 화면이 서면 안 된다. 낡은 값이라도 쓰고 로그로 말한다."""
        old = dt.datetime.now() - dt.timedelta(hours=ecos.CACHE_TTL_HOURS + 1)
        ecos.CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        ecos.CACHE_PATH.write_text(
            json.dumps({"retrieved_at": old.isoformat(), "rows": ROWS}), encoding="utf-8"
        )

        def boom(*a, **k):
            raise ecos.EcosError("망 끊김")

        monkeypatch.setattr(ecos, "fetch_rows", boom)
        assert ecos.base_rate_series()[-1][1] == 0.0275

    def test_no_cache_and_no_network_raises(self, monkeypatch):
        def boom(*a, **k):
            raise ecos.EcosError("망 끊김")

        monkeypatch.setattr(ecos, "fetch_rows", boom)
        with pytest.raises(ecos.EcosError):
            ecos.base_rate_series()


class TestWrongSeries:
    def test_a_different_item_name_is_refused(self, monkeypatch):
        """코드가 바뀌어 다른 시리즈를 가리키게 되는 날, 조용히 읽지 않는다."""
        def page(key, first, last, end):
            return {
                "list_total_count": "1",
                "row": [{"TIME": "20260817", "DATA_VALUE": "3.5",
                         "ITEM_NAME1": "콜금리(1일물)"}],
            }

        monkeypatch.setattr(ecos, "_fetch_page", page)
        with pytest.raises(ecos.EcosError) as e:
            ecos.fetch_rows()
        assert "기준금리" in str(e.value)

    def test_the_expected_item_name_passes(self, monkeypatch):
        def page(key, first, last, end):
            return {
                "list_total_count": "1",
                "row": [{"TIME": "20260817", "DATA_VALUE": "2.75",
                         "ITEM_NAME1": ecos.BASE_RATE_ITEM_NAME}],
            }

        monkeypatch.setattr(ecos, "_fetch_page", page)
        assert ecos.fetch_rows() == [{"TIME": "20260817", "DATA_VALUE": "2.75"}]

    def test_an_error_body_is_not_read_as_data(self, monkeypatch):
        """ECOS 는 오류도 HTTP 200 으로 준다. 몸통 모양이 유일한 판별이다."""
        import urllib.request

        class Fake:
            def read(self):
                return json.dumps(
                    {"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 없습니다"}}
                ).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: Fake())
        with pytest.raises(ecos.EcosError) as e:
            ecos._fetch_page("k", 1, 10, "20261231")
        assert "StatisticSearch" in str(e.value)
