@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 801 文件桶 - 检查项目完整性
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 检查项目完整性
echo ============================================
echo.

set "pass=0"
set "fail=0"

REM ---- 1. 文件清单检查 ----
echo [1/6] 检查文件...
set needed=main.py requirements.txt watchdog.py static\index.html static\index.js static\app.js static\style.css static\theme.js static\settings.html static\settings.js static\dashboard.html static\dashboard.js static\admin.html static\admin.js static\login.html static\login.js static\404.html static\favicon.svg static\vendor\bootstrap.min.css static\vendor\bootstrap.bundle.min.js static\vendor\bootstrap-icons.min.css static\vendor\qrcode.min.js
for %%f in (%needed%) do (
    if exist "%%f" (
        set /a pass+=1
    ) else (
        echo       [缺失] %%f
        set /a fail+=1
    )
)

REM ---- 2. 检查离线包 ----
echo [2/6] 检查离线包...
set whlCount=0
for %%f in (packages\*.whl) do set /a whlCount+=1
if !whlCount! gtr 0 (
    echo       发现 !whlCount! 个离线安装包
    set /a pass+=1
) else (
    echo       未提供 packages 离线包，安装依赖时走在线源
)

REM ---- 3. Python 检查 ----
echo [3/6] 检查 Python 环境...
set "pydone=0"
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
where python >nul 2>&1
if errorlevel 1 (
    if not exist ".venv\Scripts\python.exe" (
        echo       [缺失] 未检测到 python，请安装 Python 3 并加入 PATH
        set /a fail+=1
    ) else (
        echo       检测到虚拟环境 !PY!
        set /a pass+=1
        set "pydone=1"
    )
) else (
    for /f "delims=" %%v in ('"%PY%" --version 2^>^&1') do set "pyver=%%v"
    echo       检测到 !pyver!
    set /a pass+=1
    set "pydone=1"
)

REM ---- 4. 检查已装依赖 ----
echo [4/6] 检查依赖是否可导入...
if "!pydone!"=="1" (
    set "impres=?"
    for /f "delims=" %%m in ('"%PY%" -c "import fastapi,uvicorn,sqlalchemy,bcrypt,jwt,multipart;print('ok')" 2^>^&1') do set "impres=%%m"
    if "!impres!"=="ok" (
        echo       所有依赖已成功安装
        set /a pass+=1
    ) else (
        echo       [缺失] 依赖未安装或导入失败
        echo              请运行 安装依赖.bat
        set /a fail+=1
    )
)

REM ---- 5. 端口占用 ----
echo [5/6] 检查 51001 端口...
set "portpid="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":51001 " ^| findstr "LISTENING"') do set "portpid=%%p"
if defined portpid (
    echo       [提示] 端口 51001 已被 PID=!portpid! 占用，通常是本程序已在运行，可忽略。
) else (
    echo       端口 51001 空闲
    set /a pass+=1
)

REM ---- 6. 数据目录 ----
echo [6/6] 检查数据目录...
if exist "data" (
    echo       数据目录存在
    set /a pass+=1
) else (
    echo       数据目录尚未创建，首次启动会自动生成
    set /a pass+=1
)

echo.
echo ============================================
if !fail! gtr 0 (
    echo   检查完成：!pass! 项通过，!fail! 项异常
    echo   请根据上方 [缺失] 提示处理，或运行 安装依赖.bat。
    echo ============================================
    echo.
    if defined portpid (
        echo   提示：端口被占用通常不影响使用，直接启动即可。
    )
    pause
    exit /b 1
) else (
    echo   检查完成：全部 !pass! 项通过，项目完整。
    echo ============================================
    echo.
    pause
    exit /b 0
)
