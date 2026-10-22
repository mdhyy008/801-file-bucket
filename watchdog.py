# -*- coding: utf-8 -*-
"""
801 文件桶 - 守护进程
监视 main.py 运行状态，崩溃或退出后自动重启。
"""
import subprocess
import sys
import time
import os
import re
import json
import socket
import shutil
import platform
import threading
from collections import deque
from datetime import datetime, timedelta, timezone

CN_TZ = timezone(timedelta(hours=8))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = BASE_DIR
VENV_PYTHON = os.path.join(BASE_DIR, ".venv", "Scripts", "python.exe")
PYTHON = VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable
SERVER_SCRIPT = os.path.join(SERVER_DIR, "main.py")
SERVER_LOG = os.path.join(SERVER_DIR, "server.log")
LOG_FILE = os.path.join(BASE_DIR, "watchdog.log")
# OTA 更新标记：服务器完成更新后写这个文件再退出，守护据此重启一次
OTA_MARK = os.path.join(BASE_DIR, ".ota_restart")
# 心跳：服务器靠它判断守护是否在运行（没有守护，更新后没人拉起服务）
HEARTBEAT = os.path.join(BASE_DIR, ".watchdog_heartbeat")
# OTA 回滚记录与备份：服务器更新前写入，启动稳定后自行删除
ROLLBACK_FILE = os.path.join(BASE_DIR, ".ota_rollback.json")
RAPID_CRASH_SECONDS = 60      # 启动后多久内崩溃算「新版本起不来」
MAX_OTA_CRASHES = 3           # 连续这么多次快速崩溃就回滚
PORT = 51001
LOCK_PORT = PORT + 2          # 守护进程自身的单实例锁

LAST_UPDATE = ""   # 「上次更新：版本 / 时间」，供状态区显示
SERVER_STARTED_AT = None   # 当前服务进程的启动时间戳
RECENT_LOGS = deque(maxlen=200)
PRINT_LOCK = threading.Lock()
CURRENT_PROCESS = None
_WATCHDOG_LOCK = None
_JOB = None
_K32 = None


def app_version() -> str:
    try:
        with open(SERVER_SCRIPT, "r", encoding="utf-8") as f:
            m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', f.read())
        return m.group(1) if m else "未知"
    except Exception:
        return "未知"


def now_cn() -> datetime:
    return datetime.now(CN_TZ)


def log(msg: str):
    line = f"[{now_cn().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line)


def touch_heartbeat():
    try:
        with open(HEARTBEAT, "w") as f:
            f.write(str(int(time.time())))
    except Exception:
        pass


def format_uptime(seconds: float) -> str:
    total = max(0, int(seconds))
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    clock = f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{days} 天 {clock}" if days else clock


def update_title():
    """控制台标题栏实时显示服务运行时长，不刷屏、不覆盖日志。"""
    title = "801 文件桶 - 守护进程"
    if SERVER_STARTED_AT:
        title = f"801 文件桶 - 已运行 {format_uptime(time.time() - SERVER_STARTED_AT)}"
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW(title)
    except Exception:
        pass


def acquire_watchdog_lock() -> bool:
    global _WATCHDOG_LOCK
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name == "nt":
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", LOCK_PORT))
        s.listen(1)
    except OSError:
        s.close()
        return False
    _WATCHDOG_LOCK = s
    return True


def port_in_use(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def wait_port_free(seconds: float) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if not port_in_use(PORT):
            return True
        time.sleep(0.3)
    return not port_in_use(PORT)


def _create_job():
    """把服务进程挂到守护的 Job 上，守护窗口被关掉时服务随之结束。"""
    global _JOB, _K32
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        k32.SetInformationJobObject.restype = wintypes.BOOL
        k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                ctypes.c_void_p, wintypes.DWORD]
        k32.AssignProcessToJobObject.restype = wintypes.BOOL
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
                ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        job = k32.CreateJobObjectW(None, None)
        if not job:
            return
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
        _JOB, _K32 = job, k32
    except Exception:
        _JOB, _K32 = None, None


