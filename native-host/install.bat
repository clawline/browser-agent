@echo off
REM Clawline Native Messaging Host - Windows Installer
REM
REM On Windows, Chrome locates native messaging hosts via the Windows Registry,
REM NOT by scanning the NativeMessagingHosts directory (which is the macOS/Linux
REM behavior). This script writes the manifest to disk AND registers it in
REM HKCU so Chrome / Edge / Brave can find it.
REM
REM Usage:
REM   install.bat [EXTENSION_ID]
REM
REM If EXTENSION_ID is not provided, you must edit the manifest manually
REM and re-run this script.

setlocal enabledelayedexpansion

set "HOST_NAME=com.clawline.agent"
set "SCRIPT_DIR=%~dp0"

REM Strip trailing backslash from SCRIPT_DIR
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "HOST_PATH=%SCRIPT_DIR%\launcher.bat"
set "MANIFEST_PATH=%SCRIPT_DIR%\%HOST_NAME%.json"

REM Get extension ID from argument or use placeholder
if "%~1"=="" (
    set "EXT_ID=EXTENSION_ID_HERE"
) else (
    set "EXT_ID=%~1"
)

echo Installing Clawline Native Messaging Host...
echo   Host name:     %HOST_NAME%
echo   Launcher:      %HOST_PATH%
echo   Manifest:      %MANIFEST_PATH%
echo   Extension ID:  %EXT_ID%
echo.

REM Sanity check: launcher must exist
if not exist "%HOST_PATH%" (
    echo ERROR: launcher.bat not found at %HOST_PATH%
    echo Make sure you are running install.bat from the native-host directory.
    pause
    exit /b 1
)

REM Convert backslashes to escaped backslashes for JSON
set "HOST_PATH_JSON=%HOST_PATH:\=\\%"

REM Write the manifest next to the launcher (single source of truth)
(
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "Clawline Browser Agent Hook - Native Messaging Host",
    echo   "path": "%HOST_PATH_JSON%",
    echo   "type": "stdio",
    echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
    echo }
) > "%MANIFEST_PATH%"

echo Wrote manifest: %MANIFEST_PATH%
echo.

REM Register the manifest path in the Windows Registry for each supported browser.
REM Chrome reads HKCU\Software\Google\Chrome\NativeMessagingHosts\^<name^>
REM Edge   reads HKCU\Software\Microsoft\Edge\NativeMessagingHosts\^<name^>
REM Brave  reads HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\^<name^>
REM The default value of the key must be the absolute path to the manifest .json file.

set "REG_FAILED=0"

call :RegisterHost "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" "Chrome"
call :RegisterHost "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" "Edge"
call :RegisterHost "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\%HOST_NAME%" "Brave"
call :RegisterHost "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" "Chromium"

echo.
if "%REG_FAILED%"=="1" (
    echo WARNING: One or more registry writes failed. See messages above.
) else (
    echo Registry entries created successfully.
)
echo.

if "%EXT_ID%"=="EXTENSION_ID_HERE" (
    echo WARNING: You did not pass an extension ID. Chrome will reject the
    echo connection until you re-run this script with the real ID:
    echo   1. Open chrome://extensions
    echo   2. Enable Developer mode and copy the Clawline extension ID
    echo   3. Re-run: install.bat YOUR_EXTENSION_ID
    echo.
)

echo Done. Restart your browser (fully quit, then reopen) so it picks up the
echo new native messaging host registration.
echo.
pause
exit /b 0

:RegisterHost
REM %~1 = full registry key path
REM %~2 = friendly browser name (for logging)
reg add "%~1" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
if errorlevel 1 (
    echo   [!] Failed to register for %~2 at %~1
    set "REG_FAILED=1"
) else (
    echo   [+] Registered for %~2
)
exit /b 0
