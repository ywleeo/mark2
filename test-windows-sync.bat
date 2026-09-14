@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Poll shared source changes into the local development copy while Mark2 Dev runs.
set "SOURCE=%~1"
set "WORKSPACE=%~2"
set "SYNC_MARKER=%~3"
set "SYNC_TOKEN=%~4"
set "SYNC_LOG=%~5"

:sync
if not exist "%SYNC_MARKER%" exit /b 0
set "ACTIVE_TOKEN="
< "%SYNC_MARKER%" set /p "ACTIVE_TOKEN="
if not "%ACTIVE_TOKEN%"=="%SYNC_TOKEN%" exit /b 0

rem Keep npm, Cargo, Vite and generated schemas local; copy only changed source files.
robocopy "%SOURCE%" "%WORKSPACE%" /MIR /R:1 /W:1 /NP /NFL /NDL /XJ /COPY:DAT /DCOPY:DAT ^
    /XD node_modules target dist gen .git .claude artifacts output demo apple_developer fastlane cardstyles ^
    /XF .DS_Store netstat npm >nul 2>&1
if errorlevel 8 echo [%DATE% %TIME%] Shared source sync failed.>>"%SYNC_LOG%"

timeout /t 2 /nobreak >nul
goto :sync
