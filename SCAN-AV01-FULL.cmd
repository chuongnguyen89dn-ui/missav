@echo off
setlocal
cd /d "%~dp0"
title AV01 FULL SITE SCANNER
echo AV01 FULL SITE SCAN
echo F8 = hide this window. To show it again, use the AV01 tray helper.
echo Ctrl+C = stop scan.
python scripts\av01_hottest_filtered_proven.py --count 0 --out av01_hottest_full
if errorlevel 1 (
 echo.
 echo [STOP] Full-site scanner failed.
 pause
 exit /b 1
)
echo.
echo [DONE] Full-site scan finished.
pause
