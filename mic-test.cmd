@echo off
chcp 65001 >nul
title IPRC1000 Mic Test
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
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE for /d %%i in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do if exist "%%i\node.exe" set "NODE_EXE=%%i\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE goto nonode

"%NODE_EXE%" scripts\capture_mic.js --seconds 20
echo.
pause
exit /b 0

:nonode
echo Node.js not found.
pause
exit /b 1
