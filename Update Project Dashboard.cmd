@echo off
setlocal
set "UPDATER=%~dp0tools\update-from-github.ps1"
if not exist "%UPDATER%" (
  echo Missing tools\update-from-github.ps1. Extract the complete release ZIP first.
  pause
  exit /b 1
)
echo Project Dashboard - GitHub Release Updater
echo This checks public stable releases, validates the ZIP and updates your existing extension.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%UPDATER%"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Update was not completed. The original installation should remain available.
pause
exit /b %RESULT%
