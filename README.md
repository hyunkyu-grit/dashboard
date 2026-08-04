# swap-monitor

KRW IRS 시장 상시 모니터. 독립 풀스택 프로젝트이며(내부 코드명 braveworld),
설계 스펙은 `docs/DESIGN.md`가 최우선 기준이다.

**라이브 사이트: <https://swap-monitor.vercel.app>**

- `frontend/` — Next.js(App Router) + TypeScript + Tailwind. 개발 포트 **:3100**
- `backend/` — FastAPI + 이식된 커브 엔진. 개발 포트 **:8100**
- `data/irsdata.xlsx` — KRW IRS 일별 종가, 2016 → 현재

`:3000`/`:8000` 포트는 동결된 `krw-fi-pms` 시스템의 것이므로 절대 건드리지 않는다.

## 배포 토폴로지

사이트의 거의 전부는 커밋된 정적 JSON을 Vercel이 직접 서빙하고, **백테스트 하나만
라이브 백엔드**를 탄다 — 답이 사용자의 입력에 따라 달라지므로 미리 구울 수 없기
때문이다.

```
브라우저 → Vercel (정적 + /api/backtest rewrite)
                └→ Tailscale Funnel (https://e110430.tailc7b701.ts.net)
                        └→ 운용 PC의 FastAPI :8100
```

- rewrite는 `frontend/next.config.ts`가 서버측 환경변수 `BACKEND_ORIGIN`으로
  생성한다. 브라우저는 항상 자기 origin만 호출하므로 CORS·mixed content가
  아예 발생하지 않는다.
- 백엔드는 운용 PC 로그온 시 작업 스케줄러 작업 **`SauronBackend`**
  (`C:\Users\infomax\.sauron\start-backend.ps1`)이 자동 기동한다. PC가 꺼져
  있으면 백테스트만 죽고 나머지 사이트는 전부 정상 — 시트가 "백엔드 필요"를
  안내한다.
- Funnel 주소는 재시작·재부팅에도 영구 고정이라 Vercel 재배포가 필요 없다.

## 데이터 갱신 — 현재 수동

정적 스냅샷 **둘**이 서로 다른 주기로 움직인다:

| 파일 | 내용 | 갱신 주기 |
|---|---|---|
| `data/irsdata.xlsx` | KRW IRS 일별 종가 | 영업일마다 |
| `data/bokbaserate.xlsx` | 한국은행 기준금리 | 금통위 결정 시에만 |

이 리포에는 새 종가를 받아오거나 스케줄하는 코드가 없다. 내일 데이터를 넣는 것은
수동 단계이며 자동 피드는 아직 없다(소유자 결정 사항).

갱신 절차:

```powershell
# 1. data/irsdata.xlsx를 열어 Infomax 애드인이 새 날짜를 당겨오게 하고, 저장 후 반드시 닫기
#    (금통위가 있었던 날은 data/bokbaserate.xlsx도)
# 2+3. 재빌드·검증 후 (y/n 확인을 거쳐) 커밋 + 미러 + 푸시
powershell -File scripts/refresh.ps1
```

**워크북 저장은 3단계 중 1단계일 뿐인데, 그것만으로 일이 끝난 느낌이 든다.**
배포된 사이트는 xlsx를 열지 않는다 — 커밋된 JSON 트리를 서빙한다 — 그래서
"저장하고 닫기"에서 끝난 아침은 사이트를 하루 뒤처지게 만들고, 화면에는 신선도
칩 말고는 그 사실을 알려주는 것이 없다. `refresh.ps1`이 2·3단계다: Excel이
워크북을 잡고 있으면 거부하고, xlsx의 `asof`가 실제로 **전진**하지 않으면 커밋을
거부하며(휴일, 재계산 안 된 워크북, 같은 날 두 번째 실행이 모두 여기 걸린다),
재빌드된 manifest가 원본 파일과 일치하는지 확인하고, 그 트리로 백엔드를 띄워
18개 일치성 테스트를 돌린 뒤, 무엇이 바뀌었는지 출력하고 나서야 물어본다.
`-FullGate`는 두 모드 전체 게이트를 돌리고, `-Yes`는 확인을 생략하며,
`-NoPush`는 미러까지만 한다.

**기준금리가 금통위 회의보다 뒤처져 있어도 거부한다.** 두 워크북은 다른 주기로
움직이는데 기준금리는 모든 %-단위 차트에 그려지므로, 결정 이후 갱신 안 된
`bokbaserate.xlsx`는 모든 차트의 계단선을 한꺼번에 중간에서 끊는다. 그 절단
자체는 올바른 동작이지만 — 백엔드는 아무도 확인하지 않은 금리를 이어 그리지
않는다 — 배포하고 싶은 상태는 아니므로 갱신이 멈추고(exit 3) 어느 워크북을
열어야 하는지 알려준다. `-SkipBaseRate`는 끊긴 선 그대로 진행한다. 새 IRS
데이터가 없는 날은 멈추지 않고 그렇다고만 말한다.

