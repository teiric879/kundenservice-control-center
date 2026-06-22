@echo off
title e-regio Kundencenter Server
echo.
echo  e-regio Kundencenter - Server startet...
echo  Frontend: http://127.0.0.1:8124/
echo  API:      http://127.0.0.1:3001/
echo.
echo  Dieses Fenster offen lassen solange du das Tool nutzt.
echo  Zum Beenden: Fenster schliessen oder Strg+C druecken.
echo.

start "e-regio API" /min node "C:\Users\marck\Documents\Claude Code\backend\server.js"
timeout /t 1 /nobreak >nul

start "" "http://127.0.0.1:8124/"
"C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin\jwebserver.exe" -b 127.0.0.1 -p 8124 -d "C:\Users\marck\Documents\Claude Code"
