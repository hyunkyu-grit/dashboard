<#
.SYNOPSIS
  The morning data refresh: rebuild the static tree from the xlsx, check it is
  actually newer and self-consistent, then offer to commit, mirror and deploy.

.DESCRIPTION
  Saving the workbook is step 1 of 3 and the one that feels like the whole job.
  The deployed site never opens the xlsx — it serves the committed JSON tree
  (DESIGN §21) — so a morning that ends at "save and close" leaves the site
  silently one day behind, with nothing on screen to say so except the freshness
  chip. This script is steps 2 and 3.

  WHAT IT CHECKS, and why only these. A data-only refresh cannot break a
  component or a guard; the two things that can actually go wrong are the tree
  not matching the file it was built from, and the file not having advanced at
  all. So:

    1. the workbook is CLOSED         — Excel's lock file means the saved bytes
                                        may not be what you are looking at
    2. the xlsx's asof ADVANCED       — a holiday, a workbook that did not
                                        recalculate, or an already-run refresh
                                        all land here, and none of them should
                                        produce a commit
    3. manifest asof == xlsx asof     — the tree is built FROM this file
    4. the agreement suite (18 tests) — the committed tree matches the live API
                                        body for body; this is the check the
                                        deployment actually rests on

  It does NOT run the frontend suites or the backend unit tests. No frontend
  file changed, and `scripts/gate.ps1` is still what you run when CODE changes.
  If you want the full thing on a data day too: `-FullGate`.

  WHAT IT CANNOT CHECK. Whether the numbers are RIGHT. The loader warns about
  date gaps, so a workbook that stopped updating is visible, but an Infomax
  add-in that returned rubbish while logged out saves a file that looks perfect.
  Cross-checking against the terminal stays a human step.

.PARAMETER Force
  Proceed even though Excel still has the workbook open.

.PARAMETER FullGate
  Run scripts/gate.ps1 (both modes, ~5 min) instead of the agreement suite.

.PARAMETER Yes
  Skip the confirmation prompt and commit/mirror/push if every check passed.

.PARAMETER NoPush
  Commit and mirror, but do not push. Deploy on your own schedule.

.EXAMPLE
  powershell -File scripts/refresh.ps1
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$FullGate,
  [switch]$Yes,
  [switch]$NoPush,
  [int]$BackendPort = 8100
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$xlsx = Join-Path $repo 'data\irsdata.xlsx'
$manifest = Join-Path $repo 'frontend\public\api\manifest.json'

function Fail { param([string]$Msg) Write-Host $Msg -ForegroundColor Red; exit 1 }
function Note { param([string]$Msg) Write-Host $Msg -ForegroundColor DarkGray }
function Step { param([string]$Msg) Write-Host ""; Write-Host $Msg -ForegroundColor Cyan }

function Get-ManifestField {
  param([string]$Field)
  if (-not (Test-Path $manifest)) { return $null }
  return (Get-Content $manifest -Raw | ConvertFrom-Json).$Field
}

