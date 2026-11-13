param([int]$BrowserPid,[string]$Endpoint,[string]$Artifacts)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle,IntPtr dc,uint flags);
}
'@
$window = [IntPtr]::Zero
for ($n=0;$n -lt 30;$n++) {
    $process = Get-Process -Id $BrowserPid
    $window = $process.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) { break }
    Start-Sleep -Seconds 1
}
if ($window -eq [IntPtr]::Zero) { throw 'Installed browser has no native window for toolbar qualification' }
function Invoke-AIToolbar {
    $root = [Windows.Automation.AutomationElement]::FromHandle($window)
    $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'AI Assistant')
    $button = $root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
    if (!$button) { throw 'Native AI Assistant toolbar button is missing' }
    $pattern = $null
    if ($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
        ([Windows.Automation.InvokePattern]$pattern).Invoke()
    } elseif ($button.TryGetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$pattern)) {
        ([Windows.Automation.LegacyIAccessiblePattern]$pattern).DoDefaultAction()
    } else { throw 'Native AI toolbar button exposes no accessible action' }
}
function Get-PanelTarget {
    @((Invoke-RestMethod "$Endpoint/json/list") | Where-Object { $_.url -like 'devtools://*' })
}
Invoke-AIToolbar
$opened = @()
for ($n=0;$n -lt 60;$n++) {
    $opened = @(Get-PanelTarget)
    if ($opened.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
}
if ($opened.Count -eq 0) { throw 'Invoking the native toolbar did not open the bundled AI frontend' }
$rect = New-Object WindowCapture+Rect
if (![WindowCapture]::GetWindowRect($window,[ref]$rect)) { throw 'Cannot measure native browser window' }
$width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
if ($width -lt 500 -or $height -lt 300) { throw 'Native browser window is not a usable size' }
$bitmap = New-Object Drawing.Bitmap($width,$height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$dc=$graphics.GetHdc()
try { if (![WindowCapture]::PrintWindow($window,$dc,2)) { throw 'Native browser window capture failed' } } finally { $graphics.ReleaseHdc($dc) }
try {
    $colors = @{}
    for ($x=0;$x -lt $width;$x+=17) { for ($y=0;$y -lt $height;$y+=17) { $colors[$bitmap.GetPixel($x,$y).ToArgb()]=$true } }
    if ($colors.Count -lt 10) { throw 'Native window capture is blank; desktop rendering is unverified' }
    $bitmap.Save((Join-Path $Artifacts 'native-toolbar-panel.png'),[Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
@{passed=$true; action='UI Automation native toolbar Invoke'; accessible_name='AI Assistant'; frontend_urls=@($opened | ForEach-Object {$_.url}); width=$width; height=$height} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Artifacts 'native-toolbar-report.json')
