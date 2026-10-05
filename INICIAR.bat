@echo off
cd /d "%~dp0"
echo Iniciando servidor local...
echo Abre: http://localhost:3000/planes.html
echo.
echo Presiona Ctrl+C para detener
echo.
npx serve . -l 3000
