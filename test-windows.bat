@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Build and run a Windows copy of Mark2 without installing dependencies on a shared drive.
rem The trailing dot also handles a project mounted directly as Z:\.
set "SOURCE=%~dp0."
if not defined LOCALAPPDATA (
    echo [ERROR] LOCALAPPDATA is not available.
    pause
    exit /b 1
)
if not exist "%SOURCE%\package-lock.json" (
    echo [ERROR] Run this script from the Mark2 project directory.
    pause
    exit /b 1
)

set "WORK_ROOT=%LOCALAPPDATA%\Mark2\windows-dev-test"
set "WORKSPACE=%WORK_ROOT%\source"
set "CARGO_TARGET_DIR=%WORK_ROOT%\cargo-target"
set "MARKER=%WORK_ROOT%\.mark2-windows-dev-test"
set "SYNC_MARKER=%WORK_ROOT%\sync-token"

rem The marker prevents /MIR from ever cleaning an unrelated existing directory.
rem Accept the marker written by the first version of this script inside the workspace.
if exist "%WORKSPACE%\.mark2-windows-dev-test" if not exist "%MARKER%" type nul > "%MARKER%"
if exist "%WORKSPACE%\" if not exist "%MARKER%" (
    echo [ERROR] %WORKSPACE% already exists and is not owned by this script.
    pause
    exit /b 1
)
if not exist "%WORKSPACE%\" mkdir "%WORKSPACE%"
if not exist "%WORKSPACE%\" (
    echo [ERROR] Could not create the local test directory.
    pause
    exit /b 1
)
if not exist "%MARKER%" type nul > "%MARKER%"
if exist "%SYNC_MARKER%" del /q "%SYNC_MARKER%"

echo [1/4] Syncing source to %WORKSPACE%
rem Keep generated folders and platform-specific dependencies out of the shared-drive copy.
robocopy "%SOURCE%" "%WORKSPACE%" /MIR /R:2 /W:1 /NP /NFL /NDL /XJ /COPY:DAT /DCOPY:DAT ^
    /XD node_modules target dist gen .git .claude artifacts output demo apple_developer fastlane cardstyles ^
    /XF .DS_Store netstat npm
set "COPY_RESULT=%ERRORLEVEL%"
if %COPY_RESULT% GEQ 8 (
    echo [ERROR] Source sync failed. Robocopy exit code: %COPY_RESULT%
    pause
    exit /b %COPY_RESULT%
)
type nul > "%MARKER%"

pushd "%WORKSPACE%"
if errorlevel 1 (
    echo [ERROR] Could not enter the local test directory.
    pause
    exit /b 1
)

echo [2/4] Installing Windows dependencies locally
call npm ci
if errorlevel 1 goto :failed

echo [3/4] Running tests and building the frontend
call npm test
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed

echo [4/4] Starting Mark2 Dev
rem Poll the shared source; Vite and Tauri watch only the local copy.
set "SYNC_TOKEN=%RANDOM%-%RANDOM%"
> "%SYNC_MARKER%" echo %SYNC_TOKEN%
start "" /min "%WORKSPACE%\test-windows-sync.bat" "%SOURCE%" "%WORKSPACE%" "%SYNC_MARKER%" "%SYNC_TOKEN%" "%WORK_ROOT%\sync-errors.log"
if errorlevel 1 goto :failed
echo To test Explorer or ContextMenuManager, point it at:
echo   "%CARGO_TARGET_DIR%\debug\mark2-tauri.exe" "%%1"
echo Changes on the shared drive will sync automatically. Keep this window open.
call npm run tauri:dev
set "RESULT=%ERRORLEVEL%"
if exist "%SYNC_MARKER%" del /q "%SYNC_MARKER%"
popd
echo Mark2 Dev exited with code %RESULT%.
pause
exit /b %RESULT%

:failed
set "RESULT=%ERRORLEVEL%"
if exist "%SYNC_MARKER%" del /q "%SYNC_MARKER%"
echo [ERROR] Windows test stopped. Exit code: %RESULT%
popd
pause
exit /b %RESULT%
