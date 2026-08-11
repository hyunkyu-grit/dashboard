# 인포맥스 워크북(data\irsdata.xlsx) 갱신 — 아침 자동 굽기의 엑셀 반쪽.
#
# 원리: 워크북의 종료 셀이 =TODAY() 라서, 인포맥스 애드인(IMDH)이 실린 엑셀로
# 열어 재계산하면 어제 종가까지 늘어난다. 터미널이 꺼져 있으면 수식이 갱신되지
# 못한다 — 그때는 실패(exit 1)로 답하고 호출자가 기다렸다 다시 부른다
# [OWNER, 2026-08-11].
#
# **왜 New-Object COM 이 아니라 정상 기동 + 붙기인가** (진단 2026-08-11):
# 인포맥스 애드인은 레지스트리 OPEN 키의 xlam 이고, COM 으로 띄운 엑셀은 OPEN
# 키를 처리하지 않는다. xlam 을 직접 열어도, RegisterXLL 을 불러도(False 반환)
# IMDH 는 #NAME? 로 남았다. 정상 UI 기동(Start-Process)만 애드인을 싣는다 —
# 그래서 워크북 사본을 excel.exe 로 열고 GetActiveObject 로 붙어 조종한다.
# 엑셀 창이 잠깐 보이는 것은 감수한다(아침 07시대, 로그온 세션 전용 태스크).
#
# 원본은 절대 직접 열지 않는다. 애드인이 안 실린 채 저장하면 수식이 #NAME? 로
# 덮여 **폴백 소스가 파괴된다** — 그래서 사본에서 갱신하고, 두 겹 검증(셀 검사
# + load_dataset 전체 검증)을 통과했을 때만 원본을 교체한다.
#
# 종료 코드:  0 = 원본이 기대일까지 신선함(갱신했든 이미였든)
#             1 = 이번에는 못 받음 — 터미널 꺼짐/지연, 기다렸다 재시도
#             2 = 코드/환경 문제 — 재시도로 안 풀린다
#
# 엑셀 프로세스는 절대 강제 종료하지 않는다 (DTS 세션의 WINWORD 교훈과 동일).
# 오너가 쓰던 인스턴스에 붙었을 때는 우리 워크북 하나만 닫고 물러난다.

param(
  [Parameter(Mandatory = $true)][string]$Expected,   # yyyy-MM-dd, 기대 전영업일
  [string]$Workbook = "C:\Users\infomax\Desktop\Assistant\Projects_AS\braveworld\data\irsdata.xlsx",
  [string]$Python = "C:\Users\infomax\Miniconda3\python.exe",
  [int]$RecalcTimeoutSec = 300
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$backendDir = Join-Path (Split-Path -Parent (Split-Path -Parent $Workbook)) "backend"
$workDir = "C:\Users\infomax\.sauron\refresh"
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Force $workDir | Out-Null }
$work = Join-Path $workDir "irsdata.work.xlsx"
$bak  = Join-Path $workDir "irsdata.bak.xlsx"

function Test-Fresh {
  param([string]$Path)
  # load_dataset 전체 검증을 지나 asof 를 읽는다 — 서버와 같은 눈. 날짜 비교가
  # 성공 기준이다: "값이 있음" 은 어제 값이 그대로 남은 실패를 통과시킨다.
  #
  # PS 5.1 함정 (start-backend.ps1 과 동일): EAP=Stop 이면 네이티브 stderr 가
  # ErrorRecord 로 승격돼 스크립트가 죽는다. 로더의 경고(blank 개수)는 stderr
  # 로 나오므로, 이 함수 안에서만 EAP 를 낮추고 파이썬 쪽 로깅도 끈다.
  $eap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $backendDir
  $asof = & $Python -c "import sys, logging; logging.disable(logging.CRITICAL); from pathlib import Path; sys.path.insert(0, '.'); from app.dataset import load_dataset; print(load_dataset(Path(sys.argv[1])).asof)" $Path 2>$null
  $code = $LASTEXITCODE
  Pop-Location
  $ErrorActionPreference = $eap
  if ($code -ne 0) { return $false }
  $last = @($asof | Where-Object { $_ -is [string] -and $_ -match '^\d{4}-\d{2}-\d{2}$' }) | Select-Object -Last 1
  if (-not $last) { return $false }
  return ($last -ge $Expected)   # ISO 문자열 비교로 충분하다
}

function Invoke-ComRetry {
  param([scriptblock]$Body, [int]$Tries = 12, [int]$DelaySec = 5)
  # 0x800AC472(VBA_E_IGNORE): 엑셀이 바쁘면(재계산·수식 입력 중) COM 호출을
  # 거부한다. 실패가 아니라 "나중에 다시" 라는 뜻이라 기다렸다 다시 부른다.
  for ($i = 1; $i -le $Tries; $i++) {
    try { return & $Body }
    catch {
      if ($i -eq $Tries) { throw }
      Start-Sleep -Seconds $DelaySec
    }
  }
}

