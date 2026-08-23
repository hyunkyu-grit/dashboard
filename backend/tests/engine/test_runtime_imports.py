# -*- coding: utf-8 -*-
"""굽는 경로가 그래프 라이브러리를 끌고 오면 안 된다.

2026-08-21 (P4) §C.7(b) 의 결함이다. `scenario_basis/build.py` 가 최종 옵션
상수를 `solve/phase3.py` 에서 읽었는데 그 모듈이 **차트를 그리는 모듈**이라
모듈 스코프에서 plotly 를 import 했다. 그래서 「기저를 굽는다」가 plotly 를
런타임 의존으로 만들었다.

상수는 `solve/config.py`(import 없는 순수 데이터)로 내려갔다. 그게 다시
새는 것을 여기서 막는다 — **하위 프로세스**로 재는 이유는, 같은 프로세스
안에서는 다른 테스트가 이미 plotly 를 올려 놨을 수 있어서 이 측정이 못
믿을 것이 되기 때문이다.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]

#: 굽기·배선의 진입점. 이 중 어느 것도 plotly 를 올리면 안 된다.
RUNTIME_MODULES = [
    "bigfoot.scenario_basis.build",
    "bigfoot.irs_curve.assembler",
    "bigfoot.conditional.hfl",
    "bigfoot.solve.system",
    "wiring.edges",
    "wiring.surfaces",
    "rebake.__main__",
]


@pytest.mark.parametrize("mod", RUNTIME_MODULES)
def test_the_runtime_path_does_not_import_plotly(mod):
    code = (f"import sys; __import__({mod!r}); "
            "sys.exit(1 if 'plotly' in sys.modules else 0)")
    r = subprocess.run([sys.executable, "-c", code], cwd=BACKEND,
                       capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, (
        f"{mod} 가 plotly 를 끌고 와요 — 차트 import 는 함수 안으로 넣으세요.\n"
        f"{(r.stderr or r.stdout)[-800:]}")


def test_the_constants_module_imports_nothing():
    """`solve/config.py` 의 계약은 «import 없음» 이다.

    값이 늘어나는 것은 괜찮다. import 가 한 줄이라도 생기면 그 순간 이 파일이
    다시 무언가를 끌고 오는 통로가 된다.
    """
    import ast

    src = (BACKEND / "bigfoot" / "solve" / "config.py").read_text("utf-8")
    imports = [n for n in ast.walk(ast.parse(src))
               if isinstance(n, (ast.Import, ast.ImportFrom))]
    names = [a.name for n in imports for a in n.names]
    assert names == ["annotations"], f"import 가 생겼어요: {names}"
