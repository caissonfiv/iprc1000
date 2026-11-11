@echo off
chcp 65001 >nul
title IPRC1000 Mic Live
setlocal
cd /d "%~dp0"

fsutil dirty query %SystemDrive% >nul 2>&1
if not errorlevel 1 goto run

echo.
echo   Administrator rights are required (ETW needs it). A UAC prompt will appear.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
set "PY="
for /d %%i in ("%USERPROFILE%\.workbuddy\binaries\python\versions\*") do if exist "%%i\python.exe" set "PY=%%i\python.exe"
if not defined PY where python >nul 2>nul
if not defined PY if not errorlevel 1 set "PY=python"
if not defined PY goto nopy

if /i "%~1"=="list" (
  "%PY%" scripts\mic_live.py --list
  echo.
  pause
  exit /b 0
)

echo Starting audio bridge ...
echo.
start "" /b "%~dp0tools\etw_consumer.exe" --udp 127.0.0.1:31680 --seconds 86400 --quiet
timeout /t 1 >nul

"%PY%" scripts\mic_live.py %*
set RC=%errorlevel%

taskkill /IM etw_consumer.exe /F >nul 2>&1
echo.
echo Bridge stopped.
pause
exit /b %RC%

:nopy
echo.
echo Python 3 not found. Install it, or check that "python" is on PATH.
echo.
pause
exit /b 1
