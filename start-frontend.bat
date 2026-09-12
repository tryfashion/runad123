@echo off
cd /d "%~dp0"
title runad123 - frontend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-console.ps1" frontend
if errorlevel 1 pause
