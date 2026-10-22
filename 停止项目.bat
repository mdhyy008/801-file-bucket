@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 801 文件桶 - 停止服务
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 停止服务
echo ============================================
echo.

REM ---- 先停守护进程，避免服务被杀后又被拉起 ----
echo 停止守护进程...
for /f "delims=" %%p in ('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*watchdog.py*' } | Select-Object -ExpandProperty ProcessId"') do (
    taskkill /F /T /PID %%p >nul 2>&1
)
taskkill /F /FI "WINDOWTITLE eq 801 文件桶 - 守护进程*" >nul 2>&1

REM ---- 关闭占用 51001 端口的服务进程 ----
echo 停止服务进程...
set "pid="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":51001 " ^| findstr "LISTENING"') do set "pid=%%p"

if defined pid (
    echo       发现服务进程 PID=!pid!，正在终止...
    taskkill /F /PID !pid! >nul 2>&1
    ping -n 2 127.0.0.1 >nul
)

taskkill /F /FI "WINDOWTITLE eq 801 文件桶 - 服务*" >nul 2>&1

set "pid2="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":51001 " ^| findstr "LISTENING"') do set "pid2=%%p"
if defined pid2 (
    echo [错误] 服务未能完全停止，进程仍占用 51001 端口。
) else (
    echo 服务已停止。
)

echo.
echo ============================================
echo   801 文件桶 已停止
echo ============================================
echo.
pause
exit
