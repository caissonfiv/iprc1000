@echo off
rem Emergency stop: kill the mapper AND its child processes, so all input goes back to Windows.
rem /T matters: leftover GPU/renderer children keep the single-instance lock, and then the
rem next double-click silently does nothing.
title IPRC1000 - emergency stop
taskkill /IM IPRC1000.exe /F /T >nul 2>nul
taskkill /IM electron.exe /F /T >nul 2>nul
echo.
echo Mapper stopped. Keyboard and mouse should be back to normal.
echo If they are still weird, unplug and replug the USB receiver,
echo or run disable-clean-mode.cmd as administrator and reboot.
echo.
timeout /t 3 >nul
