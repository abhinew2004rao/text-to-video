@echo off
title Text-To-Video Studio
echo ======================================================
echo           🎬 TEXT-TO-VIDEO WEB STUDIO 
echo ======================================================
echo Starting server...
set PYTHONIOENCODING=utf-8

timeout /t 2 /nobreak >nul
start "" http://localhost:8000

python server.py
pause
