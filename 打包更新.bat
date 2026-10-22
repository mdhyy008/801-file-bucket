@echo off
chcp 936 >nul
title 801 文件桶 - 打包更新
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 打包更新
echo ============================================
echo.

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" 打包更新.py
) else (
    python 打包更新.py
)

echo.
pause
exit
