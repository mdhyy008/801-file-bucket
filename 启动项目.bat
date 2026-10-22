@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 801 文件桶 - 一键启动
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 一键启动
echo ============================================
echo.

REM ---- 检查 Python ----
where python >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3 并勾选 Add to PATH。
    pause
    exit /b 1
)

REM ---- 选择解释器 ----
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

REM ---- 若依赖不可用，则先安装 ----
if not exist ".venv\Scripts\python.exe" (
    "%PY%" -c "import fastapi,uvicorn,sqlalchemy,bcrypt,jwt,multipart" >nul 2>&1
    if errorlevel 1 (
        echo [1/4] 首次运行，正在创建虚拟环境并安装依赖...
        call "%~dp0安装依赖.bat"
        if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
    )
)

REM ---- 关闭占用 51001 端口的旧进程 ----
echo [2/4] 检查 51001 端口占用...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":51001 " ^| findstr "LISTENING"') do (
    echo       发现旧进程 PID=%%p，正在终止...
    taskkill /F /PID %%p >nul 2>&1
)

REM ---- 启动服务（独立窗口，关闭该窗口即停止服务）----
echo [3/4] 启动 FastAPI 服务...
start "801 文件桶 - 服务" cmd /k "%PY% main.py"

REM ---- 等待端口就绪 ----
echo       等待服务启动...
set /a tries=0
:waitloop
set portready=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":51001 " ^| findstr "LISTENING"') do set portready=1
if "!portready!"=="0" (
    set /a tries+=1
    if !tries! geq 60 (
        echo [错误] 服务启动超时，请查看服务窗口的日志。
        pause
        exit /b 1
    )
    ping -n 2 127.0.0.1 >nul
    goto waitloop
)

REM ---- 获取本机 IPv4 ----
echo [4/4] 获取访问地址...
set "lanip="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "t=%%a"
    set "t=!t: =!"
    if not defined lanip if not "!t!"=="" set "lanip=!t!"
)

echo.
echo ============================================
echo   启动成功！
echo.
if defined lanip (
    echo   局域网访问: http://!lanip!:51001
)
echo   本机访问:   http://127.0.0.1:51001
echo ============================================
echo.

REM ---- 自动打开浏览器 ----
start http://127.0.0.1:51001

pause
exit
