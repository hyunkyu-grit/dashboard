# -*- coding: utf-8 -*-
"""배선 엣지리스트 — `bigfoot/solve/system.py` 의 solve 루프를 읽어서 만든다.

python -m wiring.edges        (backend/output/wiring_graph.json 을 쓴다)

## 왜 PDF 가 아니라 코드에서 뽑나

논문을 베끼면 «논문에 있는 것» 이 나오고, 코드를 읽으면 «실제로 배선된 것» 이
나온다. 2026-08-21 감사가 잡은 결함(eq 21 의 수입 수요에 IH·G 가 빠져 있었다)이
정확히 그 차이였다. 빠진 항은 화면에서 **없는 화살표**로 보여야 한다.

## 어떻게 뽑나 — AST × 수치미분

`solve()` 의 기간 루프 본문은 전부 **선형**이다(기저의 `linearity_gate` 가 그
사실을 따로 잠근다). 그래서 각 대입문을

    new["K"] = <참조들의 선형결합>

으로 읽고, 참조마다 곱해진 계수를 모은다.

- `self.<...>` 만 들어 있는 부분식은 **그대로 eval** 한다. 살아 있는
  `BigfootSystem` 인스턴스를 네임스페이스에 넣어 두므로 계수는 추정이 아니라
  실측이다. 계수 객체(`Coefficient`)면 `.source` 가 부록 D 슬롯 주소를 준다.
- `self.pp.core_inflation(...)` 처럼 몸통이 `equations/korea.py` 에 있는
  호출은 **수치미분**한다. 선형함수라 단위벡터 한 번이면 계수가 정확히 나온다.
  korea.py 를 또 파싱하는 것보다 이쪽이 실제 함수를 재는 것이라 더 낫다.
- `self.w40 @ x_t` 같은 상태벡터 통로는 왼쪽을 수치벡터로 풀고 오른쪽
  `np.array([...])` 의 원소마다 나눠 붙인다. 시제품이 `kr10y`·`kr3y` 를 놓친
  자리가 여기였다.
- `for key, ekey, eq, rname in [...]` 루프는 리터럴 튜플로 **펼친다**.
  시제품이 `r_hh`·`r_firm` 을 놓친 자리다.

## 장기/단기

**계수 슬롯 주소에 `.target.` 이 있으면 장기(LR)**, 아니면 단기(SR)다. 논문의
설계가 그렇다 — 목표식(공적분)이 장기 행태식이고 성장식(PAC/오차수정)이 단기다.
가계부채→소비가 장기 음(eq 7)·단기 양(eq 8)으로 **같은 쌍에 엣지 둘**이 서는
것이 이 규칙으로 자동으로 나온다.

## 못 잡은 것은 못 잡았다고 적는다

`uncovered` 를 비워 두지 않는다. 생성기가 표현 못 한 자리는 화면이 그렇게
말해야 한다.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_PY = ROOT / "bigfoot" / "solve" / "system.py"
OUT = ROOT / "output" / "wiring_graph.json"

# ── 논문 인쇄 쪽 (PDF 를 읽어서 만든 표, `wiring/paper_pages.py` 참조) ────────
from wiring.paper_pages import EQUATION_PAGE  # noqa: E402

# ── 변수 사전 ────────────────────────────────────────────────────────────────
#
# 블록은 논문의 넷이다. 주택가격·가계부채가 **금융**에 있는 것은 논문이 그
# 둘을 금융 블록의 차별점으로 내세우기 때문이다(§3.4).
BLOCK = {
    "external": ["us_y", "us_pi", "us_i", "us10y", "oil",
                 "f_china", "f_japan", "f_eu", "f_ea", "f_rw", "d_x"],
    "expenditure": ["c", "dc", "i_fi", "di", "g", "dg", "i_con", "di_con",
                    "ih_star", "x", "m", "y_gap"],
    "price": ["pi_core", "pi_inf", "p_core", "p_cpi", "cpi_yoy", "pm"],
    "financial": ["s", "i_kr", "cb", "kr10y", "kr3y", "eta_hh", "eta_firm",
                  "r_hh", "r_firm", "hpi", "dhpi", "hpi_yoy", "debt",
                  "ddebt"],
}
BLOCK_OF = {v: b for b, vs in BLOCK.items() for v in vs}

LABEL = {
    "c": "민간소비", "dc": "소비 증가율", "i_fi": "설비투자",
    "di": "설비투자 증가율", "g": "정부소비", "dg": "정부소비 증가율",
    "i_con": "건설투자", "di_con": "건설투자 증가율",
    "ih_star": "건설투자 목표", "x": "수출", "m": "수입", "y_gap": "GDP 갭",
    "pi_core": "근원물가 상승률", "pi_inf": "물가 어트랙터",
    "p_core": "근원물가 수준", "p_cpi": "소비자물가 수준",
    "cpi_yoy": "소비자물가 상승률", "pm": "수입물가",
    "s": "원달러(로그, +=절하)", "i_kr": "기준금리", "cb": "회사채 스프레드",
    "kr10y": "국고 10년", "kr3y": "국고 3년",
    "eta_hh": "가계대출 스프레드", "eta_firm": "기업대출 스프레드",
    "r_hh": "가계 대출금리", "r_firm": "기업 대출금리",
    "hpi": "주택가격", "dhpi": "주택가격 증가율", "hpi_yoy": "주택가격 전년비",
    "debt": "가계부채/GDP", "ddebt": "가계부채 증가분",
    "us_y": "미국 GDP 갭", "us_pi": "미국 물가", "us_i": "미국 정책금리",
    "us10y": "미국 10년", "oil": "유가 갭",
    "f_china": "중국 GDP 갭", "f_japan": "일본 GDP 갭", "f_eu": "EU GDP 갭",
    "f_ea": "신흥아시아 GDP 갭", "f_rw": "기타국 GDP 갭",
    "d_x": "세계 수출수요",
}

# ── LHS 변수 → 방정식 ────────────────────────────────────────────────────────
#
# 번호는 `equations/korea.py` 의 `eq_no` 에서 왔고(코드가 스스로 적어 둔 값),
# 쪽수는 `wiring/paper_pages.py` 가 PDF 에서 읽었다. 목표식/성장식이 갈리는
# 변수는 (LR, SR) 두 벌을 든다.
EQ_OF = {
    #  var        LR 목표식   SR 성장식
    "c": ("7", "8"),
    "dc": (None, "8"),
    "i_fi": ("9", "11"),
    "di": (None, "11"),
    "i_con": ("12", "14"),
    "di_con": (None, "14"),
    "ih_star": ("12", None),
    "g": ("15", "16"),
    "dg": (None, "16"),
    "x": ("17", "19"),
    "m": ("20", "22"),
    "pm": ("31", "32"),
    "p_cpi": ("25", "26"),
    "cpi_yoy": (None, "25"),
    "pi_core": (None, "23"),
    "pi_inf": (None, "24"),
    "p_core": (None, "23"),
    "hpi": ("27", "28"),
    "dhpi": ("27", "28"),
    "hpi_yoy": (None, "28"),
    "debt": (None, "44"),
    "ddebt": (None, "44"),
    "i_kr": (None, "35"),
    "s": (None, "33"),
    "cb": (None, "38"),
    "eta_hh": (None, "42"),
    "eta_firm": (None, "42"),
    "r_hh": (None, "40"),
    "r_firm": (None, "40"),
    "kr10y": (None, "36"),
    "kr3y": (None, "36"),
    # 인쇄된 번호가 없는 자리. **비워 두지 않고 이름을 준다.**
    "y_gap": (None, "항등식"),
}

#: 논문 번호가 없는 «식». 화면이 이것을 논문 인용으로 오해하면 안 되므로
#: 쪽수를 안 붙이고 배선 깃발을 대신 단다.
NON_PAPER_EQ = {"항등식": "WIRING_SHARES_DATA"}

#: `investment_growth` 가 스스로를 eq 10 이라 부르지만, PDF 를 읽으면 (10) 은
#: **자본 사용자비용 정의**이고 설비투자 PAC 성장식은 (11) 이다(인쇄 p.18).
#: 엔진은 동결이라 고치지 않고, 이 표가 논문 번호를 든다.
EQ_NO_CORRECTIONS = {
    "investment_growth": {"code": "10", "paper": "11",
                          "why": "PDF 인쇄 p.18 에서 (10) 은 자본 "
                                 "사용자비용 정의이고 설비투자 성장식은 "
                                 "(11) 이에요."},
}


# ── AST 도우미 ───────────────────────────────────────────────────────────────
def _src(node) -> str:
    return ast.unparse(node)


class Ref:
    """참조 하나 — 변수와 그것이 지금 것인지 지난 분기 것인지."""

    __slots__ = ("var", "lagged")

    def __init__(self, var: str, lagged: bool):
        self.var, self.lagged = var, lagged

    def key(self):
        return (self.var, self.lagged)


class Linearizer:
    """식을 «참조 → (계수, 슬롯주소들)» 로 편다.

    선형이 아닌 것을 만나면 조용히 넘기지 않고 `unsupported` 에 적는다.
    """

    def __init__(self, system, locals_ast: dict, consts: dict = None):
        self.sys = system
        #: 참조를 품은 지역이름만 여기 남긴다. 상수 지역이름은 `consts` 로 간다.
        self.locals = locals_ast
        self.consts = dict(consts or {})
        self.unsupported: list[str] = []

    # ---- 순수 계수식인가 (참조가 하나도 없나)
    def _is_const(self, node) -> bool:
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and n.id in self.consts:
                continue
            if isinstance(n, ast.Name) and n.id in self.locals:
                return False
            if isinstance(n, ast.Name) and n.id in ("u", "new", "uspath",
                                                    "fpaths", "oil", "x_t",
                                                    "x_tm1"):
                return False
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) \
                    and n.func.id == "lag":
                return False
        return True

    def _eval(self, node):
        return eval(_src(node), {"np": np, "self": self.sys,   # noqa: S307
                                 "float": float, "abs": abs, "max": max,
                                 "min": min, **self.consts})

    def _slot(self, node) -> str | None:
        """계수식이 부록 D 슬롯이면 그 주소. `.value` 를 떼고 다시 재 본다."""
        s = _src(node)
        for cand in (s, s[: -len(".value")] if s.endswith(".value") else None):
            if not cand:
                continue
            try:
                obj = eval(cand, {"np": np, "self": self.sys,   # noqa: S307
                                  **self.consts})
            except Exception:                                   # noqa: BLE001
                continue
            src = getattr(obj, "source", None)
            if isinstance(src, str) and src.startswith("appendix_d: "):
                return src[len("appendix_d: "):]
        # __init__ 에서 g("path", i) 로 받아 둔 것
        return SLOT_ALIASES.get(s)

    # ---- 본체
    def lin(self, node) -> dict:
        """{ (var, lagged) : {"coef": float, "slots": [..]} }"""
        if self._is_const(node):
            return {}

        if isinstance(node, ast.BinOp):
            if isinstance(node.op, (ast.Add, ast.Sub)):
                out = self.lin(node.left)
                right = self.lin(node.right)
                sgn = -1.0 if isinstance(node.op, ast.Sub) else 1.0
                return _merge(out, right, sgn)
            if isinstance(node.op, ast.Mult):
                lc, rc = self._is_const(node.left), self._is_const(node.right)
                if lc or rc:
                    cnode = node.left if lc else node.right
                    vnode = node.right if lc else node.left
                    try:
                        k = float(self._eval(cnode))
                    except Exception:                          # noqa: BLE001
                        self.unsupported.append(_src(node))
                        return {}
                    return _scale(self.lin(vnode), k, self._slot(cnode))
                self.unsupported.append(f"비선형 곱: {_src(node)}")
                return {}
            if isinstance(node.op, ast.Div) and self._is_const(node.right):
                try:
                    k = 1.0 / float(self._eval(node.right))
                except Exception:                              # noqa: BLE001
                    self.unsupported.append(_src(node))
                    return {}
                return _scale(self.lin(node.left), k, None)
            if isinstance(node.op, ast.MatMult):
                return self._matmul(node)
            self.unsupported.append(f"연산자: {_src(node)}")
            return {}

        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return _scale(self.lin(node.operand), -1.0, None)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
            return self.lin(node.operand)

        if isinstance(node, ast.Name):
            if node.id in self.locals:
                return self.lin(self.locals[node.id])
            self.unsupported.append(f"이름: {node.id}")
            return {}

        if isinstance(node, ast.Subscript):
            return self._subscript(node)

        if isinstance(node, ast.Call):
            return self._call(node)

        if isinstance(node, ast.IfExp):
            # `oil[t-1] if t > 0 else 0.0` — 배선은 참 가지에 있다.
            # 다만 `pin["i_kr"][t] if pinned_now else rule_rhs` 는 반대다:
            # 핀은 **밖에서 꽂는 값**이라 배선이 아니고, 준칙이 배선이다.
            if "pin[" in _src(node.body):
                return self.lin(node.orelse)
            return self.lin(node.body)

        self.unsupported.append(f"노드: {type(node).__name__} {_src(node)}")
        return {}

    def _subscript(self, node) -> dict:
        base = node.value
        if isinstance(base, ast.Name) and base.id in ("u", "new"):
            var = ast.literal_eval(node.slice)
            return {_ref(var, False): _term()}
        if isinstance(base, ast.Name) and base.id == "uspath":
            key = ast.literal_eval(node.slice)
            v = f"us_{key}" if key != "us10y" else "us10y"
            return {_ref(v, False): _term()}
        if isinstance(base, ast.Name) and base.id == "fpaths":
            key = ast.literal_eval(node.slice)
            return {_ref(f"f_{key}", False): _term()}
        if isinstance(base, ast.Name) and base.id == "oil":
            return {_ref("oil", False): _term()}
        if isinstance(base, ast.Subscript):     # uspath["y"][t]
            return self.lin(base)
        self.unsupported.append(f"첨자: {_src(node)}")
        return {}

    #: 상태벡터를 지나오는 통로에 이름을 붙인다. 「기대」 를 지나온 엣지는
    #: 화면에서 그렇게 보여야 한다 — PAC 기대항이 소비에만 배선돼 있다는 것이
    #: 이 구현이 논문과 갈리는 가장 큰 자리이기 때문이다.
    VIA = {"self.wF": "PAC 기대항 (부록 A.11~A.16)",
           "self.w_pi_lead": "기대 근원물가 (위성 VAR)",
           "self.w40": "기대가설 40분기 평균"}

    def _matmul(self, node) -> dict:
        """`self.w40 @ x_t` — 왼쪽은 수치벡터, 오른쪽은 np.array([...])."""
        try:
            w = np.asarray(self._eval(node.left), dtype=float)
        except Exception:                                      # noqa: BLE001
            self.unsupported.append(f"행렬곱 왼쪽: {_src(node)}")
            return {}
        vec = node.right
        if isinstance(vec, ast.Name) and vec.id in self.locals:
            vec = self.locals[vec.id]
        if not (isinstance(vec, ast.Call) and _src(vec.func) == "np.array"):
            self.unsupported.append(f"행렬곱 오른쪽: {_src(node)}")
            return {}
        elems = vec.args[0].elts
        if len(elems) != len(w):
            self.unsupported.append(f"행렬곱 길이: {_src(node)}")
            return {}
        via = self.VIA.get(_src(node.left))
        out: dict = {}
        for k, e in zip(w, elems):
            out = _merge(out, _scale(self.lin(e), float(k), None, via), 1.0)
        return out

    def _call(self, node) -> dict:
        fname = _src(node.func)
        if fname == "lag":
            var = ast.literal_eval(node.args[0])
            return {_ref(var, True): _term()}
        if fname in ("float", "np.asarray"):
            return self.lin(node.args[0])
        if fname == "self._demand_x":
            # ζ^X 가중 해외 산출갭. 가중치는 `self.weights["export"]`.
            zx = self.sys.weights["export"]
            names = {"us": ("us_y", False), "cn": ("f_china", False),
                     "jp": ("f_japan", False), "eu": ("f_eu", False),
                     "ea": ("f_ea", False), "rw": ("f_rw", False)}
            return {_ref(names[k][0], False): {
                        "coef": float(zx[k]), "vias": [],
                        "slots": ["export.demand_weights.slots"]}
                    for k in names if abs(zx[k]) > 0}
        if fname.startswith("self.") or fname == "eq":
            return self._numeric_call(node)
        self.unsupported.append(f"호출: {fname}")
        return {}

    def _numeric_call(self, node) -> dict:
        """몸통이 korea.py 에 있는 선형함수를 **수치미분**한다."""
        fn_src = _src(node.func)
        try:
            fn = eval(fn_src, {"self": self.sys, **self.extra_ns})  # noqa: S307
        except Exception as exc:                               # noqa: BLE001
            self.unsupported.append(f"호출 해석 실패 {fn_src}: {exc}")
            return {}
        kw = {k.arg: k.value for k in node.keywords}
        if node.args or not kw:
            self.unsupported.append(f"키워드 아닌 인자: {_src(node)}")
            return {}
        zeros = {k: 0.0 for k in kw}
        try:
            base = float(fn(**zeros))
        except Exception as exc:                               # noqa: BLE001
            self.unsupported.append(f"수치미분 실패 {fn_src}: {exc}")
            return {}
        out: dict = {}
        for name, argnode in kw.items():
            probe = dict(zeros)
            probe[name] = 1.0
            slope = float(fn(**probe)) - base
            if abs(slope) < 1e-14:
                continue
            out = _merge(out, _scale(self.lin(argnode), slope,
                                     _fn_slot(fn_src, name)), 1.0)
        return out

    extra_ns: dict = {}


def _ref(var: str, lagged: bool) -> tuple:
    return (var, lagged, (), ())


def _term() -> dict:
    return {"coef": 1.0, "slots": [], "vias": []}


def _merge(a: dict, b: dict, sgn: float) -> dict:
    """항을 합친다. **키에 슬롯 출처가 들어 있다.**

    안 그러면 같은 참조가 목표항(장기)과 성장항(단기) 양쪽에 나올 때 둘이 한
    덩어리로 더해지고, 합의 부호가 어느 쪽도 아닌 값이 된다. 수입 수요가
    정확히 그랬다 — `c → m` 장기가 실제로는 +0.043 인데 −로 나왔다.
    """
    out = {k: {"coef": v["coef"], "slots": list(v["slots"]),
               "vias": list(v["vias"])} for k, v in a.items()}
    for k, v in b.items():
        if k in out:
            out[k]["coef"] += sgn * v["coef"]
        else:
            out[k] = {"coef": sgn * v["coef"], "slots": list(v["slots"]),
                      "vias": list(v["vias"])}
    return out


def _scale(d: dict, k: float, slot: str | None, via: str = None) -> dict:
    out = {}
    for key, v in d.items():
        slots = sorted(set(v["slots"]) | ({slot} if slot else set()))
        vias = sorted(set(v["vias"]) | ({via} if via else set()))
        out[(key[0], key[1], tuple(slots), tuple(vias))] = {
            "coef": v["coef"] * k, "slots": slots, "vias": vias}
    return out


#: `self.<이름>` 로 받아 둔 부록 D 슬롯. `__init__` 의 `g("path", i)` 를 읽어
#: 채운다(아래 `_scan_init`).
SLOT_ALIASES: dict[str, str] = {}

#: 수치미분한 함수의 인자 → 슬롯 주소. 함수가 계수를 안에 들고 있어서 밖에서는
#: 안 보이므로, **korea.py 가 그 인자에 물리는 계수의 주소**를 여기에 적는다.
#: 값이 아니라 주소만 적는 것이라 계수를 베끼는 것이 아니다.
_FN_SLOTS = {
    ("self.pp.attractor_dev", "pi_inf_lag"): "eq24.delta1",
    ("self.pp.attractor_dev", "pi_lag"): "eq24.delta2",
    ("self.pp.core_inflation", "pi_lag"): "core_cpi.slots[0]",
    ("self.pp.core_inflation", "pi_inf"): "core_cpi.slots[attractor]",
    ("self.pp.core_inflation", "pi_lead"): "core_cpi.slots[1]",
    ("self.pp.core_inflation", "gap"): "core_cpi.slots[2]",
    ("self.gov.growth_dev", "g_lag"): "government.growth.slots[0]",
    ("self.gov.growth_dev", "gap"): "government.growth.slots[2]",
    ("self.gov.growth_dev", "g_star_lag"): "government.target.slots",
    ("self.con.user_cost_dev", "i_firm"): "construction.usercost",
    ("self.con.user_cost_dev", "i_cb"): "construction.usercost",
    ("self.con.user_cost_dev", "cpi_yoy"): "construction.usercost",
    ("self.con.target_dev", "uc_dev"): "construction.target.slots[2]",
    ("self.con.target_dev", "gb_dev"): "construction.target.slots[1]",
    ("eq.spread_dev", "eta_lag"): "loan_rates.shared.named",
    ("eq.spread_dev", "cb_dev"): "loan_rates.*.slots",
    ("eq.rate_dev", "call"): "loan_rates.*.slots",
    ("eq.rate_dev", "long_rate"): "loan_rates.*.slots",
    ("eq.rate_dev", "eta"): "loan_rates.*.slots",
}


def _fn_slot(fn_src: str, arg: str) -> str | None:
    return _FN_SLOTS.get((fn_src, arg))


def _scan_init(tree) -> None:
    """`self.bX = g("export.target.slots", 1)` 같은 별칭을 모은다."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        tgt = node.targets[0]
        if not (isinstance(tgt, ast.Attribute)
                and isinstance(tgt.value, ast.Name) and tgt.value.id == "self"):
            continue
        val = node.value
        if isinstance(val, ast.Call) and isinstance(val.func, ast.Name) \
                and val.func.id == "g" and len(val.args) == 2:
            path = ast.literal_eval(val.args[0])
            idx = ast.literal_eval(val.args[1])
            SLOT_ALIASES[f"self.{tgt.attr}"] = f"{path}[{idx}]"


