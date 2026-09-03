# -*- coding: utf-8 -*-
"""대사표의 **다리 줄** — 스프레드는 한 물건이 아니다
[OWNER 2026-09-03 — "채권 KRD, bp, 손익과 IRS KRD, bp, 손익, 그리고 종합
손익이 하루에 찍혀야 함"].

## 무엇을 지키나

화면이 다리마다 세 줄(KRD·Δbp·손익)을 세우려면 그 셋이 **서버에서** 와야 하고
(§16 — 브라우저는 계산하지 않는다), 오면 항등 둘이 봉마다 닫혀야 한다:

    Σ 다리 손익 = 평가           ← 분해가 실제로 그 값을 만든다
    Σ 다리 KRD  = 0 (다리 둘)    ← DV01 중립이 눈으로 보인다
    Σ 다리 캐리 = 캐리           ← `c = -position × carry[i]` 가 선형이라

이 셋이 깨지면 화면의 표는 **자기와 다투는 표**가 된다. 세로합이 안 맞는
대사표는 대사표가 아니라 숫자 더미다.

## 왜 라우트를 타나

분해는 세 파일에 걸쳐 있다 — `mrcarry.carry_rates_by_leg`(캐리) ·
`mr._futures_series`(다리 레벨) · `main._attach_leg_recon`(부호와 곱셈). 어느
하나만 단위시험하면 셋을 잇는 배선이 안 잡힌다. 실제로 이 검사가 서는 자리는
「페이로드가 스스로 닫히나」이므로 라우트를 탄다.
"""
import pytest

from app import mr as mr_mod


def _sql_reachable() -> bool:
    try:
        mr_mod.series_points("BSS-3Y")
        return True
    except Exception:
        return False


pytestmark_live = pytest.mark.skipif(
    not _sql_reachable(), reason="MR 계열 SQL 에 닿지 않습니다"
)

#: 원 단위 표라 1원이 기준이다 — 서버의 `LEG_RECON_TOL_KRW` 와 같은 자.
TOL = 1.0

#: 계열 종류마다 다리 이름과 개수가 정해져 있다(`mrcarry.LEG_NAMES`).
#: 다리 **분해**(감도·Δ·손익)는 이제 **근사 회계에서만** 온다. BSS 는
#: 2026-09-03 부터 실가격 자산스왑으로 회계하므로 그 구간의 돈을 대사표가
#: 세고, 점에는 「일별 레벨」이 쓰는 **레벨만** 실린다 — 폐기된 근사의 감도를
#: 같이 세우면 한 화면에 두 회계가 선다.
CASES = [
    ("FSW-3Y", ["선물", "IRS"]),
    ("FUT-KTB3", ["선물"]),
]
#: 실가격 회계라 레벨만 오는 계열.
LEVEL_ONLY = [("BSS-3Y", ["국고", "IRS"]), ("BSS-7Y", ["국고", "IRS"])]


