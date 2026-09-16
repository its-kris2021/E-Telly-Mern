@echo off
echo ====================================
echo  E-Telly Local Server (Offline Mode)
echo ====================================
echo.
echo Starting MongoDB...
net start MongoDB >nul 2>&1
echo.
echo Disabling Public network firewall for mobile hotspot access...
netsh advfirewall set publicprofile state off >nul 2>&1
echo.
echo Starting server... do not close this window.
echo.
cd /d "%~dp0..\server"
set LOCAL_MODE=true
set MONGO_URI=mongodb://localhost:27017/etelly_local
set LOCAL_MONGO_URI=mongodb://localhost:27017/etelly_local
set BARANGAY_NAME=Bagong Nayon
set CLOUD_SYNC_URL=https://e-tellyph-098347559c3c.herokuapp.com/api/sync/receive-batch
set SYNC_SECRET=etelly_sync_9xK2mPqL7vR4nJ8w
node index.js
pause
