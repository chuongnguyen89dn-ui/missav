@echo off
setlocal
cd /d "%~dp0"
echo [1/3] Scan AV01 Hottest until 20 filtered 1080p movies...
python scripts\av01_hottest_filtered_v2.py
if errorlevel 1 (
  echo.
  echo [STOP] Scanner did not reach 20 valid movies. Nothing will be pushed.
  exit /b 1
)
echo.
echo [2/3] 20 valid movies ready. Commit catalog...
git add data\av01-catalog.json data\av01-progress.json
git diff --cached --quiet
if not errorlevel 1 (
  echo [INFO] No catalog changes to push.
  exit /b 0
)
git commit -m "data(av01): publish 20 filtered Hottest 1080p movies"
if errorlevel 1 exit /b 1
echo.
echo [3/3] Push to GitHub...
git push origin main
if errorlevel 1 exit /b 1
echo.
echo [DONE] 20 AV01 movies pushed. Addon catalog will read data/av01-catalog.json after deploy.
