@echo off
setlocal
cd /d "%~dp0"
echo [AV01 METADATA] Repo: %CD%
where git >nul 2>&1 || (echo ERROR: git not found & pause & exit /b 1)
where python >nul 2>&1 || (echo ERROR: python not found & pause & exit /b 1)
echo [AV01] Ctrl+Alt+F10 = hide/show this CMD window.
start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\metadata_hotkey.ps1"
if not exist "av01_metadata_full" mkdir "av01_metadata_full"
echo [AV01] Preserve checkpoint and existing metadata; resume filtered catalog.
echo [AV01] Using existing Python and Playwright. No reinstall, no automatic git pull.
python -c "import playwright.sync_api" || (echo ERROR: Playwright missing. Run python -m pip install playwright once. & pause & exit /b 1)
echo [AV01] Start metadata scan, GitHub publish every 20 successful IDs...
:again
python scripts\av01_enrich_catalog_ids.py --publish
if errorlevel 1 goto retry
goto done
:retry
echo [METADATA WATCHDOG] Scanner stopped; retry in 15 seconds...
timeout /t 15 /nobreak >nul
goto again
:done
echo [METADATA] Scan finished.
pause
