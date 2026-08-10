# swap-monitor

원화 이자율스왑(KRW IRS) 시장을 한눈에 보여주는 웹 모니터입니다.
금리 커브, 스프레드, 백테스트, 시나리오 시뮬레이션 등을 제공합니다.
(내부 코드명은 braveworld이고, 상세 설계 기준은 `docs/DESIGN.md`입니다.)

**라이브 사이트: <https://swap-monitor.vercel.app>**

## 구성

| 폴더 | 역할 | 개발 포트 |
|---|---|---|
| `frontend/` | 화면 — Next.js + TypeScript + Tailwind | :3100 |
| `backend/` | 계산 서버 — FastAPI + 커브 엔진 | :8100 |
| `data/` | 원본 데이터 — IRS 일별 종가(2016~현재), 한은 기준금리 | — |

> ⚠ `:3000`/`:8000` 포트는 별도 시스템(krw-fi-pms)이 쓰고 있으니 절대 사용하지 않습니다.

## 사이트가 동작하는 방식

핵심 아이디어는 **"거의 모든 화면을 미리 계산해 둔다"**입니다.
`backend/scripts/build_static.py`가 모든 API 응답을 정적 JSON으로 만들어
`frontend/public/api/**`에 커밋하고, Vercel은 그 파일을 그대로 서빙합니다.
그래서 배포 서버에는 Python도 QuantLib도 없습니다.

유일한 예외가 **백테스트**입니다. 사용자 입력에 따라 결과가 달라지므로 미리
만들 수 없고, 운용 PC에서 돌아가는 백엔드가 실시간으로 계산합니다.

```
브라우저 → Vercel (정적 JSON + /api/backtest만 전달)
                └→ Tailscale Funnel (영구 고정 주소)
                        └→ 운용 PC의 FastAPI :8100
```

- 운용 PC가 꺼져 있으면 백테스트만 안 되고, 나머지 화면은 전부 정상입니다.
- 백엔드는 PC 로그온 시 작업 스케줄러 작업 `SauronBackend`가 자동으로 켭니다.
- FastAPI 앱은 로컬 개발의 기준 구현이기도 합니다. `backend/app/payloads.py`가
  모든 응답 본문의 단일 원천이라 정적 파일과 라이브 API가 다르게 답할 수 없습니다.

## 데이터 갱신 — 매일 사람이 합니다

새 종가를 자동으로 받아오는 코드는 없습니다. 절차는 두 단계입니다:

```powershell
# 1. data/irsdata.xlsx를 열어 Infomax 애드인이 새 날짜를 받게 하고, 저장 후 반드시 닫기
#    (금통위 결정이 있었던 날은 data/bokbaserate.xlsx도 갱신)
# 2. 재빌드 → 검증 → 커밋 + 미러 + 푸시까지 한 번에
powershell -File scripts/refresh.ps1
```

꼭 알아야 할 것들:

- **엑셀 저장만으로는 사이트에 반영되지 않습니다.** 사이트는 커밋된 JSON을 읽으므로
  2단계까지 해야 하루 뒤처지지 않습니다.
- `refresh.ps1`은 문제가 있으면 스스로 멈춥니다: Excel이 파일을 잡고 있을 때,
  데이터 날짜가 실제로 전진하지 않았을 때(휴일·재계산 안 된 워크북),
  기준금리가 금통위 결정보다 뒤처져 있을 때. 옵션은 `-FullGate`(전체 테스트),
  `-Yes`(확인 생략), `-NoPush`(푸시 생략), `-SkipBaseRate`(기준금리 검사 생략).
- 스크립트가 못 잡는 것: **숫자 자체가 맞는지**입니다. 애드인이 로그아웃 상태면
  이상한 값이 들어와도 파일은 멀쩡해 보이므로, 터미널 값과의 대조는 사람 몫입니다.
- 로컬 백엔드를 띄워 둔 상태라면 **재시작**해야 새 파일을 읽습니다
  (캐시가 기동 시 한 번만 만들어지기 때문).
- 데이터가 뒤처지면 사이트 헤더에 신선도 칩이 뜹니다. 빨간 칩이 보이면 갱신할 때입니다.

시계열 JSON은 일부러 **한 줄에 관측 하나**로 저장합니다. 일별 갱신이 파일마다
한 줄씩만 추가하는 꼴이 되어 git 압축 덕에 커밋이 몇 KB로 끝나기 때문입니다
(한 줄짜리 블롭이면 갱신마다 ~31 MB를 다시 씁니다). 재포맷하더라도 이 줄 구조는
유지하세요.

## 정책 캘린더 — 역시 수동

