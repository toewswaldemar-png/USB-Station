@echo off
cd /d "%~dp0"

echo [DEV] Go-Server starten (port 58427)...
start "filestation-go dev" cmd /k "cd /d "%~dp0filestation-go" && go run ./cmd/server"

echo [DEV] Vite Dev-Server starten...
start "frontend-react dev" cmd /k "cd /d "%~dp0frontend-react" && npm run dev"

echo.
echo Dev-Stack gestartet:
echo   Backend:  http://localhost:58427
echo   Frontend: http://localhost:5173  (Vite, naechster freier Port falls belegt)
echo.
echo Beide Fenster einzeln schliessen zum Beenden.
