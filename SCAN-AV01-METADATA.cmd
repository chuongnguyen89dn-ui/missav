@echo off
cd /d "%~dp0"
:again
python scripts\av01_enrich_catalog_ids.py --publish
if %errorlevel%==0 goto done
echo [METADATA WATCHDOG] Scanner exited; retry in 15 seconds...
timeout /t 15 /nobreak >nul
goto again
:done
echo [METADATA] All IDs completed.
