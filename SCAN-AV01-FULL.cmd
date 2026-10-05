@echo off
setlocal
cd /d "%~dp0"
title AV01 FULL SITE SCANNER
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\av01_full_toggle.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
 echo.
 echo [STOP] AV01 scanner failed with code %RC%.
 pause
)
exit /b %RC%
