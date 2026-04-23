@echo off
REM Clawline Native Messaging Host - Windows Installer
REM
REM Usage:
REM   install.bat [EXTENSION_ID]
REM
REM If EXTENSION_ID is not provided, you must edit the manifest manually.

setlocal enabledelayedexpansion

set "HOST_NAME=com.clawline.agent"
set "SCRIPT_DIR=%~dp0"
set "HOST_PATH=%SCRIPT_DIR%launcher.bat"

REM Remove trailing backslash from SCRIPT_DIR if present
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "HOST_PATH=%SCRIPT_DIR%\launcher.bat"

REM Get extension ID from argument or use placeholder
if "%~1"=="" (
    set "EXT_ID=EXTENSION_ID_HERE"
) else (
    set "EXT_ID=%~1"
)

REM Target directory for Chrome Native Messaging Hosts
set "TARGET_DIR=%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts"

echo Installing Clawline Native Messaging Host...
echo   Host name:  %HOST_NAME%
echo   Host path:  %HOST_PATH%
echo   Target dir: %TARGET_DIR%
echo   Extension:  %EXT_ID%
echo.

REM Create target directory if it doesn't exist
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

REM Convert Windows path to JSON-safe format (forward slashes, escaped backslashes)
set "HOST_PATH_JSON=%HOST_PATH:\=\\%"

REM Create the manifest file
(
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "Clawline Browser Agent Hook - Native Messaging Host",
    echo   "path": "%HOST_PATH_JSON%",
    echo   "type": "stdio",
    echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
    echo }
) > "%TARGET_DIR%\%HOST_NAME%.json"

echo.
echo Done! Manifest installed to:
echo   %TARGET_DIR%\%HOST_NAME%.json
echo.

if "%EXT_ID%"=="EXTENSION_ID_HERE" (
    echo WARNING: You need to replace EXTENSION_ID_HERE with your actual extension ID.
    echo   1. Go to chrome://extensions
    echo   2. Find Clawline Browser Agent and copy the ID
    echo   3. Re-run: install.bat YOUR_EXTENSION_ID
    echo   Or edit: %TARGET_DIR%\%HOST_NAME%.json
    echo.
)

pause
