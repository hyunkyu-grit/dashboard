# -*- coding: utf-8 -*-
"""리베이크 — 진입점 하나.

    python -m rebake              굽는다
    python -m rebake --offline    캐시만 쓴다(네트워크 안 씀)
    python -m rebake --check      지금 구워야 하나만 답하고 안 굽는다

## 원자성 — 실패가 이전 산출물을 못 건드린다

이관 전에는 `build.py` 가 `write_text` 로 최종 경로에 **바로** 썼다
(`bigfoot/scenario_basis/build.py:232`). 중간에 죽으면 잘린 기저가 남고,
프런트는 그걸 번들해 버린다.

여기서는 엔진을 **임시 디렉터리에 굽고**, 세 산출물이 다 나온 뒤에 한꺼번에
자리로 옮긴다. 어느 단계에서 죽든 이전 산출물은 바이트 그대로 남는다.

## 세 산출물은 한 벌이다

    scenario_basis.json    기저
    assumptions.json       그 기저가 딛고 선 가정
    engine_status.json     신선도·빈티지·스코어카드

`assumptions.json` 이 «기저를 설명하는 문서» 라서, 기저와 따로 쓰이면 그 순간
서로 다른 빌드를 가리킬 수 있다. 그래서 같이 쓰고 같이 옮긴다.

## 실패는 조용하지 않다 — `engine_status.json` **하나만** 앞으로 간다

원자성은 「실패하면 아무것도 안 바뀐다」 인데, 그것만으로는 화면이 거짓말을
한다. 굽기가 멈추면 어제 판이 그대로 남고 그 판의 `staleness.state` 는
**`fresh`** 다 — 「막혔다」 가 아니라 「신선하다」 로 읽힌다(2026-08-21 P4
진단 §C.7(a)).

그래서 실패 경로가 이전 산출물을 되돌린 **뒤에**, 이전 기저의 날짜로
`engine_status.json` 만 다시 써서 `blocked` 를 세운다. 기저와 가정은 손대지
않는다 — 셋이 한 벌인 것은 **값**의 이야기이고, 신선도는 그 한 벌에 대한
바깥의 판정이다.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from rebake import cadence, layer2, status  # noqa: E402

OUT = BACKEND / "output"

#: 한 벌로 움직이는 산출물. 프런트가 읽는 것은 이 셋뿐이다.
ARTIFACTS = ("scenario_basis.json", "assumptions.json", "engine_status.json")


class RebakeError(RuntimeError):
    """굽다가 멈췄다. 이전 산출물은 손대지 않았다."""


def _run_engine(offline: bool) -> tuple[str, list[str]]:
    """엔진을 돌려 기저를 만든다. (as_of, 캐시로 때운 계열) 을 돌려준다."""
    env = dict(os.environ)
    if offline:
        env["BIGFOOT_OFFLINE"] = "1"
    r = subprocess.run([sys.executable, "-m", "bigfoot.scenario_basis.build"],
                       cwd=BACKEND, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RebakeError(f"엔진이 멈췄어요 (exit {r.returncode}):\n"
                          f"{(r.stderr or r.stdout)[-1500:]}")

    # ECOS 로더는 실패해도 캐시로 조용히 진행한다(`bigfoot/data/ecos.py:154`).
    # 그 사실이 산출물까지 올라오게, 여기서 stdout 을 읽어 건져 낸다.
    fallbacks = [ln.split("for ", 1)[-1].split(" ", 1)[0]
                 for ln in (r.stdout or "").splitlines()
                 if "[warn] fetch failed" in ln]

    basis = json.loads((OUT / "scenario_basis.json").read_text("utf-8"))
    return basis["as_of"], fallbacks


def _blocked_status(reason: str) -> bool:
    """굽기가 멈춘 뒤, **이전** 산출물 위에 `blocked` 상태만 다시 쓴다.

    이전 산출물이 아예 없으면(첫 굽기가 실패) 쓸 근거가 없다 — 그때는 아무것도
    안 하고 `False` 를 돌려준다. 지어낸 상태를 남기느니 없는 편이 낫다.

    여기서 나는 예외는 **삼킨다.** 이건 원래 실패를 화면에 알리려는 곁가지이고,
    곁가지가 본 예외를 가리면 진짜 원인이 사라진다.
    """
    try:
        basis = json.loads((OUT / "scenario_basis.json").read_text("utf-8"))
        asm = json.loads((OUT / "assumptions.json").read_text("utf-8"))
        st = status.build_status(basis["as_of"], asm, count_tests=False,
                                 blocked_reason=reason)
        (OUT / "engine_status.json").write_text(
            json.dumps(st, ensure_ascii=False, indent=2) + "\n", "utf-8")
        shutil.copy(OUT / "engine_status.json", FRONTEND / "engine_status.json")
        return True
    except Exception:                              # noqa: BLE001
        return False


def rebake(*, offline: bool = False, count_tests: bool = True) -> dict:
    with tempfile.TemporaryDirectory(prefix="rebake-", dir=str(BACKEND)) as tmp:
        staging = Path(tmp)

        # 이전 기저를 보관해 둔다 — 엔진이 최종 경로에 쓰므로, 실패 시 되돌린다.
        prev = {}
        for name in ARTIFACTS:
            p = OUT / name
            if p.exists():
                prev[name] = p.read_bytes()

        try:
            basis_as_of, fallbacks = _run_engine(offline)

            edges = status.data_edges()
            asm = layer2.build_assumptions(
                basis_as_of=basis_as_of,
                data_edge_q=edges.get("newest_quarter") or "?",
                offline=offline)
            layer2.validate(asm)                   # 출처 없으면 여기서 멈춘다

            st = status.build_status(basis_as_of, asm,
                                     cache_fallbacks=fallbacks,
                                     count_tests=count_tests)

            # D.10 — 기저가 자기가 쓴 Layer 2 보다 오래됐으면 쓰지 않는다.
            newest_l2 = max((it["as_of"] for it in asm["items"]
                             if it.get("as_of") and it["as_of"][:4].isdigit()),
                            default=None)
            if newest_l2 and newest_l2 > basis_as_of:
                raise RebakeError(
                    f"기저 as_of({basis_as_of}) 가 그 기저가 쓴 Layer 2 의 "
                    f"as_of({newest_l2}) 보다 앞서요 — 안 써요.")

            shutil.copy(OUT / "scenario_basis.json",
                        staging / "scenario_basis.json")
            (staging / "assumptions.json").write_text(
                json.dumps(asm, ensure_ascii=False, indent=2) + "\n", "utf-8")
            (staging / "engine_status.json").write_text(
                json.dumps(st, ensure_ascii=False, indent=2) + "\n", "utf-8")

            for name in ARTIFACTS:
                shutil.move(str(staging / name), str(OUT / name))
            _mirror_to_frontend()
            return st

        except Exception as e:
            for name, blob in prev.items():        # 되돌린다
                (OUT / name).write_bytes(blob)
            head = (str(e).strip().splitlines() or [""])[0][:200]
            _blocked_status("굽다가 멈춰서 이전 판을 그대로 두었어요 — "
                            "화면의 숫자는 그날 것이에요. "
                            f"({type(e).__name__}: {head})")
            raise


#: 프런트가 읽는 사본. Next 는 번들 시점에 파일을 가져가므로 백엔드 경로를
#: 런타임에 못 읽는다 — `src/lab/scenario/basis.json` 이 이미 그 이유로 사본이다.
#: 사본이 두 벌이면 갈리므로 **리베이크가 같이 옮기고** 가드가 동일성을 붙든다
#: (`guards/model-contracts.test.ts`).
FRONTEND = BACKEND.parent / "src" / "lab" / "model" / "artifacts"
MIRRORED = ARTIFACTS + ("paper_anchors.json",)

#: 기저의 **세 번째** 사본. `src/lab/scenario/combine.ts` 가 이걸 import 하고,
#: 「전략」 면의 대조축인 `guards/model-strategy-basis.test.ts` 와
#: `guards/scenario-parity.test.ts` 가 그 통로로 값을 읽는다.
#:
#: 여기 없으면 리베이크가 이 사본만 안 옮겨서 낡고, 새로 뽑은 패리티 벡터와
#: 안 맞아 가드가 빨개진다. 2026-08-21 (P4) 진단에서 찾았다.
EXTRA_MIRRORS = {
    "scenario_basis.json": BACKEND.parent / "src" / "lab" / "scenario"
                           / "basis.json",
}


def _mirror_to_frontend() -> None:
    FRONTEND.mkdir(parents=True, exist_ok=True)
    for name in MIRRORED:
        src = ((BACKEND / "config" / name)
               if name == "paper_anchors.json" else (OUT / name))
        shutil.copy(src, FRONTEND / name)
    for name, dest in EXTRA_MIRRORS.items():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(OUT / name, dest)


def main(argv: list[str]) -> int:
    if "--check" in argv:
        p = OUT / "engine_status.json"
        if not p.exists():
            print("engine_status.json 이 없어요 — 한 번도 안 구웠어요.")
            return 1
        st = json.loads(p.read_text("utf-8"))
        due = cadence.is_due(dt.date.fromisoformat(st["basis_as_of"]))
        print(f"{st['staleness']['state']} · {st['staleness']['why']}")
        print(st["next_event"]["note"])
        return 1 if due else 0

    st = rebake(offline="--offline" in argv)
    print(f"구웠어요 · basis_as_of {st['basis_as_of']} · "
          f"{st['staleness']['state']}")
    print(f"  {st['as_of_sentence']}")
    print(f"  {st['next_event']['note']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
