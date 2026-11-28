@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 사용법: START_WINDOWS.bat        → 누니 편집실
REM         START_WINDOWS.bat gomo   → 고모 편집실
if not exist "node_modules\ffmpeg-static" (
 echo Installing npm dependencies...
 call npm install
 if errorlevel 1 pause & exit /b 1
)
if "%~1"=="" (call npm run dev) else (call npm run dev -- %~1)
if errorlevel 1 pause