@pytestmark_live
class TestLegRecon:
    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            yield c

    @pytest.mark.parametrize("sid,names", CASES)
    def test_every_bar_carries_its_legs(self, client, sid, names):
        """**한 봉도 빠지지 않는다.** 일부만 있으면 화면이 어떤 날은 이중으로,
        어떤 날은 한 줄로 서서 읽는 사람이 그 차이를 데이터로 읽는다."""
        body = client.get(f"/api/mr/strategy?id={sid}").json()
        pts = body["points"]
        assert pts, f"{sid}: 봉이 없다"
        missing = [p["t"] for p in pts if not p.get("legs")]
        assert not missing, f"{sid}: 다리가 없는 봉 {len(missing)}개 (첫 {missing[:3]})"
        for p in pts:
            assert [g["k"] for g in p["legs"]] == names, f"{sid} {p['t']}"

    @pytest.mark.parametrize("sid,names", CASES)
    def test_the_legs_add_up_to_what_the_engine_booked(self, client, sid, names):
        """세로합 셋 — 이 시험이 이 레인의 자기검사다."""
        pts = client.get(f"/api/mr/strategy?id={sid}").json()["points"]
        for p in pts:
            legs = p["legs"]
            assert abs(sum(g["mtm"] for g in legs) - p["mtm"]) <= TOL, \
                f"{sid} {p['t']}: 다리 손익 합 ≠ 평가"
            assert abs(sum(g["carry"] for g in legs) - p["carry"]) <= TOL, \
                f"{sid} {p['t']}: 다리 캐리 합 ≠ 캐리"
            if len(legs) == 2:
                assert abs(sum(g["krd"] for g in legs)) <= TOL, \
                    f"{sid} {p['t']}: 다리 KRD 합 ≠ 0 (DV01 중립이 깨졌다)"

    @pytest.mark.parametrize("sid,names", CASES)
    def test_each_row_closes_its_own_multiplication(self, client, sid, names):
        """줄마다 `손익 = −KRD × Δbp` — 백테스트 대사표의 그 부호 규약이다.

        이게 깨지면 표의 **가로**가 안 닫힌다. 세로합만 맞고 가로가 틀리면
        「분해는 그럴듯한데 줄이 거짓」인 표가 되고, 그건 더 나쁘다.
        """
        pts = client.get(f"/api/mr/strategy?id={sid}").json()["points"]
        checked = 0
        for p in pts:
            for g in p["legs"]:
                if g["dv"] is None or p["hold"] == 0:
                    assert g["mtm"] == 0, f"{sid} {p['t']} {g['k']}: 못 곱하는데 손익이 있다"
                    continue
                assert abs(-g["krd"] * g["dv"] - g["mtm"]) <= TOL, \
                    f"{sid} {p['t']} {g['k']}: −KRD × Δ ≠ 손익"
                checked += 1
        assert checked > 100, f"{sid}: 실제로 곱한 줄이 {checked}개뿐이다"

    @pytest.mark.parametrize("sid,names", LEVEL_ONLY)
    def test_real_accounting_series_carry_levels_only(self, client, sid, names):
        """실가격 회계 계열은 점에 **레벨만** 온다.

        「일별 레벨」 칸이 그 값을 쓴다(`legs[].lvl`). 감도·손익·캐리는 폐기된
        근사의 값이라 안 싣는다 — 있으면 화면이 두 회계를 같이 세우게 된다.
        """
        pts = client.get(f"/api/mr/strategy?id={sid}").json()["points"]
        assert pts
        for p in pts:
            assert p.get("legs"), f"{sid} {p['t']}: 다리 레벨이 없다"
            assert [g["k"] for g in p["legs"]] == names
            for g in p["legs"]:
                assert set(g) == {"k", "lvl"}, f"{sid} {p['t']}: 근사의 값이 남아 있다"

    def test_a_roll_day_masks_both_legs(self, client):
        """롤일은 봉 전체가 마스크다 — **한쪽만 살리면 그 줄이 안 닫힌다.**

        선물 다리에서 온 점프라 IRS 다리만 살려 두고 싶어지는데, 그러면
        「감도 × Δ = 손익」이 IRS 줄에서만 참이고 종합에서 거짓이 된다. 엔진이
        그 봉을 0 으로 적었으므로 표도 0 이어야 하고, 왜 0 인지는 표식이 말한다.
        """
        pts = client.get("/api/mr/strategy?id=FSW-3Y").json()["points"]
        rolls = [p for p in pts if p.get("roll")]
        assert rolls, "롤일이 한 봉도 없다 — 표본이나 규칙이 바뀌었다"
        for p in rolls:
            assert p["dv"] == 0, f"{p['t']}: 스프레드 Δ 가 안 마스크됐다"
            for g in p["legs"]:
                assert g["dv"] == 0, f"{p['t']} {g['k']}: 다리 Δ 가 안 마스크됐다"
                assert g["mtm"] == 0, f"{p['t']} {g['k']}: 마스크된 봉에 손익이 있다"

    def test_the_sign_of_krd_means_what_the_desk_means(self, client):
        """**부호가 경제와 맞나** — 이건 조용히 뒤집히는 종류다.

        백테스트·시뮬 대사표의 규약은 `손익 = −KRD × Δbp` 이고, 그 규약에서
        **양수 KRD = 금리 오르면 잃는 쪽**(현물 매수·리시브), **음수 KRD =
        금리 오르면 버는 쪽**(페이·숏)이다. 오너의 실물 표로 대조했다
        (2026-09-03): `KRD −509,059 · Δbp 0.75 · 손익 +381,795`.

        BSS 는 `dirs` 가 한 방향만 허용한다 — 국고 **매수** · IRS **페이**
        (엔진 부호로 `position = -1`). 그러면 국고 다리는 양수 KRD, IRS 다리는
        음수 KRD 여야 한다. 값이 아니라 **뜻**을 재는 시험이라, 부호 규약을
        바꾸면 여기가 먼저 빨개진다.

        ⚠ 종전 화면의 「감도」 칸은 `hold × 명목` 이라 **반대 부호**였다.
        2026-09-03 에 앱 전체와 맞췄고, 그 사실은 `_attach_leg_recon` 머리에.
        """
        pts = client.get("/api/mr/strategy?id=FSW-3Y").json()["points"]
        held = [p for p in pts if p["hold"] == -1]
        assert len(held) > 100, f"보유 봉이 {len(held)}개뿐이다 — 표본이 바뀌었다"
        for p in held:
            g, s = p["legs"]
            assert g["k"] == "선물" and s["k"] == "IRS"
            assert g["krd"] > 0, f"{p['t']}: 매수 다리인데 KRD 가 양수가 아니다"
            assert s["krd"] < 0, f"{p['t']}: IRS 페이인데 KRD 가 음수가 아니다"

        # 그리고 그 부호가 실제로 돈의 방향을 만든다 — 금리가 오른 날 국고
        # 다리는 잃고, 같은 날 IRS 다리는 번다.
        up = [p for p in held if p["legs"][0]["dv"] and p["legs"][0]["dv"] > 0]
        assert up, "국고 금리가 오른 보유 봉이 없다"
        for p in up[:200]:
            assert p["legs"][0]["mtm"] < 0, f"{p['t']}: 매수 다리 금리가 올랐는데 벌었다"
        up_i = [p for p in held if p["legs"][1]["dv"] and p["legs"][1]["dv"] > 0]
        assert up_i, "IRS 금리가 오른 보유 봉이 없다"
        for p in up_i[:200]:
            assert p["legs"][1]["mtm"] > 0, f"{p['t']}: IRS 페이인데 금리 올라 잃었다"

    @pytest.mark.parametrize("sid,_names", LEVEL_ONLY)
    def test_bss_legs_are_the_spread_itself(self, client, sid, _names):
        """BSS 는 `(국고 − IRS) × 100 = 값` 이 정확히 성립한다 — 다리 레벨이
        스프레드의 **재료**이지 옆에 붙은 참고값이 아니라는 사실이다."""
        pts = client.get(f"/api/mr/strategy?id={sid}").json()["points"]
        for p in pts[:500]:
            g, s = p["legs"][0]["lvl"], p["legs"][1]["lvl"]
            assert abs((g - s) * 100.0 - p["v"]) <= 0.05, f"{p['t']}: 다리 − 다리 ≠ 값"

