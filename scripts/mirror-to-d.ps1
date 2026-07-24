# Mirror this repo to the second drive (D:). Re-runnable backup while no
# private git remote is configured. Creates the bare mirror on first run,
# then force-syncs every ref (branches + tags) on each run.
#
# Usage:  pwsh -File scripts/mirror-to-d.ps1
#     or: powershell -File scripts/mirror-to-d.ps1

$ErrorActionPreference = "Stop"
$mirror = "D:\Backups\braveworld.git"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not (Test-Path "D:\Backups")) { New-Item -ItemType Directory "D:\Backups" | Out-Null }
if (-not (Test-Path $mirror)) { git init --bare $mirror | Out-Null }

if (-not (git remote | Select-String -Quiet '^mirror$')) {
    git remote add mirror $mirror
}

git push mirror --mirror
Write-Host "Mirrored to $mirror :" (git --git-dir=$mirror log --oneline -1)
