@echo off
title EXAMCORE
cd /d "%~dp0"
node --version >/dev/null 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run setup.bat first.
  pause
  exit /b 1
)
node scripts\portable\start.mjs
if errorlevel 1 pause
