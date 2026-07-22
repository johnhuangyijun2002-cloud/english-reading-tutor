@echo off
cd /d "%~dp0"
call venv\Scripts\activate
start "" http://127.0.0.1:8000
uvicorn main:app --reload --port 8000
pause
