# 아침 자동 굽기 — SauronMorningBake 스케줄 태스크가 평일 07:20 에 부른다.
#
# 하루의 규칙 [OWNER, 2026-08-11]:
#   1. 휴일이면 아무것도 안 한다 (달력은 엔진 것 — check_close.py 가 답한다).
#   2. SQL(mkt_irs_close)이 기대 전영업일을 온전히 들고 있으면 바로 굽는다.
#   3. 아니면 SQL 컷오프(기본 08:30)까지 기다린다 — 적재가 늦는 것이 보통이고
#      SQL 이 정답이라서다. 그 사이 엑셀 폴백을 데워 둔다(refresh_irsdata).
#   4. 컷오프가 지나면 있는 것으로 굽는다: 1D 만 비면 엑셀로 채우고, 하루가
#      없으면 엑셀에서 덧붙인다 (병합 로더가 판정 — dataset.py). 화면 칩과
#      manifest.source 가 엑셀이 섞였음을 말한다.
#   5. 11:00 까지는 계속 지켜본다 — SQL 이 뒤늦게 오면 다시 구워 올린다.
#   6. 게이트(데이터 경로 pytest + static-agreement)를 통과한 트리만
#      정적 트리 경로 한정으로 자동 commit+push 한다 [OWNER 승인, 2026-08-11].
#      게이트 1이 전체 스위트가 아니라 데이터 관련 테스트인 이유: 데이터
#      커밋이 다른 레인의 미완성 코드에 인질 잡히면 안 된다 — 코드의 게이트는
#      gate.ps1 이고, 깨진 코드가 나가는 사고는 push 가드가 막는다(비자동화
#      커밋이 있으면 push 자체를 보류하므로).
#      비자동화 커밋이 push 대기 중이면 push 는 보류하고 알린다 — "푸시는
#      오너" 규칙은 그 커밋들에 대해 그대로 산다.
#
# 조용한 실패 금지: 못 구운 날, 게이트가 깨진 날, push 를 보류한 날은 알림
# (msg 팝업 + .sauron\ALERT-bake.txt + 로그)으로 말한다.

param(
  [string]$Repo = "C:\Users\infomax\Desktop\Assistant\Projects_AS\braveworld",
  [string]$Python = "C:\Users\infomax\Miniconda3\python.exe",
  [string]$SqlCutoff = "08:30",     # 이때까지는 SQL 을 기다린다
  [string]$LateSqlUntil = "11:00",  # 이때까지 늦은 SQL 을 지켜본다
  [int]$PollSec = 600
)

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$sauron = "C:\Users\infomax\.sauron"
if (-not (Test-Path $sauron)) { New-Item -ItemType Directory -Force $sauron | Out-Null }
$log = Join-Path $sauron "bake.log"
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Remove-Item $log -Force }

function Write-Log { param([string]$Msg)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Msg"
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}

function Send-Alert { param([string]$Msg)
  Write-Log "ALERT: $Msg"
  $f = Join-Path $sauron "ALERT-bake.txt"
  Add-Content -Path $f -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $Msg" -Encoding utf8
  # 보이는 알림 — 실패해도 로그가 남아 있다. 조용한 재시도 루프는 실패를
  # 숨기는 장치가 된다 (설계 리뷰의 결론).
  try { $null = & msg.exe $env:USERNAME "/TIME:0" "[Sauron 아침 굽기] $Msg" 2>$null } catch {}
}

# 이중 실행 가드 — 어제 루프가 아직 돌고 있으면 새로 시작하지 않는다.
$lock = Join-Path $sauron "bake.lock"
if (Test-Path $lock) {
  $oldPid = (Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Log "another bake (pid $oldPid) is still running — exiting"
    exit 0
  }
}
Set-Content -Path $lock -Value $PID -Encoding utf8

function Get-CloseState {
  Push-Location (Join-Path $Repo "backend")
  $out = & $Python "scripts/check_close.py" --json 2>$null
  Pop-Location
  $json = $out | Where-Object { $_ -is [string] -and $_.StartsWith("{") } | Select-Object -Last 1
  if (-not $json) { return $null }
  try { return $json | ConvertFrom-Json } catch { return $null }
}

