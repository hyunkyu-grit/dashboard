# -*- coding: utf-8 -*-
"""Session-finish hook: stamp output/engine_status.json (Phase 6a.1).

The hub's 엔진 상태 card reads this contract; the hub itself never runs
tests or git (read-only rule). The stamp is written only after a
FULL-suite green run (>= 5 distinct test files collected, zero failures)
so a scoped `pytest tests/test_x.py` can never publish a misleading
count.

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

그래서 여기서는 정본을 **읽어서 시험 수 칸만 얹고** 다시 쓴다. 정본이
없거나 못 읽으면 **아무것도 안 쓴다** — 지어낸 판을 남기느니 없는 편이 낫다.

프런트 사본(`src/lab/model/artifacts/`)도 같이 옮긴다. 사본이 갈리면
`guards/model-contracts.test.ts` 가 바이트 동일성으로 잡는다.

⚠ `passed`/`total` 은 **이 세션이 돈 범위 전체**의 수다(`pytest tests/engine`
이면 그 범위, 전체 스위트면 전체). 정본의 `tests.collected` 와는 다른 잣대라
그 칸은 안 건드리고 따로 싣는다. 다음 `python -m rebake` 는 정본을 새로
만들므로 여기서 얹은 칸이 사라지고, 다음 그린 런이 다시 얹는다.
"""
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"
#: 프런트가 번들하는 사본. `rebake/__main__.py::FRONTEND` 와 같은 자리다.
FRONTEND = ROOT.parent / "src" / "lab" / "model" / "artifacts"
MIN_FILES_FOR_STAMP = 5


def _git_describe() -> str:
    try:
        return subprocess.check_output(
            ["git", "describe", "--tags", "--always"], cwd=ROOT,
            stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    stats = terminalreporter.stats
    passed = len(stats.get("passed", []))
    failed = len(stats.get("failed", [])) + len(stats.get("error", []))
    skipped = len(stats.get("skipped", []))
    total = passed + failed + skipped
    files = {r.nodeid.split("::")[0] for r in stats.get("passed", [])}
    if failed or len(files) < MIN_FILES_FOR_STAMP:
        return                      # partial or red run: never stamp

    target = OUT / "engine_status.json"
    try:
        status = json.loads(target.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        terminalreporter.write_line(
            f"[engine_status] 정본을 못 읽어서 시험 수를 안 찍었어요 "
            f"({type(e).__name__}) — `python -m rebake` 로 다시 구우세요.")
        return

    status["tests_passed"] = passed
    status["tests_total"] = total
    status["current_tag"] = _git_describe()

    blob = json.dumps(status, ensure_ascii=False, indent=2) + "\n"
    target.write_text(blob, encoding="utf-8")
    if FRONTEND.is_dir():
        shutil.copy(target, FRONTEND / "engine_status.json")
