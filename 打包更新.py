#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""801 文件桶 - 打包更新脚本。

把当前项目的程序文件打成带 manifest.json 的 zip 更新包，供设置页的「更新」按钮上传。
数据目录、日志、数据库、批处理脚本不会进入更新包。
用法：
    python 打包更新.py
输出：
    更新包/801_file_bucket_update_<版本>.zip
"""
import hashlib
import hmac
import json
import os
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PACKAGES = BASE_DIR / "更新包"
OTA_MANIFEST = "manifest.json"

EXCLUDE_DIRS = {
    "data", "__pycache__", ".venv", ".git", ".idea", ".vscode",
    "更新包", ".ota_backup", ".ota_stage", "packages",
}
EXCLUDE_FILES = {
    OTA_MANIFEST, "打包更新.py", ".ota_restart", ".ota_rollback.json",
    ".watchdog_heartbeat", ".watchdog_pid",
}
EXCLUDE_EXTS = {".log", ".pyc", ".pyo", ".db", ".db-wal", ".db-shm", ".zip", ".bat"}

# 更新包清单校验码：与 main.py 里的 OTA_SECRET 必须完全一致
OTA_SECRET = "801-file-bucket-ota-5c9e2f7a4b1d8036"
CN_TZ = timezone(timedelta(hours=8))


def ota_checksum(version: str) -> str:
    return hmac.new(OTA_SECRET.encode("utf-8"), str(version).encode("utf-8"),
                    hashlib.sha256).hexdigest()[:16]


APP_VERSION_RE = re.compile(rb'(APP_VERSION\s*=\s*")([^"]+)(")')


def bump_app_version() -> tuple:
    """把 main.py 里的 APP_VERSION 末段加一，返回 (旧版本, 新版本, 原始字节)。"""
    path = BASE_DIR / "main.py"
    raw = path.read_bytes()
    m = APP_VERSION_RE.search(raw)
    if not m:
        raise RuntimeError("main.py 中没有找到 APP_VERSION")
    old = m.group(2).decode("utf-8")
    parts = old.split(".")
    if not parts[-1].isdigit():
        raise RuntimeError(f"APP_VERSION 格式无法自动递增：{old}")
    parts[-1] = str(int(parts[-1]) + 1).zfill(len(parts[-1]))
    new = ".".join(parts)
    path.write_bytes(raw[:m.start(2)] + new.encode("utf-8") + raw[m.end(2):])
    return old, new, raw


def collect_files() -> list:
    files = []
    for dirpath, dirnames, filenames in os.walk(BASE_DIR):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fn in filenames:
            path = Path(dirpath) / fn
            rel = path.relative_to(BASE_DIR).as_posix()
            if fn in EXCLUDE_FILES:
                continue
            if path.suffix.lower() in EXCLUDE_EXTS:
                continue
            if any(part.startswith(".") for part in rel.split("/")):
                continue
            files.append(rel)
    return sorted(files)


def build_package(version: str, files: list) -> Path:
    PACKAGES.mkdir(parents=True, exist_ok=True)
    out = PACKAGES / f"801_file_bucket_update_{version}.zip"
    manifest = {
        "app": "801_file_bucket",
        "version": version,
        "checksum": ota_checksum(version),
        "built_at": datetime.now(CN_TZ).strftime("%Y-%m-%d %H:%M"),
        "files": files,
        "delete": [],
    }
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            z.write(BASE_DIR / rel, rel)
        z.writestr(OTA_MANIFEST,
                   json.dumps(manifest, ensure_ascii=False, indent=2))
    return out


def prune_packages(keep: int = 5):
    pkgs = sorted(PACKAGES.glob("801_file_bucket_update_*.zip"),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    removed = 0
    for old in pkgs[keep:]:
        try:
            old.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def main():
    files = collect_files()
    old_version, version, raw = bump_app_version()
    try:
        pkg = build_package(version, files)
    except Exception:
        (BASE_DIR / "main.py").write_bytes(raw)
        raise
    print(f"版本：{old_version} → {version}")
    print(f"文件：{len(files)} 个")
    print(f"更新包：{pkg}")
    print(f"大小：{pkg.stat().st_size / 1024:.1f} KB")
    removed = prune_packages()
    if removed:
        print(f"已清理旧更新包 {removed} 个（只保留最近 5 个）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
