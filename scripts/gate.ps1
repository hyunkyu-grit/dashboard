<#
.SYNOPSIS
  Run every gate in both modes and report each separately.

.DESCRIPTION
  19 backend tests used to skip by default because the static/live agreement
  suite needs a running backend, and a test that skips by default never goes
  red. The structural argument still stands and is what actually prevents drift
  (`app/payloads.py` is the single source of every body; `main.py` is only
  transport) — but the agreement suite should be RUNNABLE on purpose and its
  result recorded, rather than quietly absent.

  So this runs two modes explicitly:

    mode 1  backend STOPPED  — the static paths, exactly as deployed
    mode 2  backend RUNNING  — the agreement suite compares the committed
                               tree against the live API

  Each suite's pass/skip/fail counts are printed per mode, and the script exits
  non-zero if either fails.

  Nothing is piped. A pipe hides the exit code, which has shipped a red lint
  twice — every command here is run standalone and judged by $LASTEXITCODE.
  `pnpm lint` also writes a banner to stderr, which PowerShell surfaces as a
  NativeCommandError even on success, so stderr is never treated as failure.

.PARAMETER SkipMode2
  Run only the static mode. Use when uvicorn cannot be started.

.EXAMPLE
  powershell -File scripts/gate.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipMode2,
  [int]$BackendPort = 8100
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$results = [System.Collections.ArrayList]::new()
$script:anyFailed = $false

function Invoke-Gate {
  param([string]$Mode, [string]$Name, [string]$Dir, [scriptblock]$Body)
  Write-Host ""
  Write-Host ("=" * 70)
  Write-Host "[$Mode] $Name" -ForegroundColor Cyan
  Write-Host ("=" * 70)
  Push-Location $Dir
  # captured, not piped: the transcript is parsed for counts AFTER the exit
  # code has been read, never instead of it
  $out = & $Body 2>&1 | Out-String
  $code = $LASTEXITCODE
  Pop-Location
  Write-Host $out
  if ($code -ne 0) { $script:anyFailed = $true }

  # counts, best effort — the exit code is the verdict, these are for the report
  $passed = $skipped = $failed = $null
  if ($out -match '(\d+)\s+passed') { $passed = [int]$Matches[1] }
  if ($out -match '(\d+)\s+skipped') { $skipped = [int]$Matches[1] }
  if ($out -match '(\d+)\s+failed')  { $failed  = [int]$Matches[1] }
  if ($out -match 'Tests\s+(\d+)\s+passed') { $passed = [int]$Matches[1] }

  [void]$results.Add([pscustomobject]@{
    Mode = $Mode; Gate = $Name; Exit = $code
    Passed = $passed; Skipped = $skipped; Failed = $failed
    Status = $(if ($code -eq 0) { 'OK' } else { 'FAIL' })
  })
}

function Test-PortListening {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# ── mode 1: backend stopped ────────────────────────────────────────────────
if (Test-PortListening -Port $BackendPort) {
  Write-Host "A process is listening on :$BackendPort." -ForegroundColor Yellow
  Write-Host "Mode 1 must run with the backend STOPPED so the agreement suite" -ForegroundColor Yellow
  Write-Host "skips and the static paths are what is exercised. Stop it first." -ForegroundColor Yellow
  Write-Host "Also note: a dev server competing for CPU takes the backend suite" -ForegroundColor Yellow
  Write-Host "from ~70s to ~200s, so timings taken now mean nothing." -ForegroundColor Yellow
  exit 2
}

Invoke-Gate 'mode 1 (static)' 'backend pytest' (Join-Path $repo 'backend') {
  python -m pytest tests -q
}
Invoke-Gate 'mode 1 (static)' 'frontend vitest' (Join-Path $repo 'frontend') {
  pnpm vitest run
}
Invoke-Gate 'mode 1 (static)' 'frontend lint' (Join-Path $repo 'frontend') {
  pnpm lint
}
Invoke-Gate 'mode 1 (static)' 'frontend build' (Join-Path $repo 'frontend') {
  pnpm build
}

# ── mode 2: backend running ────────────────────────────────────────────────
if (-not $SkipMode2) {
  Write-Host ""
  Write-Host "Starting uvicorn on :$BackendPort for the agreement suite..." -ForegroundColor Cyan
  $backend = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory (Join-Path $repo 'backend') `
    -FilePath 'python' -ArgumentList '-m', 'uvicorn', 'app.main:app', '--port', "$BackendPort"
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 120 -and -not (Test-PortListening -Port $BackendPort)) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-PortListening -Port $BackendPort)) {
      Write-Host "backend did not come up within 120s" -ForegroundColor Red
      $script:anyFailed = $true
    }
    else {
      Write-Host "backend up after $([int]$sw.Elapsed.TotalSeconds)s" -ForegroundColor Green
      Invoke-Gate 'mode 2 (agreement)' 'static-vs-live agreement' (Join-Path $repo 'backend') {
        python -m pytest tests/test_static_agreement.py -q
      }
    }
  }
  finally {
    if ($backend -and -not $backend.HasExited) {
      Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
      Write-Host "backend stopped" -ForegroundColor DarkGray
    }
  }
}

# ── report ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 70)
Write-Host "GATE SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 70)
$results | Format-Table Mode, Gate, Status, Exit, Passed, Skipped, Failed -AutoSize | Out-String | Write-Host

if ($script:anyFailed) {
  Write-Host "AT LEAST ONE GATE FAILED" -ForegroundColor Red
  exit 1
}
Write-Host "all gates green in both modes" -ForegroundColor Green
exit 0
