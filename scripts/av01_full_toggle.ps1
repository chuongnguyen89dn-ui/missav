Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AV01Window {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
  public struct POINT { public int x; public int y; }
  public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
}
"@
$hwnd=[AV01Window]::GetConsoleWindow()
$HOTKEY=1
$WM_HOTKEY=0x0312
$PM_REMOVE=1
# Ctrl+Alt+F9 is system-wide, so it can restore the console after it is hidden.
if(-not [AV01Window]::RegisterHotKey([IntPtr]::Zero,$HOTKEY,3,0x78)){ throw "Cannot register Ctrl+Alt+F9" }
$hidden=$false
Write-Host "Ctrl+Alt+F9 = hide/show CMD (global hotkey). Ctrl+C = stop."
$job=Start-Job -ScriptBlock {
  param($root)
  Set-Location $root
  & python "scripts\av01_hottest_filtered_proven.py" --count 0 --out "av01_hottest_full"
  exit $LASTEXITCODE
} -ArgumentList $PSScriptRoot
try {
  while($job.State -eq "Running"){
    $msg=New-Object AV01Window+MSG
    if([AV01Window]::PeekMessage([ref]$msg,[IntPtr]::Zero,$WM_HOTKEY,$WM_HOTKEY,$PM_REMOVE)){
      $hidden=-not $hidden
      [AV01Window]::ShowWindow($hwnd, $(if($hidden){0}else{5})) | Out-Null
    }
    Receive-Job $job
    Start-Sleep -Milliseconds 80
  }
  Receive-Job $job
  $code=if($job.State -eq "Completed"){0}else{1}
} finally {
  [AV01Window]::UnregisterHotKey([IntPtr]::Zero,$HOTKEY) | Out-Null
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
exit $code
