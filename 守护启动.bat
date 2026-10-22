@echo off
chcp 936 >nul
title 801 文件桶 - 守护进程
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 守护进程
echo ============================================
echo.

if exist ".venv\Scripts\python.exe" goto run

python -c "import fastapi,uvicorn,sqlalchemy,bcrypt,jwt,multipart" >nul 2>&1
if not errorlevel 1 goto run

echo [1/2] 当前环境缺少依赖，正在安装...
call "%~dp0安装依赖.bat"
if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
)

:run
echo [2/2] 启动守护进程...
echo.
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" watchdog.py
) else (
    python watchdog.py
)

pause
exit
