@echo off
setlocal
chcp 65001 >nul
title AV01 HOTKEY TEST
echo TEST ONLY - scanner will NOT run.
echo Ctrl+Alt+F9 = hide/show this CMD window.
echo Close this window to end the test.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$src='using System; using System.Runtime.InteropServices; public class AVHotkey { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd,int id,uint fsModifiers,uint vk); [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd,int id); [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg,IntPtr hWnd,uint wMsgFilterMin,uint wMsgFilterMax); public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; } }'; Add-Type -TypeDefinition $src; $w=[AVHotkey]::GetConsoleWindow(); if(-not [AVHotkey]::RegisterHotKey([IntPtr]::Zero,99,3,0x78)){Write-Host '[FAIL] Ctrl+Alt+F9 could not be registered.';exit 2}; Write-Host '[READY] Press Ctrl+Alt+F9 now.'; $hidden=$false; try{$msg=New-Object AVHotkey+MSG; while([AVHotkey]::GetMessage([ref]$msg,[IntPtr]::Zero,0,0)-gt 0){if($msg.message -eq 0x312 -and $msg.wParam.ToUInt64() -eq 99){$hidden=-not $hidden; if($hidden){[AVHotkey]::ShowWindow($w,0)|Out-Null}else{[AVHotkey]::ShowWindow($w,9)|Out-Null}}}}finally{[AVHotkey]::UnregisterHotKey([IntPtr]::Zero,99)|Out-Null}"
set "RC=%ERRORLEVEL%"
echo.
echo Test ended. Code=%RC%
pause
exit /b %RC%
