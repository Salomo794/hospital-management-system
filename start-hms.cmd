@echo off
setlocal
set "NODE_ENV=production"
if "%PORT%"=="" set "PORT=5000"
set "ROOT=%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 22 or newer and try again.
  exit /b 1
)
for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  echo Node.js %NODE_MAJOR% is too old. Install Node.js 22 or newer and try again.
  exit /b 1
)

rem A clean checkout has no ignored client/dist directory. Build it once so
rem the production server can serve the Vue application.
if not exist "%ROOT%client\dist\index.html" (
  echo Client build not found. Building the production client...
  pushd "%ROOT%client"
  call npm.cmd run build
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

rem Run from the repository location, regardless of where this file is invoked.
cd /d "%ROOT%server" || exit /b 1
node index.js
exit /b %ERRORLEVEL%
