@echo off
setlocal

set "ROOT_DIR=%~dp0"

echo Starting backend on http://0.0.0.0:6008 ...
start "satintel-backend" /D "%ROOT_DIR%backend" cmd /k python -m uvicorn app:app --host 0.0.0.0 --port 6008

echo Starting frontend on http://0.0.0.0:6006 ...
start "satintel-frontend" /D "%ROOT_DIR%" cmd /k npm run dev -- --hostname 0.0.0.0 --port 6006

echo.
echo Backend:  http://localhost:6008
echo Frontend: http://localhost:6006

endlocal
