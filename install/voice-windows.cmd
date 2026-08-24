@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0voice-windows.ps1"
if errorlevel 1 pause