# ── 루프 본문 읽기 ───────────────────────────────────────────────────────────
def _solve_body(tree):
    """`solve` 의 기간 루프와 그 안의 수렴 루프를 돌려준다."""
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "solve":
            for st in ast.walk(node):
                if isinstance(st, ast.For) and _src(st.target) == "t":
                    inner = [s for s in ast.walk(st)
                             if isinstance(s, ast.While)]
                    return st, inner[0]
    raise RuntimeError("solve 의 기간 루프를 못 찾았어요")


def _collect(for_node, while_node) -> tuple[dict, list]:
    """지역이름 → AST, 그리고 `new[...] = ...` 대입문들."""
    locs: dict = {}
    assigns: list = []

    def take(stmts, in_loop: bool):
        for st in stmts:
            if isinstance(st, ast.For):
                # `for key, ekey, eq, rname in [(...), (...)]:` 펼치기
                if isinstance(st.iter, ast.List):
                    names = [e.id for e in st.target.elts]
                    for tup in st.iter.elts:
                        binding = dict(zip(names, tup.elts))
                        take_unrolled(st.body, binding)
                continue
            if isinstance(st, ast.While):
                continue
            if not isinstance(st, ast.Assign) or len(st.targets) != 1:
                continue
            tgt = st.targets[0]
            if isinstance(tgt, ast.Subscript) and isinstance(tgt.value, ast.Name) \
                    and tgt.value.id == "new":
                assigns.append((ast.literal_eval(tgt.slice), st.value, {}))
            elif isinstance(tgt, ast.Name):
                locs[tgt.id] = st.value
        # `new[k] += res[...]` 같은 증강대입
        for st in stmts:
            if isinstance(st, ast.AugAssign) and isinstance(st.target,
                                                            ast.Subscript):
                pass    # 잔차항은 배선이 아니다 — 외생 입력이다

    def take_unrolled(stmts, binding):
        for st in stmts:
            if not isinstance(st, ast.Assign) or len(st.targets) != 1:
                continue
            tgt = st.targets[0]
            if isinstance(tgt, ast.Subscript) and isinstance(tgt.value, ast.Name) \
                    and tgt.value.id == "new":
                key = tgt.slice
                if isinstance(key, ast.Name) and key.id in binding:
                    var = ast.literal_eval(binding[key.id])
                else:
                    var = ast.literal_eval(key)
                assigns.append((var, st.value, binding))

    take(for_node.body, False)
    take(while_node.body, True)
    return locs, assigns


