@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   Push this project to GitHub
echo  ============================================
echo.
echo   BEFORE you run this, do ONE thing in a browser:
echo.
echo     1. Open  https://github.com/new
echo     2. Repository name:  iprc1000
echo     3. Do NOT tick "Add a README" / "Add .gitignore" / "Choose a license"
echo        (the repo must be EMPTY, otherwise the push is rejected)
echo     4. Click  Create repository
echo     5. Copy the URL it shows, it looks like:
echo        https://github.com/YOURNAME/iprc1000.git
echo.
set "URL="
set /p "URL= Paste that URL here and press Enter: "
if "%URL%"=="" goto :no_url

echo.
echo  Remote -> %URL%
git remote remove origin >nul 2>&1
git remote add origin "%URL%"
if errorlevel 1 goto :failed

echo.
echo  Pushing 57 files (about 1.5 MB)...
echo  A browser window may pop up: sign in to GitHub, then come back here.
echo.
git push -u origin main
if errorlevel 1 goto :failed

echo.
echo  ============================================
echo   Done.  %URL%
echo  ============================================
echo.
echo  App icon shown on the repo page comes from ui/icon.png.
echo  Later changes:  git add -A  ^&^&  git commit -m "..."  ^&^&  git push
echo.
pause
exit /b 0

:no_url
echo.
echo  No URL entered, nothing to do.
echo.
pause
exit /b 1

:failed
echo.
echo  Push FAILED.  Most common causes:
echo    - the repo already has a README / license, so it is not empty
echo      (delete the repo and create it again with no files)
echo    - you are not signed in, or you opened the wrong account
echo    - the network is behind a proxy that blocks github.com
echo.
echo  Nothing is lost: the commit is local. Fix the cause and run me again.
echo.
pause
exit /b 1
