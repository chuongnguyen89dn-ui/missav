@echo off
setlocal
cd /d "%~dp0"
echo [AV01 AVMATES] Windows local scanner - user initiated only
where git >nul 2>&1 || (echo ERROR: git missing & pause & exit /b 1)
where python >nul 2>&1 || (echo ERROR: python missing & pause & exit /b 1)
if not exist "data\av01-catalog.json" (echo ERROR: missing data\av01-catalog.json & pause & exit /b 1)
python -m py_compile scripts\av01_avmates_cdn_scan.py
if errorlevel 1 (echo ERROR: scanner syntax invalid & pause & exit /b 1)
echo [AV01 AVMATES] Scan all IDs from current catalog, verify image bytes.
echo [AV01 AVMATES] Results and checkpoints push to GitHub every 20 processed IDs.
echo [AV01 AVMATES] Existing checkpoint resumes. To rescan from zero, first back up and remove only av01_avmates_cdn\checkpoint.json and data\av01-avmates-cdn-images.json.
echo [AV01 AVMATES] No automatic git pull, no catalog/manifest/player edits.
python scripts\av01_avmates_cdn_scan.py --limit 0 --max-snap 30 --workers 4 --delay 1 --publish-every 20
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (echo [AV01 AVMATES] Scanner stopped with error %EXITCODE%. Review output above.)
echo [AV01 AVMATES] Exit code: %EXITCODE%
pause
exit /b %EXITCODE%