def _attach_job(process):
    if _JOB and _K32:
        try:
            _K32.AssignProcessToJobObject(_JOB, int(process._handle))
        except Exception:
            pass


def _stream_output(process):
    try:
        with open(SERVER_LOG, "a", encoding="utf-8") as f:
            for raw in process.stdout:
                line = raw.rstrip("\r\n")
                f.write(line + "\n")
                f.flush()
                RECENT_LOGS.append(line)
                with PRINT_LOCK:
                    print(f"  | {line}", flush=True)
    except Exception:
        pass


def start_server():
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    process = subprocess.Popen(
        [PYTHON, SERVER_SCRIPT],
        cwd=SERVER_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=env,
    )
    _attach_job(process)
    threading.Thread(target=_stream_output, args=(process,), daemon=True).start()
    return process


def stop_server(process):
    if process is None or process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=5)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


def ota_rollback():
    """按服务器的回滚记录还原文件，返回是否成功。"""
    try:
        with open(ROLLBACK_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        log(f"读取回滚记录失败：{e}")
        return False
    backup_dir = data.get("backup_dir") or os.path.join(BASE_DIR, ".ota_backup")
    backup_files = os.path.join(backup_dir, "files")
    restored = 0
    for item in data.get("written", []):
        name = item.get("name") or ""
        target = os.path.join(SERVER_DIR, name)
        try:
            if item.get("existed"):
                src = os.path.join(backup_files, name)
                if os.path.isfile(src):
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    shutil.copy2(src, target)
                    restored += 1
            elif os.path.isfile(target):
                os.remove(target)
                restored += 1
        except Exception as e:
            log(f"回滚 {name} 失败：{e}")
    for item in data.get("deleted", []):
        name = item.get("name") or ""
        try:
            src = os.path.join(backup_files, name)
            if os.path.isfile(src):
                target = os.path.join(SERVER_DIR, name)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.copy2(src, target)
                restored += 1
        except Exception as e:
            log(f"恢复 {name} 失败：{e}")
    try:
        os.remove(ROLLBACK_FILE)
    except Exception:
        pass
    shutil.rmtree(backup_dir, ignore_errors=True)
    log(f"已回滚到更新前的版本（还原 {restored} 个文件）")
    return True


def get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "未知"


def get_disk_free(path: str) -> str:
    try:
        free = shutil.disk_usage(path).free
        if free >= 1 << 30:
            return f"{free / (1 << 30):.1f} GB"
        elif free >= 1 << 20:
            return f"{free / (1 << 20):.1f} MB"
        else:
            return f"{free / (1 << 10):.1f} KB"
    except Exception:
        return "未知"


def get_dir_file_count(path: str) -> str:
    try:
        total = 0
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in ('.venv', '__pycache__', '.git', 'node_modules', 'data')]
            total += len(files)
        if total >= 1000:
            return f"{total / 1000:.1f}k"
        return str(total)
    except Exception:
        return "?"


def get_db_info() -> str:
    db_path = os.path.join(SERVER_DIR, 'data', 'app.db')
    if os.path.exists(db_path):
        size = os.path.getsize(db_path)
        if size >= 1 << 30:
            return f"DB {size / (1 << 30):.1f} GB"
        elif size >= 1 << 20:
            return f"DB {size / (1 << 20):.1f} MB"
        else:
            return f"DB {size / (1 << 10):.1f} KB"
    return "DB 无"


def clear_screen():
    if os.name == "nt":
        try:
            import ctypes
            k32 = ctypes.windll.kernel32
            handle = k32.GetStdHandle(-11)
            mode = ctypes.c_uint32()
            if (k32.GetConsoleMode(handle, ctypes.byref(mode))
                    and k32.SetConsoleMode(handle, mode.value | 0x0004)):
                sys.stdout.write("\x1b[H\x1b[2J")
                sys.stdout.flush()
                return
        except Exception:
            pass
        os.system("cls")
    else:
        sys.stdout.write("\x1b[H\x1b[2J")
        sys.stdout.flush()


