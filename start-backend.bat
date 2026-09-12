@echo off
cd /d "%~dp0"
title runad123 - backend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-console.ps1" backend
if errorlevel 1 pause