수동으로 하려면:

```powershell
# 1. data/irsdata.xlsx를 같은 레이아웃의 더 새로운 파일로 교체
#    (마지막 갱신 이후 금통위가 있었다면 data/bokbaserate.xlsx도)
# 2. 배포 사이트가 읽는 정적 API 재빌드
python backend/scripts/build_static.py
# 3. xlsx 파일들과 frontend/public/api/** 를 커밋하고 푸시하면 배포됨
```

스크립트가 확인해줄 수 없는 것 둘. 숫자가 **맞는지** — 로더가 날짜 공백은
경고하므로 갱신이 멈춘 워크북은 보이지만, 로그아웃 상태에서 쓰레기를 반환한
애드인은 멀쩡해 보이는 파일을 저장하므로 터미널 대조는 사람 몫이다. 그리고
Excel이 재계산을 했는지: `D1`은 `=TODAY()`, `A2`는 `IMDH` 배열 풀이라 계산이
수동으로 설정돼 있지 않고 애드인이 로그인돼 있어야 새 날짜가 들어온다.

로컬에서 라이브 백엔드를 상대로 개발 중이라면 백엔드도 **재시작**해야 한다 —
데이터셋·커브·자기이력 캐시가 모두 기동 시 한 번 만들어지므로, 떠 있는 서버는
재시작 전까지 새 파일을 알아차리지 못한다.

파일이 정적이므로 앱은 자신의 신선도를 스스로 측정해서 옛 커브를 오늘 것처럼
보여주지 않는다. 당일이면 헤더가 조용하고, 1영업일 뒤처지면 칩이 보이고, 그
이상이면 빨간 "최신 커브가 아닐 수 있습니다" 칩이 뜬다. 그 칩이 보이면 파일을
갱신해야 한다. 배포 사이트는 `api/manifest.json`을 **보는 사람의** 시계와
대조해 계산하고, 라이브 백엔드는 같은 형태를 `/api/health`로 답한다.

### 데이터는 정적 JSON으로 배포된다

백테스트를 제외하면 배포 사이트는 백엔드를 호출하지 않는다.
`backend/scripts/build_static.py`가 모든 응답을 `frontend/public/api/**`로
미리 계산해 그 트리를 **커밋**하고, Vercel은 `next build`만 돌린다 — 빌드
이미지에 Python도 QuantLib도 없다.

FastAPI 앱은 없어지지 않는다: 로컬 개발의 기준 구현으로 남고,
`backend/app/payloads.py`가 모든 응답 본문의 단일 원천이므로 정적과 라이브가
다르게 답할 수 없다.

**파이프라인 출력을 커밋하는 이유와 비용.** 대략 984개 파일, ~31 MB. 시계열은
일부러 **한 줄에 관측 하나**로 쓴다: 일별 갱신이 ~196개 이력 각각에 한 줄을
덧붙이는 꼴이 되어 git의 델타 압축으로 커밋이 몇 KB에 그친다. 한 줄짜리
블롭으로 쓰면 같은 갱신이 매번 파일 전체를 다시 쓴다 — 갱신당 ~31 MB, 연간
약 7.5 GB. 이 파일들을 재포맷할 일이 있어도 줄 구조는 유지할 것.

## 정책 캘린더 — 역시 수동이며, 다 떨어지면 스스로 알려준다

`frontend/src/data/calendar.json`은 손으로 관리한다: 피드도 API도 없다. 모든
항목은 **발표한 중앙은행에서 직접 읽어온 것**이고 출처를 함께 담는다. 현재
**2026년만** 들어 있다 — 금통위·FOMC·BOJ·ECB 각 8회. PBOC LPR은 목록에 없고
규칙으로 생성된다(매월 20일, 영업일로 순연).

**`verified`가 구조를 지탱한다.** `verified: false`인 항목은 어디에도 렌더되지
않고 — 스트립에도, 카운트다운에도, 차트 룰로도 — 신선도 지평에도 계산되지
않는다. 파일에 미리 적어둘 수는 있지만, 누군가 출처에서 읽고 플래그를 뒤집기
전까지는 보이지 않는다.

**`guards/calendar.test.ts`가 실패하면** 파일이 다 떨어진 것이다 — 그것이
설계이지 결함이 아니다. 마지막 검증 날짜가 **2026-12-18**이므로 게이트는 60일
지평에서 **2026년 10월 말**쯤 발화한다. 할 일:

1. 각 은행이 내년 일정을 공표했는지 확인:
   - 금통위 — <https://www.bok.or.kr> (통화정책방향 결정회의 일정)
   - FOMC — <https://www.federalreserve.gov> (FOMC calendars)
   - BOJ — <https://www.boj.or.jp> (Monetary Policy Meeting schedule)
   - ECB — <https://www.ecb.europa.eu> (Governing Council meeting dates)
