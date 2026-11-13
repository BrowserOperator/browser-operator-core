param(
    [Parameter(Mandatory=$true)][string]$ChromiumSource,
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Artifacts
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot
$identities = Get-Content (Join-Path $repo 'config\updater\windows-identities.json') -Raw | ConvertFrom-Json
$browserId = '{'+$identities.browser+'}'
$updaterId = '{'+$identities.updater+'}'
$installRoot = Join-Path $env:LOCALAPPDATA 'BrowserOperator\Browser Operator\Application'
$exe = Join-Path $installRoot 'chrome.exe'
if (Test-Path $exe) { throw 'Installed-app qualification requires a disposable Windows account without a prior Browser Operator installation' }
New-Item -ItemType Directory -Force $Artifacts | Out-Null
if ((Get-AuthenticodeSignature -LiteralPath $Installer).Status -ne 'NotSigned') { throw 'This qualification is for the explicitly approved unsigned internal candidate' }
$beforeGoogleUpdate = Test-Path 'HKCU:\Software\Google\Update'
$beforeChromiumUpdate = Test-Path 'HKCU:\Software\Chromium\Update'
$process = Start-Process -FilePath $Installer -ArgumentList @('--do-not-launch-chrome','--enable-logging','--verbose-logging') -PassThru
$null = $process.Handle
if (!$process.WaitForExit(600000)) { throw 'Candidate installer timed out' }
if ($process.ExitCode -ne 0) { throw "Candidate installer failed: $($process.ExitCode)" }
if (!(Test-Path $exe)) { throw 'Installer did not create the branded per-user browser' }
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry32)
foreach ($app in @($browserId,$updaterId)) {
    $key = $registry.OpenSubKey('Software\BrowserOperator\Update\Clients\'+$app)
    if (!$key) { throw "Missing native updater registration: $app" }
    try { if ($key.GetValue('pv') -ne '158.0.8127.18') { throw "Incorrect registered native version: $app" } } finally { $key.Dispose() }
}
$registry.Dispose()
if (!$beforeGoogleUpdate -and (Test-Path 'HKCU:\Software\Google\Update')) { throw 'Installer wrote Google updater identity' }
if (!$beforeChromiumUpdate -and (Test-Path 'HKCU:\Software\Chromium\Update')) { throw 'Installer wrote Chromium updater identity' }
$node = Join-Path $ChromiumSource 'third_party\node\win\node.exe'
$profile = Join-Path $Artifacts 'disposable-profile'
$port = 9445
$browser = Start-Process -FilePath $exe -ArgumentList @('--no-first-run','--no-default-browser-check','--force-renderer-accessibility','--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$port",('--user-data-dir="{0}"' -f $profile),'--enable-logging','--v=1','about:blank') -PassThru
$null = $browser.Handle
try {
    $endpoint = "http://127.0.0.1:$port"
    $ready = $false
    for ($n=0; $n -lt 60; $n++) {
        try { $null=Invoke-RestMethod "$endpoint/json/version"; $ready=$true; break } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { throw 'Installed browser did not start its local qualification endpoint' }
    & $node (Join-Path $PSScriptRoot 'verify_chromium_release.mjs') $endpoint '158.0.8127.18' $Artifacts '0.7.0'
    if ($LASTEXITCODE -ne 0) { throw 'Installed AI tools, native update entry, or privileged-URL tests failed' }
    & $node (Join-Path $PSScriptRoot 'verify_chromium_windows_update.mjs') $endpoint $Artifacts
    if ($LASTEXITCODE -ne 0) { throw 'Installed native updater check failed' }
    @{passed=$true; installed_executable=$exe; browser_app_id=$browserId; updater_app_id=$updaterId; signed=$false; publication=$false; os=[Environment]::OSVersion.VersionString; intel_windows_client_tested=$false} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Artifacts 'installed-windows-report.json')
} finally {
    if (!$browser.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $browser.Id /T /F | Out-Null }
    $updaterRoot = Join-Path $env:LOCALAPPDATA 'BrowserOperator\BrowserOperatorUpdater'
    if (Test-Path $updaterRoot) {
        Get-ChildItem $updaterRoot -Filter '*.log' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $Artifacts ('updater-'+$_.Name)) -Force }
    }
}