def draw_status(status: str, restart_count: int, extra: str = ""):
    touch_heartbeat()
    with PRINT_LOCK:
        clear_screen()
        lan_ip = get_lan_ip()
        port = str(PORT)

        print("=" * 58)
        print("       801 文件桶 - 守护进程")
        print("=" * 58)
        print()
        print(f"  程序版本    : v{app_version()}")
        print(f"  Python 版本 : {sys.version.split()[0]}")
        print(f"  操作系统    : {platform.system()} {platform.release()}")
        print(f"  主机名      : {platform.node()}")
        print(f"  局域网 IP   : {lan_ip}")
        print(f"  磁盘剩余    : {get_disk_free(BASE_DIR)}")
        print(f"  项目文件    : {get_dir_file_count(SERVER_DIR)} 个  |  {get_db_info()}")
        print(f"  项目目录    : {SERVER_DIR}")
        print()
        print("-" * 58)
        print("  访问地址：")
        print(f"    本机: http://127.0.0.1:{port}")
        if lan_ip != "未知":
            print(f"    局域网: http://{lan_ip}:{port}")
        print()
        print(f"  守护日志    : {LOG_FILE}")
        print(f"  服务器日志  : {SERVER_LOG}")
        print()
        print("=" * 58)
        print(f"  状态    : {status}")
        uptime = format_uptime(time.time() - SERVER_STARTED_AT) if SERVER_STARTED_AT else "—"
        print(f"  运行时间: {uptime}")
        print(f"  重启次数: {restart_count}")
        if LAST_UPDATE:
            print(f"  上次更新: {LAST_UPDATE}")
        if extra:
            print(f"  {extra}")
        print()
        print("-" * 58)
        print("  按 Ctrl+C 停止守护进程并关闭服务器")
        print("=" * 58)
        print()
        sys.stdout.flush()


