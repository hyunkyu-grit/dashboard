# 시험 7건 실패 — 이어받기 프롬프트 (2026-09-01)

> **✅ 닫힘 (2026-09-01 오후). §7 을 먼저 읽으세요.** §3-1·§3-2 는 고쳤고
> (968 passed · 0 failed), §3-3 은 오너가 새 export 를 주기로 해 대기입니다.
> 아래 §0~§6 은 진단 당시의 기록이라 그대로 둡니다.

> 아래 전체를 새 세션에 그대로 붙여넣으면 이 일감을 이어서 할 수 있습니다.
>
> 2026-09-01 아침 폴더 정리 세션이 진단만 하고 넘깁니다. **코드는 한 줄도
> 고치지 않았습니다.** §3 의 세 갈래는 전부 실측으로 뿌리까지 내려간 것이고,
> 남은 것은 «어떻게 고칠까» 하나입니다.

---

## 0. 너의 임무

`Projects\apps\sauron-v2` 백엔드 시험 **7건 실패**를 닫는다.

```
961 passed · 7 failed · 7 skipped · 1 xfailed   (449초)
```

**실패는 폴더 이동 탓이 아니다.** 이동 전에도 실패하고 있었다(§2 참조).
뿌리가 셋이고, 셋 다 성격이 다르다. 하나로 뭉뚱그려 고치면 안 된다.

시작 전에 반드시:
1. `CLAUDE.md` 를 읽는다 — 캐논·얼라인·말줄임 금지·낱말 중간 줄바꿈 금지.
2. 이 문서 §4 「이미 밟은 함정」을 읽는다. 넷 다 30분씩 잡아먹는 것들이다.
3. §5 의 검증 절차를 먼저 확인한다 — 전체 스위트는 **7분 반** 걸린다.

---

## 1. 절대 규칙 (오너 지시)

- **커밋 금지.** 오너가 명시적으로 지시할 때까지 `git commit` 하지 않는다.
- **`git stash` 금지** (이 리포의 기존 규칙 — 동시 세션과 pop 이 조용히 실패한다).
  커밋할 때는 반드시 `git commit --only -- <경로>` 로 경로를 못 박는다.
- **동시 세션이 이 기계에서 일하고 있다.** 2026-09-01 09:00 기준 다른 세션이
  `Desktop\ou-optimal\lit\` 와 `Desktop\gsquant-study\` 에서 작업 중이다.
  가드가 빨개지면 **먼저 `git status --porcelain` 으로 누구 파일인지 가른다.**
- **지어낸 데이터 금지 [OWNER 2026-08-26].** 없는 것은 화면에도 시험에도 없어야 한다.

---

## 2. ⚠ 경로가 바뀌었다 (2026-09-01)

이 리포는 오늘 아침 옮겨졌다. **옛 경로를 쓰는 명령은 전부 실패한다.**

```
전  C:\Users\infomax\Desktop\Assistant\Projects_AS\sauron-v2
후  C:\Users\infomax\Projects\apps\sauron-v2
```

같이 옮겨간 것들:

| 무엇 | 새 자리 |
|---|---|
| sauron-v3 (v2 를 `..\sauron-v2` 로 참조) | `Projects\apps\sauron-v3` |
| braveworld (v1) | `Projects\apps\braveworld` |
| rawData 수집기 | `Projects\apps\rawdata` |
| masterdata | `Projects\data\masterdata` |

이동은 같은 볼륨 rename 이라 **git 은 온전하다** — HEAD `c4b79938` 그대로,
커밋 손실 0. 예약작업 7개도 새 경로로 재등록돼 `rawDataWatch`·`SauronV2Refresh`
가 `0x0` 으로 완주했고, 백엔드 `:8100`·`:8200` 과 프런트 `:3200`·`:3400`
모두 라이브로 200 을 확인했다.

**리포 안에 `.premove.bak` 파일이 널려 있다** — 경로 치환의 백업이다.
`git status` 를 지저분하게 만들지만 지우면 안 된다(오너가 정리 명령을 아직
안 내렸다). 가드나 스위트가 `.bak` 를 집으면 그건 이 정리의 부산물이지
네 잘못이 아니다.

---

## 3. 실패 7건 — 뿌리 셋

### 3-1. cashbond 넷 — 하드코딩된 시작일 + 행 상한 (시한폭탄)

```
tests/test_cashbond.py::TestReconTiesOutOnLiveData::test_the_daily_rows_sum_to_the_backtest_total
  [CB-3Y] [CB-10Y] [ASW-3Y] [ASW-10Y]