function Test-PortListening { param([int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Restore-Tree {
  Push-Location $Repo
  git checkout -- frontend/public/api 2>$null
  git clean -fdq frontend/public/api 2>$null
  Pop-Location
}

function Read-Manifest {
  $p = Join-Path $Repo "frontend\public\api\manifest.json"
  if (-not (Test-Path $p)) { return $null }
  try { return (Get-Content $p -Raw -Encoding utf8 | ConvertFrom-Json) } catch { return $null }
}

$SOURCE_RANK = @{ "sql" = 3; "sql+xlsx-1d" = 2; "sql+xlsx-day" = 1; "xlsx" = 1 }

function Invoke-Bake {
  # 성공 시 구워진 source 문자열, 실패 시 $null. 실패는 트리를 원상 복구한다.
  $prev = Read-Manifest
  $prevAsof = "?"
  if ($prev) { $prevAsof = $prev.asof }

  # 1) 백엔드 정지 — mode 1 게이트는 :8100 이 비어 있어야 한다 (gate.ps1 규칙).
  Stop-ScheduledTask -TaskName "SauronBackend" -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ((Test-PortListening 8100) -and $sw.Elapsed.TotalSeconds -lt 30) { Start-Sleep -Seconds 2 }
  if (Test-PortListening 8100) {
    Send-Alert ":8100 이 멈추지 않아 굽기를 중단했어요 — SauronBackend 태스크를 확인해 주세요"
    return $null
  }

  # 2) 굽기
  Write-Log "bake: building static tree…"
  Push-Location (Join-Path $Repo "backend")
  & $Python "scripts/build_static.py" --quiet 2>&1 | Out-String | ForEach-Object { Add-Content $log $_ }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) {
    Restore-Tree
    Start-ScheduledTask -TaskName "SauronBackend" -ErrorAction SilentlyContinue
    Send-Alert "정적 트리 빌드가 실패했어요 (exit $code) — bake.log 를 봐 주세요"
    return $null
  }
  $m = Read-Manifest
  if (-not $m) {
    Restore-Tree
    Start-ScheduledTask -TaskName "SauronBackend" -ErrorAction SilentlyContinue
    Send-Alert "빌드는 끝났는데 manifest 를 읽지 못했어요"
    return $null
  }
  Write-Log "bake: built asof=$($m.asof) source=$($m.source) rows=$($m.rows)"

  # 3) 게이트 1 — 데이터 경로 테스트. 트리의 결정성(빌드 2회 비교), 로더
  #    검증, 병합 판정, 캐시 키. 전체 스위트가 아닌 이유는 머리말 참조.
  Write-Log "bake: gate 1 (data-path pytest)…"
  Push-Location (Join-Path $Repo "backend")
  $null = & $Python -m pytest tests/test_build_static.py tests/test_dataset_merge.py tests/test_dataset_validation.py tests/test_cache.py -q 2>&1 |
    Out-String | ForEach-Object { Add-Content $log $_ }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) {
    Restore-Tree
    Start-ScheduledTask -TaskName "SauronBackend" -ErrorAction SilentlyContinue
    Send-Alert "게이트(데이터 경로 pytest)가 빨간 상태라 트리를 되돌렸어요"
    return $null
  }

  # 4) 백엔드 재기동 — 새 데이터를 읽게 하고, agreement 를 세운다.
  Start-ScheduledTask -TaskName "SauronBackend" -ErrorAction SilentlyContinue
  $up = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 180) {
    try {
      $h = Invoke-RestMethod "http://localhost:8100/api/health" -TimeoutSec 5
      if ($h.asof -eq $m.asof) { $up = $true; break }
    } catch {}
    Start-Sleep -Seconds 5
  }

  # 5) 게이트 2 — 정적 트리 vs 라이브 API. 백엔드가 안 떴으면 커밋은 하되
  #    크게 알린다 (트리는 게이트 1을 지났고, 죽은 백엔드는 별개의 사고다).
  if ($up) {
    Write-Log "bake: gate 2 (static-agreement)…"
    Push-Location (Join-Path $Repo "backend")
    $null = & $Python -m pytest tests/test_static_agreement.py -q 2>&1 | Out-String | ForEach-Object { Add-Content $log $_ }
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
      Restore-Tree
      Send-Alert "static-agreement 가 깨져 트리를 되돌렸어요 — 정적 트리와 라이브 API 가 갈라진 상태예요"
      return $null
    }
  } else {
    Send-Alert "백엔드가 새 데이터로 뜨지 않았어요 — 트리는 게이트 1만 통과한 채 커밋해요"
  }

  # 6) 커밋 — 정적 트리 경로 한정. 엑셀이 값을 보탠 날은 그 워크북도 함께
  #    (어느 파일의 값이 들어갔는지가 리포에 남아야 한다).
  Push-Location $Repo
  git add frontend/public/api 2>&1 | Out-Null
  if ($m.source -ne "sql") { git add data/irsdata.xlsx 2>&1 | Out-Null }
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Log "bake: tree unchanged — nothing to commit"
    Pop-Location
    return [string]$m.source
  }
  $msg = "Data refresh: $prevAsof -> $($m.asof) ($($m.rows) observations, source=$($m.source)) [자동 굽기]"
  git commit -m $msg 2>&1 | Out-String | ForEach-Object { Add-Content $log $_ }
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Send-Alert "커밋이 실패했어요 — bake.log 를 봐 주세요"
    return $null
  }
  Write-Log "bake: committed `"$msg`""

  # 7) push 가드 — 우리 커밋보다 앞에 비자동화 커밋이 끼어 있으면 보류.
  #    push 는 커밋 단위가 아니라 브랜치 단위라, 밀면 그 커밋들까지 같이
  #    나간다. "푸시는 오너" 규칙이 그 커밋들의 것이므로 기다린다.
  git fetch origin 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Send-Alert "origin fetch 가 실패해 push 를 건너뛰었어요 (네트워크?) — 커밋은 로컬에 있어요"
    return [string]$m.source
  }
  $subjects = @(git log --format=%s origin/main..HEAD)
  $foreign = @($subjects | Where-Object { $_ -notmatch '^Data refresh: ' })
  if ($foreign.Count -gt 0) {
    Pop-Location
    Send-Alert "수동 커밋 $($foreign.Count)건이 push 대기 중이라 자동 push 를 보류했어요 — 오너 push 후 다음 굽기부터 자동으로 나가요"
    return [string]$m.source
  }
  git push origin main 2>&1 | Out-String | ForEach-Object { Add-Content $log $_ }
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Send-Alert "origin push 가 실패했어요 — 커밋은 로컬에 있어요"
    return [string]$m.source
  }
  Write-Log "bake: pushed to origin — Vercel 이 재배포해요"
  git push mirror main 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Log "mirror push failed (non-fatal)" }
  Pop-Location
  return [string]$m.source
}

# ── 본 루프 ────────────────────────────────────────────────────────────────

try {
  $st = Get-CloseState
  if (-not $st) { Send-Alert "check_close.py 가 답하지 않아요 — 환경 문제"; exit 1 }
  if (-not $st.businessDay) { Write-Log "holiday/weekend ($($st.today)) — no-op"; exit 0 }

  $expected = $st.expected
  $today = Get-Date
  $cutoff = [datetime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $SqlCutoff", "yyyy-MM-dd HH:mm", $null)
  $lateEnd = [datetime]::ParseExact("$($today.ToString('yyyy-MM-dd')) $LateSqlUntil", "yyyy-MM-dd HH:mm", $null)
  Write-Log "start: expected close = $expected, sql cutoff $SqlCutoff, watch until $LateSqlUntil"

  $bakedRank = 0
  while ($true) {
    $st = Get-CloseState
    if ($st) {
      $sqlStatus = $st.sql.status
      $xlsxFresh = ($st.xlsx.status -eq "fresh")
      $now = Get-Date

      # 지금 도달 가능한 최선의 출처
      $want = $null
      if ($sqlStatus -eq "full") { $want = "sql" }
      elseif ($now -ge $cutoff) {
        if ($sqlStatus -eq "missing-1d" -and $xlsxFresh) { $want = "sql+xlsx-1d" }
        elseif ($xlsxFresh) { $want = "sql+xlsx-day" }
      }

      if ($want -and $SOURCE_RANK[$want] -gt $bakedRank) {
        Write-Log "state: sql=$sqlStatus xlsx=$($st.xlsx.status) → bake ($want)"
        # 함수 반환은 마지막 원소만 취한다 — 파이프라인에 샌 출력이 섞여도
        # source 문자열이 맨 끝이다.
        $got = @(Invoke-Bake) | Select-Object -Last 1
        if ($got -and $SOURCE_RANK.ContainsKey([string]$got)) {
          $bakedRank = $SOURCE_RANK[[string]$got]
        }
      }
      elseif (-not $xlsxFresh -and $sqlStatus -ne "full") {
        # SQL 을 기다리는 동안 엑셀 폴백을 데워 둔다. 실패는 정상 경로다 —
        # 터미널이 꺼져 있으면 다음 바퀴에 다시 시도한다.
        Write-Log "state: sql=$sqlStatus xlsx=$($st.xlsx.status) → warming xlsx fallback"
        & (Join-Path $Repo "ops\refresh_irsdata.ps1") -Expected $expected -Python $Python 2>&1 |
          Out-String | ForEach-Object { Add-Content $log $_ }
      }
      else {
        Write-Log "state: sql=$sqlStatus xlsx=$($st.xlsx.status) baked=$bakedRank — waiting"
      }
    }

    if ($bakedRank -ge 3) { break }              # SQL 로 구웠다 — 오늘 몫 끝
    if ((Get-Date) -ge $lateEnd) { break }
    Start-Sleep -Seconds $PollSec
  }

  if ($bakedRank -eq 0) {
    Send-Alert "오늘($($st.today)) 전일 종가를 어느 출처에서도 받지 못해 굽지 못했어요 — 인포맥스 터미널과 SQL 적재를 확인해 주세요"
    exit 1
  }
  if ($bakedRank -lt 3) {
    Write-Log "done: baked with excel supplement (rank $bakedRank) — 칩이 화면에서 말한다"
  } else {
    Write-Log "done: baked from sql"
  }
  exit 0
}
finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
