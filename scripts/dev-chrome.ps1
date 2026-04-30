param(
  [ValidateSet('start', 'restart', 'stop')]
  [string]$Mode = 'restart',
  [string]$ChromePath = '',
  [string]$ProfilePath = '',
  [string]$StartUrl = 'https://developer.mozilla.org/en-US/',
  [string]$ExtensionId = 'cieihjmncnbcdopackfalfnbednkfidc',
  [int]$HookPort = 4831,
  [int]$DebugPort = 9331
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

if (-not $ChromePath) {
  $playwrightChromes = @()
  $playwrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  if (Test-Path $playwrightRoot) {
    $playwrightChromes = @(Get-ChildItem $playwrightRoot -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -ExpandProperty FullName)
  }
  $candidates = @(
    $playwrightChromes,
    "$env:ProgramFiles\Google\Chrome for Testing\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome for Testing\Application\chrome.exe",
    "$env:ProgramFiles\Chromium\Application\chrome.exe",
    "$env:LOCALAPPDATA\Chromium\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ }
  $ChromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ChromePath -or -not (Test-Path $ChromePath)) { throw 'Chrome executable not found.' }

if (-not $ProfilePath) {
  $profileName = if ($ChromePath -match 'ms-playwright|Chrome for Testing|Chromium') { '.chromium-agent-profile' } else { '.chrome-agent-profile' }
  $ProfilePath = Join-Path $repoRoot $profileName
}

$profileFull = [System.IO.Path]::GetFullPath($ProfilePath)
$extensionUrl = "chrome-extension://$ExtensionId/sidepanel.html"

function Stop-DevChrome {
  $profileNeedle = $profileFull.ToLowerInvariant()
  $procs = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profileNeedle) }
  $processIds = @($procs | ForEach-Object { [int]$_.ProcessId })
  foreach ($proc in $procs) {
    try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop } catch {}
  }
  if ($processIds.Count -gt 0) {
    try { Wait-Process -Id $processIds -Timeout 10 -ErrorAction SilentlyContinue } catch {}
  }
}

if ($Mode -eq 'stop' -or $Mode -eq 'restart') {
  Stop-DevChrome
}

if ($Mode -eq 'stop') {
  Write-Output "Stopped dev Chrome profile: $profileFull"
  exit 0
}

New-Item -ItemType Directory -Force -Path $profileFull | Out-Null

$oldHookPort = $env:CLAWLINE_HOOK_PORT
$oldHookHost = $env:CLAWLINE_HOOK_HOST
$env:CLAWLINE_HOOK_PORT = [string]$HookPort
$env:CLAWLINE_HOOK_HOST = '127.0.0.1'
try {
  $args = @(
    "--user-data-dir=$profileFull",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--enable-unsafe-extension-debugging',
    "--remote-debugging-port=$DebugPort",
    "--disable-extensions-except=$repoRoot",
    "--load-extension=$repoRoot",
    '--new-window',
    $StartUrl
  )
  Start-Process -FilePath $ChromePath -ArgumentList $args | Out-Null
} finally {
  $env:CLAWLINE_HOOK_PORT = $oldHookPort
  $env:CLAWLINE_HOOK_HOST = $oldHookHost
}

$openedExtension = $false
$deadline = (Get-Date).AddSeconds(12)
do {
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 1
    $extensionReady = $targets | Where-Object { $_.url -like "chrome-extension://$ExtensionId/*" } | Select-Object -First 1
    if ($extensionReady) {
      Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:$DebugPort/json/new?$extensionUrl" -TimeoutSec 2 | Out-Null
      $openedExtension = $true
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $openedExtension) {
  Write-Warning "Extension did not become ready on debug port $DebugPort; open manually: $extensionUrl"
}

Write-Output "Started dev Chrome profile: $profileFull"
Write-Output "Hook port: $HookPort"
Write-Output "Debug port: $DebugPort"
Write-Output "Extension page: $extensionUrl"