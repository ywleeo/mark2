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
set "MARKER=%WORKSPACE%\.mark2-windows-dev-test"

rem The marker prevents /MIR from ever cleaning an unrelated existing directory.
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

echo [1/4] Syncing source to %WORKSPACE%
rem Keep generated folders and platform-specific dependencies out of the shared-drive copy.
robocopy "%SOURCE%" "%WORKSPACE%" /MIR /R:2 /W:1 /NP /NFL /NDL /XJ /COPY:DAT /DCOPY:DAT ^
    /XD node_modules target dist .git .claude artifacts output demo apple_developer fastlane cardstyles ^
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
echo To test Explorer or ContextMenuManager, point it at:
echo   "%CARGO_TARGET_DIR%\debug\mark2-tauri.exe" "%%1"
echo Keep this window open while testing. Rerun this script after source changes.
call npm run tauri:dev -- --no-watch
set "RESULT=%ERRORLEVEL%"
popd
echo Mark2 Dev exited with code %RESULT%.
pause
exit /b %RESULT%

:failed
set "RESULT=%ERRORLEVEL%"
echo [ERROR] Windows test stopped. Exit code: %RESULT%
popd
pause
exit /b %RESULT%
