@echo off
setlocal enabledelayedexpansion
title Impulsor Hub

REM Double-click launcher for Impulsor Agent (M2.6 SPEC section C).
REM No commands to type: this window shows progress text and closes
REM itself into the background once the Agent is up. Requires Python
REM 3.11+ already installed (see M2_6_REPORT.md "Windows artifact" for
REM why this is not yet a single self-contained .exe).

cd /d "%~dp0\.."

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo No se encontro Python en este equipo.
    echo Impulsor Hub necesita Python 3.11 o superior instalado.
    echo Descargalo desde https://www.python.org/downloads/ y vuelve a intentar.
    echo.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Preparando Impulsor Hub por primera vez, esto puede tardar unos minutos...
    python -m venv .venv
)

call ".venv\Scripts\activate.bat"

if not exist ".venv\.deps_installed" (
    echo Instalando dependencias...
    pip install -q -r requirements.txt
    if errorlevel 1 (
        echo.
        echo No se pudieron instalar las dependencias. Revisa tu conexion a internet.
        pause
        exit /b 1
    )
    echo ok > ".venv\.deps_installed"
)

if not exist "ui\dist\index.html" (
    echo.
    echo No se encontro la interfaz compilada ^(ui\dist^). Esta copia de Impulsor
    echo Hub deberia incluirla ya construida; si ves este mensaje, construyela
    echo primero con Node.js instalado: cd ui ^&^& npm install ^&^& npm run build
    echo.
    pause
    exit /b 1
)

echo.
echo Iniciando Impulsor Agent...
start "" http://127.0.0.1:8000/
uvicorn app.api.main:app --host 127.0.0.1 --port 8000
