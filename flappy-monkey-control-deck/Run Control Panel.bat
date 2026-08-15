@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 flappy_monkey_control_deck.py
    goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
    python flappy_monkey_control_deck.py
    goto :done
)

echo.
echo Python 3.11 or newer is needed to run Flappy Monkey Control Panel.
echo Install Python from https://www.python.org/downloads/windows/
echo During setup, check "Add python.exe to PATH", then run this file again.
echo.
pause

:done
endlocal
