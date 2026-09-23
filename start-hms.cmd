@echo off
setlocal
set "NODE_ENV=production"
if "%PORT%"=="" set "PORT=5000"

rem Run from the repository location, regardless of where this file is invoked.
cd /d "%~dp0server" || exit /b 1

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 18 or newer and try again.
  exit /b 1
)

node index.js
exit /b %ERRORLEVEL%
