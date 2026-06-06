@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Frontend bauen...
cd frontend-react
call npm install --silent
if errorlevel 1 ( echo FEHLER: npm install fehlgeschlagen. & pause & exit /b 1 )
call npm run build
if errorlevel 1 ( echo FEHLER: Frontend-Build fehlgeschlagen. & pause & exit /b 1 )
cd ..

echo.
echo [2/3] Go-Binaries bauen...
cd filestation-go
go build -o ..\_build\Server\filestation.exe ./cmd/server
if errorlevel 1 ( echo FEHLER: Go-Server-Build fehlgeschlagen. & pause & exit /b 1 )
go build -o ..\_build\Client\fileclient.exe ./cmd/fileclient
if errorlevel 1 ( echo FEHLER: Go-Client-Build fehlgeschlagen. & pause & exit /b 1 )
cd ..

echo.
echo [3/3] Anwendung laeuft:
echo   Lokal:     http://localhost:8000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set ip=%%a
    goto :found
)
:found
set ip=%ip: =%
echo   Netzwerk:  http://%ip%:8000
echo   (fileclient.json in _build\Client\ fuer Kiosk anpassen)
echo.
cd _build\Server
filestation.exe
cd ..\..

echo.
echo === Server beendet ===
pause
