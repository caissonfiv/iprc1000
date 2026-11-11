@echo off
setlocal
cd /d "%~dp0"

fsutil dirty query %SystemDrive% >nul 2>&1
if not errorlevel 1 goto run

echo.
echo   Administrator rights are required. A UAC prompt will appear.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\mic-setup.ps1"
echo.
pause
