@echo off
setlocal
chcp 65001 >nul
title AV01 HOTKEY TEST
echo TEST ONLY - scanner will NOT run.
echo Ctrl+Alt+F9 = hide/show this CMD window.
echo Ctrl+C = exit test.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$sig='[DllImport("kernel32.dll")]public static extern IntPtr GetConsoleWindow();[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool RegisterHotKey(IntPtr h,int id,uint m,uint v);[DllImport("user32.dll")]public static extern bool UnregisterHotKey(IntPtr h,int id);[DllImport("user32.dll")]public static extern int GetMessage(out MSG msg,IntPtr h,uint a,uint b);public struct MSG{public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public int x;public int y;}'; Add-Type -MemberDefinition $sig -Name H -Namespace AV; $w=[AV.H]::GetConsoleWindow(); if(-not [AV.H]::RegisterHotKey([IntPtr]::Zero,99,3,0x78)){Write-Error 'Cannot register Ctrl+Alt+F9';exit 2}; $hidden=$false; try{$msg=New-Object AV.H+MSG; while([AV.H]::GetMessage([ref]$msg,[IntPtr]::Zero,0,0)-gt 0){if($msg.message -eq 0x312 -and $msg.wParam.ToUInt64() -eq 99){$hidden=-not $hidden; [AV.H]::ShowWindow($w,$(if($hidden){0}else{5}))|Out-Null}}}finally{[AV.H]::UnregisterHotKey([IntPtr]::Zero,99)|Out-Null}"
