@echo off
title e-regio Kundencenter Server
rem Projektordner = Ordner dieser .bat (Kundenservice Control Center)
cd /d "%~dp0"
set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"

echo.
echo  e-regio Kundencenter - Server startet...
echo  Frontend: http://127.0.0.1:8124/
echo  API:      http://127.0.0.1:3001/
echo.
echo  Dieses Fenster offen lassen solange du das Tool nutzt.
echo  Zum Beenden: Fenster schliessen oder Strg+C druecken.
echo.

rem .env laden (KEY=VALUE, Kommentarzeilen mit # werden uebersprungen),
rem damit das Backend die Turso-Zugangsdaten bekommt.
if exist "%APPDIR%\.env" (
  for /f "usebackq eol=# tokens=1* delims==" %%a in ("%APPDIR%\.env") do set "%%a=%%b"
) else (
  echo  WARNUNG: .env nicht gefunden - Dashboard zeigt evtl. keine Daten.
)

rem API-Server (Node, Port 3001) im Hintergrund starten.
start "e-regio API" /min node "%APPDIR%\backend\server.js"
timeout /t 2 /nobreak >nul

rem Browser oeffnen (127.0.0.1 ist wichtig - nur dann ruft das Frontend die API auf Port 3001).
start "" "http://127.0.0.1:8124/"

rem Statischen Webserver fuer den Projektordner starten (Port 8124, blockiert dieses Fenster).
"C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin\jwebserver.exe" -b 127.0.0.1 -p 8124 -d "%APPDIR%"
