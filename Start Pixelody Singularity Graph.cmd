@echo off
start "Pixelody Singularity Graph" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Launch Pixelody.ps1" -SingularityProbe graph
