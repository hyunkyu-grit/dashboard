# -*- coding: utf-8 -*-
"""Session-finish hook: stamp output/engine_status.json (Phase 6a.1).

The hub's 엔진 상태 card reads this contract; the hub itself never runs
tests or git (read-only rule). The stamp is written only after a green
engine-suite run (>= 5 distinct test files, zero failures) so a scoped
`pytest tests/engine/test_x.py` can never publish a misleading count.

## 왜 «덮어쓰기» 가 아니라 «병합» 인가 [OWNER 2026-09-03]

이 도장은 원래 **자기 스키마의 판을 통째로 써서** 정본을 지웠다. 정본은
`rebake/status.py::build_status` 가 만드는 133줄(기저·데이터 끝·신선도·
스코어카드 13밴드·이음매)인데, 도장이 13줄짜리 다른 모양으로 갈아치웠다.

그러면 **한 파일에 스키마가 다른 writer 가 둘**이 되고, 그 다음 런에서
이렇게 무너진다:

  1. 전체 그린 런 → 도장이 정본을 스텁으로 덮는다.
  2. 다음 런에서 `tests/test_rebake.py` 가 `KeyError: 'misses'`·`'staleness'`
     로 죽고, 프런트 사본 동일성 가드(`guards/model-contracts.test.ts`)도
     같이 깨진다.
  3. **빨간 런은 도장을 안 찍으므로** 스스로는 못 빠져나온다.

그래서 정본을 **읽어서 한 칸만 얹고** 다시 쓴다. 정본이 없거나 못 읽으면
**아무것도 안 쓴다** — 지어낸 판을 남기느니 없는 편이 낫다.

## 왜 «새 칸» 이 아니라 `tests` 인가

처음에는 `tests_passed`·`tests_total`·`current_tag` 셋을 새로 얹었는데
`guards/model-payload-rendered.test.ts` 가 잡았다: **페이로드에 실려 오는데
아무 면도 안 쓰는 칸**이었다. 화면이 세우는 것은 「지고 있는 시험 · N개」
하나뿐이고(`src/lab/model/method/MethodSurface.tsx:268` → `tests.collected`),
셋 중 어느 것도 거기 안 들어간다. 결정이 안 붙은 칸은 싣지 않는다.

그래서 **렌더되는 칸에 쓴다.** 리베이크는 그 수를 `--collect-only` 로 세는데
(`rebake/status.py::_tests_passed`), 여기서는 **실제로 돌려서** 센다. 같은
자리에 더 강한 근거를 넣는 것이고, 모양(`{collected, source}`)은 그대로다.

## 세는 범위

`tests/engine` **밑의 것만** 센다. 이 훅은 세션 훅이라 전체 스위트를 돌려도
불리는데, 그때 세션 전체 수(1,214)를 넣으면 카드가 「엔진이 지고 있는 시험」
자리에 스위트 전체를 세우게 된다. 잣대가 다른 수를 같은 칸에 넣지 않는다.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"
#: 프런트가 번들하는 사본. `rebake/__main__.py::FRONTEND` 와 같은 자리다.
FRONTEND = ROOT.parent / "src" / "lab" / "model" / "artifacts"
MIN_FILES_FOR_STAMP = 5
#: nodeid 는 rootdir 상대라 `backend/` 에서 돌리면 `tests/engine/...`,
#: 리포 뿌리에서 돌리면 `backend/tests/engine/...` 이다. 부분일치로 본다.
ENGINE_PREFIX = "tests/engine/"


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    stats = terminalreporter.stats
    if stats.get("failed") or stats.get("error"):
        return                      # red run: never stamp

    seen: set[str] = set()
    for outcome in ("passed", "skipped", "xfailed", "xpassed"):
        for report in stats.get(outcome, []):
            nodeid = getattr(report, "nodeid", "")
            if ENGINE_PREFIX in nodeid.replace("\\", "/"):
                seen.add(nodeid)

    files = {n.split("::")[0] for n in seen}
    if len(files) < MIN_FILES_FOR_STAMP:
        return                      # partial run: never stamp

    target = OUT / "engine_status.json"
    try:
        status = json.loads(target.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        terminalreporter.write_line(
            f"[engine_status] 정본을 못 읽어서 시험 수를 안 찍었어요 "
            f"({type(e).__name__}) — `python -m rebake` 로 다시 구우세요.")
        return

    status["tests"] = {"collected": len(seen), "source": "pytest (돌려서 셌어요)"}
    blob = json.dumps(status, ensure_ascii=False, indent=2) + "\n"
    target.write_text(blob, encoding="utf-8")
    if FRONTEND.is_dir():
        shutil.copy(target, FRONTEND / "engine_status.json")
