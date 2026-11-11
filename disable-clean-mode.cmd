@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not errorlevel 1 goto do_uninstall

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:do_uninstall
echo.
echo   Removing Interception KeyboardFilter driver ...
echo.
"%~dp0native\install-interception.exe" /uninstall
echo.
echo   ExitCode=%errorlevel%
echo.
echo   After this, the remote goes back to typing letters into windows.
echo.
pause
