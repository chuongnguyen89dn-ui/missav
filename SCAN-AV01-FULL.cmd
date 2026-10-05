@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title AV01 FULL SITE SCANNER

echo [AV01] Clean full-site scan
echo [AV01] Ctrl+Alt+F9 = hide/show this CMD window.
start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test_hotkey.ps1"

python "%~dp0scripts\av01_hottest_filtered_proven.py" --count 0 --out "av01_hottest_full"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
 echo.
 echo [STOP] AV01 scanner failed with code %RC%.
 pause
)
exit /b %RC%