`frontend/src/data/calendar.json`은 손으로 관리합니다(피드·API 없음). 모든 날짜는
**해당 중앙은행 공식 발표에서 직접 읽어온 것**만 넣고, `verified: true`가 아닌
항목은 화면 어디에도 나오지 않습니다.

현재 2026년치만 들어 있습니다(금통위·FOMC·BOJ·ECB 각 8회. PBOC LPR은 매월 20일
규칙으로 자동 생성이라 목록에 없음). `guards/calendar.test.ts`가 실패하기
시작하면(2026년 10월 말쯤 예정) 캘린더가 다 떨어졌다는 신호입니다 — 결함이
아니라 설계입니다. 그때 할 일:

1. 각 은행 홈페이지에서 내년 일정을 확인 — 한국은행(bok.or.kr),
   Fed(federalreserve.gov), BOJ(boj.or.jp), ECB(ecb.europa.eu)
2. **날짜는 공식 출처에서 읽고, 기억으로 채우지 않습니다** — 기억으로 만든 이전
   파일은 182개 중 ~23개가 틀려서 폐기됐습니다.
3. `verified: true`와 출처 문자열을 달아 추가합니다. 부분적인 연도여도 괜찮습니다.

참고: 한국은행은 여덟 번의 통화정책방향 결정회의만 기준금리를 정합니다.
3·6·9·12월의 금융안정회의는 금리 결정이 아니므로 넣지 않습니다.

## 로컬 실행

```powershell
# 백엔드
cd backend; python -m uvicorn app.main:app --port 8100
# 프론트엔드 (별도 셸)
cd frontend; pnpm install; pnpm next dev --port 3100
```

기본값으로는 프로덕션과 같은 정적 파일을 상대로 개발하게 됩니다. 라이브 백엔드를
상대로 개발하려면 `frontend/.env.development.local`에 `NEXT_PUBLIC_API_BASE`를
설정하세요(`frontend/.env.example` 참고).

## 테스트 (게이트)

한 명령으로 전부 돌리고, 하나라도 실패하면 non-zero로 종료합니다:

```powershell
powershell -File scripts/gate.ps1
```

- **모드 1**: 백엔드를 끈 채로 전체 스위트 (배포된 것과 같은 정적 경로)
- **모드 2**: uvicorn을 띄워 정적 파일과 라이브 API가 일치하는지 검사
- :8100에 이미 무언가 떠 있으면 시작을 거부합니다.

개별로 돌릴 때의 함정 (gate.ps1은 알아서 처리):

- `pnpm lint`/`pnpm build`는 성공해도 stderr에 쓰므로 PowerShell이 에러처럼
  보여줍니다 — **종료 코드로만 판단**하고, 절대 파이프로 잇지 마세요.
- dev 서버가 떠 있으면 백엔드 테스트가 ~70초에서 ~200초로 늘어납니다.
- `tests/test_static_agreement.py`는 :8100에 백엔드가 없으면 skip됩니다
  (정적 트리와 라이브 API를 비교하는 테스트라서 — 모드 2가 존재하는 이유).

## 배포

자세한 체크리스트는 `docs/DEPLOY_CHECKLIST.md`. 요약:

- Vercel 프로젝트의 **Root Directory = `frontend`**. CLI 배포는 이 설정 때문에
  **리포 루트에서** `vercel deploy` 합니다.
- 환경변수는 **`BACKEND_ORIGIN` 하나뿐**입니다(서버 전용, 현재 Funnel 주소).
  `NEXT_PUBLIC_*`은 절대 설정하지 않습니다 — 번들에 구워져 재빌드 없이는 못
  되돌립니다. CLI로 넣을 때는 `--no-sensitive`가 필수입니다(Sensitive 타입은
  빌드 타임에 복호화되지 않아 rewrite 생성이 실패).
- 캐시 헤더는 `frontend/next.config.ts`가 단일 원천입니다. `vercel.json`에
  headers 블록을 넣으면 안 되며, `guards/cache-policy.test.ts`가 이를 강제합니다.

## 백업 / 원격

| remote | 주소 | 용도 |
|---|---|---|
| `origin` | github.com/wwoo1116-cell/swap_monitor | 주 원격 |
| `dashboard` | github.com/hyunkyu-grit/dashboard | 공유용 사본 |

원격은 백업이 아닙니다 — 커밋 후 미러도 함께 돌립니다:

```powershell
powershell -File scripts/mirror-to-d.ps1
```

모든 브랜치와 태그를 `D:\Backups\braveworld.git`(bare 미러)으로 동기화합니다.
복원은 `git clone D:\Backups\braveworld.git`.
