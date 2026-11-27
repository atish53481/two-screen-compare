@echo off
rem Double-click to (re)start QA Vision. The previous QA Vision window and any server already running are closed first.
rem In this window: press R to restart the server, Q to quit.
title QA Vision Master
color 0A
echo ================================================
echo    QA VISION MASTER
echo ================================================
echo.
echo   In this window:  R = restart server    Q = quit
echo.
echo Instructions:
echo 1. Go to the "Profiles" tab
echo 2. Select or create a profile with your URLs
echo 3. On "Live Comparison", click Launch
echo 4. Before Start Comparison you can use both the DEV and PROD screens
echo 5. Click Start Comparison - DEV becomes master and PROD mirrors it
echo.
cd /d "%~dp0qa-vision"
node scripts\supervise.js
echo.
echo QA Vision has stopped. You can close this window.
pause
