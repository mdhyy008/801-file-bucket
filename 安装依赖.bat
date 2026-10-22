@echo off
chcp 936 >nul
setlocal enabledelayedexpansion

set "PIP_MIRROR=https://mirrors.aliyun.com/pypi/simple/"
title 801 文件桶 - 安装依赖
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 安装依赖
echo ============================================
echo.

REM ---- 检查 Python ----
where python >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3 并勾选 Add to PATH。
    pause
    exit /b 1
)

REM ---- 创建虚拟环境 ----
if not exist ".venv\Scripts\python.exe" (
    echo [1/3] 创建虚拟环境 .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败。
        pause
        exit /b 1
    )
)

REM ---- 升级 pip ----
echo [2/3] 升级 pip ...
".venv\Scripts\python.exe" -m pip install --upgrade pip -i "%PIP_MIRROR%" --disable-pip-version-check >nul 2>&1

REM ---- 安装依赖（有离线包优先，否则在线）----
echo [3/3] 安装依赖...
if exist "packages\*.whl" (
    ".venv\Scripts\python.exe" -m pip install --no-index --find-links packages -r requirements.txt --disable-pip-version-check
    if errorlevel 1 (
        echo       离线安装失败，尝试在线安装...
        ".venv\Scripts\python.exe" -m pip install -r requirements.txt -i "%PIP_MIRROR%" --disable-pip-version-check
    )
) else (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt -i "%PIP_MIRROR%" --disable-pip-version-check
)

if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
)

echo.
echo   依赖安装完成！
echo.
pause
exit /b 0