function Test-PortListening {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# ── 1. the workbook must be closed ──────────────────────────────────────────
# `~$irsdata.xlsx` exists exactly while Excel holds the workbook. Building from
# a file whose owner has unsaved edits produces a tree that disagrees with what
# the owner believes they refreshed — and it looks fine.
$lock = Join-Path $repo 'data\~$irsdata.xlsx'
if (Test-Path $lock) {
  if (-not $Force) {
    Write-Host "Excel still has data\irsdata.xlsx open (its lock file is there)." -ForegroundColor Yellow
    Write-Host "Save and close it first, so the bytes on disk are the ones you saw." -ForegroundColor Yellow
    # The lock file is HIDDEN, so `ls`, `dir` and Explorer all say the folder is
    # clean while it sits there. Checking for the file beats checking for a
    # window: Excel can be closed and the lock left behind by a crash.
    Write-Host "  (the lock file is hidden - 'Get-ChildItem -Force' to see it)" -ForegroundColor DarkGray
    Write-Host "  -Force  builds anyway" -ForegroundColor DarkGray
    exit 2
  }
  Note "workbook is open; -Force given, continuing"
}
if (-not (Test-Path $xlsx)) { Fail "no data file at $xlsx" }

# ── 2. did the data actually advance? ───────────────────────────────────────
$before = Get-ManifestField 'asof'
$beforeRows = Get-ManifestField 'rows'
Step "reading the workbook (the engine's own loader, not a second parser)"
Push-Location (Join-Path $repo 'backend')
# stderr carries the loader's own gap warnings — kept visible, never fatal
$dataAsof = (& python -c "from pathlib import Path; from app.dataset import load_dataset; print(load_dataset(Path(r'$xlsx')).asof)" 2>$null | Select-Object -Last 1)
$loaderCode = $LASTEXITCODE
Pop-Location
if ($loaderCode -ne 0 -or -not $dataAsof) { Fail "could not read the workbook's asof (loader exit $loaderCode)" }
$dataAsof = $dataAsof.Trim()

Write-Host "  committed tree : $before ($beforeRows observations)"
Write-Host "  workbook       : $dataAsof"

if ($dataAsof -eq $before) {
  Write-Host ""
  Write-Host "Nothing to do - the workbook is still $dataAsof, same as the committed tree." -ForegroundColor Yellow
  Write-Host "A KR holiday, a workbook that did not recalculate (check the calculation" -ForegroundColor DarkGray
  Write-Host "mode and that the Infomax add-in is logged in), or today's refresh already" -ForegroundColor DarkGray
  Write-Host "done. No rebuild, no commit." -ForegroundColor DarkGray
  # Opening the workbook rewrites it even when no value changes (a measured
  # 775,811 -> 775,934 bytes with an identical 2612 observations), so `git
  # status` will show the xlsx as modified. That churn is not data and there is
  # nothing to commit; `git checkout -- data/irsdata.xlsx` drops it.
  Push-Location $repo
  $dirty = (& git status --porcelain -- data/irsdata.xlsx | Measure-Object -Line).Lines
  Pop-Location
  if ($dirty -gt 0) {
    Write-Host "" -ForegroundColor DarkGray
    Write-Host "data/irsdata.xlsx shows as modified anyway - Excel rewrites the file on" -ForegroundColor DarkGray
    Write-Host "open even when no value changes. Byte churn, not data." -ForegroundColor DarkGray
  }
  exit 0
}
if ($dataAsof -lt $before) {
  Fail "the workbook ($dataAsof) is OLDER than the committed tree ($before). Refusing - this would roll the site back."
}

# ── 3. rebuild ──────────────────────────────────────────────────────────────
Step "rebuilding the static tree ($before -> $dataAsof)"
Push-Location $repo
& python backend/scripts/build_static.py
$buildCode = $LASTEXITCODE
Pop-Location
if ($buildCode -ne 0) { Fail "build_static.py failed (exit $buildCode) - nothing committed" }

$after = Get-ManifestField 'asof'
$afterRows = Get-ManifestField 'rows'
if ($after -ne $dataAsof) {
  Fail "the rebuilt tree says $after but the workbook says $dataAsof - the tree is not built from this file"
}

# ── 4. the check the deployment rests on ────────────────────────────────────
if ($FullGate) {
  Step "full gate, both modes"
  & powershell -File (Join-Path $PSScriptRoot 'gate.ps1')
  if ($LASTEXITCODE -ne 0) { Fail "gate failed - nothing committed" }
}
else {
  Step "agreement suite (committed tree vs the live API, body for body)"
  if (Test-PortListening -Port $BackendPort) {
    Fail ":$BackendPort is already in use. Stop it - the suite must talk to a backend started from THIS tree."
  }
  $backend = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory (Join-Path $repo 'backend') `
    -FilePath 'python' -ArgumentList '-m', 'uvicorn', 'app.main:app', '--port', "$BackendPort"
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 120 -and -not (Test-PortListening -Port $BackendPort)) {
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-PortListening -Port $BackendPort)) { Fail "backend did not come up within 120s" }
    Note "backend up after $([int]$sw.Elapsed.TotalSeconds)s"
    Push-Location (Join-Path $repo 'backend')
    & python -m pytest tests/test_static_agreement.py -q
    $agreeCode = $LASTEXITCODE
    Pop-Location
    if ($agreeCode -ne 0) { Fail "agreement suite failed (exit $agreeCode) - nothing committed" }
  }
  finally {
    if ($backend -and -not $backend.HasExited) {
      Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
      Note "backend stopped"
    }
  }
}

# ── 5. what changed, then ask ───────────────────────────────────────────────
Push-Location $repo
$touched = (& git status --porcelain -- data/irsdata.xlsx frontend/public/api | Measure-Object -Line).Lines
Pop-Location

Write-Host ""
Write-Host ("=" * 70)
Write-Host "READY" -ForegroundColor Green
Write-Host ("=" * 70)
Write-Host "  asof          $before -> $after"
Write-Host "  observations  $beforeRows -> $afterRows  (+$($afterRows - $beforeRows))"
Write-Host "  files touched $touched"
Write-Host "  checks        $(if ($FullGate) { 'full gate, both modes' } else { 'asof advanced, tree matches the file, agreement 18' })"
Write-Host ""
Write-Host "  NOT checked: whether the numbers are right. Cross-check against the" -ForegroundColor DarkGray
Write-Host "  terminal - a logged-out add-in saves a file that looks perfect." -ForegroundColor DarkGray

if (-not $Yes) {
  Write-Host ""
  $answer = Read-Host "commit$(if (-not $NoPush) { ', mirror and push (deploys)' } else { ' and mirror' })? [y/N]"
  if ($answer -notmatch '^(y|yes)$') {
    Write-Host "stopped - the rebuilt tree is in your working copy, uncommitted." -ForegroundColor Yellow
    exit 0
  }
}

# ── 6. commit, mirror, deploy ───────────────────────────────────────────────
Push-Location $repo
try {
  & git add data/irsdata.xlsx frontend/public/api
  if ($LASTEXITCODE -ne 0) { Fail "git add failed" }
  & git commit -m "Data refresh: $before -> $after ($afterRows observations)"
  if ($LASTEXITCODE -ne 0) { Fail "git commit failed" }
  $sha = (& git rev-parse --short HEAD).Trim()
  Write-Host "committed $sha" -ForegroundColor Green

  # A remote is not a backup (see HANDOFF): mirror every commit, and do it
  # BEFORE the push so a failed deploy still has the local copy saved.
  & powershell -File (Join-Path $PSScriptRoot 'mirror-to-d.ps1')
  if ($LASTEXITCODE -ne 0) {
    Write-Host "mirror reported a problem - check it, the commit itself is fine." -ForegroundColor Yellow
  }

  if ($NoPush) {
    Write-Host "not pushed (-NoPush). 'git push origin main' deploys." -ForegroundColor Yellow
  }
  else {
    & git push origin main
    if ($LASTEXITCODE -ne 0) { Fail "push failed - commit $sha is local only; retry the push" }
    Write-Host "pushed - Vercel builds from this commit if the project is connected." -ForegroundColor Green
  }
}
finally { Pop-Location }

exit 0
