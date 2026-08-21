# -*- coding: utf-8 -*-
"""sauron-v2 의 `guards/scenario-parity.vectors.json` 을 다시 뽑는다.

    python -m bigfoot.scenario_basis.parity_vectors <출력경로>

## 왜 이 파일이 생겼나

그 가드는 머리글에 "손으로 고치지 않는다 — 고칠 일이 생기면 파이썬으로 다시
뽑는다" 라고 적어 두었는데, **다시 뽑는 스크립트가 없었다**. 2026-08-21 에
필립스 식을 논문대로 고쳐 `scenario_basis.json` 을 다시 구우면서 그 사실이
드러났다(벡터 25건이 한꺼번에 빨강이 됐다). 규칙만 있고 도구가 없으면 다음
사람은 손으로 고친다.

## 무엇을 담나

케이스 일곱은 **손잡이만** 담고 값은 여기서 계산한다. 손잡이는 그 화면이
실제로 밟는 자리들이다 — 0(항등)·지속·계단·지그재그·혼합·미국 2분기/6분기.

`frames` 는 `dy_bp` 만 필요하다(가드가 그것만 본다). `replay_frames` 가
관측 커브를 받지만 그건 절대 레벨을 얹을 때만 쓰이고 `dy_bp` 는 순수하게
`combine` 의 결과라, 여기서는 0 커브를 넘긴다 — gitignore 된 IRS 파케가 없는
PC 에서도 벡터가 나와야 한다.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from bigfoot.scenario_basis.replay_ref import (
    DAY_GRID,
    IRS_TENORS,
    KTB_TENORS,
    combine,
    load_basis,
    replay_frames,
)

#: 화면이 실제로 밟는 손잡이 자리들. 카멜케이스는 TS 쪽 이름이다.
CASES: dict[str, dict] = {
    "zero": {"policyBp": [0] * 8, "cpiPp": 0.0, "gapPp": 0.0,
             "exportsPct": 0.0, "usBp": 0.0, "usDurQ": 4, "oilPct": 0.0},
    "sustained": {"policyBp": [-25] * 8, "cpiPp": 0.0, "gapPp": 0.0,
                  "exportsPct": 0.0, "usBp": 0.0, "usDurQ": 4, "oilPct": 0.0},
    "staircase": {"policyBp": [-25, -50, -75, -100, -100, -100, -100, -100],
                  "cpiPp": 0.0, "gapPp": 0.0, "exportsPct": 0.0,
                  "usBp": 0.0, "usDurQ": 4, "oilPct": 0.0},
    "zigzag": {"policyBp": [-25, 0, -25, 0, 0, 0, 0, 0], "cpiPp": 0.0,
               "gapPp": 0.0, "exportsPct": 0.0, "usBp": 0.0, "usDurQ": 4,
               "oilPct": 0.0},
    "mixed": {"policyBp": [-25, -25, 0, 0, 25, 0, 0, 0], "cpiPp": 0.35,
              "gapPp": -0.4, "exportsPct": -5.0, "usBp": 100.0,
              "usDurQ": 4, "oilPct": 10.0},
    "us6q": {"policyBp": [0] * 8, "cpiPp": 0.0, "gapPp": 0.0,
             "exportsPct": 0.0, "usBp": 50.0, "usDurQ": 6, "oilPct": 0.0},
    "us2q": {"policyBp": [0] * 8, "cpiPp": 0.0, "gapPp": 0.0,
             "exportsPct": 0.0, "usBp": 25.0, "usDurQ": 2, "oilPct": 0.0},
}

#: TS 쪽 이름 -> `replay_ref` 의 이름.
_SNAKE = {"policyBp": "policy_bp", "cpiPp": "cpi_pp", "gapPp": "gap_pp",
          "exportsPct": "exports_pct", "usBp": "us_bp",
          "usDurQ": "us_dur_q", "oilPct": "oil_pct"}

#: `dy_bp` 는 관측 레벨과 무관하다 — 0 커브로 충분하다.
_ZERO_OBSERVED = {"ktb": {t: 0.0 for t in KTB_TENORS},
                  "irs": {t: 0.0 for t in IRS_TENORS},
                  "as_of": None}


def build(basis: dict) -> dict:
    cases = {}
    for name, knobs in CASES.items():
        snake = {_SNAKE[k]: v for k, v in knobs.items()}
        d = combine(basis, snake)
        frames = replay_frames(basis, _ZERO_OBSERVED, snake)
        cases[name] = {
            "knobs": knobs,
            "iKr": d["i_kr"],
            "kr3y": d["kr3y"],
            "kr10y": d["kr10y"],
            "cpiYoy": d["cpi_yoy"],
            "irs": {t: d["irs"][t] for t in IRS_TENORS},
            "coefs": d["_coefs"],
            "frames": [{"day": f["day"],
                        "dyBp": {k: v for k, v in f["dy_bp"].items()}}
                       for f in frames],
        }
        assert [f["day"] for f in cases[name]["frames"]] == list(DAY_GRID)
    return {
        "note": ("bigfoot/scenario_basis/replay_ref.py 가 생성한 기준값. "
                 "손으로 고치지 않는다 — "
                 "python -m bigfoot.scenario_basis.parity_vectors <경로>"),
        "basisAsOf": basis["as_of"],
        "generated": date.today().isoformat(),
        "cases": cases,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    out = Path(argv[1])
    payload = build(load_basis())
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    print(f"wrote {out} (basis as_of {payload['basisAsOf']}, "
          f"{len(payload['cases'])} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