# 이미 신선하면 아무것도 안 한다.
if (Test-Fresh $Workbook) {
  Write-Host "irsdata.xlsx already fresh (>= $Expected)"
  exit 0
}

Copy-Item $Workbook $work -Force

$preExisting = $null -ne (Get-Process -Name EXCEL -ErrorAction SilentlyContinue)
$excel = $null
$wb = $null
try {
  # 정상 기동으로 사본을 연다 — 애드인이 실리는 유일한 경로 (머리말 참조).
  # 엑셀이 이미 떠 있으면(오너 사용 중) 그 인스턴스에 워크북만 얹힌다.
  Start-Process -FilePath "excel.exe" -ArgumentList "`"$work`""

  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 90 -and -not $excel) {
    Start-Sleep -Seconds 3
    try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application") } catch {}
  }
  if (-not $excel) {
    Write-Host "could not attach to Excel — 다음 바퀴에 재시도"
    exit 1
  }

  # 우리 사본 워크북을 찾는다 — 붙은 인스턴스에 아직 로딩 중일 수 있다.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 60 -and -not $wb) {
    foreach ($w in @(Invoke-ComRetry { $excel.Workbooks })) {
      if ($w.FullName -ieq $work) { $wb = $w }
    }
    if (-not $wb) { Start-Sleep -Seconds 3 }
  }
  if (-not $wb) {
    Write-Host "work copy did not open in the attached instance"
    exit 1
  }

  # 재계산. 시트 단위 먼저(오너의 다른 워크북을 건드리지 않으려고), 그걸로
  # 부족하면 전체 리빌드로 한 번 더.
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while (-not $excel.Ready -and $sw.Elapsed.TotalSeconds -lt $RecalcTimeoutSec) {
    Start-Sleep -Seconds 2
  }
  $expectedDate = [datetime]::ParseExact($Expected, "yyyy-MM-dd", $null)

  function Test-SheetHasExpected {
    # 기대일 행이 있고 그 행에 오류 셀이 없다. 데이터는 4행부터 내림차순 —
    # 기대일은 위쪽 몇 행 안에 있어야 한다 (오늘 장중 행 + 기대일).
    return (Invoke-ComRetry {
      $ws = $wb.Worksheets.Item(1)
      $ok = $false
      for ($row = 4; $row -le 12; $row++) {
        $v = $ws.Cells.Item($row, 1).Value2
        if ($null -eq $v) { continue }
        $d = [datetime]::FromOADate($v)
        if ($d.Date -eq $expectedDate) {
          $ok = $true
          for ($col = 1; $col -le 16; $col++) {
            $text = [string]$ws.Cells.Item($row, $col).Text
            if ($text.StartsWith("#")) {
              Write-Host "cell error at row $row col $col ($text) — 터미널 미접속?"
              $ok = $false
              break
            }
          }
          break
        }
        if ($d.Date -lt $expectedDate) { break }   # 기대일을 지나쳤다 — 없다
      }
      $ok
    })
  }

  function Wait-Calc {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $RecalcTimeoutSec) {
      $state = Invoke-ComRetry { $excel.CalculationState }
      if ($state -eq 0 -and $excel.Ready) { break }
      Start-Sleep -Seconds 2
    }
    Start-Sleep -Seconds 10   # 비동기 꼬리(애드인 내부 큐)
  }

  Invoke-ComRetry { $wb.Worksheets.Item(1).Calculate() }
  Wait-Calc
  $found = Test-SheetHasExpected
  if (-not $found) {
    Invoke-ComRetry { $excel.CalculateFullRebuild() }
    Wait-Calc
    $found = Test-SheetHasExpected
  }

  if (-not $found) {
    Write-Host "expected close $Expected not present after recalc — not saving"
    Invoke-ComRetry { $wb.Close($false) }   # 저장하지 않는다 — 원본은 그대로다
    $wb = $null
    exit 1
  }

  Invoke-ComRetry { $wb.Save() }
  Invoke-ComRetry { $wb.Close($false) }
  $wb = $null
}
catch {
  Write-Host "excel automation failed: $($_.Exception.Message)"
  if ($wb) { try { $wb.Close($false) } catch {} }
  exit 1
}
finally {
  if ($excel) {
    # 우리가 띄운 인스턴스이고 남은 워크북이 없을 때만 닫는다 — 오너가 쓰던
    # 인스턴스라면 워크북 하나 닫은 것으로 끝. 강제 종료는 어느 경우에도 없다.
    try {
      if (-not $preExisting -and (Invoke-ComRetry { $excel.Workbooks.Count }) -eq 0) {
        $excel.Quit()
      }
    } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
}

# 검증 2: 저장된 사본이 load_dataset 전체 검증(범위·순서·중복)을 통과하고
# 기대일까지 왔는가. 통과 못 하면 원본을 건드리지 않는다.
if (-not (Test-Fresh $work)) {
  Write-Host "saved copy failed validation or still stale — original untouched"
  exit 1
}

Copy-Item $Workbook $bak -Force     # 마지막 정상본 백업
Copy-Item $work $Workbook -Force
Write-Host "irsdata.xlsx refreshed through $Expected"
exit 0
