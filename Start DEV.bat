@echo off
title Sample DEV (Green)
color 0A
echo ================================================
echo    Starting Sample DEV Environment (Green)
echo ================================================
echo.
echo URL: http://localhost:3002
echo.
echo Starting Next.js dev server in new window...
cd /d "%~dp0sample-dev"
echo.
echo Please wait while the server starts...
npm run dev
echo.
echo Server should be running at http://localhost:3002
echo.
pause
echo.
echo Press any key to close this window...