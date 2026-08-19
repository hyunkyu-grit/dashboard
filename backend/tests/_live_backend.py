"""살아 있는 백엔드에 대고 도는 테스트가 **어디에** 말을 걸 것인가.

## 왜 이 파일이 생겼나

배포되면 :8200 이 Tailscale Funnel 로 공개된다. 그 상태에서 백엔드 테스트를
돌리면 두 가지가 동시에 일어난다:

1. 테스트가 백엔드를 재시작하거나 캐시를 흔드는 동안 **사이트가 502** 를 낸다.
2. 더 나쁜 쪽 — "포트가 열려 있다" 를 "백엔드가 떠 있다(=내가 띄운 것이다)" 로
   읽고, **라이브 서비스를 상대로** 테스트를 돌린다. v1 에서 실제로 그랬다.

포트 번호는 그 둘을 구별하지 못한다. 프로세스 이름도 못 한다 — 같은 uvicorn 이
같은 앱을 서빙하기 때문이다. 구별되는 사실은 **개발용으로 띄웠다는 선언**
하나뿐이고(`app/dev_marker.py`), 그 선언이 쪽지를 남긴다.

## 규칙

    포트가 닫혀 있다              → skip. 비교할 것이 없다.
    포트가 열렸고 쪽지가 맞는다   → 진행.
    포트가 열렸는데 쪽지가 없다   → **fail**. 남의 것일 수 있다.

마지막 줄이 핵심이다. skip 으로 두면 아무도 안 읽고, 언젠가 누가 그 skip 을
"백엔드 없음" 으로 오해해 조건을 느슨하게 푼다.

## 띄우는 법

    powershell -File backend\\serve.ps1 -Local     # 쪽지를 남긴다(테스트용)
    powershell -File backend\\serve.ps1            # 안 남긴다(공개 서비스용)

주소는 `SAURON_TEST_BASE` 로 바꿀 수 있다. 하드코딩된 포트는 이 리포에 더 이상
없다 — 있으면 "다른 포트에서 돌려 보자" 가 소스 수정이 되고, 그러면 아무도 안
한다.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parents[1]
MARKER_PATH = BACKEND_DIR / ".cache" / "dev-backend.json"

#: 기본값은 로컬 개발 주소다. 여기가 이 리포에서 포트가 적히는 **유일한** 곳.
DEFAULT_BASE = "http://127.0.0.1:8200"


def base_url() -> str:
    return (os.getenv("SAURON_TEST_BASE") or DEFAULT_BASE).rstrip("/")


def _port(base: str) -> int | None:
    parsed = urlparse(base)
    if parsed.port:
        return parsed.port
    return {"http": 80, "https": 443}.get(parsed.scheme)


def is_up(base: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/api/health", timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def _run(cmd: list[str]) -> str:
    """콘솔 도구의 출력을 **바이트로 받아** 느슨하게 푼다.

    한국어 Windows 의 `netstat` 은 cp949 로 말한다. `text=True` 로 받으면
    파이썬이 utf-8 로 풀다가 UnicodeDecodeError 로 죽고, 그 예외는 출력을 읽는
    **스레드 안**에서 나기 때문에 `run()` 은 조용히 `stdout=None` 을 돌려준다.
    실측 2026-08-20: 그 None 이 여기서 AttributeError 로 나타났다."""
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=10, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return ""
    return (raw or b"").decode("utf-8", errors="replace")


def _listening_pids(port: int) -> set[int]:
    """이 포트를 지금 듣고 있는 프로세스들. 못 알아내면 빈 집합이고, 그때는
    쪽지의 PID 를 대조할 수 없으므로 판정이 보수적으로(=거절로) 간다."""
    try:
        if os.name == "nt":
            out = _run(["netstat", "-ano", "-p", "TCP"])
            pids = set()
            for line in out.splitlines():
                if "LISTENING" not in line:
                    continue
                parts = line.split()
                if len(parts) < 5:
                    continue
                if re.search(rf"[:.]{port}$", parts[1]) and parts[-1].isdigit():
                    pids.add(int(parts[-1]))
            return pids
        out = _run(["ss", "-ltnp"])
        pids = set()
        for line in out.splitlines():
            if re.search(rf"[:.]{port}\b", line):
                pids.update(int(m) for m in re.findall(r"pid=(\d+)", line))
        return pids
    except (OSError, subprocess.SubprocessError):
        return set()


def _marker() -> dict[str, object] | None:
    try:
        return json.loads(MARKER_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


class Verdict:
    """세 갈래의 답. `reason` 은 사람이 읽고 바로 행동할 수 있는 문장이다."""

    def __init__(self, base: str, run: bool, fail: bool, reason: str) -> None:
        self.base, self.run, self.fail, self.reason = base, run, fail, reason


def claim() -> Verdict:
    """이 포트를 테스트 대상으로 삼아도 되는가."""
    base = base_url()
    port = _port(base)

    if not is_up(base):
        return Verdict(base, False, False, f"{base} 에 백엔드가 없습니다 — 건너뜁니다.")

    marker = _marker()
    if marker is None:
        return Verdict(
            base, False, True,
            f"{base} 는 응답하는데 개발용 쪽지({MARKER_PATH.name})가 없습니다. "
            "이 백엔드는 제가 띄운 것이 아닐 수 있고, 배포 뒤에는 그것이 곧 "
            "**Funnel 로 공개된 라이브 서비스**를 뜻합니다. 포트가 열려 있다는 "
            "사실만으로 진행하지 않습니다. 테스트용으로 띄우려면 "
            "`backend\\serve.ps1 -Local`.",
        )

    pids = _listening_pids(port) if port else set()
    marker_pid = marker.get("pid")
    if not pids:
        return Verdict(
            base, False, True,
            f"{port} 번을 듣고 있는 프로세스를 알아내지 못했습니다. 쪽지가 "
            "가리키는 것이 그 프로세스인지 확인할 수 없으므로 진행하지 않습니다.",
        )
    if marker_pid not in pids:
        return Verdict(
            base, False, True,
            f"쪽지의 PID({marker_pid})가 {port} 번을 듣고 있는 프로세스"
            f"({sorted(pids)})와 다릅니다. 지난번 백엔드의 유령 쪽지이거나, "
            "지금 그 포트에 있는 것이 남의 것입니다.",
        )

    return Verdict(base, True, False, f"{base} — 이 세션이 띄운 백엔드입니다(pid {marker_pid}).")
