"""이 백엔드를 **누가** 띄웠는지 남기는 쪽지.

배포되면 :8200 은 Tailscale Funnel 로 공개된다. 그때부터 "포트가 열려 있다" 는
사실은 두 가지를 뜻할 수 있다 — 내가 방금 띄운 개발 백엔드이거나, **사람들이
지금 쓰고 있는 라이브 서비스**이거나. v1 에서 실제로 뒤엣것에 대고 테스트를
돌렸다. 포트만 보고 판단했기 때문이다.

포트 번호로는 둘을 구별할 수 없고, 프로세스 이름으로도 안 된다(같은 uvicorn 이
같은 앱을 서빙한다). 구별되는 사실은 하나뿐이다: **개발용으로 띄웠다고 선언
했는가**. 그 선언이 `SAURON_DEV_LOCAL=1` 이고, 선언한 프로세스만 이 쪽지를
쓴다. 라이브 서비스는 그 변수 없이 뜨므로 쪽지를 남기지 않는다.

쪽지에는 PID 가 들어 있고, 검사하는 쪽(`tests/_live_backend.py`)은 그 포트를
**지금 듣고 있는 프로세스의 PID** 와 대조한다. 쪽지만 있고 프로세스가 다르면
그건 지난번에 죽은 백엔드의 유령이고, 그때도 진행하지 않는다.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

log = logging.getLogger("app.dev_marker")

#: 개발용으로 띄운다는 선언. `backend/serve.ps1 -Local` 이 이걸 켠다.
ENV_FLAG = "SAURON_DEV_LOCAL"

#: 쪽지의 자리. `backend/.cache/` 는 gitignore 돼 있다.
MARKER_PATH = Path(__file__).resolve().parents[1] / ".cache" / "dev-backend.json"


def is_local_run() -> bool:
    return os.environ.get(ENV_FLAG, "") == "1"


def write(port: int | None) -> None:
    """개발용 선언이 있을 때만 쪽지를 남긴다. 없으면 조용히 아무것도 안 한다."""
    if not is_local_run():
        return
    try:
        MARKER_PATH.parent.mkdir(parents=True, exist_ok=True)
        MARKER_PATH.write_text(
            json.dumps({"pid": os.getpid(), "port": port}, indent=2),
            encoding="utf-8",
        )
        log.info("dev marker: pid=%s port=%s -> %s", os.getpid(), port, MARKER_PATH)
    except OSError as exc:  # 쪽지를 못 써도 서비스는 떠야 한다
        log.warning("dev marker 를 못 썼습니다: %s", exc)


def clear() -> None:
    if not is_local_run():
        return
    MARKER_PATH.unlink(missing_ok=True)


def listening_port() -> int | None:
    """uvicorn 이 명령줄로 받은 포트. 쪽지에 적어 두면 검사 쪽이 base URL 의
    포트와 맞춰 볼 수 있다. 못 알아내면 None 이고, 그때는 PID 대조만 한다."""
    argv = sys.argv
    for i, arg in enumerate(argv):
        if arg == "--port" and i + 1 < len(argv) and argv[i + 1].isdigit():
            return int(argv[i + 1])
        if arg.startswith("--port=") and arg.split("=", 1)[1].isdigit():
            return int(arg.split("=", 1)[1])
    return None
