@echo off
setlocal

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8765"
set "URL=http://%HOST%:%PORT%"

title MBE Tracker
echo MBE Tracker
echo Project: %CD%
echo URL:     %URL%
echo.
echo Keep this window open while using the app.
echo Close this window or press Ctrl+C here to stop the service.
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1; Start-Process '%URL%'"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%CD%\server.py" serve --host "%HOST%" --port "%PORT%"
) else (
  python "%CD%\server.py" serve --host "%HOST%" --port "%PORT%"
)

echo.
echo The local service has stopped.
pause
