@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title AV01 FULL SITE SCANNER

echo [AV01] Full-site scan with checkpoint + watchdog recovery
echo [AV01] Ctrl+Alt+F9 = hide/show this CMD window.
start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test_hotkey.ps1"

:RUN
echo.
echo [AV01] Starting/resuming scanner...
python "%~dp0scripts\av01_hottest_filtered_proven.py" --count 0 --out "av01_hottest_full"
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" goto DONE
echo [WATCHDOG] Scanner exited code %RC%. Restarting from checkpoint in 15 seconds...
timeout /t 15 /nobreak >nul
goto RUN

:DONE
echo.
echo [DONE] AV01 full-site scan completed normally.
exit /b 0
