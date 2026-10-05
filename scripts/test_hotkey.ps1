$ErrorActionPreference = "Stop"
$src = @'
using System;
using System.Runtime.InteropServices;
public static class AVHotkey {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }
}
'@
Add-Type -TypeDefinition $src
$w = [AVHotkey]::GetConsoleWindow()
if ($w -eq [IntPtr]::Zero) { throw "Console window handle not found" }
if (-not [AVHotkey]::RegisterHotKey([IntPtr]::Zero, 99, 3, 0x78)) { throw "Ctrl+Alt+F9 registration failed" }
Write-Host "[READY] Ctrl+Alt+F9 = hide/show this CMD window."
$hidden = $false
try {
    $msg = New-Object AVHotkey+MSG
    while ([AVHotkey]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0) -gt 0) {
        if ($msg.message -eq 0x0312 -and $msg.wParam.ToUInt64() -eq 99) {
            $hidden = -not $hidden
            if ($hidden) { [AVHotkey]::ShowWindow($w, 0) | Out-Null }
            else { [AVHotkey]::ShowWindow($w, 9) | Out-Null }
        }
    }
}
finally { [AVHotkey]::UnregisterHotKey([IntPtr]::Zero, 99) | Out-Null }
