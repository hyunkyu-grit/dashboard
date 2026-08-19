"""누가 이 백엔드에 브라우저로 말을 걸 수 있는가.

배포 형태 [OWNER, 2026-08-20]: 프런트는 Vercel, 이 백엔드는 Tailscale Funnel 로
공개한 :8200. 프런트와 백엔드의 **출처가 다르므로** 모든 요청이 CORS 를 거친다.
목록이 코드에 박혀 있으면 도메인이 정해지는 날 코드를 고쳐야 하고, 그날은 보통
배포하는 날이다 — 그래서 환경변수로 뺀다.

## 왜 `*` 가 아닌가

`allow_origins=["*"]` 한 줄이면 이 파일이 통째로 없어도 된다. 그렇게 하지
않는 이유는, 이 API 가 인증이 없고 Funnel 로 공개돼 있어서 CORS 가 "아무
웹페이지나 방문자의 브라우저를 시켜 이걸 읽게 만들 수 있는가"의 유일한 문턱이기
때문이다. 문턱이 낮은 것과 없는 것은 다르다.

## 프리뷰 주소는 목록에 못 적는다

Vercel 프리뷰 배포는 커밋마다 주소가 바뀐다(`rateslab-<hash>-<scope>.vercel.app`).
그래서 이 하나만 정규식이고, 정규식이라 **의도한 것만 물고 아무 서브도메인은
안 무는지**를 `tests/test_cors_origins.py` 가 고정한다. 특히 다음 셋은 반드시
거절해야 한다 — 셋 다 사람 눈에는 비슷하게 생겼다:

    https://rateslab.vercel.app.evil.com   (뒤에 붙인 도메인)
    https://evil-rateslab.vercel.app       (앞에 붙인 라벨)
    http://rateslab.vercel.app             (평문)
"""

from __future__ import annotations

import os
import re

#: 로컬 개발. :3200 이 v2 의 프런트고, :3100 은 v1(braveworld) 이다 — 이 백엔드
#: 사본을 v1 포트 배치에서도 돌려 볼 수 있게 남긴다. :3000/:8000 은 얼어붙은
#: krw-fi-pms 의 것이라 절대 넣지 않는다.
DEV_ORIGINS: tuple[str, ...] = (
    "http://localhost:3200",
    "http://127.0.0.1:3200",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
)

#: Vercel 프로젝트 이름이 `rateslab` 일 때의 프로덕션·프리뷰 주소.
#: 앞뒤 앵커(`\A`/`\Z`)를 명시한다. 설치된 starlette 1.3.1 은 `fullmatch` 라
#: 앵커가 없어도 되지만, 예전 판은 `match` 였고 그때는 끝 앵커가 없으면
#: `https://rateslab.vercel.app.evil.com` 이 통과했다. requirements 의 하한이
#: 그 판을 배제하지 않으므로 앵커는 여기서 짊어진다 — 아래 `origin_allowed` 도
#: `match` 를 쓴다(같은 규칙을 두 판정기가 공유하도록).
DEFAULT_ORIGIN_REGEX = r"\Ahttps://rateslab(-[a-z0-9-]+)?\.vercel\.app\Z"


def _split(raw: str) -> list[str]:
    """콤마로 나누고 공백과 끝의 `/` 를 떤다. 출처에는 경로가 없으므로 끝
    슬래시가 붙은 채로 비교하면 영영 안 맞는다(브라우저는 안 붙여 보낸다)."""
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


def allowed_origins() -> list[str]:
    """정확히 일치해야 하는 출처들.

    `SAURON_ALLOWED_ORIGINS` 에 적은 것이 **더해진다**(대체가 아니다). 대체로
    만들면 배포 도메인을 넣는 순간 로컬 개발이 막히고, 그때 사람은 목록을
    고치는 대신 `*` 로 도망간다.
    """
    extra = _split(os.getenv("SAURON_ALLOWED_ORIGINS", ""))
    seen: dict[str, None] = dict.fromkeys(DEV_ORIGINS)
    for origin in extra:
        seen.setdefault(origin, None)
    return list(seen)


def allowed_origin_regex() -> str:
    """주소가 매번 바뀌는 쪽(프리뷰). 빈 값이면 기본 프리뷰 패턴을 쓴다."""
    raw = os.getenv("SAURON_ALLOWED_ORIGIN_REGEX", "").strip()
    return raw or DEFAULT_ORIGIN_REGEX


def origin_allowed(origin: str) -> bool:
    """스타렛이 하는 판정과 같은 판정. 테스트가 이 함수를 부른다 —
    미들웨어를 통째로 세우지 않고도 규칙만 고정할 수 있어야 한다."""
    if origin in allowed_origins():
        return True
    return re.compile(allowed_origin_regex()).match(origin) is not None
