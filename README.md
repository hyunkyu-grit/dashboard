# rateslab (sauron-v2)

원화 금리 데스크의 화면. Next.js(App Router) + Coinbase Design System 프런트와,
같은 리포 안에 든 FastAPI 백엔드로 이루어져 있다.

프런트가 계산을 하지 않는다. 커브 부트스트랩·백테스트·시뮬레이션·RV 는 전부
백엔드가 하고, 화면은 그 답을 그린다. 그래서 **화면만 배포해서는 아무것도 안
보인다** — 배포는 언제나 두 조각이다.

## 배포 형태

```
    브라우저 ──▶ Vercel (이 리포의 Next 앱)
        │
        └──────▶ Tailscale Funnel ──▶ 이 PC 의 :8200 (FastAPI)
```

프런트는 Vercel 에, 계산은 사무실 PC 에서 도는 백엔드에 있고 그 백엔드는
Tailscale Funnel 로 공개된다. 브라우저는 두 출처에 말을 걸므로 CORS 가 걸리고
(→ `backend/app/cors.py`), 프런트는 백엔드 주소를 **빌드 시각에** 알아야 한다
(→ `src/lib/apiBase.ts`).

설정해야 하는 값의 목록은 `.env.example` 에 있다. 값이 아니라 이름만 있다.

### 프런트 (Vercel)

| | |
|---|---|
| Root Directory | 리포 루트 (`./`) — `package.json` 과 `next.config.ts` 가 여기 있다 |
| Framework | Next.js (자동 감지) |
| Node | 22 (`.nvmrc`) |
| 필수 환경변수 | `NEXT_PUBLIC_API_BASE` |

`NEXT_PUBLIC_API_BASE` 는 Funnel 이 공개한 https 주소이고 끝에 `/` 를 붙이지
않는다. **프로덕션 빌드에서 이 값이 없으면 빌드가 죽는다.** 없을 때 조용히
`localhost` 로 떨어지는 것이 v1 의 실제 사고였다 — 그 문자열이 번들에 구워져
방문자의 브라우저가 자기 PC 를 두드렸다. 백엔드 없이 굽고 싶다면 빈 문자열을
**명시**한다(그러면 같은 출처로만 나가고, 백엔드가 필요한 화면은 "백엔드가
필요한 화면이에요" 패널이 된다).

### 백엔드 (:8200)

```powershell
powershell -ExecutionPolicy Bypass -File backend\serve.ps1          # 공개 서비스용
powershell -ExecutionPolicy Bypass -File backend\serve.ps1 -Local   # 개발·테스트용
```

`-Local` 이 붙은 것만 개발용 쪽지를 남기고, 백엔드 테스트는 그 쪽지가 있는
포트만 건드린다(`backend/tests/_live_backend.py`). 공개 서비스에 대고 테스트가
도는 사고를 그 한 줄이 막는다.

MySQL 접속 정보(`BW_MYSQL_*`)는 **환경에만** 있다. 코드에 기본값이 없으므로
설정하지 않으면 SQL 을 읽는 순간 어느 변수가 비었는지 이름을 대며 죽는다.

## 개발

```sh
pnpm install
pnpm dev        # :3200
```

백엔드 주소를 설정하지 않으면 개발에서는 `http://localhost:8200` 을 쓴다.
다른 주소를 쓰려면 `.env.development.local` 에 적는다 — **`.env.local` 에 적지
말 것.** `next build` 도 그 파일을 읽어서, 개발용 주소가 프로덕션 번들에 실린다.

> `vercel link` / `vercel env pull` 이 `.env.local` 을 만든다(OIDC 토큰 한 줄).
> 이 리포는 그 토큰을 쓰지 않으므로 지운다. `guards/production-env.test.ts` 가
> 남아 있으면 실패시킨다.

## 게이트

세 개를 각각 따로 돌린다. 파이프로 잇지 않는다 — 파이프는 앞 명령의 종료코드를
가린다.

```sh
pnpm build       # 청크를 만든다
pnpm vitest run  # 그 청크를 가드가 읽는다 (production-env)
pnpm lint
```

순서에 이유가 있다. `guards/production-env.test.ts` 는 `.next/static/chunks` 를
읽어 프로덕션 번들에 개발 출처가 없는지 본다. 빌드보다 먼저 돌면 **지난번**
빌드를 검사하게 된다.

백엔드는 별도다.

```sh
cd backend && python -m pytest -q
```

## 리포 안내

| 경로 | |
|---|---|
| `src/lib/apiBase.ts` | 백엔드 주소가 정해지는 단 한 곳 |
| `src/lib/staticPaths.ts` | 모든 API URL 의 모양. 화면 코드는 여기서만 URL 을 받는다 |
| `backend/app/cors.py` | 누가 브라우저로 말을 걸 수 있는가 |
| `guards/` | 소스·산출물에 대고 도는 가드들. 대부분 텍스트를 핀한다 |
| `BACKEND.md` | 백엔드가 braveworld 의 **복사본**이라는 사실과 그 차이 목록 |
| `HANDOFF-*.md` | 레인별 인계 문서 |
