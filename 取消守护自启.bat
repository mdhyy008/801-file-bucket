@echo off
chcp 936 >nul
title 801 文件桶 - 取消守护自启
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 取消开机自启守护进程
echo ============================================
echo.

schtasks /delete /f /tn "801 File Bucket Watchdog" >nul 2>&1

if errorlevel 1 (
    echo [信息] 未找到开机自启任务，或已取消。
) else (
    echo [成功] 已取消开机自启守护进程。
)

echo.
pause
exit
