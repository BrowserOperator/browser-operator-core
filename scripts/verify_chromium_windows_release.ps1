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
$ownership = Join-Path $env:LOCALAPPDATA 'BrowserOperatorQualification\installation.json'
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (Test-Path $exe) {
    if (!(Test-Path $ownership)) { throw 'Refusing to replace an installation not created by this qualification' }
    $owned = Get-Content $ownership -Raw | ConvertFrom-Json
    if ($owned.sid -ne $currentSid -or $owned.path -ne $exe) { throw 'Existing qualification ownership differs' }
    # Chromium intentionally retains same-version files during repair. A new
    # candidate with the same158 version must be tested as a fresh installation.
    $uninstaller = Join-Path $installRoot '158.0.8127.18\Installer\setup.exe'
    if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Owned installation has no uninstaller; preserve it for inspection' }
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('--uninstall','--force-uninstall','--verbose-logging') -PassThru
    $null = $uninstall.Handle
    if (!$uninstall.WaitForExit(120000) -or $uninstall.ExitCode -notin @(0,19)) { throw 'Owned qualification uninstall failed; do not replace unknown files' }
    for ($n=0; $n -lt 30 -and (Test-Path -LiteralPath $exe); $n++) { Start-Sleep -Seconds 1 }
    if (Test-Path -LiteralPath $exe) { throw 'Owned browser remains after uninstall' }

} else {
    New-Item -ItemType Directory -Force (Split-Path $ownership) | Out-Null
    @{sid=$currentSid; path=$exe} | ConvertTo-Json | Set-Content -Encoding utf8 $ownership
}
New-Item -ItemType Directory -Force $Artifacts | Out-Null
if ((Get-AuthenticodeSignature -LiteralPath $Installer).Status -ne 'NotSigned') { throw 'This qualification is for the explicitly approved unsigned internal candidate' }
$beforeGoogleUpdate = Test-Path 'HKCU:\Software\Google\Update'
$beforeChromiumUpdate = Test-Path 'HKCU:\Software\Chromium\Update'
$process = Start-Process -FilePath $Installer -ArgumentList @('--do-not-launch-chrome','--enable-logging','--verbose-logging') -PassThru
$null = $process.Handle
if (!$process.WaitForExit(600000)) { throw 'Candidate installer timed out' }
if ($process.ExitCode -ne 0) { throw "Candidate installer failed: $($process.ExitCode)" }
if (!(Test-Path $exe)) { throw 'Installer did not create the branded per-user browser' }
$expectedSetup = Join-Path (Split-Path $Installer) 'UpdaterSetup.exe'
$installedSetup = Join-Path $installRoot '158.0.8127.18\UpdaterSetup.exe'
if ((Get-FileHash -LiteralPath $expectedSetup -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installedSetup -Algorithm SHA256).Hash) { throw 'Installed updater setup differs from the candidate payload' }
$expectedUpdater = Join-Path (Split-Path $Installer) 'updater.exe'
$installedUpdater = Join-Path $env:LOCALAPPDATA 'BrowserOperator\BrowserOperatorUpdater\158.0.8127.18\updater.exe'
if ((Get-FileHash -LiteralPath $expectedUpdater -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installedUpdater -Algorithm SHA256).Hash) { throw 'Installed updater executable differs from the candidate payload' }

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
    & (Join-Path $PSScriptRoot 'verify_chromium_windows_toolbar.ps1') -BrowserPid $browser.Id -Endpoint $endpoint -Artifacts $Artifacts
    & $node (Join-Path $PSScriptRoot 'verify_chromium_release.mjs') $endpoint '158.0.8127.18' $Artifacts '0.7.0'
    if ($LASTEXITCODE -ne 0) { throw 'Installed AI tools, native update entry, or privileged-URL tests failed' }
    & $node (Join-Path $PSScriptRoot 'verify_chromium_windows_update.mjs') $endpoint $Artifacts
    if ($LASTEXITCODE -ne 0) { throw 'Installed native updater check failed' }
    @{passed=$true; installed_executable=$exe; browser_app_id=$browserId; updater_app_id=$updaterId; signed=$false; publication=$false; os=[Environment]::OSVersion.VersionString; windows_10_11_client_tested=$false} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Artifacts 'installed-windows-report.json')
} finally {
    if (!$browser.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $browser.Id /T /F | Out-Null }
    $updaterRoot = Join-Path $env:LOCALAPPDATA 'BrowserOperator\BrowserOperatorUpdater'
    if (Test-Path $updaterRoot) {
        Get-ChildItem $updaterRoot -Filter '*.log' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $Artifacts ('updater-'+$_.Name)) -Force }
    }
}
