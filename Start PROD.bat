@echo off
title Sample PROD (Blue)
color 0B
echo ================================================
echo    Starting Sample PROD Environment (Blue)
echo ================================================
echo.
echo URL: http://localhost:3003
echo.
echo Starting Next.js dev server in new window...
cd ..\sample-prod
echo.
echo Please wait while the server starts...
npm run dev
echo.
echo Server should be running at http://localhost:3003
echo.
pause
echo.
echo Press any key to close this window...