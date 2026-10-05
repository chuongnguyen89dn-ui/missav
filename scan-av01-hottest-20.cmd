@echo off
setlocal
cd /d "%~dp0"
echo AV01 Hottest - FULL SITE scan: tags + 2024/2025/2026 + block filter + 1080 probe...
python scripts\av01_hottest_filtered_proven.py --count 0 --out av01_hottest_full
if errorlevel 1 (
  echo.
  echo [STOP] Full-site scanner failed.
  exit /b 1
)
echo.
echo [DONE] Full-site scan finished. Review av01_hottest_full\report.json
