@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 사용법: BUILD_WINDOWS.bat        → 누니 편집실 설치 파일
REM         BUILD_WINDOWS.bat gomo   → 고모 편집실 설치 파일
call npm install
if errorlevel 1 pause & exit /b 1
call npm run typecheck
if errorlevel 1 pause & exit /b 1
if "%~1"=="" (call npm run dist:win) else (call npm run dist:win -- %~1)
pause
