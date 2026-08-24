# Cadara terminal installer (Windows).
#
#   irm https://raw.githubusercontent.com/pulakit001/cadara-text-to-cad/main/install.ps1 | iex
#
# Downloads the latest Cadara release from GitHub and runs the NSIS
# installer silently (per-user, no admin rights needed).

$ErrorActionPreference = "Stop"
$Repo = "pulakit001/cadara-text-to-cad"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" -ForegroundColor DarkGray }

# Windows PowerShell 5.1 (the default shell on most Windows installs)
# can default to TLS versions GitHub rejects -> "underlying connection
# was closed". Force TLS 1.2+ (no-op on PowerShell 7+).
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

# PS 5.1 renders a progress bar for every downloaded chunk, slowing big
# downloads by an order of magnitude. Suppress it for the transfer.
$ProgressPreference = 'SilentlyContinue'

Step "1/4 - Checking system..."
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Info "Windows on ARM detected: the x64 build will run under emulation."
}
try {
  $tempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
  $freeGB = [Math]::Round([System.IO.DriveInfo]::new($tempRoot).AvailableFreeSpace / 1GB, 1)
  if ($freeGB -lt 3) {
    throw "Only $freeGB GB free on the system drive. Cadara needs about 3 GB (installer + app). Free up space and retry."
  }
  Info "OK ($freeGB GB free on the system drive)"
} catch [System.IO.IOException] {
  Info "Skipped the free-space check (could not read drive info)."
}

Step "2/4 - Looking up the latest Cadara release..."
$release = $null
foreach ($attempt in 1..5) {
  try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 30
    break
  } catch {
    Info "Lookup attempt $attempt failed ($($_.Exception.Message)); retrying in 3s..."
    Start-Sleep -Seconds 3
  }
}
if (-not $release) { throw "Could not reach GitHub. Check your internet connection and try again." }
$asset = $release.assets | Where-Object { $_.name -match '^Cadara-.*-win-x64\.exe$' } | Select-Object -First 1
if (-not $asset) { throw "No Cadara win-x64 installer found in the latest release ($($release.tag_name))." }
$sizeMB = [Math]::Round($asset.size / 1MB)
Info "Latest release: $($release.tag_name) - $($asset.name) (~$sizeMB MB)"

Step "3/4 - Downloading $($asset.name) (~$sizeMB MB - please keep this window open)..."
$tempDir = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$tmp = Join-Path $tempDir $asset.name
$dlOk = $false
foreach ($attempt in 1..3) {
  try {
    Invoke-WebRequest $asset.browser_download_url -OutFile $tmp -TimeoutSec 1800
    $got = (Get-Item $tmp -ErrorAction SilentlyContinue).Length
    if ($got -ge [Math]::Max($asset.size * 0.99, 100MB)) { $dlOk = $true; break }
    Info "Attempt $attempt incomplete ($([Math]::Round($got / 1MB)) of $sizeMB MB); resuming in 3s..."
  } catch {
    Info "Download attempt $attempt failed ($($_.Exception.Message)); retrying in 3s..."
  }
  Start-Sleep -Seconds 3
}
if (-not $dlOk) {
  Remove-Item $tmp -ErrorAction SilentlyContinue
  throw "Download failed after 3 attempts. Please try again later."
}

Step "4/4 - Installing (silent, per-user - no admin rights needed)..."
Start-Process -FilePath $tmp -ArgumentList "/S" -Wait
Remove-Item $tmp -ErrorAction SilentlyContinue
$ProgressPreference = 'Continue'

Write-Host ""
Step "Cadara installed successfully! Launch it from the Start menu."
