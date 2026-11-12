@echo off
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=
rem IPRC1000 remote mapper - launch the desktop app
cd /d "%~dp0"

if exist "dist\driver-ui\IPRC1000-Driver-win32-x64\IPRC1000-Driver.exe" (
    start "" "dist\driver-ui\IPRC1000-Driver-win32-x64\IPRC1000-Driver.exe"
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
