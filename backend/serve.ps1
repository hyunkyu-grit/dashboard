# V2-LOCAL EDIT 3 of 3 — see ../BACKEND.md
#
# sauron-v2's own backend launcher. It binds :8200.
#
# The port was never in the source: v1 passes it on the uvicorn command line
# from `.sauron\start-backend.ps1`, which lives outside the repo and belongs to
# braveworld. So "bind :8200" could not be a one-line source edit — it is this
# file, which is the v2-local equivalent of that launcher.
#
# :8100 IS NEVER BOUND HERE. That port belongs to braveworld, is taken down
# every time its gate runs, and the deployed site is served from it.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path (Split-Path -Parent $root) "backend.log"
$python = "C:\Users\infomax\Miniconda3\python.exe"

if (Get-NetTCPConnection -LocalPort 8200 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host ":8200 already serving — nothing to do"
  exit 0
}

$env:PYTHONUTF8 = "1"
Set-Location $root

# cmd owns the redirection: PS 5.1 wraps native stderr lines into ErrorRecords,
# and the backend's harmless dataset warnings on stderr kill the launcher.
# (Carried over from v1's launcher, which learned this the hard way.)
& cmd.exe /s /c " ""$python"" -m uvicorn app.main:app --port 8200 >> ""$log"" 2>&1 "