REF_NAMES = ("u", "new", "uspath", "fpaths", "oil", "lag", "pin")


def _split_consts(locs: dict, system, outer: dict) -> tuple[dict, dict]:
    """지역이름을 «참조를 품은 것» 과 «상수» 로 가른다.

    `cq = 4.0 if self.opt[...] else 1.0` 이나 `zm = self.weights["import"]`
    는 배선이 아니라 계수다. 상수로 안 갈라 놓으면 `x / cq` 가 통째로
    «해석 못 함» 이 되고, 그러면 소비·부채 엣지가 조용히 사라진다."""
    consts = dict(outer)
    refy = {}
    for name, node in locs.items():
        names = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
        if names & set(REF_NAMES) or names & set(refy):
            refy[name] = node
            continue
        try:
            consts[name] = eval(_src(node),                     # noqa: S307
                                {"np": np, "self": system, **consts})
        except Exception:                                      # noqa: BLE001
            refy[name] = node
    return refy, consts


class _BindingLinearizer(Linearizer):
    """펼친 루프의 이름 묶음을 아는 선형화기."""

    def __init__(self, system, locals_ast, binding, consts=None):
        super().__init__(system, locals_ast, consts)
        self.binding = binding
        self.extra_ns = {}
        for name, node in binding.items():
            try:
                self.extra_ns[name] = eval(          # noqa: S307
                    _src(node), {"self": system})
            except Exception:                        # noqa: BLE001
                pass

    def _subscript(self, node):
        base = node.value
        if isinstance(base, ast.Name) and base.id in ("u", "new") \
                and isinstance(node.slice, ast.Name) \
                and node.slice.id in self.binding:
            var = ast.literal_eval(self.binding[node.slice.id])
            return {_ref(var, False): _term()}
        return super()._subscript(node)

    def _call(self, node):
        if isinstance(node.func, ast.Attribute) \
                and isinstance(node.func.value, ast.Name) \
                and node.func.value.id in self.binding:
            return self._numeric_call(node)
        return super()._call(node)

    def lin(self, node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "lag" and isinstance(node.args[0], ast.Name) \
                and node.args[0].id in self.binding:
            var = ast.literal_eval(self.binding[node.args[0].id])
            return {_ref(var, True): _term()}
        return super().lin(node)


# ── 엣지 조립 ────────────────────────────────────────────────────────────────
def build() -> dict:
    from bigfoot.solve.phase3 import (BETA_SYNC_ADOPTED, FINAL_EQ24,
                                      FINAL_OPTIONS)
    from bigfoot.solve.system import BigfootSystem

    tree = ast.parse(SYSTEM_PY.read_text(encoding="utf-8"))
    _scan_init(tree)
    system = BigfootSystem(beta_sync=BETA_SYNC_ADOPTED, eq24_form=FINAL_EQ24,
                           T=24, options=FINAL_OPTIONS)
    for_node, while_node = _solve_body(tree)
    locs, assigns = _collect(for_node, while_node)
    outer = {"zm": system.weights["import"], "zx": system.weights["export"],
             "sh": system.shares, "T": 24}
    locs, consts = _split_consts(locs, system, outer)

    edges, unsupported, seen = [], [], set()
    for var, expr, binding in assigns:
        lz = _BindingLinearizer(system, locs, binding, consts)
        terms = lz.lin(expr)
        unsupported.extend(f"{var}: {u}" for u in lz.unsupported)
        cand: dict = {}
        for key, info in terms.items():
            src, lagged = key[0], key[1]
            coef = info["coef"]
            if abs(coef) < 1e-12 or src == var:
                continue
            slots = [x for x in info["slots"] if x]
            horizon = "LR" if any(".target." in x for x in slots) else "SR"
            # 장기 엣지의 **대표 계수는 목표식의 것**이다. 오차수정 적재
            # (`.growth.slots[0]`)도 같은 항에 곱해져 있지만, 그 항이 말하는
            # 장기 관계를 진 것은 목표식 계수다.
            slots.sort(key=lambda x: (0 if ".target." in x else 1, x))
            cand.setdefault((src, horizon), []).append(
                {"coef": coef, "slots": slots, "vias": info["vias"],
                 "lagged": lagged})

        for (src, horizon), rows in cand.items():
            # 대표항 = 지평에 맞는 슬롯을 진 것 → 그중 **지금 분기** 것 →
            # 그중 큰 것. 같은 참조가 성장항에 «지금» 과 «전분기» 로 두 번
            # 나올 때 부호가 흔들리지 않게 하는 자리다.
            def rank(r, _h=horizon):
                fit = 0 if any((".target." in x) == (_h == "LR")
                               for x in r["slots"]) else 1
                return (fit, 0 if not r["lagged"] else 1, -abs(r["coef"]))

            best = sorted(rows, key=rank)[0]
            key = (src, var, horizon)
            if key in seen:
                continue
            seen.add(key)
            slot = best["slots"][0] if best["slots"] else None
            eq = _slot_equation(slot) or _equation_for(var, horizon)
            edges.append({
                "from": src,
                "to": var,
                "block": BLOCK_OF.get(var, "expenditure"),
                "horizon": horizon,
                "sign": "+" if best["coef"] > 0 else "-",
                "coefficient_slot": slot,
                "equation": eq,
                "paper_page": EQUATION_PAGE.get(eq),
                "via": best["vias"][0] if best["vias"] else None,
                "lagged": best["lagged"],
            })

    merges = _find_flow_merges(for_node, while_node)
    edges = _apply_merges(edges, merges)
    edges = edges + _external_edges(system)

    used = sorted({e["from"] for e in edges} | {e["to"] for e in edges})
    nodes = [{"id": v, "label": LABEL.get(v, v),
              "block": BLOCK_OF.get(v, "expenditure")} for v in used]
    missing = [v for v in used if v not in LABEL]

    uncovered = [{"var": v, "why": w}
                 for v, w in _uncovered(edges, system, merges)]
    return {
        "module": "wiring_graph",
        "generated_from": "backend/bigfoot/solve/system.py (AST + 수치미분) "
                          "+ backend/config/appendix_d_resolved.yaml",
        "uncovered": uncovered,
        "unsupported_expressions": sorted(set(unsupported)),
        "missing_labels": missing,
        "nodes": nodes,
        "edges": sorted(edges, key=lambda e: (e["to"], e["horizon"],
                                              e["from"])),
        "flow_merges": [{"folded": k, "into": v} for k, v in
                        sorted(merges.items())],
        "eq_no_corrections": EQUATION_CORRECTION_ROWS,
        "non_paper_equations": NON_PAPER_EQ,
    }


EQUATION_CORRECTION_ROWS = [
    {"where": k, **v} for k, v in EQ_NO_CORRECTIONS.items()
]


def _find_flow_merges(for_node, while_node) -> dict:
    """`new[X] = lag(X, t) + new[dX]` 를 찾아 dX 를 X 로 접는다.

    이 대입문은 배선이 아니라 **회계**다 — 수준과 그 증분은 같은 변수다.
    안 접으면 노드가 배로 늘고, 무엇보다 논문의 서명 같은 쌍이 안 보인다:
    가계부채→소비는 장기 음(eq 7)·단기 양(eq 8)인데, 코드에서 단기 쪽은
    `ddebt → dc` 로 흐르므로 접기 전에는 `debt → c` 화살표가 **하나도 안 선다**.
    접는 규칙을 코드에서 뽑는 이유가 그것이다 — 손으로 정하면 어느 쌍을
    접었는지 화면이 말할 수 없다.
    """
    merges = {}
    for st in list(for_node.body) + list(while_node.body):
        if not (isinstance(st, ast.Assign) and len(st.targets) == 1):
            continue
        tgt = st.targets[0]
        if not (isinstance(tgt, ast.Subscript)
                and isinstance(tgt.value, ast.Name) and tgt.value.id == "new"):
            continue
        lhs = ast.literal_eval(tgt.slice)
        v = st.value
        if not (isinstance(v, ast.BinOp) and isinstance(v.op, ast.Add)):
            continue
        left, right = v.left, v.right
        ok_left = (isinstance(left, ast.Call)
                   and isinstance(left.func, ast.Name)
                   and left.func.id == "lag"
                   and ast.literal_eval(left.args[0]) == lhs
                   and len(left.args) == 2)
        ok_right = (isinstance(right, ast.Subscript)
                    and isinstance(right.value, ast.Name)
                    and right.value.id == "new")
        if ok_left and ok_right:
            merges[ast.literal_eval(right.slice)] = lhs
    return merges


def _apply_merges(edges: list, merges: dict) -> list:
    out, seen = [], set()
    for e in edges:
        src = merges.get(e["from"], e["from"])
        dst = merges.get(e["to"], e["to"])
        if src == dst:
            continue
        key = (src, dst, e["horizon"])
        if key in seen:
            continue
        seen.add(key)
        # 접고 나면 도착 변수가 바뀌므로 방정식을 **다시 매긴다**. 안 하면
        # `debt → c` 장기 엣지가 증가율식(eq 8)을 달고 서게 되는데, 그 엣지가
        # 말하는 것은 목표식(eq 7)이다.
        eq = (_slot_equation(e["coefficient_slot"])
              or _equation_for(dst, e["horizon"]))
        out.append({**e, "from": src, "to": dst, "equation": eq,
                    "paper_page": EQUATION_PAGE.get(eq)})
    return out


#: 부록 D 슬롯 그룹 → 그 계수가 실린 인쇄식. 계수가 어느 식의 것인지는
#: **그 계수가 사는 그룹**이 말한다. 도착 변수로만 번호를 매기면 다른 식의
#: 목표 계수를 타고 온 항이 남의 번호를 달게 된다 — 유가→소비자물가가 그랬다
#: (계수는 eq 31 수입물가 목표식 것인데 eq 25 로 찍혔다).
SLOT_EQ = {
    "consumption.target": "7", "consumption.growth": "8",
    "investment_fi.target": "9", "investment_fi.growth": "11",
    "construction.target": "12", "construction.usercost": "13",
    "construction.growth": "14",
    "government.target": "15", "government.growth": "16",
    "export.target": "17", "export.demand_weights": "18",
    "export.growth": "19",
    "import_.target": "20", "import_.demand_weights": "21",
    "import_.growth": "22",
    "core_cpi": "23", "eq24": "24",
    "cpi.target": "25", "cpi.growth": "26",
    "housing.target": "27", "housing.growth": "28",
    "export_price.target": "29", "export_price.growth": "30",
    "import_price.target": "31", "import_price.growth": "32",
    "fx": "33", "policy_rule": "35", "corp_bond": "38",
    "loan_rates": "40", "debt_gdp": "44",
    "calibration.r_star": "35",
}


def _slot_equation(slot: str | None) -> str | None:
    if not slot:
        return None
    for prefix, eq in sorted(SLOT_EQ.items(), key=lambda kv: -len(kv[0])):
        if slot.startswith(prefix):
            return eq
    return None


def _external_edges(system) -> list:
    """해외 블록 안쪽 배선 — `_foreign_paths` 와 `_us10y` 에서 읽는다.

    한국 블록의 수렴 루프 밖에 있어서 AST 통로가 안 닿는다. 그런데 논문의
    Figure 2(무역 스필오버)와 Figure 3(미 금융경로)이 정확히 이 자리라 화면이
    그 셋을 같은 그림 위에서 비추려면 있어야 한다. 그래서 **계수를 재서**
    붙인다(부호는 실제 계수의 부호다, 옮겨 적은 것이 아니다).

    eq (5) — 유가는 해외 블록마다 산출갭에 **음으로** 들어간다. 그래서 유가
    충격이 세계 수요충격처럼 움직인다.
    eq (6) — 스필오버는 미국 갭이다(WIRING_SPILLOVER).
    """
    out = []
    for name, blk in system.fblocks.items():
        node = f"f_{name}"
        base = float(blk.output_gap(gap_lag=0.0, foreign_gap=0.0,
                                    oil_gap_lag=0.0))
        spill = float(blk.output_gap(gap_lag=0.0, foreign_gap=1.0,
                                     oil_gap_lag=0.0)) - base
        # 유가 부호는 `WIRING_OIL_SIGN` 레버를 지나 들어간다 — 화면이 계수의
        # 부호가 아니라 **배선된 부호**를 보여야 한다.
        oil_in = (float(blk.output_gap(gap_lag=0.0, foreign_gap=0.0,
                                       oil_gap_lag=1.0)) - base) \
            * float(system.opt["oil_sign"])
        slot = f"foreign.{name}.slots"
        if abs(spill) > 1e-12:
            out.append({"from": "us_y", "to": node, "block": "external",
                        "horizon": "SR", "sign": "+" if spill > 0 else "-",
                        "coefficient_slot": f"{slot}[3]", "equation": "6",
                        "paper_page": EQUATION_PAGE.get("6"),
                        "via": "WIRING_SPILLOVER", "lagged": False})
        if abs(oil_in) > 1e-12:
            out.append({"from": "oil", "to": node, "block": "external",
                        "horizon": "SR", "sign": "+" if oil_in > 0 else "-",
                        "coefficient_slot": f"{slot}[4]", "equation": "5",
                        "paper_page": EQUATION_PAGE.get("5"),
                        "via": "WIRING_OIL_SIGN", "lagged": True})
    # 미국 10년 = 기대가설 + FIR 기간프리미엄 커널 (Phase 4.7)
    out.append({"from": "us_i", "to": "us10y", "block": "external",
                "horizon": "SR", "sign": "+", "coefficient_slot": None,
                "equation": "36", "paper_page": EQUATION_PAGE.get("36"),
                "via": "기대가설 40분기 평균 + tp_us FIR 커널 (K=12)",
                "lagged": False})
    return out


def _equation_for(var: str, horizon: str) -> str:
    lr, sr = EQ_OF.get(var, (None, None))
    eq = lr if horizon == "LR" else sr
    if eq is None:
        eq = sr or lr
    return eq or "미상"


def _uncovered(edges, system, merges: dict) -> list:
    """엣지가 안 붙은 자리. **비어 있는 척하지 않는다.**"""
    from bigfoot.solve.system import KOREA_VARS
    have = {e["to"] for e in edges} | set(merges)
    out = []
    for v in KOREA_VARS:
        if v not in have:
            out.append((v, "생성기가 이 변수의 대입문에서 참조를 못 폈어요."))
    out.append(("us_y·us_pi·us_i", "미국 블록은 완전예견 **적층 선형해**라 "
                                   "기간별 대입문이 없어요. 그 안쪽 배선(IS·"
                                   "필립스·준칙)은 이 그래프에 안 서고, "
                                   "미국이 한국으로 나오는 통로만 서요."))
    out.append(("x·m 의 세계 수출물가", "eq (29)(30) 의 세계 수출물가가 "
                                        "외생이라 환율이 그 자리에 서 있어요"
                                        "(WIRING_PX_EXOG). 화살표는 `s → pm` "
                                        "으로 보여요."))
    return out


def main() -> None:
    g = build()
    OUT.write_text(json.dumps(g, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    print(f"nodes {len(g['nodes'])} edges {len(g['edges'])} "
          f"uncovered {len(g['uncovered'])} "
          f"unsupported {len(g['unsupported_expressions'])}")
    for u in g["unsupported_expressions"]:
        print("  ?", u)
    for u in g["uncovered"]:
        print("  -", u["var"])


if __name__ == "__main__":
    main()
