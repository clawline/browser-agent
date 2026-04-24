@echo off
REM Clawline Native Messaging Host - Windows Uninstaller
REM Removes registry entries created by install.bat.

setlocal

set "HOST_NAME=com.clawline.agent"

echo Removing Clawline Native Messaging Host registry entries...
echo.

call :UnregisterHost "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" "Chrome"
call :UnregisterHost "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" "Edge"
call :UnregisterHost "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\%HOST_NAME%" "Brave"
call :UnregisterHost "HKCU\Software\Chromium\NativeMessagingHosts\%HOST_NAME%" "Chromium"

echo.
echo Done. The manifest .json file on disk was left in place; delete the
echo native-host folder manually if you want to remove it completely.
echo.
pause
exit /b 0

:UnregisterHost
reg query "%~1" >nul 2>&1
if errorlevel 1 (
    echo   [-] Not present for %~2
) else (
    reg delete "%~1" /f >nul 2>&1
    if errorlevel 1 (
        echo   [!] Failed to remove registry entry for %~2
    ) else (
        echo   [+] Removed for %~2
    )
)
exit /b 0