def main():
    global LAST_UPDATE, CURRENT_PROCESS, SERVER_STARTED_AT
    restart_count = 0
    ota_fail_count = 0

    if not os.path.exists(SERVER_SCRIPT):
        print(f"错误：未找到服务器脚本：{SERVER_SCRIPT}")
        input("按 Enter 退出...")
        sys.exit(1)

    if not acquire_watchdog_lock():
        log("已有另一个守护进程在运行，本次启动已取消。")
        input("按 Enter 退出...")
        sys.exit(1)

    if port_in_use(PORT):
        log(f"检测到 {PORT} 端口已有服务在运行，本次守护启动已取消。")
        print(f"\n如需重启，请先运行「停止项目.bat」，再启动守护。")
        input("按 Enter 退出...")
        sys.exit(1)

    _create_job()
    log("守护进程启动")
    PID_MARK = os.path.join(BASE_DIR, ".watchdog_pid")

    while True:
        stop_reason = ""
        exit_watchdog = False

        if not wait_port_free(5):
            log(f"端口 {PORT} 被其他进程占用，守护进程停止。")
            draw_status("端口被占用", restart_count, f"请先释放 {PORT} 端口")
            input("按 Enter 退出...")
            break

        draw_status("启动服务器...", restart_count)
        log("正在启动服务器...")

        server_start_time = time.time()

        process = start_server()
        CURRENT_PROCESS = process
        SERVER_STARTED_AT = server_start_time
        update_title()
        draw_status("运行中", restart_count)

        try:
            with open(PID_MARK, "w") as f:
                f.write(str(process.pid))
        except Exception:
            pass

        last_status_draw = time.time()
        while True:
            ret = process.poll()
            if ret is not None:
                # OTA 更新：服务器覆盖完代码、写下标记后退出，这里重启一次让新代码生效
                # （退出码是 0 也要重启，所以放在「正常退出就停守护」之前判断）
                if os.path.exists(OTA_MARK):
                    ver = ""
                    try:
                        with open(OTA_MARK, "r", encoding="utf-8") as f:
                            ver = (f.read().strip().split("\n") or [""])[0]
                    except Exception:
                        pass
                    try:
                        os.remove(OTA_MARK)
                    except Exception:
                        pass
                    log(f"检测到更新（版本 {ver}），重启服务使新代码生效")
                    for i in range(3, 0, -1):
                        draw_status(f"检测到更新（版本 {ver}），重启中", restart_count,
                                    f"{i} 秒后重启...")
                        time.sleep(1)
                    LAST_UPDATE = f"{ver}  {now_cn().strftime('%Y-%m-%d %H:%M:%S')}"
                    ret = -1   # 置非 0，避免走「正常退出 → 停守护」的分支
                    break

                elapsed = time.time() - server_start_time
                elapsed_str = str(timedelta(seconds=int(elapsed)))

                # 更新后新版本连续起不来：累计快速崩溃次数，达到上限就还原旧文件
                if (os.path.exists(ROLLBACK_FILE) and elapsed < RAPID_CRASH_SECONDS):
                    ota_fail_count += 1
                    log(f"更新后的服务启动异常（第 {ota_fail_count} 次快速崩溃，运行 {elapsed_str}）")
                    if ota_fail_count >= MAX_OTA_CRASHES:
                        LAST_UPDATE = f"更新失败，已回滚  {now_cn().strftime('%Y-%m-%d %H:%M:%S')}"
                        ota_fail_count = 0
                        ota_rollback()
                else:
                    ota_fail_count = 0

                if ret == 0:
                    msg = f"服务器正常退出（运行 {elapsed_str}）"
                    log(msg)
                    draw_status(f"服务器已正常退出（运行 {elapsed_str}）", restart_count)
                    exit_watchdog = True
                elif ret == 2 and elapsed < 20:
                    stop_reason = "已有另一个实例在运行"
                    log("服务检测到已有实例在运行，守护进程停止。")
                    draw_status("已有实例在运行", restart_count, "守护进程停止，请先运行「停止项目.bat」")
                    exit_watchdog = True
                else:
                    restart_count += 1
                    crash_time = now_cn().strftime('%Y-%m-%d %H:%M:%S')

                    reason = "外部终止"
                    if ret in (-1073741510, 3221225786):
                        reason = "Ctrl+C / 关闭控制台"
                    elif ret == 1:
                        reason = "taskkill /F 或异常崩溃"
                    log(f"服务器异常退出（退出码 {ret}，{reason}，运行 {elapsed_str}），第 {restart_count} 次重启...")
                    print(f"\n>>> [{crash_time}] 服务器异常退出（退出码 {ret}，{reason}）")

                    server_lines = []
                    try:
                        with open(SERVER_LOG, "r", encoding="utf-8", errors="replace") as f:
                            all_lines = f.readlines()
                            server_lines = [l.rstrip("\n\r") for l in all_lines[-10:] if l.strip()]
                    except Exception:
                        pass
                    if server_lines:
                        print("    最近运行日志：")
                        for line in server_lines:
                            print(f"    | {line}")
                    for i in range(5, 0, -1):
                        draw_status(
                            f"服务器异常退出（退出码 {ret}，运行 {elapsed_str}）",
                            restart_count, f"倒计时 {i} 秒后重启...")
                        time.sleep(1)
                    draw_status("正在重启...", restart_count)
                    time.sleep(1)
                break

            touch_heartbeat()
            update_title()
            if time.time() - last_status_draw >= 5:
                draw_status("运行中", restart_count)
                last_status_draw = time.time()
            time.sleep(1)

        CURRENT_PROCESS = None
        SERVER_STARTED_AT = None
        update_title()
        try:
            os.remove(PID_MARK)
        except Exception:
            pass

        if exit_watchdog:
            if stop_reason:
                log(f"守护进程停止：{stop_reason}")
                draw_status("已停止", restart_count, stop_reason)
            else:
                log("服务器正常退出，守护进程随之停止。")
                draw_status("已停止", restart_count, "服务器正常退出，守护进程结束。")
            time.sleep(2)
            break


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        log("用户手动停止守护进程")
        if CURRENT_PROCESS is not None:
            log("正在关闭服务器...")
            stop_server(CURRENT_PROCESS)
        print()
        print("守护进程已停止。")
        time.sleep(1)
    except Exception as e:
        log(f"守护进程异常: {e}")
        if CURRENT_PROCESS is not None:
            stop_server(CURRENT_PROCESS)
        import traceback
        traceback.print_exc()
        input("按 Enter 退出...")
