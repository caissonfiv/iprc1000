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
if not exist "%~dp0tools\vbcable\VBCABLE_Setup_x64.exe" (
  echo.
  echo   [!] Missing tools\vbcable\VBCABLE_Setup_x64.exe
  echo       Re-download it from https://vb-audio.com/Cable/
  echo.
  pause
  exit /b 1
)

echo.
echo   Opening the VB-CABLE installer.
echo.
echo   In the window that appears, click  "Install Driver"
echo   and wait until it says it is finished.
echo.
start "" /wait "%~dp0tools\vbcable\VBCABLE_Setup_x64.exe"

echo.
echo   Installer closed.
echo.
echo   NEXT STEPS:
echo     1. REBOOT this PC.
echo     2. Double-click  mic-live.cmd  and answer the UAC prompt.
echo     3. Run it as:    mic-live.cmd --device CABLE
echo.
echo   Then the remote mic audio goes into the virtual cable,
echo   and you can pick "CABLE Output" as the microphone in your IME.
echo.
pause
