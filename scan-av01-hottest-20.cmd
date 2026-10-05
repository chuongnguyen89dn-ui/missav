@echo off
setlocal
cd /d "%~dp0"
echo [1/2] AV01 Hottest - proven browser official-tag + 1080 resolver pipeline...
python scripts\av01_hottest_filtered_proven.py --count 20 --out av01_hottest_filtered_20
if errorlevel 1 (
  echo.
  echo [STOP] Scanner/resolver failed. Nothing pushed.
  exit /b 1
)
echo.
echo [2/2] Finished. Review av01_hottest_filtered_20\report.json
