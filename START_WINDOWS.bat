@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron" (
 echo Installing npm dependencies...
 call npm install
 if errorlevel 1 pause & exit /b 1
)
call npm run dev
if errorlevel 1 pause
