@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build Control Panel.ps1"
if errorlevel 1 (
    echo.
    echo The Control Panel build failed. Read the error above, then try again.
    pause
    exit /b 1
)
echo.
pause
endlocal
