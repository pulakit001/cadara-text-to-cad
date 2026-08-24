# Cadara terminal installer (Windows).
#
#   irm https://raw.githubusercontent.com/pulakit001/cadara-text-to-cad/main/install.ps1 | iex
#
# Downloads the latest Cadara release from GitHub and runs the NSIS
# installer silently.

$ErrorActionPreference = "Stop"
$Repo = "pulakit001/cadara-text-to-cad"

Write-Host "`n==> Fetching the latest Cadara release..." -ForegroundColor Cyan
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match '^Cadara-.*-win-x64\.exe$' } | Select-Object -First 1
if (-not $asset) { throw "No Cadara win-x64 installer found in the latest release." }

$tmp = Join-Path $env:TEMP $asset.name
Write-Host "==> Downloading $($asset.name) ..." -ForegroundColor Cyan
Invoke-WebRequest $asset.browser_download_url -OutFile $tmp

Write-Host "==> Running installer (silent) ..." -ForegroundColor Cyan
Start-Process -FilePath $tmp -ArgumentList "/S" -Wait
Remove-Item $tmp -ErrorAction SilentlyContinue

Write-Host "==> Cadara installed! Launch it from the Start menu." -ForegroundColor Green
