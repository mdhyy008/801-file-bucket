@echo off
chcp 936 >nul
title 801 文件桶 - 设置守护自启
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 设置开机自启守护进程
echo ============================================
echo.

set "TASK_NAME=801 File Bucket Watchdog"

REM 删除旧任务
schtasks /delete /f /tn "%TASK_NAME%" >nul 2>&1

REM 创建开机自启任务（用户登录时启动，管理员权限）
schtasks /create /tn "%TASK_NAME%" ^
    /tr ""%~dp0守护启动.bat"" ^
    /sc onlogon ^
    /rl highest ^
    /f

if errorlevel 1 (
    echo [失败] 创建计划任务失败，请以管理员身份运行。
) else (
    echo [成功] 已设置开机自启守护进程。
    echo.
    echo   下次开机时守护进程会自动启动。
    echo   手动运行「守护启动.bat」可立即启用。
    echo.
    echo   如需取消自启，运行「取消守护自启.bat」。
)

echo.
pause
exit
