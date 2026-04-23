@echo off
REM Clawline Native Host Launcher (Windows)
REM Chrome doesn't inherit user's PATH, so we find node ourselves.

setlocal

REM Get the directory where this script is located
set "DIR=%~dp0"

REM Try to find Node.js in common locations
where node >nul 2>nul
if %errorlevel% equ 0 (
    node "%DIR%index.js"
    exit /b
)

REM Check Program Files
if exist "C:\Program Files\nodejs\node.exe" (
    "C:\Program Files\nodejs\node.exe" "%DIR%index.js"
    exit /b
)

REM Check Program Files (x86)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    "C:\Program Files (x86)\nodejs\node.exe" "%DIR%index.js"
    exit /b
)

REM Check AppData Local
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    "%LOCALAPPDATA%\Programs\nodejs\node.exe" "%DIR%index.js"
    exit /b
)

REM Check nvm for Windows
if exist "%NVM_HOME%\node.exe" (
    "%NVM_HOME%\node.exe" "%DIR%index.js"
    exit /b
)

if exist "%APPDATA%\nvm\node.exe" (
    "%APPDATA%\nvm\node.exe" "%DIR%index.js"
    exit /b
)

REM If we reach here, node was not found
echo Error: Node.js not found. Please install Node.js from https://nodejs.org/ 1>&2
exit /b 1
