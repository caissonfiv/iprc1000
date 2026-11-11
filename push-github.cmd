@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo   Commit and push to GitHub
echo  ============================================
echo.

git remote get-url origin >nul 2>&1
if errorlevel 1 goto :no_remote

echo  Remote:
git remote get-url origin
echo.

git add -A
git diff --cached --quiet
if not errorlevel 1 goto :nothing

echo  Files to commit:
echo  --------------------------------------------
git status --short
echo  --------------------------------------------
echo.

set "MSG="
set /p "MSG= Commit message (Enter = 'update'): "
if "%MSG%"=="" set "MSG=update"

git commit -q -m "%MSG%"
if errorlevel 1 goto :failed

echo.
echo  Pushing...
git push
if errorlevel 1 goto :failed

echo.
echo  ============================================
echo   Done.  Pushed to origin/main
echo  ============================================
echo.
pause
exit /b 0

:nothing
echo  Nothing changed since the last commit.
echo.
git status -sb
echo.
pause
exit /b 0

:no_remote
echo  No remote configured. Run this once:
echo.
echo     git remote add origin git@github.com:YOURNAME/iprc1000.git
echo     git push -u origin main
echo.
pause
exit /b 1

:failed
echo.
echo  FAILED.  Nothing is lost, the commit stays local.
echo  If it is an SSH problem, test it with:  ssh -T git@github.com
echo.
pause
exit /b 1
