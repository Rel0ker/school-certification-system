@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Build SchoolAttestation.exe  -  Python 3.10+ required
echo.

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
  py -3 -m pip install -U -r requirements-build.txt
  if errorlevel 1 exit /b 1
  py -3 -m PyInstaller --clean --noconfirm attestation.spec
  if errorlevel 1 (
    echo Build failed.
    exit /b 1
  )
  goto ok
)

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
  python -m pip install -U -r requirements-build.txt
  if errorlevel 1 exit /b 1
  python -m PyInstaller --clean --noconfirm attestation.spec
  if errorlevel 1 (
    echo Build failed.
    exit /b 1
  )
  goto ok
)

echo Python not found. Install from https://www.python.org/ ^& run again.
exit /b 1

:ok
echo.
echo  OK:  dist\SchoolAttestation.exe
echo  Copy the EXE to the admin PC. No Python required there. Stop server: Ctrl+C
echo.
pause