@pytestmark_live
class TestRealRecon:
    """`/api/mr/recon` — **실가격 자산스왑 대사** [OWNER 2026-09-03 — "이 방향이
    정확한 대사"].

    BSS 를 자산스왑으로 세워 민평 노드를 1bp 씩 범프한 테너별 KRD 다. 값을
    만드는 것은 `cashbond` 이고 그쪽에 자기 시험이 있으므로, 여기서 재는 것은
    **MR 이 그것을 옳게 부르는가**다: 액면 환산 · 방향 · 못 세우는 자리.
    """

    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            yield c

    def test_a_trade_inside_the_matrix_gets_a_tenor_grid(self, client):
        """표가 서고, **줄마다 곱셈이 닫힌다**(`추정 = −KRD × Δbp`).

        이게 이 표의 전부다 — 테너별 KRD 를 세우는 이유가 그 곱셈이 테너마다
        보이게 하는 것이기 때문이다.
        """
        b = client.get("/api/mr/strategy?id=BSS-7Y").json()
        first = client.get("/api/mr/recon?id=BSS-7Y"
                           "&entry=2021-04-30&exit=2021-06-08&dir=-1").json()
        assert first["available"], first.get("why")
        assert first["tenors"], "테너 열이 비었다"
        assert first["rows"], "행이 없다"
        # 액면은 **전략 라우트와 같은 수**여야 한다 — 두 화면이 다른 명목으로
        # 같은 거래를 말하면 대사가 아니다.
        assert first["principal"]["krw"] == b["principal"]["krw"]

        checked = 0
        for r in first["rows"]:
            krd, dbp, est = r.get("krd") or {}, r.get("dbp") or {}, r.get("est") or {}
            for lb, k in krd.items():
                d = dbp.get(lb)
                if d is None:
                    continue
                assert abs(-k * d - est.get(lb, 0.0)) <= 1.0, f"{r['t']} {lb}"
                checked += 1
            if r.get("estTotal") is not None:
                assert abs(sum(est.values()) - r["estTotal"]) <= 1.0, r["t"]
            if r.get("residual") is not None and r.get("valuation") is not None:
                assert abs(r["valuation"] - r["estTotal"] - r["residual"]) <= 1.0, r["t"]
        assert checked > 20, f"곱셈을 잰 칸이 {checked}개뿐이다"

    def test_the_sensitivity_sits_where_the_bond_lives(self, client):
        """KRD 가 **잔존만기 언저리 노드**에만 실린다.

        단일수익률 할인이라 노드 하나를 흔들면 잔존을 감싸는 두 노드에만
        가중치가 실린다(`cashbond._krd_bond`). 7년 자산스왑의 감도가 3M 에
        실려 있으면 그건 가격기를 잘못 부른 것이다.
        """
        r = client.get("/api/mr/recon?id=BSS-7Y"
                       "&entry=2021-04-30&exit=2021-06-08&dir=-1").json()
        mid = r["rows"][len(r["rows"]) // 2]
        hot = [lb for lb, v in (mid["krd"] or {}).items() if abs(v) > 1.0]
        assert hot, f"{mid['t']}: KRD 가 전부 0 이다"
        assert set(hot) <= {"5Y", "7Y", "10Y"}, f"{mid['t']}: 감도가 엉뚱한 데 있다 — {hot}"

    def test_a_trade_before_the_matrix_says_so_instead_of_inventing(self, client):
        """민평 이력 밖은 **비운다** [OWNER 2026-09-03]. 지어낸 대사를 세우면
        읽는 사람이 그것을 실측으로 읽는다."""
        r = client.get("/api/mr/recon?id=BSS-7Y"
                       "&entry=2015-06-11&exit=2015-08-18&dir=-1").json()
        assert r["available"] is False
        assert "민평" in r["why"] and "2020-01-02" in r["why"]
        assert "rows" not in r, "못 세운다면서 행을 보냈다"

    def test_futures_series_say_why_they_have_no_asset_swap(self, client):
        """선물 계열은 이 경로가 **없다** — 증거금·일일정산이라 현물을 조달해
        들고 있는 자산스왑으로 가격할 수 없다. 화면은 다리 표로 서고, 그 사실을
        여기서 말한다."""
        for sid in ("FUT-KTB3", "FSW-3Y"):
            r = client.get(f"/api/mr/recon?id={sid}"
                           "&entry=2021-01-04&exit=2021-02-01&dir=-1").json()
            assert r["available"] is False, sid
            assert "자산스왑" in r["why"], sid

    def test_an_unknown_series_is_a_404_not_an_empty_table(self, client):
        assert client.get("/api/mr/recon?id=NOPE&entry=2021-01-04"
                          "&exit=2021-02-01&dir=-1").status_code == 404

    def test_every_bss_trade_on_screen_can_be_reconciled(self, client):
        """**화면이 보여 주는 것은 전부 대사할 수 있다** [OWNER 2026-09-03 —
        "2020-01-02 이전의 데이터를 안 보이게 해서 차단"].

        MR 의 값 계열은 `imx_data.timeseries`(2014-05-28~)인데 실가격 대사는
        민평 행렬(`credit_matrix`, 2020-01-02~)로 채권을 다시 가격한다. 종전에는
        그 갈림 때문에 거래의 절반이 «표가 안 뜨는 거래» 였다(BSS-7Y 34건 중 18).

        표본을 민평의 첫 날로 자른 것이 그 답이다. 이 시험이 재는 것은 **자른
        결과가 실제로 그 성질을 만드나** — 한 건이라도 못 재면 화면이 다시
        「왜 안 뜨죠」를 받는다.
        """
        from app import creditmatrix

        first = creditmatrix.load().dates[0].isoformat()
        for sid in ("BSS-3Y", "BSS-7Y"):
            b = client.get(f"/api/mr/strategy?id={sid}").json()
            assert b["points"][0]["t"] >= first, f"{sid}: 표본이 민평보다 앞선다"
            bad = []
            for t in b["trades"]:
                r = client.get(f"/api/mr/recon?id={sid}&entry={t['entryT']}"
                               f"&exit={t['exitT']}&dir={t['dir']}").json()
                if not r.get("available"):
                    bad.append((t["entryT"], r.get("why", "")[:40]))
            assert not bad, f"{sid}: 대사 못 하는 거래 {len(bad)}건 — {bad[:2]}"
            assert len(b["trades"]) > 5, f"{sid}: 자르고 나니 거래가 너무 적다"

    def test_futures_keep_their_full_sample(self, client):
        """**선물 계열은 안 자른다.** 자산스왑이 아니라 민평 제약이 걸리지 않는
        자리다 — 거기까지 자르면 얻는 것 없이 표본만 천 봉 잃는다(실측 FSW-3Y
        2,614 → 1,636)."""
        from app import creditmatrix

        first = creditmatrix.load().dates[0].isoformat()
        for sid in ("FSW-3Y", "FUT-KTB3"):
            b = client.get(f"/api/mr/strategy?id={sid}").json()
            assert b["points"][0]["t"] < first, f"{sid}: 선물인데 잘렸다"

    def test_the_table_is_the_book(self, client):
        """**대사표가 곧 엔진의 장부다** [OWNER 2026-09-03 — "캐리 롤다운 다
        넣고 우리가 원래 사용하던 백테스트/시뮬레이션에서의 대사와 동일하게"].

        종전에는 둘이 다른 회계였다 — 엔진은 `평가 = 명목 × Δ스프레드` 하나라
        롤다운도 조달도 없었고, 실측에서 안 세는 롤다운이 세는 전부보다 컸다.
        이제 진입·청산 시점만 엔진이 정하고 그 구간의 돈은 이 표가 센다.

        **정확히 0 이어야 한다.** «거의 같다» 는 두 화면이 다른 수를 말한다는
        뜻이고, 그러면 트레이더가 어느 쪽을 믿을지 골라야 한다.
        """
        b = client.get("/api/mr/strategy?id=BSS-7Y").json()
        assert b["real"] is True, "BSS 인데 실가격 회계가 아니다"
        assert b["trades"], "거래가 없다"
        for t in b["trades"]:
            r = client.get(f"/api/mr/recon?id=BSS-7Y&entry={t['entryT']}"
                           f"&exit={t['exitT']}&dir={t['dir']}").json()
            assert r["available"], f"{t['entryT']}: 대사가 안 선다"
            tot = sum(x.get("actual") or 0 for x in r["rows"])
            assert abs((tot + t["cost"]) - t["pnl"]) < 0.01,                 f"{t['entryT']}: 표 세로합 + 비용 ≠ 거래 손익"

    def test_five_components_close_on_every_trade(self, client):
        """`평가 + 캐리 + 롤다운 + 조달 + 비용 = 손익` — 다섯이 닫힌다.

        백테스트·시뮬 대사의 네 성분에 전략의 비용 하나가 붙은 모양이다. 비용이
        표에 없는 이유는 그것이 상품의 성질이 아니라 노브이기 때문이다.
        """
        b = client.get("/api/mr/strategy?id=BSS-3Y").json()
        assert b["real"] is True
        for t in b["trades"]:
            five = (t["mtm"] + t["carry"] + t["rolldown"] + t["funding"] + t["cost"])
            assert abs(five - t["pnl"]) < 0.02, f"{t['entryT']}: 다섯이 안 닫힌다"
        # 봉 단위로도 닫힌다 — 대사표의 가로가 그것이다.
        for p in b["points"]:
            five = p["mtm"] + p["carry"] + p["rolldown"] + p["funding"] + p["cost"]
            assert abs(five - p["pnl"]) < 0.02, f"{p['t']}: 봉의 다섯이 안 닫힌다"

    def test_futures_keep_the_engine_approximation_and_say_so(self, client):
        """선물 계열은 자산스왑이 아니라 이 회계가 **없다**. 0 으로 채우지 않고
        열 자체를 안 보낸다 — 0 은 「그날 롤다운이 없었다」는 다른 말이다."""
        for sid in ("FUT-KTB3", "FSW-3Y"):
            b = client.get(f"/api/mr/strategy?id={sid}").json()
            assert b["real"] is False, sid
            p = b["points"][len(b["points"]) // 2]
            assert "rolldown" not in p and "funding" not in p, sid
            assert abs((p["mtm"] + p["carry"] + p["cost"]) - p["pnl"]) < 0.02, sid

    def test_the_locked_pms_vector_still_passes(self):
        """**엔진 함수는 안 건드렸다.** 회계는 라우트에서 얹으므로 `simulate`
        의 적합성 벡터가 그대로 통과해야 한다 — 이 시험이 그 사실의 기록이다."""
        from tests import test_mrbacktest as tb

        tb.test_kpi_conformance_vector_matches_pms()
