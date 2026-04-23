@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Сборка SchoolAttestation.exe (нужен Python 3.10+)
echo.

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Не найден py или python. Установите Python с https://www.python.org/
  pause
  exit /b 1
)

%PY% -m pip install -U -r requirements-build.txt
if %ERRORLEVEL% neq 0 exit /b 1

%PY% -m PyInstaller --clean --noconfirm attestation.spec
if %ERRORLEVEL% neq 0 (
  echo Сборка не удалась.
  exit /b 1
)
echo.
echo  Готово: dist\SchoolAttestation.exe
echo  Скопируйте EXE на ПК завуча — Python на том ПК не нужен.
echo  Запуск: двойной щелчок, консоль с адресами, остановка: Ctrl+C
echo.
pause