2. **날짜는 출처에서 읽는다. 기억으로 공백을 메우지 않는다** — 그렇게 만들어진
   파일이 182개 중 ~23개가 틀려서 지금 파일로 교체됐다.
3. `verified: true`와 출처 문자열을 달아 추가한다.

FOMC는 보통 **2년 치**를, 나머지는 **1년 치**를 미리 공표하므로 다음 해는
조각조각 도착한다. 있는 것부터 추가하면 된다; 부분적인 연도여도 지평이 60일을
넘기면 게이트는 조용해진다.

게이트가 못 하는 것 둘: **멈춘** 파일은 잡아도 **틀린** 파일은 못 잡는다.
그리고 한국은행의 여덟 번 통화정책방향 결정회의만 기준금리를 정한다 —
3·6·9·12월의 금융안정회의는 금리 결정이 아니므로 파일에 넣지 않는다.

## 실행

```powershell
# 백엔드
cd backend; python -m uvicorn app.main:app --port 8100
# 프론트엔드 (별도 셸)
cd frontend; pnpm install; pnpm next dev --port 3100
```

라이브 백엔드를 상대로 개발하려면 `frontend/.env.development.local`에
`NEXT_PUBLIC_API_BASE`를 설정하고(`frontend/.env.example` 참고), 설정하지
않으면 프로덕션이 서빙하는 것과 같은 정적 파일을 상대로 개발하게 된다.

## 게이트

한 명령으로 두 모드 전부, 하나라도 실패하면 non-zero로 종료:

```powershell
powershell -File scripts/gate.ps1
```

모드 1은 백엔드를 **끈 채로** 전부 돌리고(배포된 것과 같은 정적 경로), 모드 2는
uvicorn을 띄워 정적-라이브 일치성 스위트를 돌린다(모드 1에서는 설계상 skip).
:8100에 무언가 떠 있으면 시작을 거부한다 — 모드 1에 백엔드가 있으면 안 되기
때문이다.

개별로 돌리려면 — 각각을 독립 명령으로, 종료 코드를 읽고, **절대 파이프로 잇지
말 것**:

```powershell
cd backend;  python -m pytest tests -q
cd frontend; pnpm vitest run; pnpm lint; pnpm build
```

함정 둘, 모두 `scripts/gate.ps1`이 처리하지만 수동으로 돌릴 때 알아둘 것.
`pnpm lint`와 `pnpm build`는 stderr에 쓰는데 PowerShell은 이를 **성공했어도**
`NativeCommandError`로 표면화한다 — 오직 종료 코드로만 판단할 것. 그리고 dev
서버가 떠 있으면 백엔드 스위트가 ~70초에서 ~200초로 늘어난다; 시간을 재기 전에
꺼둘 것.

`tests/test_static_agreement.py`는 :8100에 백엔드가 없으면 **skip**된다 —
커밋된 정적 트리와 라이브 API를 비교하는 테스트라 혼자서는 게이트가 될 수 없다.
그것이 모드 2가 존재하는 이유다. 단독으로 돌리려면:

```powershell
cd backend; python -m uvicorn app.main:app --port 8100   # 별도 셸
cd backend; python -m pytest tests/test_static_agreement.py -q
```

## 배포

`docs/DEPLOY_CHECKLIST.md`가 배포된 사이트에서만 확인 가능한 항목들을 다룬다.
요약:

- Vercel 프로젝트 **Root Directory = `frontend`** (CLI로 배포할 때는 이 설정
  때문에 **리포 루트에서** `vercel deploy` 할 것)
- 환경변수는 **`BACKEND_ORIGIN` 하나** (server-side; 현재 Funnel 주소).
  `NEXT_PUBLIC_*`은 절대 설정하지 않는다 — 번들에 구워져 재빌드 없이는 못
  되돌린다. 그리고 Vercel CLI로 넣을 때는 **`--no-sensitive`가 필수** —
  Sensitive 타입은 빌드 타임에 복호화되지 않아 rewrite 생성이
  "Invalid rewrite"로 실패한다.
- 캐시 헤더(`no-cache` 전면)는 `frontend/next.config.ts`가 단일 원천이다.
  `vercel.json`에는 headers 블록이 없어야 하며 `guards/cache-policy.test.ts`가
  이를 강제한다.

## 백업 / 미러 / 원격

원격은 둘이다:

| remote | 주소 | 용도 |
|---|---|---|
| `origin` | github.com/wwoo1116-cell/swap_monitor | 주 원격 |
| `dashboard` | github.com/hyunkyu-grit/dashboard | 공유용 사본 |

원격은 백업이 아니다 — 커밋 후 미러도 함께 돌린다:

```powershell
powershell -File scripts/mirror-to-d.ps1
```

모든 브랜치와 태그를 `D:\Backups\braveworld.git`(bare 미러, 최초 실행 시 생성)
으로 강제 동기화한다. 다른 곳에서 복원하려면: `git clone D:\Backups\braveworld.git`.
