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

if not exist "%ROOT%node_modules" (
  echo Root dependencies are missing. Run npm run install:all first.
  exit /b 1
)
if not exist "%ROOT%client\node_modules" (
  echo Client dependencies are missing. Run npm run install:all first.
  exit /b 1
)
if not exist "%ROOT%server\node_modules" (
  echo Server dependencies are missing. Run npm run install:all first.
  exit /b 1
)

rem Always rebuild so the production server cannot serve a stale client bundle.
echo Building the production client...
pushd "%ROOT%client"
call npm.cmd run build
if errorlevel 1 (
  popd
  exit /b 1
)
popd

rem Apply idempotent schema migrations before accepting traffic.
pushd "%ROOT%server"
node config\setup.js
if errorlevel 1 (
  popd
  exit /b 1
)
node index.js
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
