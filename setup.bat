@echo off
title EXAMCORE setup
cd /d "%~dp0"
node --version >/dev/null 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer.
  echo Install the LTS version from https://nodejs.org, then run setup.bat again.
  echo.
  pause
  exit /b 1
)
node scripts\portable\setup.mjs
echo.
pause