```

깨지는 줄은 `tests/test_cashbond.py:801`:

```python
pos = cb.BondPosition(kind, "KTB", tenor, 1, N, dt.date(2025, 8, 13))
...
assert rc["truncated"] is False        # ← 여기. 지금은 True 다.
```

**시작일이 `2025-08-13` 으로 박혀 있다.** 하루가 갈 때마다 대사 창이 하루씩
길어지고, 어느 날 `book_recon` 의 행 상한을 넘어 `truncated` 가 True 가 된다.
메모리에 「test_cashbond 넷은 08-26부터 날짜 시한폭탄」으로 기록돼 있다 —
**이미 알려진 것이고, 아직 안 고쳐진 것이다.**

이 시험이 지키려던 성질은 여전히 유효하다(독스트링: 총액 대조만이 스왑 다리
누락을 잡는다). 죽이면 안 되고, 시작일을 창 길이로 바꾸든 상한을 올리든
`truncated` 를 전제로 받든, **셋 중 하나를 골라야 한다.** 고르는 근거를 적어라.

### 3-2. issuance·rv 셋 — 지나간 미래를 시험하고 있다

```
tests/test_issuance.py::test_a_scheduled_meeting_without_a_decision_is_not_the_same_as_no_meeting
tests/test_issuance_mp.py::test_a_meeting_without_a_decision_has_no_direction_yet
tests/test_rv.py::TestRoute::test_mpc_override_moves_carry_the_right_way
```

시험 자신의 독스트링이 답이다:

> **«8/27 은 달력에 있고 결과표에는 아직 없다.»**

쓸 당시엔 참이었다. 그런데 8/27 이 왔고, 금통위는 **인상**했다. 실측:

```
mpc.csv 마지막 행
2026-08-27,인상,2.75,3.0,0.25,"...3.00% 로 상향 조정..."
```

그래서 `day_detail("2026-08-27")["mpc"]` 가 `{"decision": None, "bias": None}`
이 아니라 `{"decision": {인상 2.75→3.00}, "bias": {약세, ...}}` 를 낸다.

**데이터가 낡은 게 아니라 시험이 낡았다.** 진짜 다가오는 회의 날짜를 상수로
박아 «아직 결정 없음» 을 주장하면, 그 날이 지나는 순간 전제가 만료된다.
`mpc.csv` 는 `rawDataWatch`(평일 5분)가 자동으로 갱신하므로 **이 만료는 반드시
반복된다.** 다음 금통위에 또 터진다.

고칠 방향은 둘이다 — 합성 픽스처로 「결정 없는 예정 회의」를 만들거나,
날짜를 «달력에 있는 가장 먼 미래 회의» 로 계산하거나. 상수를 다음 회의 날짜로
바꾸는 것은 **폭탄을 재장전하는 것**이니 하지 마라.

### 3-3. 기준금리 원천 둘이 어긋나 있다 (시험 밖 · 앱의 문제)

백엔드가 뜰 때마다 경고한다:

```
WARNING app.policy: base rate is stale to 2026-07-16 and the Board met 2026-08-27
  — the step ends at 2026-07-16 rather than carrying an unverified rate to 2026-08-31.
  Refresh data/bokbaserate.xlsx.
