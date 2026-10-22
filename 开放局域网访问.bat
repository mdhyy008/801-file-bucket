@echo off
chcp 936 >nul
title 801 文件桶 - 开放端口
cd /d "%~dp0"

echo ============================================
echo   801 文件桶 - 开放防火墙端口 51001
echo ============================================
echo.
echo   Windows 防火墙可能会拦截局域网访问，
echo   下面添加一条规则放行端口 51001。
echo.

REM 删除旧规则
netsh advfirewall firewall delete rule name="801 File Bucket 51001" >nul 2>&1

REM 添加新规则
netsh advfirewall firewall add rule ^
    name="801 File Bucket 51001" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=51001 ^
    profile=any ^
    description="允许 801 文件桶从网络访问端口 51001"

if errorlevel 1 (
    echo [失败] 添加防火墙规则失败，请以管理员身份运行。
) else (
    echo [成功] 端口 51001 的防火墙规则已开放。
    echo.
    echo   现在局域网内其他电脑可以访问：
    echo   本机: http://127.0.0.1:51001
    echo   局域网: http://^<你的IP^>:51001
    echo.
    echo   如需关闭，可在 Windows 防火墙高级设置中
    echo   找到 "801 File Bucket 51001" 规则并禁用。
)

echo.
pause
exit
