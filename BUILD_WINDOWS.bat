@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm install
if errorlevel 1 pause & exit /b 1
call npm run typecheck
if errorlevel 1 pause & exit /b 1
call npm run dist:win
pause
