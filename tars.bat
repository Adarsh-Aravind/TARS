@echo off
REM ===========================================================================
REM  TARS launcher (Windows)
REM
REM  Double-click this file, or run `tars.bat --dev` from a terminal.
REM  All real work lives in scripts\launch.py so Windows and macOS stay in sync.
REM  macOS/Linux users: run tars.command instead.
REM ===========================================================================

setlocal
cd /d "%~dp0"

REM Prefer the project venv if it already exists — it has the right packages.
if exist ".venv\Scripts\python.exe" (
    set "TARS_PY=.venv\Scripts\python.exe"
    goto :launch
)

REM Otherwise find a system Python. The `py` launcher is the most reliable on
REM Windows; fall back to python.exe on PATH.
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "TARS_PY=py -3"
    goto :launch
)

where python >nul 2>&1
if %errorlevel% equ 0 (
    set "TARS_PY=python"
    goto :launch
)

echo.
echo   [TARS] ERROR: Python was not found.
echo.
echo   Install Python 3.10 or newer from https://python.org
echo   and be sure to tick "Add Python to PATH" during setup.
echo.
pause
exit /b 1

:launch
%TARS_PY% "scripts\launch.py" %*
set "EXITCODE=%errorlevel%"

REM Only hold the window open on failure, and only when double-clicked.
if %EXITCODE% neq 0 (
    echo.
    echo   [TARS] exited with code %EXITCODE%
    pause
)

endlocal
exit /b %EXITCODE%
