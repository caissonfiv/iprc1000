@echo off
rem IPRC1000 remote mapper - launch the desktop app
cd /d "%~dp0"

if exist "dist\IPRC1000-win32-x64\IPRC1000.exe" (
    start "" "dist\IPRC1000-win32-x64\IPRC1000.exe"
    exit /b 0
)

if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" "%~dp0"
    exit /b 0
)

echo [ERROR] Desktop app not found.
echo Run these once in this folder:
echo     npm install
echo     npm run dist
pause
