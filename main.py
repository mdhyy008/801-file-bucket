import io
import os
import re
import sys
import time
import json
import hmac
import uuid
import shutil
import socket
import hashlib
import secrets
import tempfile
import zipfile
import threading
import subprocess
import ctypes
from contextlib import asynccontextmanager
from ctypes import wintypes
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import bcrypt
import jwt
import uvicorn
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import (
    create_engine, event, Column, String, Integer, BigInteger, DateTime, Text,
    UniqueConstraint, func, or_,
)
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
TEMP_DIR = DATA_DIR / "tmp"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = DATA_DIR / "app.db"
SERVER_PORT = 51001
APP_VERSION = "1.0.0.015"
CN_TZ = timezone(timedelta(hours=8))

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

for _d in (DATA_DIR, UPLOAD_DIR, TEMP_DIR):
    _d.mkdir(parents=True, exist_ok=True)
# 上传解析产生的临时文件也落在程序目录，不写系统临时目录（可能在 C 盘）
tempfile.tempdir = str(TEMP_DIR)

CODE_ALPHABET = "0123456789"
TEXT_EXTS = {
    "txt", "md", "markdown", "csv", "tsv", "log", "json", "xml", "yml", "yaml",
    "ini", "conf", "cfg", "toml", "py", "js", "ts", "jsx", "tsx", "go", "java",
    "c", "h", "cpp", "hpp", "cs", "rs", "php", "rb", "sh", "bat", "ps1", "sql",
    "html", "htm", "css", "scss", "less", "vue",
}
MAX_TEXT_BYTES = 1024 * 1024

IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "ico": "image/x-icon",
}
VIDEO_TYPES = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "ogv": "video/ogg",
}
TYPE_GROUPS = [
    ("图片", {"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tif", "tiff", "heic"}),
    ("视频", {"mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts"}),
    ("音频", {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"}),
    ("文档", {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "odt"}),
    ("压缩包", {"zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"}),
    ("代码", TEXT_EXTS),
]

Base = declarative_base()


class Device(Base):
    __tablename__ = "fb_device"
    id = Column(String(32), primary_key=True)
    nickname = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, nullable=False)


class Bucket(Base):
    __tablename__ = "fb_bucket"
    id = Column(String(32), primary_key=True)
    name = Column(String(80), nullable=False)
    code = Column(String(8), unique=True, nullable=False, index=True)
    owner_id = Column(String(32), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class BucketFile(Base):
    __tablename__ = "fb_file"
    id = Column(String(32), primary_key=True)
    bucket_id = Column(String(32), nullable=False, index=True)
    uploader_id = Column(String(32), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    stored_name = Column(String(120), nullable=False)
    size = Column(BigInteger, nullable=False, default=0)
    ext = Column(String(20), default="")
    version = Column(Integer, nullable=False, default=1)
    hash = Column(String(64), index=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class Visit(Base):
    __tablename__ = "fb_visit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(32), nullable=False, index=True)
    bucket_id = Column(String(32), nullable=False, index=True)
    last_visit_at = Column(DateTime, nullable=False)
    __table_args__ = (UniqueConstraint("device_id", "bucket_id", name="uq_fb_visit"),)


class Setting(Base):
    __tablename__ = "fb_setting"
    key = Column(String(50), primary_key=True)
    value = Column(Text, nullable=False)


class Share(Base):
    __tablename__ = "fb_share"
    id = Column(String(8), primary_key=True)
    file_ids = Column(Text, nullable=False)
    creator_id = Column(String(32))
    created_at = Column(DateTime, nullable=False)


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    future=True,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


# ───────────────────────── 时间 / 设置 ─────────────────────────

def now_cn() -> datetime:
    return datetime.now(CN_TZ)


def now_db() -> datetime:
    return now_cn().replace(tzinfo=None)


def iso_cn(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=CN_TZ).isoformat()
    return dt.astimezone(CN_TZ).isoformat()


_SETTINGS: dict[str, str] = {}
_JWT_SECRET = ""


def _default_settings() -> dict[str, str]:
    return {
        "admin_password_hash": bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode(),
        "admin_password_is_default": "1",
        "max_upload_mb": "100",
        "dashboard_visible": "1",
        "disk_quota_percent": "20",
        "disk_quota_bytes": "0",
        "uploads_enabled": "1",
        "ext_mode": "off",
        "ext_list": "",
        "max_files_per_bucket": "0",
        "dashboard_refresh_sec": "10",
        "jwt_secret": secrets.token_hex(32),
    }


def load_settings():
    global _JWT_SECRET
    with SessionLocal() as db:
        defaults = _default_settings()
        existing = {s.key: s.value for s in db.query(Setting).all()}
        for k, v in defaults.items():
            if k not in existing:
                db.add(Setting(key=k, value=v))
                existing[k] = v
        db.commit()
        _SETTINGS.clear()
        _SETTINGS.update(existing)
        _JWT_SECRET = _SETTINGS["jwt_secret"]


def sget(key: str, default=None):
    return _SETTINGS.get(key, default)


def sget_int(key: str, default: int) -> int:
    try:
        return int(_SETTINGS.get(key, default))
    except (TypeError, ValueError):
        return default


def sget_bool(key: str, default: bool = False) -> bool:
    return _SETTINGS.get(key, "1" if default else "0") == "1"


def sset(key: str, value) -> None:
    value = str(value)
    with SessionLocal() as db:
        row = db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
        db.commit()
    _SETTINGS[key] = value


# ───────────────────────── 设备 / 管理员 ─────────────────────────

_ADJ = ["安静", "好奇", "快乐", "勇敢", "温柔", "机灵", "淡定", "热情", "文艺", "靠谱", "自在", "明亮", "悠然", "清爽"]
_ANI = ["松鼠", "海豚", "白兔", "狐狸", "熊猫", "刺猬", "海豹", "猫头鹰", "小鹿", "鲸鱼", "企鹅", "浣熊", "水獭", "考拉"]


def random_nickname() -> str:
    return f"{secrets.choice(_ADJ)}的{secrets.choice(_ANI)}{secrets.randbelow(100):02d}"


_HEX32 = re.compile(r"^[0-9a-f]{32}$")


def _is_admin_request(request: Request) -> bool:
    token = request.cookies.get("fb_admin")
    if not token or not _JWT_SECRET:
        return False
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
        return payload.get("sub") == "admin"
    except Exception:
        return False


def require_admin(request: Request):
    if not _is_admin_request(request):
        raise HTTPException(status_code=403, detail="仅管理员可见")


def admin_token() -> str:
    return jwt.encode(
        {"sub": "admin", "exp": datetime.now(timezone.utc) + timedelta(days=7)},
        _JWT_SECRET,
        algorithm="HS256",
    )


_LOGIN_FAILS: dict[str, dict] = {}
_LOGIN_LOCK = threading.Lock()
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_SECONDS = 60


def _login_blocked(ip: str) -> bool:
    with _LOGIN_LOCK:
        rec = _LOGIN_FAILS.get(ip)
        if not rec:
            return False
        if rec["until"] > time.time():
            return True
        _LOGIN_FAILS.pop(ip, None)
        return False


def _login_failed(ip: str) -> bool:
    """记录一次失败；返回是否已触发锁定。"""
    with _LOGIN_LOCK:
        rec = _LOGIN_FAILS.setdefault(ip, {"count": 0, "until": 0.0})
        rec["count"] += 1
        if rec["count"] >= LOGIN_MAX_FAILS:
            rec["until"] = time.time() + LOGIN_LOCK_SECONDS
            rec["count"] = 0
            return True
        return False


def _login_ok(ip: str):
    with _LOGIN_LOCK:
        _LOGIN_FAILS.pop(ip, None)


# ───────────────────────── 磁盘 / 内存 ─────────────────────────

_SIZE_CACHE = {"program": 0, "data": 0, "ready": False}
_SIZE_LOCK = threading.Lock()


def _dir_size(path: Path, skip: tuple[str, ...] = ()) -> int:
    total = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in skip]
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return total


def refresh_sizes():
    program = _dir_size(BASE_DIR, ("data",))
    data = _dir_size(DATA_DIR)
    with _SIZE_LOCK:
        _SIZE_CACHE.update({"program": program, "data": data, "ready": True})


def _size_loop():
    while True:
        try:
            refresh_sizes()
        except Exception:
            pass
        time.sleep(60)


def app_size() -> int:
    with _SIZE_LOCK:
        return int(_SIZE_CACHE["program"]) + int(_SIZE_CACHE["data"])


def add_data_size(delta: int):
    with _SIZE_LOCK:
        _SIZE_CACHE["data"] = max(0, int(_SIZE_CACHE["data"]) + int(delta))


def disk_info() -> dict:
    mount = str(BASE_DIR.drive + "\\") if BASE_DIR.drive else str(BASE_DIR)
    try:
        usage = shutil.disk_usage(mount)
        return {
            "mount": mount,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "program_size": _SIZE_CACHE["program"],
            "data_size": _SIZE_CACHE["data"],
            "app_size": app_size(),
            "ready": _SIZE_CACHE["ready"],
        }
    except Exception as e:
        return {"error": str(e)}


def quota_info() -> dict:
    disk = disk_info()
    pct = max(1, min(90, sget_int("disk_quota_percent", 20)))
    quota = sget_int("disk_quota_bytes", 0)
    return {
        "percent": pct,
        "disk_total": int(disk.get("total") or 0),
        "disk_free": int(disk.get("free") or 0),
        "quota_bytes": quota,
        "used_bytes": app_size(),
        "ready": _SIZE_CACHE["ready"],
    }


def ensure_quota():
    """首次启动按当时的磁盘剩余空间 × 百分比固化成绝对额度。"""
    if sget_int("disk_quota_bytes", 0) > 0:
        return
    disk = disk_info()
    pct = max(1, min(90, sget_int("disk_quota_percent", 20)))
    sset("disk_quota_bytes", int(int(disk.get("free") or 0) * pct / 100))


def uploads_enabled() -> bool:
    return sget_bool("uploads_enabled", True)


def normalized_ext_list(raw: str) -> list[str]:
    items = []
    for part in re.split(r"[\s,;，；、]+", str(raw or "")):
        ext = part.strip().lstrip(".").lower()
        if ext and ext not in items:
            items.append(ext)
    return items


def ext_rules() -> tuple[str, set[str]]:
    mode = str(sget("ext_mode", "off") or "off").lower()
    if mode not in ("allow", "deny"):
        mode = "off"
    return mode, set(normalized_ext_list(sget("ext_list", "")))


def ext_forbidden(ext: str) -> bool:
    mode, items = ext_rules()
    if mode == "off" or not items:
        return False
    ext = str(ext or "").lower()
    return ext not in items if mode == "allow" else ext in items


def require_upload_allowed(ext: str):
    if not uploads_enabled():
        raise HTTPException(status_code=403, detail="维护中，暂停上传")
    if ext_forbidden(ext):
        raise HTTPException(status_code=400, detail="不允许上传该类型文件")


def require_bucket_capacity(db, bucket_id: str):
    limit = max(0, sget_int("max_files_per_bucket", 0))
    if not limit:
        return
    count = db.query(func.count(BucketFile.id)).filter(BucketFile.bucket_id == bucket_id).scalar() or 0
    if int(count) >= limit:
        raise HTTPException(status_code=400, detail=f"每个桶最多 {limit} 个文件")


def memory_info() -> dict:
    try:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return {
                "load_percent": stat.dwMemoryLoad,
                "total": stat.ullTotalPhys,
                "available": stat.ullAvailPhys,
                "used": stat.ullTotalPhys - stat.ullAvailPhys,
            }
    except Exception:
        pass
    return {}


def process_memory_info() -> dict:
    try:
        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        k32 = ctypes.windll.kernel32
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.windll.psapi
        psapi.GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD,
        ]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        pmc = PROCESS_MEMORY_COUNTERS_EX()
        pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
        if psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
            return {
                "working_set": pmc.WorkingSetSize,
                "peak_working_set": pmc.PeakWorkingSetSize,
                "pagefile_usage": pmc.PagefileUsage,
            }
    except Exception:
        pass
    return {}


# ───────────────────────── 通用工具 ─────────────────────────

def clean_name(raw: str | None, fallback: str = "未命名文件", limit: int = 180) -> str:
    name = os.path.basename((raw or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    if not name:
        name = fallback
    if len(name) > limit:
        suffix = Path(name).suffix
        keep = limit - len(suffix) if len(suffix) <= 12 else limit
        name = name[:max(1, keep)] + (suffix if len(suffix) <= 12 else "")
    return name


def ext_of(name: str) -> str:
    ext = Path(name).suffix.lower().lstrip(".")
    return re.sub(r"[^a-z0-9]", "", ext)[:12]


def previewable(ext: str) -> bool:
    return ext in IMAGE_TYPES or ext in VIDEO_TYPES or ext == "pdf" or ext in TEXT_EXTS


def new_code() -> str:
    with SessionLocal() as db:
        for _ in range(30):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            if not db.query(Bucket.id).filter(Bucket.code == code).first():
                return code
    raise HTTPException(status_code=500, detail="识别码生成失败")


def migrate_bucket_codes() -> None:
    """把旧版本生成的字母识别码统一改为 6 位纯数字。"""
    with SessionLocal() as db:
        changed = []
        for b in db.query(Bucket).all():
            if re.fullmatch(r"\d{6}", b.code or ""):
                continue
            for _ in range(30):
                code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
                if not db.query(Bucket.id).filter(Bucket.code == code).first():
                    changed.append((b.code, code))
                    b.code = code
                    break
        if changed:
            db.commit()
            for old, new in changed:
                print(f"识别码已换成纯数字：{old} → {new}", flush=True)


def migrate_file_hash() -> None:
    """老库补上文件哈希列，用于上传查重。"""
    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(fb_file)")}
        if "hash" not in cols:
            conn.exec_driver_sql("ALTER TABLE fb_file ADD COLUMN hash VARCHAR(64)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_fb_file_hash ON fb_file (hash)")


def migrate_share_creator() -> None:
    """老库补上分享创建者，便于创建者自己停止分享。"""
    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(fb_share)")}
        if "creator_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE fb_share ADD COLUMN creator_id VARCHAR(32)")


def _hash_loop():
    """后台给缺少哈希的旧文件补算，每轮最多 50 个。"""
    while True:
        count = 0
        try:
            with SessionLocal() as db:
                rows = (
                    db.query(BucketFile)
                    .filter((BucketFile.hash.is_(None)) | (BucketFile.hash == ""))
                    .limit(50)
                    .all()
                )
                count = len(rows)
                for f in rows:
                    p = bucket_file_path(f.bucket_id, f.stored_name)
                    f.hash = (_sha256_file(p) if p.exists() else "") or ""
                if rows:
                    db.commit()
        except Exception:
            count = 0
        time.sleep(2 if count else 30)


def mask_bucket_name(name: str) -> str:
    if len(name) >= 3:
        return name[0] + "**" + name[-1]
    return "*" * max(1, len(name))


def bucket_file_path(bucket_id: str, stored_name: str) -> Path:
    return UPLOAD_DIR / bucket_id / stored_name


def file_dict(f: BucketFile, nickname: str, device_id: str) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "version": f.version,
        "size": f.size,
        "ext": f.ext,
        "uploader": nickname or "未知",
        "created_at": iso_cn(f.created_at),
        "is_mine": f.uploader_id == device_id,
        "previewable": previewable(f.ext),
    }


def bucket_stats(db, bucket_ids: list[str]) -> dict[str, tuple[int, int]]:
    if not bucket_ids:
        return {}
    rows = (
        db.query(BucketFile.bucket_id, func.count(BucketFile.id), func.coalesce(func.sum(BucketFile.size), 0))
        .filter(BucketFile.bucket_id.in_(bucket_ids))
        .group_by(BucketFile.bucket_id)
        .all()
    )
    return {r[0]: (int(r[1]), int(r[2] or 0)) for r in rows}


def nicknames_map(db, device_ids: set[str]) -> dict[str, str]:
    if not device_ids:
        return {}
    rows = db.query(Device.id, Device.nickname).filter(Device.id.in_(device_ids)).all()
    return {r[0]: r[1] for r in rows}


def _page(name: str) -> FileResponse:
    return FileResponse(STATIC_DIR / name, media_type="text/html", headers={"Cache-Control": "no-store"})


# ───────────────────────── 启动 ─────────────────────────

_instance_lock_socket = None


def acquire_instance_lock() -> bool:
    global _instance_lock_socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name == "nt":
        # Windows 的 SO_REUSEADDR 允许抢占已被占用的端口，必须用独占绑定
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", SERVER_PORT + 1))
        s.listen(1)
    except OSError:
        s.close()
        return False
    _instance_lock_socket = s
    return True


def _tmp_cleanup_loop():
    """清理打包中断（用户关掉浏览器）后遗留的临时 ZIP，超过 1 小时即删。"""
    while True:
        try:
            cutoff = time.time() - 3600
            for p in TEMP_DIR.glob("zip_*.zip"):
                try:
                    if p.stat().st_mtime < cutoff:
                        p.unlink(missing_ok=True)
                except OSError:
                    pass
        except Exception:
            pass
        time.sleep(600)


@asynccontextmanager
async def lifespan(_app):
    if not acquire_instance_lock():
        print(f"已有另一个 801 文件桶实例在运行（单实例锁 127.0.0.1:{SERVER_PORT + 1} 被占用），本次启动中止。", flush=True)
        os._exit(2)
    Base.metadata.create_all(engine)
    load_settings()
    migrate_bucket_codes()
    migrate_file_hash()
    migrate_share_creator()
    ensure_quota()
    refresh_sizes()
    threading.Thread(target=_size_loop, daemon=True).start()
    threading.Thread(target=_hash_loop, daemon=True).start()
    threading.Thread(target=_ota_confirm_startup, daemon=True).start()
    threading.Thread(target=_tmp_cleanup_loop, daemon=True).start()
    yield


app = FastAPI(title="801 文件桶", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


# ───────────────────────── 中间件 ─────────────────────────

@app.middleware("http")
async def device_middleware(request: Request, call_next):
    request.state.is_admin = _is_admin_request(request)

    path = request.url.path
    if path.startswith("/static/") or path == "/favicon.ico":
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        # 静态资源每次向服务器校验，避免改了前端后浏览器还跑旧缓存
        response.headers["Cache-Control"] = "no-cache"
        return response

    # 上传请求在解析表单前先按 Content-Length 挡一次超大包 / 超额包；
    # 替换会被旧文件腾出的空间抵消，只交给接口内按实际大小判断
    is_new_upload = request.method == "POST" and path.endswith("/files")
    if is_new_upload:
        cl_raw = request.headers.get("content-length")
        if cl_raw:
            try:
                cl = int(cl_raw)
            except ValueError:
                cl = 0
            max_mb = max(1, sget_int("max_upload_mb", 100))
            if not request.state.is_admin and cl > max_mb * 1024 * 1024 + 4 * 1024 * 1024:
                return JSONResponse({"detail": f"文件超过 {max_mb} MB 上限"}, status_code=413)
            q = quota_info()
            if q["quota_bytes"] and cl > max(0, q["quota_bytes"] - q["used_bytes"]) + 4 * 1024 * 1024:
                return JSONResponse({"detail": "项目存储空间不足"}, status_code=507)

    device = None
    device_id = request.cookies.get("fb_device", "")
    if _HEX32.match(device_id):
        with SessionLocal() as db:
            device = db.get(Device, device_id)
    if device is None:
        header_id = request.headers.get("x-device-id", "").strip().lower()
        if _HEX32.match(header_id):
            with SessionLocal() as db:
                device = db.get(Device, header_id)
    set_cookie = False
    if device is None:
        device_id = uuid.uuid4().hex
        ts = now_db()
        with SessionLocal() as db:
            db.add(Device(id=device_id, nickname=random_nickname(), created_at=ts, last_seen_at=ts))
            db.commit()
        set_cookie = True
    else:
        device_id = device.id
        if (now_db() - device.last_seen_at) > timedelta(hours=1):
            with SessionLocal() as db:
                row = db.get(Device, device_id)
                if row:
                    row.last_seen_at = now_db()
                    db.commit()
        set_cookie = True

    request.state.device_id = device_id
    response = await call_next(request)
    if set_cookie:
        response.set_cookie(
            "fb_device", device_id, max_age=10 * 365 * 24 * 3600,
            httponly=True, samesite="lax",
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


# ───────────────────────── 请求模型 ─────────────────────────

class BucketIn(BaseModel):
    name: str


class NicknameIn(BaseModel):
    nickname: str


class LoginIn(BaseModel):
    password: str


class SettingsIn(BaseModel):
    max_upload_mb: int
    dashboard_visible: bool
    disk_quota_percent: int
    uploads_enabled: bool = True
    ext_mode: str = "off"
    ext_list: str = ""
    max_files_per_bucket: int = 0
    dashboard_refresh_sec: int = 10


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


class TextIn(BaseModel):
    name: str = ""
    content: str = ""


# ───────────────────────── 页面 ─────────────────────────

@app.get("/")
def index_page():
    return _page("index.html")


@app.get("/index.html")
def index_page2():
    return _page("index.html")


@app.get("/dashboard.html")
def dashboard_page():
    return _page("dashboard.html")


@app.get("/admin.html")
def admin_page():
    return _page("admin.html")


@app.get("/settings.html")
def settings_page():
    return _page("settings.html")


@app.get("/login.html")
def login_page():
    return _page("login.html")


@app.get("/f/{file_id}")
def file_page(file_id: str):
    return _page("file.html")


@app.get("/s/{share_id}")
def share_page(share_id: str):
    return _page("share.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": getattr(exc, "detail", "Not Found")}, status_code=404)
    if path.startswith("/static/"):
        return PlainTextResponse("Not Found", status_code=404)
    return FileResponse(
        STATIC_DIR / "404.html",
        status_code=404,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


# ───────────────────────── 设备 / 管理员接口 ─────────────────────────

@app.get("/api/me")
def api_me(request: Request):
    with SessionLocal() as db:
        d = db.get(Device, request.state.device_id)
        return {
            "device_id": request.state.device_id,
            "nickname": d.nickname if d else "",
            "created_at": iso_cn(d.created_at) if d else None,
            "last_seen_at": iso_cn(d.last_seen_at) if d else None,
            "is_admin": request.state.is_admin,
            "dashboard_visible": sget_bool("dashboard_visible", True),
            "uploads_enabled": uploads_enabled(),
            "max_upload_mb": sget_int("max_upload_mb", 100),
            "quota": quota_info(),
            "is_default_password": sget("admin_password_is_default", "1") == "1",
        }


@app.post("/api/device/nickname")
def api_nickname(body: NicknameIn, request: Request):
    nickname = re.sub(r"[\x00-\x1f\x7f]", "", body.nickname).strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="昵称不能为空")
    if len(nickname) > 20:
        raise HTTPException(status_code=400, detail="昵称最多 20 个字")
    with SessionLocal() as db:
        d = db.get(Device, request.state.device_id)
        if not d:
            raise HTTPException(status_code=404, detail="设备不存在")
        d.nickname = nickname
        db.commit()
    return {"ok": True, "nickname": nickname}


@app.post("/api/admin/login")
def api_login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    if _login_blocked(ip):
        raise HTTPException(status_code=429, detail="尝试过多，请 1 分钟后再试")
    if not bcrypt.checkpw(body.password.encode("utf-8"), sget("admin_password_hash", "").encode("utf-8")):
        if _login_failed(ip):
            raise HTTPException(status_code=429, detail="尝试过多，请 1 分钟后再试")
        raise HTTPException(status_code=401, detail="密码错误")
    _login_ok(ip)
    resp = JSONResponse({"ok": True, "is_default_password": sget("admin_password_is_default", "1") == "1"})
    resp.set_cookie(
        "fb_admin", admin_token(), max_age=7 * 24 * 3600,
        httponly=True, samesite="lax",
    )
    return resp


@app.post("/api/admin/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("fb_admin")
    return resp


# ───────────────────────── 桶接口 ─────────────────────────

@app.get("/api/home")
def api_home(request: Request):
    did = request.state.device_id
    with SessionLocal() as db:
        owned = db.query(Bucket).filter(Bucket.owner_id == did).order_by(Bucket.created_at.desc()).all()
        stats = bucket_stats(db, [b.id for b in owned])
        my_buckets = [
            {
                "id": b.id,
                "name": b.name,
                "code": b.code,
                "created_at": iso_cn(b.created_at),
                "file_count": stats.get(b.id, (0, 0))[0],
                "size": stats.get(b.id, (0, 0))[1],
            }
            for b in owned
        ]

        rows = (
            db.query(Visit, Bucket)
            .join(Bucket, Bucket.id == Visit.bucket_id)
            .filter(Visit.device_id == did, Bucket.owner_id != did)
            .order_by(Visit.last_visit_at.desc())
            .limit(100)
            .all()
        )
        stats2 = bucket_stats(db, [b.id for _, b in rows])
        visited = [
            {
                "id": b.id,
                "name": b.name,
                "code": b.code,
                "last_visit_at": iso_cn(v.last_visit_at),
                "file_count": stats2.get(b.id, (0, 0))[0],
                "size": stats2.get(b.id, (0, 0))[1],
            }
            for v, b in rows
        ]
        return {"my_buckets": my_buckets, "visited_buckets": visited}


@app.delete("/api/visits/{bucket_id}")
def api_delete_visit(bucket_id: str, request: Request):
    with SessionLocal() as db:
        db.query(Visit).filter(
            Visit.device_id == request.state.device_id,
            Visit.bucket_id == bucket_id,
        ).delete(synchronize_session=False)
        db.commit()
    return {"ok": True}


@app.post("/api/buckets")
def api_create_bucket(body: BucketIn, request: Request):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入储存桶名")
    if len(name) > 60:
        raise HTTPException(status_code=400, detail="储存桶名最多 60 个字")
    ts = now_db()
    with SessionLocal() as db:
        b = Bucket(
            id=uuid.uuid4().hex, name=name, code=new_code(),
            owner_id=request.state.device_id, created_at=ts, updated_at=ts,
        )
        db.add(b)
        db.commit()
        return {"id": b.id, "name": b.name, "code": b.code}


@app.get("/api/buckets/lookup")
def api_lookup(code: str):
    code = re.sub(r"\s+", "", code or "").upper()
    if not re.fullmatch(r"[A-Z0-9]{6}", code):
        raise HTTPException(status_code=404, detail="识别码不存在")
    with SessionLocal() as db:
        b = db.query(Bucket).filter(Bucket.code == code).first()
        if not b:
            raise HTTPException(status_code=404, detail="识别码不存在")
        return {"bucket_id": b.id}


def _get_bucket(db, bucket_id: str) -> Bucket:
    if not _HEX32.match(bucket_id or ""):
        raise HTTPException(status_code=404, detail="桶不存在")
    b = db.get(Bucket, bucket_id)
    if not b:
        raise HTTPException(status_code=404, detail="桶不存在")
    return b


@app.get("/api/buckets/{bucket_id}")
def api_bucket(bucket_id: str, request: Request):
    did = request.state.device_id
    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        files = (
            db.query(BucketFile)
            .filter(BucketFile.bucket_id == b.id)
            .order_by(BucketFile.created_at.desc())
            .all()
        )
        nickmap = nicknames_map(db, {f.uploader_id for f in files})
        owner = db.get(Device, b.owner_id)

        v = db.query(Visit).filter(Visit.device_id == did, Visit.bucket_id == b.id).first()
        if v:
            v.last_visit_at = now_db()
        else:
            db.add(Visit(device_id=did, bucket_id=b.id, last_visit_at=now_db()))
        db.commit()

        disk = disk_info()
        disk_total = int(disk.get("total") or 0)
        disk_used = int(disk.get("used") or 0)
        disk_free = int(disk.get("free") or 0)
        size_app = app_size()
        disk_percent = round(size_app / disk_total * 100, 1) if disk_total else 0
        disk_used_percent = round(disk_used / disk_total * 100, 1) if disk_total else 0
        disk_other_percent = round(max(0, disk_used - size_app) / disk_total * 100, 1) if disk_total else 0
        disk_free_percent = round(disk_free / disk_total * 100, 1) if disk_total else 0

        q = quota_info()
        quota_total = int(q.get("quota_bytes") or 0)
        quota_remaining = max(0, quota_total - int(q.get("used_bytes") or 0))
        quota_remaining_percent = (quota_remaining * 1000 // quota_total) / 10 if quota_total else 0

        return {
            "id": b.id,
            "name": b.name,
            "code": b.code,
            "created_at": iso_cn(b.created_at),
            "owner_nickname": owner.nickname if owner else "未知",
            "is_owner": b.owner_id == did,
            "is_admin": request.state.is_admin,
            "files": [file_dict(f, nickmap.get(f.uploader_id, ""), did) for f in files],
            "file_count": len(files),
            "total_size": sum(f.size for f in files),
            "disk_percent": disk_percent,
            "disk_used_percent": disk_used_percent,
            "disk_other_percent": disk_other_percent,
            "disk_free_percent": disk_free_percent,
            "disk_mount": disk.get("mount") or "",
            "quota_total_bytes": quota_total,
            "quota_remaining_bytes": quota_remaining,
            "quota_remaining_percent": quota_remaining_percent,
        }


@app.patch("/api/buckets/{bucket_id}")
def api_rename_bucket(bucket_id: str, body: BucketIn, request: Request):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入储存桶名")
    if len(name) > 60:
        raise HTTPException(status_code=400, detail="储存桶名最多 60 个字")
    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        if b.owner_id != request.state.device_id and not request.state.is_admin:
            raise HTTPException(status_code=403, detail="没有权限")
        b.name = name
        b.updated_at = now_db()
        db.commit()
    return {"ok": True, "name": name}


@app.delete("/api/buckets/{bucket_id}")
def api_delete_bucket(bucket_id: str, request: Request):
    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        if b.owner_id != request.state.device_id and not request.state.is_admin:
            raise HTTPException(status_code=403, detail="没有权限")
        files = db.query(BucketFile).filter(BucketFile.bucket_id == b.id).all()
        freed = sum(f.size for f in files)
        db.query(BucketFile).filter(BucketFile.bucket_id == b.id).delete()
        db.query(Visit).filter(Visit.bucket_id == b.id).delete()
        db.delete(b)
        db.commit()
    shutil.rmtree(UPLOAD_DIR / bucket_id, ignore_errors=True)
    add_data_size(-freed)
    return {"ok": True}


# ───────────────────────── 文件接口 ─────────────────────────

def _quota_remaining(extra_free: int = 0) -> int:
    q = quota_info()
    return max(0, q["quota_bytes"] - q["used_bytes"] + extra_free)


_QUOTA_LOCK = threading.Lock()
_QUOTA_RESERVED = 0


class _QuotaHold:
    """并发上传共享同一份剩余额度，写盘前逐块预占、结束时释放。extra_free 用于替换时抵扣旧文件大小。"""

    def __init__(self, extra_free: int = 0):
        self.extra_free = max(0, int(extra_free or 0))
        self.reserved = 0

    def take(self, size: int) -> bool:
        global _QUOTA_RESERVED
        if size <= 0:
            return True
        with _QUOTA_LOCK:
            free = max(0, sget_int("disk_quota_bytes", 0) - app_size() - _QUOTA_RESERVED)
            credit = min(self.extra_free, self.reserved)
            if size > free + credit:
                return False
            _QUOTA_RESERVED += size
            self.reserved += size
            return True

    def release(self):
        global _QUOTA_RESERVED
        with _QUOTA_LOCK:
            if self.reserved:
                _QUOTA_RESERVED = max(0, _QUOTA_RESERVED - self.reserved)
                self.reserved = 0


async def _save_upload(file: UploadFile, dest: Path, limit: int | None, hold: _QuotaHold):
    """流式落盘并计算 SHA-256；超过单文件上限或额度不足立即中止并删除半成品。"""
    size = 0
    digest = hashlib.sha256()
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if limit is not None and size > limit:
                    raise HTTPException(status_code=413, detail=f"文件超过 {limit // (1024 * 1024)} MB 上限")
                if not hold.take(len(chunk)):
                    raise HTTPException(status_code=507, detail="项目存储空间不足")
                out.write(chunk)
                digest.update(chunk)
    except HTTPException:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    except Exception:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail="保存文件失败")
    return size, digest.hexdigest()


@app.post("/api/buckets/{bucket_id}/files")
async def api_upload(bucket_id: str, request: Request, file: UploadFile = File(...)):
    did = request.state.device_id
    admin = request.state.is_admin
    display = clean_name(file.filename)
    ext = ext_of(display)
    require_upload_allowed(ext)

    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        require_bucket_capacity(db, b.id)
        max_mb = max(1, sget_int("max_upload_mb", 100))
        limit = None if admin else max_mb * 1024 * 1024
        remaining = _quota_remaining()
        if remaining <= 0:
            raise HTTPException(status_code=507, detail="项目存储空间不足")
        if limit is not None and file.size is not None and file.size > limit:
            raise HTTPException(status_code=413, detail=f"文件超过 {max_mb} MB 上限")
        if file.size is not None and file.size > remaining:
            raise HTTPException(status_code=507, detail="项目存储空间不足")

        fid = uuid.uuid4().hex
        stored = f"{fid}{('.' + ext) if ext else ''}"
        dest = bucket_file_path(b.id, stored)
        hold = _QuotaHold()
        try:
            size, digest = await _save_upload(file, dest, limit, hold)

            dup = (
                db.query(BucketFile)
                .filter(BucketFile.bucket_id == b.id, BucketFile.hash == digest)
                .order_by(BucketFile.created_at.asc())
                .first()
            )
            if dup:
                try:
                    dest.unlink(missing_ok=True)
                except OSError:
                    pass
                dn = db.get(Device, dup.uploader_id)
                return JSONResponse(status_code=409, content={
                    "detail": "该文件已经上传过",
                    "duplicate": {
                        "name": dup.name,
                        "uploader": (dn.nickname if dn else "") or "未知",
                        "created_at": iso_cn(dup.created_at),
                    },
                })

            maxv = (
                db.query(func.max(BucketFile.version))
                .filter(BucketFile.bucket_id == b.id, BucketFile.name == display)
                .scalar()
            )
            ts = now_db()
            f = BucketFile(
                id=fid, bucket_id=b.id, uploader_id=did, name=display,
                stored_name=stored, size=size, ext=ext, hash=digest,
                version=int(maxv or 0) + 1, created_at=ts, updated_at=ts,
            )
            db.add(f)
            db.commit()
            add_data_size(size)
            d = db.get(Device, did)
            return file_dict(f, d.nickname if d else "", did)
        finally:
            hold.release()


@app.post("/api/buckets/{bucket_id}/texts")
def api_create_text(bucket_id: str, body: TextIn, request: Request):
    did = request.state.device_id
    admin = request.state.is_admin

    name = clean_name(body.name)
    if not name or name == "未命名文件":
        raise HTTPException(status_code=400, detail="请输入文件名")
    ext = ext_of(name)
    if not ext:
        name = f"{name}.txt"
        ext = "txt"
    if ext not in TEXT_EXTS:
        raise HTTPException(status_code=400, detail="只能创建文本文件")
    require_upload_allowed(ext)

    data = (body.content or "").encode("utf-8")
    max_mb = max(1, sget_int("max_upload_mb", 100))
    limit = None if admin else max_mb * 1024 * 1024
    if limit is not None and len(data) > limit:
        raise HTTPException(status_code=413, detail=f"文件超过 {max_mb} MB 上限")

    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        require_bucket_capacity(db, b.id)
        hold = _QuotaHold()
        try:
            if not hold.take(len(data)):
                raise HTTPException(status_code=507, detail="项目存储空间不足")
            fid = uuid.uuid4().hex
            stored = f"{fid}.{ext}"
            dest = bucket_file_path(b.id, stored)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            maxv = (
                db.query(func.max(BucketFile.version))
                .filter(BucketFile.bucket_id == b.id, BucketFile.name == name)
                .scalar()
            )
            ts = now_db()
            f = BucketFile(
                id=fid, bucket_id=b.id, uploader_id=did, name=name,
                stored_name=stored, size=len(data), ext=ext,
                hash=hashlib.sha256(data).hexdigest(),
                version=int(maxv or 0) + 1, created_at=ts, updated_at=ts,
            )
            db.add(f)
            db.commit()
            add_data_size(len(data))
            d = db.get(Device, did)
            return file_dict(f, d.nickname if d else "", did)
        finally:
            hold.release()


@app.put("/api/files/{file_id}/content")
async def api_replace(file_id: str, request: Request, file: UploadFile = File(...)):
    did = request.state.device_id
    admin = request.state.is_admin

    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        if f.uploader_id != did:
            raise HTTPException(status_code=403, detail="只能替换自己上传的文件")
        max_mb = max(1, sget_int("max_upload_mb", 100))
        limit = None if admin else max_mb * 1024 * 1024
        remaining = _quota_remaining(extra_free=f.size)
        if limit is not None and file.size is not None and file.size > limit:
            raise HTTPException(status_code=413, detail=f"文件超过 {max_mb} MB 上限")
        if file.size is not None and file.size > remaining:
            raise HTTPException(status_code=507, detail="项目存储空间不足")
        require_upload_allowed(f.ext)

        ext = f.ext
        new_stored = f"{f.id}{('.' + ext) if ext else ''}"
        new_path = bucket_file_path(f.bucket_id, new_stored)
        tmp_path = new_path.with_name(new_stored + ".new")
        hold = _QuotaHold(extra_free=f.size)
        try:
            size, digest = await _save_upload(file, tmp_path, limit, hold)
            os.replace(tmp_path, new_path)
            old_stored = f.stored_name
            old_size = f.size
            f.stored_name = new_stored
            f.size = size
            f.hash = digest
            f.version = int(f.version or 1) + 1
            f.updated_at = now_db()
            db.commit()
            if old_stored != new_stored:
                try:
                    bucket_file_path(f.bucket_id, old_stored).unlink(missing_ok=True)
                except OSError:
                    pass
            add_data_size(size - old_size)
            d = db.get(Device, did)
            return file_dict(f, d.nickname if d else "", did)
        finally:
            hold.release()


@app.patch("/api/files/{file_id}")
def api_rename_file(file_id: str, body: BucketIn, request: Request):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        if f.uploader_id != request.state.device_id:
            raise HTTPException(status_code=403, detail="只能修改自己上传的文件")
        name = clean_name(body.name)
        if name != f.name:
            maxv = (
                db.query(func.max(BucketFile.version))
                .filter(BucketFile.bucket_id == f.bucket_id, BucketFile.name == name, BucketFile.id != f.id)
                .scalar()
            )
            f.version = int(maxv or 0) + 1
            f.name = name
            f.updated_at = now_db()
            db.commit()
        d = db.get(Device, f.uploader_id)
        return file_dict(f, d.nickname if d else "", request.state.device_id)


@app.delete("/api/files/{file_id}")
def api_delete_file(file_id: str, request: Request):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        if f.uploader_id != request.state.device_id and not request.state.is_admin:
            raise HTTPException(status_code=403, detail="没有权限")
        bucket_id, stored, size = f.bucket_id, f.stored_name, f.size
        db.delete(f)
        db.commit()
    try:
        bucket_file_path(bucket_id, stored).unlink(missing_ok=True)
    except OSError:
        pass
    add_data_size(-size)
    return {"ok": True}


def _file_info(db, f: BucketFile) -> dict:
    d = db.get(Device, f.uploader_id)
    return {
        "id": f.id,
        "name": f.name,
        "size": f.size,
        "ext": f.ext,
        "uploader": (d.nickname if d else "") or "未知",
        "created_at": iso_cn(f.created_at),
        "previewable": previewable(f.ext),
    }


@app.get("/api/files/{file_id}/info")
def api_file_info(file_id: str):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        if not bucket_file_path(f.bucket_id, f.stored_name).exists():
            raise HTTPException(status_code=404, detail="文件已不存在")
        return _file_info(db, f)


class ShareCreate(BaseModel):
    file_ids: list[str] = []


@app.post("/api/shares")
def api_create_share(body: ShareCreate, request: Request):
    ids = []
    for fid in body.file_ids:
        if _HEX32.match(fid) and fid not in ids:
            ids.append(fid)
    if not ids:
        raise HTTPException(status_code=400, detail="没有可分享的文件")
    with SessionLocal() as db:
        existing = {
            row[0] for row in
            db.query(BucketFile.id).filter(BucketFile.id.in_(ids)).all()
        }
        ids = [fid for fid in ids if fid in existing]
        if not ids:
            raise HTTPException(status_code=404, detail="文件不存在")
        for _ in range(10):
            sid = secrets.token_hex(4)
            if db.get(Share, sid) is None:
                db.add(Share(id=sid, file_ids=json.dumps(ids),
                             creator_id=request.state.device_id, created_at=now_db()))
                db.commit()
                return {"id": sid}
    raise HTTPException(status_code=500, detail="生成分享链接失败")


@app.get("/api/shares/{share_id}")
def api_share_info(share_id: str):
    if not re.fullmatch(r"[0-9a-f]{8}", share_id):
        raise HTTPException(status_code=404, detail="分享不存在")
    with SessionLocal() as db:
        share = db.get(Share, share_id)
        if not share:
            raise HTTPException(status_code=404, detail="分享不存在")
        try:
            ids = json.loads(share.file_ids)
        except (TypeError, ValueError):
            ids = []
        files = []
        for fid in ids:
            f = db.get(BucketFile, fid)
            if not f or not bucket_file_path(f.bucket_id, f.stored_name).exists():
                files.append(None)
                continue
            files.append(_file_info(db, f))
        return {
            "id": share.id,
            "created_at": iso_cn(share.created_at),
            "files": files,
        }


def _share_file_ids(share: Share) -> list:
    try:
        ids = json.loads(share.file_ids or "[]")
    except (TypeError, ValueError):
        return []
    return ids if isinstance(ids, list) else []


@app.get("/api/buckets/{bucket_id}/shares")
def api_bucket_shares(bucket_id: str, request: Request):
    with SessionLocal() as db:
        b = db.get(Bucket, bucket_id)
        if not b:
            raise HTTPException(status_code=404, detail="项目桶不存在")
        did = request.state.device_id
        admin = _is_admin_request(request)
        by_id = {
            f.id: f
            for f in db.query(BucketFile).filter(BucketFile.bucket_id == bucket_id).all()
        }
        items = []
        for s in db.query(Share).order_by(Share.created_at.desc()).all():
            if not admin and s.creator_id != did:
                continue
            ids = _share_file_ids(s)
            matched = [fid for fid in ids if fid in by_id]
            if not matched:
                continue
            items.append({
                "id": s.id,
                "created_at": iso_cn(s.created_at),
                "file_count": len(ids),
                "names": [by_id[fid].name for fid in matched],
                "can_delete": True,
            })
        return {"items": items}


@app.delete("/api/shares/{share_id}")
def api_delete_share(share_id: str, request: Request):
    if not re.fullmatch(r"[0-9a-f]{8}", share_id):
        raise HTTPException(status_code=404, detail="分享不存在")
    with SessionLocal() as db:
        share = db.get(Share, share_id)
        if not share:
            raise HTTPException(status_code=404, detail="分享不存在")
        ids = _share_file_ids(share)
        allowed = (
            _is_admin_request(request)
            or share.creator_id == request.state.device_id
        )
        if not allowed and ids:
            bucket_ids = {
                row[0] for row in
                db.query(BucketFile.bucket_id).filter(BucketFile.id.in_(ids)).all()
            }
            allowed = db.query(Bucket).filter(
                Bucket.id.in_(bucket_ids),
                Bucket.owner_id == request.state.device_id,
            ).first() is not None
        if not allowed:
            raise HTTPException(status_code=403, detail="没有权限")
        db.delete(share)
        db.commit()
    return {"ok": True}


@app.post("/api/buckets/{bucket_id}/download.zip")
async def api_download_zip(bucket_id: str, request: Request, background_tasks: BackgroundTasks, file_ids: str = Form("")):
    ids = []
    for raw in file_ids.split(","):
        fid = raw.strip()
        if _HEX32.match(fid) and fid not in ids:
            ids.append(fid)
    if not ids:
        raise HTTPException(status_code=400, detail="没有可下载的文件")

    with SessionLocal() as db:
        b = _get_bucket(db, bucket_id)
        rows = (
            db.query(BucketFile)
            .filter(BucketFile.bucket_id == b.id, BucketFile.id.in_(ids))
            .all()
        )
        by_id = {f.id: f for f in rows}
        entries = [
            (bucket_file_path(f.bucket_id, f.stored_name), f.name)
            for f in (by_id[fid] for fid in ids if fid in by_id)
        ]
        bucket_name = b.name

    if not entries:
        raise HTTPException(status_code=404, detail="文件不存在")

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = TEMP_DIR / f"zip_{uuid.uuid4().hex}.zip"
    used = set()
    aborted = False
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as zf:
            for path, name in entries:
                if not path.exists():
                    continue
                arc = name
                if arc in used:
                    stem, ext = os.path.splitext(name)
                    n = 2
                    while f"{stem} ({n}){ext}" in used:
                        n += 1
                    arc = f"{stem} ({n}){ext}"
                used.add(arc)
                await run_in_threadpool(zf.write, path, arcname=arc)
                # 浏览器中途关掉时不再继续打包，半成品直接清掉
                if await request.is_disconnected():
                    aborted = True
                    break
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    if aborted:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=499, detail="已取消打包")

    safe = re.sub(r'[\\/:*?"<>|]+', "_", re.sub(r"\s+", "", bucket_name)).strip()[:60] or "文件"
    stamp = now_cn().strftime("%Y%m%d_%H%M")
    background_tasks.add_task(tmp.unlink, missing_ok=True)
    return FileResponse(tmp, filename=f"{safe}_{stamp}.zip", media_type="application/zip")


@app.get("/api/files/{file_id}/download")
def api_download(file_id: str):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        path = bucket_file_path(f.bucket_id, f.stored_name)
        name = f.name
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已不存在")
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@app.get("/api/files/{file_id}/text")
def api_file_text(file_id: str):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        if f.ext not in TEXT_EXTS:
            raise HTTPException(status_code=415, detail="不是文本文件")
        path = bucket_file_path(f.bucket_id, f.stored_name)
        size = f.size
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已不存在")
    if size > MAX_TEXT_BYTES:
        raise HTTPException(status_code=413, detail="文件过大，无法在线编辑")
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "gbk", "latin-1"):
        try:
            return PlainTextResponse(raw.decode(enc))
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=415, detail="无法读取文本内容")


@app.get("/api/files/{file_id}/preview")
def api_preview(file_id: str):
    with SessionLocal() as db:
        f = db.get(BucketFile, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="文件不存在")
        path = bucket_file_path(f.bucket_id, f.stored_name)
        ext, name, size = f.ext, f.name, f.size
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已不存在")

    disp = {"Content-Disposition": f"inline; filename*=UTF-8''{quote(name)}"}
    if ext in IMAGE_TYPES:
        return FileResponse(path, media_type=IMAGE_TYPES[ext], headers=disp)
    if ext in VIDEO_TYPES:
        return FileResponse(path, media_type=VIDEO_TYPES[ext], headers=disp)
    if ext == "pdf":
        return FileResponse(path, media_type="application/pdf", headers=disp)
    if ext in TEXT_EXTS:
        with open(path, "rb") as fp:
            raw = fp.read(512 * 1024)
        headers = {"X-Text-Truncated": "1"} if int(size or 0) > len(raw) else None
        for enc in ("utf-8-sig", "gbk", "latin-1"):
            try:
                return PlainTextResponse(raw.decode(enc), headers=headers)
            except UnicodeDecodeError:
                continue
    raise HTTPException(status_code=415, detail="不支持预览")


# ───────────────────────── 看板 ─────────────────────────

@app.get("/api/dashboard")
def api_dashboard(request: Request):
    admin = request.state.is_admin
    if not admin and not sget_bool("dashboard_visible", True):
        raise HTTPException(status_code=403, detail="仅管理员可见")

    with SessionLocal() as db:
        total_buckets = db.query(func.count(Bucket.id)).scalar() or 0
        total_files = db.query(func.count(BucketFile.id)).scalar() or 0
        total_devices = db.query(func.count(Device.id)).scalar() or 0
        total_size = int(db.query(func.coalesce(func.sum(BucketFile.size), 0)).scalar() or 0)

        today = now_cn().date()
        start_day = today - timedelta(days=29)
        start_dt = datetime.combine(start_day, datetime.min.time())
        rows = (
            db.query(func.date(BucketFile.created_at), func.count(BucketFile.id))
            .filter(BucketFile.created_at >= start_dt)
            .group_by(func.date(BucketFile.created_at))
            .all()
        )
        day_counts = {str(r[0]): int(r[1]) for r in rows}
        trend = []
        for i in range(30):
            d = start_day + timedelta(days=i)
            trend.append({"date": d.strftime("%m-%d"), "count": day_counts.get(d.isoformat(), 0)})

        rank_rows = (
            db.query(
                BucketFile.bucket_id,
                func.count(BucketFile.id),
                func.coalesce(func.sum(BucketFile.size), 0),
            )
            .group_by(BucketFile.bucket_id)
            .order_by(func.coalesce(func.sum(BucketFile.size), 0).desc())
            .limit(10)
            .all()
        )
        bucket_ids = [r[0] for r in rank_rows]
        buckets = {b.id: b for b in db.query(Bucket).filter(Bucket.id.in_(bucket_ids)).all()} if bucket_ids else {}
        ranking = []
        for bid, cnt, sz in rank_rows:
            b = buckets.get(bid)
            if not b:
                continue
            item = {
                "name": b.name if admin else mask_bucket_name(b.name),
                "files": int(cnt),
                "size": int(sz or 0),
            }
            if admin:
                item["id"] = b.id
            ranking.append(item)

        ext_rows = (
            db.query(BucketFile.ext, func.count(BucketFile.id))
            .group_by(BucketFile.ext)
            .all()
        )
        groups = {name: 0 for name, _ in TYPE_GROUPS}
        groups["其他"] = 0
        for ext, cnt in ext_rows:
            label = "其他"
            for name, exts in TYPE_GROUPS:
                if ext in exts:
                    label = name
                    break
            groups[label] += int(cnt)
        types = [{"label": k, "count": v} for k, v in groups.items() if v > 0]

        return {
            "is_admin": admin,
            "stats": {
                "buckets": int(total_buckets),
                "files": int(total_files),
                "devices": int(total_devices),
                "size": total_size,
            },
            "trend": trend,
            "ranking": ranking,
            "types": types,
            "max_upload_mb": sget_int("max_upload_mb", 100),
            "refresh_sec": max(5, min(300, sget_int("dashboard_refresh_sec", 10))),
            "quota": quota_info(),
            "memory": memory_info(),
            "process_memory": process_memory_info(),
            "disk": disk_info(),
        }


# ───────────────────────── 管理 / 设置 ─────────────────────────

@app.get("/api/admin/buckets")
def api_admin_buckets(request: Request, q: str = ""):
    require_admin(request)
    with SessionLocal() as db:
        query = db.query(Bucket)
        if q.strip():
            query = query.filter(Bucket.name.contains(q.strip()))
        buckets = query.order_by(Bucket.created_at.desc()).all()
        stats = bucket_stats(db, [b.id for b in buckets])
        owners = nicknames_map(db, {b.owner_id for b in buckets})
        return {
            "total": len(buckets),
            "items": [
                {
                    "id": b.id,
                    "name": b.name,
                    "code": b.code,
                    "owner": owners.get(b.owner_id, "未知"),
                    "file_count": stats.get(b.id, (0, 0))[0],
                    "size": stats.get(b.id, (0, 0))[1],
                    "created_at": iso_cn(b.created_at),
                }
                for b in buckets
            ],
        }


@app.get("/api/admin/files")
def api_admin_files(request: Request, q: str = "", bucket_id: str = "", offset: int = 0, limit: int = 100):
    require_admin(request)
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    with SessionLocal() as db:
        query = (
            db.query(BucketFile, Bucket.name, Device.nickname)
            .join(Bucket, Bucket.id == BucketFile.bucket_id)
            .outerjoin(Device, Device.id == BucketFile.uploader_id)
        )
        if bucket_id and _HEX32.match(bucket_id):
            query = query.filter(BucketFile.bucket_id == bucket_id)
        if q.strip():
            kw = q.strip()
            query = query.filter(or_(
                BucketFile.name.contains(kw),
                Bucket.name.contains(kw),
                Device.nickname.contains(kw),
            ))
        total = query.count()
        rows = query.order_by(BucketFile.created_at.desc()).offset(offset).limit(limit).all()
        return {
            "total": int(total),
            "items": [
                {
                    "id": f.id,
                    "name": f.name,
                    "version": f.version,
                    "size": f.size,
                    "ext": f.ext,
                    "bucket_id": f.bucket_id,
                    "bucket_name": bname,
                    "uploader": nick or "未知",
                    "created_at": iso_cn(f.created_at),
                }
                for f, bname, nick in rows
            ],
        }


@app.get("/api/admin/settings")
def api_get_settings(request: Request):
    require_admin(request)
    disk = disk_info()
    q = quota_info()
    return {
        "max_upload_mb": sget_int("max_upload_mb", 100),
        "dashboard_visible": sget_bool("dashboard_visible", True),
        "disk_quota_percent": sget_int("disk_quota_percent", 20),
        "uploads_enabled": uploads_enabled(),
        "ext_mode": ext_rules()[0],
        "ext_list": ",".join(normalized_ext_list(sget("ext_list", ""))),
        "max_files_per_bucket": max(0, sget_int("max_files_per_bucket", 0)),
        "dashboard_refresh_sec": max(5, min(300, sget_int("dashboard_refresh_sec", 10))),
        "disk_total": q["disk_total"],
        "disk_free": q["disk_free"],
        "quota_bytes": q["quota_bytes"],
        "used_bytes": q["used_bytes"],
        "disk": disk,
        "is_default_password": sget("admin_password_is_default", "1") == "1",
    }


@app.post("/api/admin/settings")
def api_set_settings(body: SettingsIn, request: Request):
    require_admin(request)
    if not (1 <= body.max_upload_mb <= 102400):
        raise HTTPException(status_code=400, detail="单文件上限需在 1–102400 MB 之间")
    if not (1 <= body.disk_quota_percent <= 90):
        raise HTTPException(status_code=400, detail="磁盘占用比例需在 1–90% 之间")
    if body.ext_mode not in ("off", "allow", "deny"):
        raise HTTPException(status_code=400, detail="扩展名规则不合法")
    if not (0 <= body.max_files_per_bucket <= 100000):
        raise HTTPException(status_code=400, detail="单桶文件数量上限需在 0–100000 之间")
    if not (5 <= body.dashboard_refresh_sec <= 300):
        raise HTTPException(status_code=400, detail="看板刷新间隔需在 5–300 秒之间")
    exts = normalized_ext_list(body.ext_list)
    if len(",".join(exts)) > 2000:
        raise HTTPException(status_code=400, detail="扩展名列表过长")

    sset("max_upload_mb", body.max_upload_mb)
    sset("dashboard_visible", "1" if body.dashboard_visible else "0")
    sset("uploads_enabled", "1" if body.uploads_enabled else "0")
    sset("ext_mode", body.ext_mode)
    sset("ext_list", ",".join(exts))
    sset("max_files_per_bucket", body.max_files_per_bucket)
    sset("dashboard_refresh_sec", body.dashboard_refresh_sec)
    if body.disk_quota_percent != sget_int("disk_quota_percent", 20) or sget_int("disk_quota_bytes", 0) <= 0:
        free = int(disk_info().get("free") or 0)
        sset("disk_quota_bytes", int(free * body.disk_quota_percent / 100))
    sset("disk_quota_percent", body.disk_quota_percent)
    return {"ok": True, **api_get_settings(request)}


@app.delete("/api/admin/shares")
def api_invalidate_shares(request: Request):
    require_admin(request)
    with SessionLocal() as db:
        count = db.query(Share).delete()
        db.commit()
    return {"ok": True, "count": int(count or 0)}


@app.post("/api/admin/password")
def api_change_password(body: PasswordIn, request: Request):
    require_admin(request)
    if not bcrypt.checkpw(body.old_password.encode("utf-8"), sget("admin_password_hash", "").encode("utf-8")):
        raise HTTPException(status_code=401, detail="原密码错误")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    if len(body.new_password) > 64:
        raise HTTPException(status_code=400, detail="新密码最多 64 位")
    sset("admin_password_hash", bcrypt.hashpw(body.new_password.encode("utf-8"), bcrypt.gensalt()).decode())
    sset("admin_password_is_default", "0")
    return {"ok": True}


# ───────────────────────── OTA 系统更新 ─────────────────────────

OTA_MANIFEST_NAME = "manifest.json"
OTA_MARK_NAME = ".ota_restart"
OTA_RUNTIME_ROOT = BASE_DIR
OTA_ROLLBACK_NAME = ".ota_rollback.json"
OTA_BACKUP_NAME = ".ota_backup"
OTA_STAGE_NAME = ".ota_stage"
OTA_HEARTBEAT_NAME = ".watchdog_heartbeat"
# 上传与解压上限，防止超大包或压缩炸弹拖垮服务
OTA_MAX_PACKAGE = 200 * 1024 * 1024
OTA_MAX_TOTAL = 500 * 1024 * 1024
OTA_MAX_ENTRY = 200 * 1024 * 1024
OTA_MAX_ENTRIES = 5000
# 守护进程心跳超过这么久没更新，视为未运行
OTA_HEARTBEAT_MAX_AGE = 30

# OTA 解压时绝不覆盖的运行时数据（相对应用根）
OTA_BLOCKED_FILES = {
    OTA_MANIFEST_NAME, OTA_MARK_NAME, OTA_ROLLBACK_NAME, OTA_HEARTBEAT_NAME,
    "watchdog.log", "crash.log", "server.log", "server_run.log",
}
OTA_BLOCKED_DIRS = {"data", "__pycache__", ".venv", ".git", OTA_BACKUP_NAME, OTA_STAGE_NAME}
OTA_BLOCKED_EXTS = {".pyc", ".pyo", ".db", ".log", ".db-wal", ".db-shm"}

# 更新包清单校验码：由版本号经 HMAC 得出，防止改掉版本号绕过「禁止旧版本」拦截。
# 必须与 打包更新.py 里的 OTA_SECRET 完全一致。
OTA_SECRET = "801-file-bucket-ota-5c9e2f7a4b1d8036"


def _ota_checksum(version: str) -> str:
    return hmac.new(OTA_SECRET.encode("utf-8"), str(version).encode("utf-8"),
                    hashlib.sha256).hexdigest()[:16]


# 更新进度（供前端轮询显示）
OTA_STATE = {"running": False, "phase": "idle", "total": 0, "done": 0,
             "current": "", "version": "", "message": ""}


def _ota_changelog(zf, version: str) -> str:
    """从包内 CHANGELOG.md 里截出该版本的更新日志（正文部分，去掉标题行）。"""
    try:
        md = zf.read("CHANGELOG.md").decode("utf-8")
    except Exception:
        return ""
    pat = re.compile(r"^###\s*v?" + re.escape(version) + r"\b.*?(?=^###\s|\Z)", re.S | re.M)
    m = pat.search(md)
    if not m:
        return ""
    lines = [l for l in m.group(0).split("\n")[1:] if l.strip()]
    return "\n".join(lines).strip()


def _ota_is_older(new: str, cur: str) -> bool:
    """比较两段版本号，new 比 cur 旧返回 True。逐段取数字比较，缺失段补 0。"""
    def segs(v):
        return [int(x) for x in re.findall(r"\d+", str(v or ""))]

    a, b = segs(new), segs(cur)
    n = max(len(a), len(b))
    a += [0] * (n - len(a))
    b += [0] * (n - len(b))
    return a < b


def _sha256_file(path: Path):
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def _sha256_zip_member(zf, info) -> str:
    h = hashlib.sha256()
    with zf.open(info) as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _ota_unsafe_reason(name: str):
    """检查更新包里的相对路径是否允许写入；返回原因，允许时返回 None。
    目录/文件名一律按小写比较（Windows 文件系统不区分大小写）。"""
    parts = [p for p in str(name).replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or str(name).startswith("/") or any(p == ".." for p in parts):
        return "路径不合法"
    if parts[-1].lower() in OTA_BLOCKED_FILES:
        return "受保护的文件"
    if any(p.lower() in OTA_BLOCKED_DIRS for p in parts[:-1]):
        return "受保护的目录"
    if os.path.splitext(parts[-1])[1].lower() in OTA_BLOCKED_EXTS:
        return "受保护的文件类型"
    base = BASE_DIR.resolve()
    target = (base / "/".join(parts)).resolve()
    if base != target and base not in target.parents:
        return "路径越界"
    data_root = DATA_DIR.resolve()
    if target == data_root or data_root in target.parents:
        return "数据目录受保护"
    return None


def _ota_watchdog_alive() -> bool:
    """watchdog 会持续写心跳文件；心跳太旧说明没在运行，更新后没人拉起服务。"""
    try:
        hb = OTA_RUNTIME_ROOT / OTA_HEARTBEAT_NAME
        return (time.time() - hb.stat().st_mtime) <= OTA_HEARTBEAT_MAX_AGE
    except OSError:
        return False


def _ota_parse(raw: bytes):
    """解析并校验更新包，返回 (version, built_at, checksum, checksum_ok, entries, deletes, changelog)。
    entries = [{"orig": zip 内的原始名, "name": 归一化后的相对路径, "changed": 内容是否有变化}, ...]，
    只含清单列出的文件；与磁盘上现有文件哈希一致时 changed 为 False。
    deletes = 清单要求删除、且当前确实存在的文件。
    结构性问题（非 zip、缺清单、清单不一致、超出限额）抛 HTTPException；
    校验码只解析不在此拦截，留给真正执行更新前再拦。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="不是有效的 zip 更新包")

    try:
        manifest = json.loads(zf.read(OTA_MANIFEST_NAME).decode("utf-8"))
    except KeyError:
        raise HTTPException(status_code=400, detail="更新包缺少 manifest.json")
    except Exception:
        raise HTTPException(status_code=400, detail="manifest.json 无法解析")
    version = str(manifest.get("version") or "")
    listed = manifest.get("files")
    deleted = manifest.get("delete") or []
    if not version or not isinstance(listed, list) or not isinstance(deleted, list):
        raise HTTPException(status_code=400, detail="manifest.json 内容不完整")

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > OTA_MAX_ENTRIES:
        raise HTTPException(status_code=400, detail=f"更新包文件数过多（上限 {OTA_MAX_ENTRIES}）")
    total_size = 0
    for info in infos:
        if info.flag_bits & 0x1:
            raise HTTPException(status_code=400, detail="更新包包含加密文件，无法处理")
        if info.file_size > OTA_MAX_ENTRY:
            raise HTTPException(status_code=400, detail=f"单个文件过大：{info.filename}")
        total_size += info.file_size
    if total_size > OTA_MAX_TOTAL:
        raise HTTPException(status_code=400, detail="更新包解压后过大（上限 500 MB）")

    checksum = str(manifest.get("checksum") or "")
    checksum_ok = bool(checksum) and hmac.compare_digest(checksum, _ota_checksum(version))

    names_map = {}
    for info in infos:
        names_map[info.filename.replace("\\", "/")] = info

    bad_listed = [f for f in listed if not isinstance(f, str)]
    if bad_listed:
        raise HTTPException(status_code=400, detail="manifest.json 的文件列表格式不正确")
    listed_norm = []
    seen = set()
    for f in listed:
        n = f.replace("\\", "/")
        if n not in seen:
            seen.add(n)
            listed_norm.append(n)
    missing = [f for f in listed_norm if f not in names_map]
    if missing:
        raise HTTPException(status_code=400, detail="更新包与清单不一致，缺少：" + "、".join(missing[:5]))

    if "main.py" in names_map:
        m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"',
                      zf.read(names_map["main.py"]).decode("utf-8", errors="replace"))
        if m and m.group(1) != version:
            raise HTTPException(
                status_code=400,
                detail=f"包内程序版本（{m.group(1)}）与清单版本（{version}）不一致")

    entries = []
    for name in listed_norm:
        reason = _ota_unsafe_reason(name)
        if reason:
            raise HTTPException(status_code=400,
                                detail=f"清单包含不允许更新的文件：{name}（{reason}）")
        info = names_map[name]
        target = (BASE_DIR.resolve() / name)
        changed = _sha256_zip_member(zf, info) != _sha256_file(target)
        entries.append({"orig": info.filename, "name": name, "changed": changed})

    deletes = []
    for name in deleted:
        if not isinstance(name, str):
            raise HTTPException(status_code=400, detail="manifest.json 的删除列表格式不正确")
        name = name.replace("\\", "/")
        reason = _ota_unsafe_reason(name)
        if reason:
            raise HTTPException(status_code=400,
                                detail=f"清单要求删除不允许改动的文件：{name}（{reason}）")
        if name in seen:
            continue
        if (BASE_DIR.resolve() / name).is_file():
            deletes.append(name)

    changelog = _ota_changelog(zf, version)
    zf.close()
    return version, str(manifest.get("built_at") or ""), checksum, checksum_ok, entries, deletes, changelog


def _ota_restore(base: Path, backup_files: Path, written: list, deleted: list):
    """把已备份的旧文件放回原处，并删掉本次新增的文件。用于更新中途失败时自愈。"""
    for item in written:
        target = base / item["name"]
        try:
            if item["existed"]:
                src = backup_files / item["name"]
                if src.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, target)
            elif target.is_file():
                target.unlink()
        except OSError:
            pass
    for item in deleted:
        try:
            src = backup_files / item["name"]
            if src.is_file():
                target = base / item["name"]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, target)
        except OSError:
            pass


def _ota_apply(raw: bytes, entries: list, deletes: list, version: str):
    """后台执行：先把新文件解到暂存目录，再备份将被覆盖/删除的文件并写回滚记录，
    最后原子替换、删除旧文件。全部成功后才写标记并退出，由 watchdog 重启服务。
    任何一步失败都立即用备份把现场恢复原样。"""
    base = BASE_DIR.resolve()
    stage = OTA_RUNTIME_ROOT / OTA_STAGE_NAME
    backup = OTA_RUNTIME_ROOT / OTA_BACKUP_NAME
    backup_files = backup / "files"
    rollback_log = OTA_RUNTIME_ROOT / OTA_ROLLBACK_NAME
    written, deleted = [], []
    try:
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir(parents=True, exist_ok=True)

        # 1) 解压到暂存目录（与部署目录同卷，后面才能原子替换）
        zf = zipfile.ZipFile(io.BytesIO(raw))
        write_total = sum(1 for e in entries if e["changed"]) + len(deletes)
        OTA_STATE.update(phase="extracting", total=write_total, done=0, current="", message="")
        staged = []
        for entry in entries:
            if entry["changed"]:
                info = zf.getinfo(entry["orig"])
                dest = stage / entry["name"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                staged.append((entry["name"], dest))
        zf.close()

        # 2) 依赖有变化时先安装，安装失败就中止，此时程序文件还没动
        staged_req = stage / "requirements.txt"
        if staged_req.is_file():
            OTA_STATE.update(phase="deps", current="安装依赖…")
            r = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(staged_req),
                 "--disable-pip-version-check"],
                capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                tail = ((r.stderr or r.stdout or "").strip().splitlines() or ["未知错误"])[-1]
                raise RuntimeError(f"依赖安装失败：{tail}")

        # 3) 备份将被覆盖与将被删除的文件，并写回滚记录
        OTA_STATE.update(phase="backup", current="")
        shutil.rmtree(backup, ignore_errors=True)
        backup_files.mkdir(parents=True, exist_ok=True)
        for name, _dest in staged:
            target = base / name
            existed = target.is_file()
            if existed:
                b = backup_files / name
                b.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, b)
            written.append({"name": name, "existed": existed})
        for name in deletes:
            target = base / name
            if target.is_file():
                b = backup_files / name
                b.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, b)
                deleted.append({"name": name, "existed": True})
        rollback_log.write_text(json.dumps({
            "version": version,
            "created_at": datetime.now(CN_TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "backup_dir": str(backup),
            "written": written,
            "deleted": deleted,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        # 4) 原子替换 + 删除旧文件
        OTA_STATE.update(phase="applying", total=len(staged) + len(deleted), done=0)
        for i, (name, dest) in enumerate(staged, 1):
            target = base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(dest, target)
            OTA_STATE.update(done=i, current=name)
        for j, item in enumerate(deleted, len(staged) + 1):
            try:
                (base / item["name"]).unlink()
            except FileNotFoundError:
                pass
            OTA_STATE.update(done=j, current=item["name"])

        # 5) 写更新标记（watchdog 根目录），交给 watchdog 重启
        mark = OTA_RUNTIME_ROOT / OTA_MARK_NAME
        try:
            mark.write_text(f"{version}\n{datetime.now(CN_TZ).strftime('%Y-%m-%d %H:%M:%S')}\n",
                            encoding="utf-8")
        except Exception:
            pass

        shutil.rmtree(stage, ignore_errors=True)
        OTA_STATE.update(phase="restarting", current="")
        time.sleep(3)          # 留出前端「3 秒后重启」倒计时
        # 非 0 退出：即使标记文件没被守护进程看到，也会按异常退出自动拉起
        os._exit(1001)
    except Exception as e:
        try:
            _ota_restore(base, backup_files, written, deleted)
            rollback_log.unlink(missing_ok=True)
            shutil.rmtree(backup, ignore_errors=True)
        except Exception:
            pass
        shutil.rmtree(stage, ignore_errors=True)
        OTA_STATE.update(running=False, phase="error", message=str(e))


def _ota_confirm_startup():
    """更新重启后服务能正常跑起来，说明新版本可用：延迟一段时间清掉回滚备份。"""
    rollback_log = OTA_RUNTIME_ROOT / OTA_ROLLBACK_NAME
    if not rollback_log.exists():
        return
    time.sleep(20)
    if rollback_log.exists():
        try:
            rollback_log.unlink()
            shutil.rmtree(OTA_RUNTIME_ROOT / OTA_BACKUP_NAME, ignore_errors=True)
        except OSError:
            pass


async def _ota_read_upload(file: UploadFile) -> bytes:
    """流式读取上传内容，超过上限立即中止，避免把内存吃满。"""
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > OTA_MAX_PACKAGE:
            raise HTTPException(status_code=413,
                                detail=f"更新包过大（上限 {OTA_MAX_PACKAGE // (1024 * 1024)} MB）")
    return bytes(buf)


@app.get("/api/version")
def api_version():
    return {"version": APP_VERSION}


@app.post("/api/system/ota-update")
async def system_ota_update(request: Request, background: BackgroundTasks,
                            file: UploadFile = File(...), dry_run: bool = False):
    """OTA 更新：dry_run=true 只解析校验并返回结果供二次确认；
    否则覆盖程序代码，写完标记后由 watchdog 重启一次。"""
    require_admin(request)
    raw = await _ota_read_upload(file)
    version, built_at, checksum, checksum_ok, entries, deletes, changelog = _ota_parse(raw)
    files = [{"name": e["name"], "changed": e["changed"]} for e in entries]
    overwrite_count = sum(1 for e in entries if e["changed"])
    watchdog_ok = _ota_watchdog_alive()

    if dry_run:
        return {"ok": True, "dry_run": True, "version": version, "built_at": built_at,
                "current": APP_VERSION, "checksum": checksum, "checksum_ok": checksum_ok,
                "changelog": changelog, "files": files,
                "count": len(files), "overwrite_count": overwrite_count,
                "same_count": len(files) - overwrite_count,
                "delete_count": len(deletes), "deletes": deletes,
                "watchdog_ok": watchdog_ok,
                "older": _ota_is_older(version, APP_VERSION)}

    if not checksum_ok:
        raise HTTPException(status_code=400, detail="更新包校验码无效，版本号可能被篡改")
    if _ota_is_older(version, APP_VERSION):
        raise HTTPException(status_code=400,
                            detail=f"不能更新到更旧的版本（当前 {APP_VERSION}）")
    if not watchdog_ok:
        raise HTTPException(status_code=503,
                            detail="守护进程未运行，更新后无法自动重启服务，已取消更新。请先通过「守护启动.bat」启动服务再更新")

    if OTA_STATE.get("running"):
        raise HTTPException(status_code=409, detail="已有更新正在进行中，请稍候")
    OTA_STATE.update(running=True, phase="extracting", total=len(entries) + len(deletes),
                     done=0, current="", version=version, message="")
    background.add_task(_ota_apply, raw, entries, deletes, version)
    return {"ok": True, "version": version, "files": files, "count": len(files),
            "delete_count": len(deletes), "message": "开始更新"}


@app.get("/api/system/ota-progress")
async def system_ota_progress(request: Request):
    """OTA 更新进度，供前端轮询显示。"""
    require_admin(request)
    return OTA_STATE


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT, log_level="warning", access_log=False)
