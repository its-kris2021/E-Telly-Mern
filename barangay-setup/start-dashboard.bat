@echo off
echo ====================================
echo  E-Telly Web Dashboard (Local Mode)
echo ====================================
echo.
echo Dashboard will open at: http://localhost:5173
echo Also on this network at: http://192.168.1.100:5173
echo.
echo Starting dashboard... do not close this window.
echo.
cd /d "%~dp0..\client"
set VITE_LOCAL_MODE=true
npx vite --host
pause
