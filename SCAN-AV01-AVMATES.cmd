@echo off
setlocal
cd /d "%~dp0"
echo [AV01 AVMATES] Proven image probe + DMM resume/watchdog/publish.
where git >nul 2>&1 || (echo ERROR git missing & pause & exit /b 1)
where python >nul 2>&1 || (echo ERROR python missing & pause & exit /b 1)
if not exist "data\av01-catalog.json" (echo ERROR missing catalog & pause & exit /b 1)
python -m py_compile scripts\av01_avmates_cdn_scan.py || (echo ERROR scanner syntax & pause & exit /b 1)
echo [AV01] GitHub catalog order, fresh generation once, resume on restart.
echo [AV01] Push 20 verified posters per batch; never touch catalog or addon.
:again
python scripts\av01_avmates_cdn_scan.py --limit 0 --max-snap 30 --workers 4 --delay 1 --publish-every 20
if errorlevel 1 goto retry
goto done
:retry
echo [AVMATES WATCHDOG] Retry in 15 seconds. Ctrl+C to stop.
timeout /t 15 /nobreak >nul
goto again
:done
echo [AVMATES] Scan finished.
pause
