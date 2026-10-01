@echo off
start "Pixelody Singularity Proxy" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Launch Pixelody.ps1" -SingularityProbe proxy
