@echo off
title QA Vision Master
color 0A
echo ================================================
echo    QA VISION MASTER - ONE CLICK START
echo ================================================
echo.
echo Starting QA Vision Master with Real Action Mirroring...
echo.
echo The browser should open automatically at http://localhost:3001
echo.
echo Instructions:
echo 1. Go to the "Profiles" tab
echo 2. Select or create a profile with your URLs
echo 3. Click "LAUNCH ENVIRONMENTS"
echo 4. Click "START SESSION"
echo 5. Perform actions in the DEV window - they will be mirrored to PROD automatically.
echo.
echo Keep this window open while using the app.
echo.
cd qa-vision
start http://localhost:3001
echo.
echo If browser did not open automatically, please open this link manually:
echo http://localhost:3001
echo.
echo Server is starting...
npm run start:real
pause