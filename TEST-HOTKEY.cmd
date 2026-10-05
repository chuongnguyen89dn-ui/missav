@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title AV01 HOTKEY TEST
echo TEST ONLY - scanner will NOT run.
echo Ctrl+Alt+F9 = hide/show this CMD window.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test_hotkey.ps1"
set "RC=%ERRORLEVEL%"
echo.
echo Test ended. Code=%RC%
pause
exit /b %RC%