```

실측한 뿌리:

| 원천 | 갱신 | 마지막 |
|---|---|---|
| `data/bokbaserate.xlsx` (인포맥스 단말 수기 export) | 손 | 헤더의 종료일이 **2026-07-16** · 2.75 |
| `rawdata/data/mpc.csv` (rawDataWatch 자동) | 5분 | **2026-08-27** · 3.00 |

**한 앱이 기준금리를 두 곳에서 읽고 둘이 다르다.** 자동 갱신되는 쪽이 최신이고,
수기 export 쪽이 정책 계단(`app.policy`)을 지고 있다. 시험 셋(3-2)을 고쳐도
이건 남는다.

이건 **오너 판단이 필요하다** — 새 export 를 받을지, `app.policy` 를 `mpc.csv`
쪽으로 옮길지. 후자면 「수기 워크북 한 장이 자동 수집기와 어긋난다」는 구조를
없애는 것이라 더 나아 보이지만, `bokbaserate.xlsx` 가 2016 년부터의 이력을
들고 있어서 **`mpc.csv` 의 시작이 언제인지 먼저 재야 한다.** 재기 전에 옮기지 마라.

---

## 4. 이미 밟은 함정 넷

**① `test_static_agreement.py` 는 수집 단계에서 스위트를 통째로 죽인다.**
자기가 안 띄운 `:8200` 을 거부한다(배포된 :8200 이 Funnel 공개 서비스라
«포트가 열려 있다» 가 «내 백엔드가 떴다» 로 읽히는 것을 막는 설계된 가드다).
예약작업 `SauronV2Backend` 가 띄운 백엔드는 쪽지를 안 남기므로 항상 걸린다.

```
python -m pytest -q --ignore=tests/test_static_agreement.py
```

이 시험을 제대로 돌리려면 `powershell -File backend/serve.ps1 -Local` 로
직접 띄워 쪽지(`backend/.cache/dev-backend.json`)를 남겨야 한다.

**② 그 쪽지는 낡은 채로 남는다.** 이동 후 `{"pid": 24076, "port": 8299}` 가
남아 있어 «쪽지의 PID 가 듣고 있는 프로세스와 다릅니다» 로 죽었다.
지우면 재작성된다.

**③ 트레이스백이 옛 경로를 가리킨다.** `__pycache__` 의 `.pyc` 가 컴파일 당시
소스 경로를 품고 있고, rename 은 mtime 을 보존하므로 파이썬은 그 `.pyc` 를
유효하다고 본다. 실행은 정상이고 **표시만 거짓말한다.** 헷갈리면
`__pycache__` 를 지워라. 없애기 전에 «파일이 두 곳에 있나» 를 의심하지 마라 —
아니다.

**④ 전체 스위트는 7분 반이다.** 반복하지 말고 파일 단위로 좁혀라.

---

## 5. 검증

```powershell
cd C:\Users\infomax\Projects\apps\sauron-v2\backend

# 좁게
python -m pytest -q tests/test_cashbond.py -k ReconTiesOut
python -m pytest -q tests/test_issuance.py tests/test_issuance_mp.py tests/test_rv.py

