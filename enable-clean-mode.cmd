@echo off
setlocal
cd /d "%~dp0"

fsutil dirty query %SystemDrive% >nul 2>&1
if not errorlevel 1 goto do_install

echo.
echo   Need administrator rights.
echo   A UAC prompt will pop up - please click "Yes".
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:do_install
echo.
echo   Installing Interception KeyboardFilter driver ...
echo.
"%~dp0native\install-interception.exe" /install
set RC=%errorlevel%
echo.
if "%RC%"=="0" goto ok

echo   [WARN] Installer returned code %RC%
echo.
echo   This installer is 32-bit and can fail to resolve the system directory
echo   on this machine, leaving the services with an empty ImagePath.
echo   Running the registry repair now ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-interception.ps1"
goto done

:ok
echo   [OK] Installer finished.
echo.
echo   Verifying the service registration ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-interception.ps1"

:done
echo.
echo   ------------------------------------------------------------
echo   This is an upper filter driver: it attaches to the keyboard
echo   device stack, so a REBOOT is needed before it takes effect.
echo.
echo   After rebooting, run run.cmd and look for the line:
echo        > [takeover mode] enabled
echo   ------------------------------------------------------------
echo.
pause
