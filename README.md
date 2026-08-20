# rateslab (sauron-v2)

원화 금리 데스크 화면. Next.js 프런트 + FastAPI 백엔드가 한 리포에 있다.
계산은 전부 백엔드가 한다. 백엔드 없이 프런트만 띄우면 화면이 비어 있다.

- 프런트: Vercel → https://rateslab.vercel.app
- 백엔드: 이 PC 의 :8200, Tailscale Funnel 로 공개
  → https://e110430.tailc7b701.ts.net/v2  (예비: `…ts.net:8443`)

## 실행

```sh
pnpm install
pnpm dev            # :3200
```

```powershell
powershell -ExecutionPolicy Bypass -File backend\serve.ps1 -Local   # :8200
```

프런트는 `NEXT_PUBLIC_API_BASE` 가 없으면 개발에서 `http://localhost:8200` 을 쓴다.

## 환경변수

이름만 `.env.example` 에 있다. 값은 없다.

| 이름 | 어디에 | 없으면 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | Vercel 대시보드 | **프로덕션 빌드가 실패한다.** 백엔드 주소, 끝에 `/` 없이 |
| `BW_MYSQL_HOST/PORT/USER/PASSWORD/DB` | 백엔드 셸 (사용자 환경변수로 설정됨) | SQL 을 읽는 순간 죽는다 |
| `ECOS_API_KEY` | 백엔드 셸 (사용자 환경변수로 설정됨) | 조달 기준의 기준금리를 못 가져온다. 기본은 **기준금리 +10bp** 다 |
| `SAURON_ALLOWED_ORIGINS` | 백엔드 셸 | 로컬 개발 오리진만 허용. `rateslab*.vercel.app` 은 기본 정규식이 이미 허용 |
| `SAURON_TEST_BASE` | 백엔드 테스트 | `http://127.0.0.1:8200` |

## 게이트

```sh
pnpm build       # NEXT_PUBLIC_API_BASE 필요
pnpm vitest run
pnpm lint
```

각각 따로 돌린다(파이프로 이으면 종료코드가 가려진다). **build 를 먼저** —
`guards/production-env.test.ts` 가 빌드 산출 청크를 읽는다.

백엔드는 따로: `cd backend && python -m pytest -q`

## 알아 둘 것

- `.env.local` 에 값을 적지 말 것. `next build` 도 그 파일을 읽는다. 개발 전용
  값은 `.env.development.local` 에.
- `vercel link` 가 `.env.local` 을 만든다(OIDC 토큰). 지우면 된다. 안 지우면
  가드가 실패한다.
- `serve.ps1 -Local` 로 띄운 백엔드만 PID 쪽지를 남기고, 백엔드 테스트는 그
  쪽지가 있는 포트만 건드린다. 공개 서비스에 테스트가 도는 것을 막는다.
- Funnel 의 :443 루트(`/`)는 v1(swap-monitor→:8100)이 쓴다. v2 는 같은 443 의
  **`/v2` 경로**에 얹혀 있고, Tailscale 이 접두사를 벗겨서 넘긴다. 443 이라
  포트를 막는 망에서도 열린다. `:8443` 도 같은 백엔드를 물고 있는 예비 주소다.
- 백엔드는 `SauronV2Backend` 예약 태스크가 로그인 때 띄운다. `BW_MYSQL_*` 는
  사용자 환경변수라 태스크가 물려받는다.

## 파일

| | |
|---|---|
| `src/lib/apiBase.ts` | 백엔드 주소가 정해지는 곳 |
| `src/lib/staticPaths.ts` | 모든 API URL |
| `backend/app/cors.py` | 허용 오리진 |
| `backend/app/main.py` | 라우트 |
| `guards/` | 소스·산출물 검사 |
| `BACKEND.md` | 백엔드는 braveworld 복사본이다. 차이 목록 |
| `HANDOFF-*.md` | 레인별 인계 |