# 전체 (7분 반)
python -m pytest -q --ignore=tests/test_static_agreement.py
```

기준선 — 이 문서를 쓴 시점(2026-09-01 08:5x):

```
961 passed · 7 failed · 7 skipped · 1 xfailed
실패: test_cashbond ×4 · test_issuance ×1 · test_issuance_mp ×1 · test_rv ×1
```

프런트를 건드렸다면 sauron-v3 도 같이 본다(v2 백엔드를 빌려 쓴다):

```powershell
cd ..\..\sauron-v3 ; npx tsc --noEmit ; npx vitest run   # 46파일 1,022시험
```

---

## 6. 오너에게 물어야 할 것

1. **§3-3 을 어떻게 닫을까** — 새 인포맥스 export 를 주실지, 아니면
   `app.policy` 를 `mpc.csv` 로 옮길지. 후자면 `mpc.csv` 의 시작 연도를
   먼저 재서 이력이 안 잘리는지 보고해야 한다.
2. **§3-1 의 세 갈래 중 무엇** — 시작일을 창 길이로 바꿀지, 상한을 올릴지,
   `truncated` 를 전제로 받을지.
3. `.premove.bak` 294개를 지워도 되는지 (폴더 정리 세션의 잔여 보험이다).

---

## 7. 닫힘 기록 (2026-09-01 오후)

```
968 passed · 7 skipped · 1 xfailed · 0 failed   (494초)
```

기준선 961 passed / 7 failed 에서 **7건이 그대로 넘어왔고 회귀 0.** 커밋은
안 했습니다(§1 오너 규칙). 고친 것은 시험 넷뿐이고 `app/` 은 한 줄도 안
건드렸습니다.

### 7-1. §3-1 cashbond 넷 — 진입일을 행렬 상대값으로 [오너 선택]

`tests/test_cashbond.py`. 세 갈래 중 **시작일을 상대값으로** 를 골랐습니다.
근거: `truncated is False` 는 이 시험의 **주제가 아니라 전제**입니다. 주제는
독스트링이 말하는 「행 합 = 백테스트 총액」(자산스왑 스왑 다리 누락을 잡은 그
검사)이고, 잘리면 행이 백테스트보다 짧아져 합을 견줄 수 없어서 앞에 서 있는
것입니다. 상한을 올리는 것은 시험을 위해 제품 동작(화면 대사표 행 수)을 바꾸는
것이고, `truncated` 를 받아들이면 잡으라고 만든 것을 못 잡습니다.

```python
ENTRY_ROWS_BACK = 200          # 클래스 상수 (SPEC 옆)
entry = m.dates[-self.ENTRY_ROWS_BACK]
pos = cb.BondPosition(kind, "KTB", tenor, 1, N, entry)
```

`start = max(first, last - RECON_MAX_DAYS + 1)` (`app/cashbond.py:961`) 이
세는 것은 달력 날짜가 아니라 **행렬의 관측 행**이므로 진입일도 같은 자로
잽니다. 199 < 249 라 50행 여유가 있고 시한폭탄이 사라집니다.

⚠ 상수를 `@pytest.mark.parametrize` 와 `def` **사이**에 두면 SyntaxError 입니다
(한 번 밟았습니다). 클래스 상단 `SPEC` 옆에 둡니다.

### 7-2. §3-2 issuance·rv 셋 — 합성 픽스처 + 달력 계산 [오너 선택]

`test_issuance.py` · `test_issuance_mp.py` 둘은 **상태**를 재는 것이지 날짜를
재는 것이 아니므로, 결과표가 영원히 가질 수 없는 미래 회의를 **달력에만**
넣어 그 상태를 만듭니다:

```python
pending = (dt.date.today() + dt.timedelta(days=180)).isoformat()
assert day_detail(pending, MPC + [pending])["mpc"] == {
    "scheduled": True, "decision": None, "bias": None}
assert day_detail(pending, MPC)["mpc"] is None      # 같은 날, 달력만 다르다
```

`day_detail` 은 `iso in set(mpc_dates)` 로 «예정» 을, `_mpc(stamp).get(iso)` 로
«결정» 을 따로 읽습니다(`app/issuance.py:669`). 두 축이 갈라져 있어 합성이
가능하고, 미래 날짜는 CSV 가 절대 못 채우므로 만료되지 않습니다.

`test_rv.py` 는 다릅니다 — 오버라이드가 캐리를 움직이려면 회의가 **캐리 지평
안**에 있어야 하므로 합성이 아니라 달력에서 계산합니다:

```python
asof = dt.date.fromisoformat(base["asof"]["creditMatrix"])
nxt = next((d for d in MPC_DATES if d > asof), None)
assert nxt, f"{asof} 이후 회의가 달력에 없어요 — app.policy.MPC_DATES 를 늘리세요"
```

한은은 연 8회라 다음 회의는 늘 `H_DEFAULT_MONTHS = 6` 안에 듭니다. 달력이
마르면 StopIteration 대신 **고칠 곳을 말하는 문장**으로 죽습니다.

### 7-3. §3-3 기준금리 — **ECOS 로 옮겨 닫았다** [OWNER, 2026-09-01]

> 처음에는 «새 export 를 주신다» 로 정리했는데, 오너가 되물었다 — **«굳이
> 엑셀을 참고하는게 아니라 ECOS API에서 참조해오는게 편하잖아»**. 맞는
> 지적이었고, 더 나아가 **이 리포는 이미 그 결론에 도달해 절반을 실행해 둔
> 상태였다**: `app/ecos.py` 가 2026-08-20 에 같은 이유로 만들어져
> `app/funding.py` 의 조달 기준을 대고 있었고, `app/policy.py` 만 워크북에
> 남아 있었다. 아래 측정은 그 판단의 근거로 남긴다.

문서가 「먼저 재라」고 한 것을 쟀습니다:

| 원천 | 범위 | 모양 |
|---|---|---|
| `bokbaserate.xlsx` | **2016-01-01 → 2026-07-16** (일별, 최신순) | 일별 계단 |
| `mpc.csv` | **2024-01-11 → 2026-08-27** (22행) · `결정` 파싱은 **2024-10-11 부터 16행** | 사건 목록 |

**옮기면 안 됩니다** — 이력이 8년(결정 기준 10년) 짧고, 계단이 아니라
이벤트라 모양이 다릅니다.

그리고 **`app.policy` 는 고장난 게 아니었습니다.** 모듈 독스트링이 이 상황을
미리 적어 뒀고(「보증할 수 있는 마지막 날에서 끝난다」), 경고는 설계된 가드가
제대로 운 것입니다. 고친 것은 가드가 아니라 **출처**입니다.

#### 무엇을 했나

`app/policy.py` 에 `load_base_rate_ecos()` 와 `load_base_rate_auto()` 를 더하고
`app/main.py:338` 을 후자로 돌렸습니다. 워크북은 **폴백**으로 남습니다 — 키·망·
캐시가 전부 없을 때만 읽히고, 그때는 `BaseRate.source` 가 바뀌어 `policy_step`
의 `warnings` 가 그 사실을 말합니다. 캐리 가드는 **그대로**입니다: ECOS 도
발표 지연이 있어 낡을 수 있고, 신선한 출처와 회의를 본 출처는 다른 사실입니다.

#### 교체의 근거 — 겹치는 구간에서 한 날도 안 갈린다

```
워크북  2016-01-01 → 2026-07-16   3,850행   코너 23
ECOS    1999-05-06 → 2026-08-29   9,977행   코너 61

