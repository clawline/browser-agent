@echo off
REM View Clawline Native Host Logs (Windows)
REM This script helps you view the error log file

setlocal

set "DIR=%~dp0"
set "ERROR_LOG=%DIR%error.log"

echo Clawline Native Host Log Viewer
echo ================================
echo.
echo Log file location: %ERROR_LOG%
echo.

if not exist "%ERROR_LOG%" (
    echo No log file found. The native host hasn't logged any errors yet.
    echo.
    echo Note: The native host logs to stderr and to error.log
    echo   - stderr may be visible in Chrome's native host output
    echo   - error.log persists errors for debugging
    echo.
    pause
    exit /b 0
)

echo Current log contents:
echo --------------------
type "%ERROR_LOG%"
echo --------------------
echo.
echo Press any key to refresh, or Ctrl+C to exit...
pause >nul
cls
goto :eof