겹친 날 3,850 / 3,850 · 정확한 같음으로 불일치 0 · ECOS 에 없는 날 0
```

값을 바꾸는 것이 아니라 **꼬리를 잇는 것**입니다. 시험으로 잠갔습니다
(`test_ecos_agrees_with_the_workbook_where_they_overlap`).

#### ⚠ 단위 — 이 리포가 이미 한 번 낸 사고

`ecos.base_rate_series()` 는 **소수**(0.03)를 줍니다(`funding` 이 그걸 원해서).
`BaseRate.values` 는 **%**(3.00)입니다. ×100 을 빠뜨리면 예외가 아니라 그럴듯한
숫자가 나옵니다 — MR 레인의 캐리 항이 같은 함정으로 100배 틀렸었습니다.
로더의 대역 검사(`RATE_MIN_PCT`)가 그걸 막고, 시험이 한 번 더 못 박습니다.

그리고 `round(v * 100.0, 6)` 이 필요합니다. 왕복 잡티로 1.75 가
`1.7500000000000002` 이 되는데, `decisions()` 가 코너를 **정확한 같음**으로
가리므로 그 잡티가 화면까지 갑니다. 정책금리는 0.25 배수라 6자리가 정확합니다.

#### 결과

```
before  through 2026-07-16 · latest 2.75 · warnings 1건
after   through 2026-08-28 · latest 3.00 · warnings 없음 · steps 61
```

프런트는 손 안 댔습니다. `references.ts:policyByDate` 와 `Surface3D:policyAt`
둘 다 **오름차순으로 훑어 마지막 값을 쥐는** 방식이라, 1999~2015 코너가 늘어도
축 첫 날 전에 소비되고 끝납니다 — 동작 변화 0.

### 7-4. 남은 것

- `.premove.bak` 294개 = **그대로 둡니다** [오너 2026-09-01].
- 커밋 안 함. 제가 고친 것은 이 넷뿐입니다:
  `backend/tests/{test_cashbond,test_issuance,test_issuance_mp,test_rv}.py`
  ⚠ `backend/tests/` 아래 `test_engine_port.py`·`test_labmacro.py`·
  `test_valuation_port.py` 도 M 으로 뜨는데 **폴더 정리 세션의 경로 치환**이지
  제 것이 아닙니다. `test_issuance.py` 에는 그 치환(`ORIGINAL` 경로)과 제
  수정이 **같이** 들어 있습니다.
- §4 의 함정 넷은 전부 실물로 확인했습니다. 특히 ③ — 트레이스백이 지금도
  옛 `Desktop\Assistant\Projects_AS\...` 를 가리킵니다. 표시만 거짓말입니다.
