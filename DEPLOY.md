# 801 文件桶部署指南

本文覆盖 Windows 与 Linux 两种部署方式，包括安装、开机自启、防火墙、备份、升级和常见问题。

- [一、环境要求](#一环境要求)
- [二、Windows 部署](#二windows-部署)
- [三、Linux 部署](#三linux-部署)
- [四、首次登录](#四首次登录)
- [五、局域网访问与防火墙](#五局域网访问与防火墙)
- [六、数据备份与恢复](#六数据备份与恢复)
- [七、升级](#七升级)
- [八、反向代理与访问方式（可选）](#八反向代理与访问方式可选)
- [九、常见问题](#九常见问题)

## 一、环境要求

| 项目 | 要求 |
| --- | --- |
| Python | 3.10 或更高版本 |
| 操作系统 | Windows 10/11；主流 Linux 发行版（Debian/Ubuntu、CentOS/RHEL、Rocky、Arch 等） |
| 端口 | 默认 `51001`（服务），`51002`（单实例锁），`51003`（守护进程锁） |
| 磁盘 | 程序与依赖约 200 MB，另加实际存储的文件占用 |
| 网络 | 仅需要局域网；客户端用浏览器访问，无需安装任何软件 |

> 服务默认监听 `0.0.0.0:51001`，同一局域网内的设备都可以访问。

## 二、Windows 部署

项目自带批处理脚本，解压后即可使用。

### 1. 安装 Python

从 <https://www.python.org/downloads/> 下载 Python 3.10 或更高版本。安装时务必勾选 **Add Python to PATH**。

安装完成后打开命令提示符，确认：

```bat
python --version
```

### 2. 安装依赖

双击 `安装依赖.bat`。脚本会：

1. 在项目目录创建 `.venv` 虚拟环境；
2. 使用阿里云镜像安装 `requirements.txt` 中的依赖；
3. 如果项目目录下存在 `packages\*.whl` 离线包，则优先离线安装。

依赖安装只需要执行一次。看到「依赖安装完成」即可关闭窗口。

### 3. 启动服务

双击 `启动项目.bat`。脚本会：

1. 检查并结束占用 `51001` 端口的旧进程；
2. 在新窗口中运行 `main.py`；
3. 等待端口就绪后，自动打开 <http://127.0.0.1:51001>。

关闭那个「801 文件桶 - 服务」窗口即可停止服务。

### 4. 放行防火墙

局域网内其他设备无法访问时，右键以管理员身份运行 `开放局域网访问.bat`。脚本会创建一条名为 `801 File Bucket 51001` 的 Windows 防火墙入站规则，允许 TCP 51001。

如需撤销，在「Windows Defender 防火墙 → 高级设置 → 入站规则」中删除该规则。

### 5. 守护进程与开机自启

`守护启动.bat` 会启动 `watchdog.py`：

- 自动拉起 `main.py`；
- 服务异常退出后自动重启；
- 显示运行时长、局域网地址、磁盘剩余等信息；
- 支持管理后台的在线更新。

关闭守护进程窗口时，它拉起的服务也会一起结束。

需要开机自启时，右键以管理员身份运行 `设置守护自启.bat`。它会创建一个名为 `801 File Bucket Watchdog` 的计划任务，在用户登录时以最高权限启动守护进程。运行 `取消守护自启.bat` 可取消。

若已经通过 `启动项目.bat` 启动了服务，请先运行 `停止项目.bat`，再启动守护进程，避免端口冲突。

### 6. 停止服务

双击 `停止项目.bat`。脚本会先停止守护进程，再结束占用 51001 端口的服务进程。

## 三、Linux 部署

以下以 Debian/Ubuntu 为例，其他发行版替换包管理器命令即可。

### 1. 安装 Python 与虚拟环境

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
python3 --version   # 需要 3.10+
```

### 2. 部署程序

把项目解压到 `/opt/801-file-bucket`（或其他固定目录）：

```bash
sudo mkdir -p /opt/801-file-bucket
sudo chown -R "$USER":"$USER" /opt/801-file-bucket
# 将项目文件复制到该目录后：
cd /opt/801-file-bucket
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

### 3. 试运行

```bash
cd /opt/801-file-bucket
.venv/bin/python main.py
```

看到服务启动后，在浏览器访问 `http://服务器IP:51001`。按 `Ctrl+C` 停止，然后配置 systemd。

首次运行会自动创建 `data/`、初始化数据库，并生成默认管理员密码 `admin123`。

### 4. 使用 systemd 托管

创建专用用户（推荐，避免以 root 运行）：

```bash
sudo useradd --system --home /opt/801-file-bucket --shell /usr/sbin/nologin filebucket
sudo chown -R filebucket:filebucket /opt/801-file-bucket
```

创建服务文件 `/etc/systemd/system/801-file-bucket.service`：

```ini
[Unit]
Description=801 File Bucket
After=network.target

[Service]
Type=simple
User=filebucket
Group=filebucket
WorkingDirectory=/opt/801-file-bucket
Environment=PYTHONUNBUFFERED=1
Environment=TZ=Asia/Shanghai
ExecStart=/opt/801-file-bucket/.venv/bin/python /opt/801-file-bucket/main.py
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 801-file-bucket
sudo systemctl status 801-file-bucket
```

查看日志：

```bash
sudo journalctl -u 801-file-bucket -f
```

> 此方式由 systemd 负责重启。若需要使用管理后台的在线更新（OTA），应用检测不到守护进程心跳会拒绝更新，请改用下一节的 watchdog 方式，或直接按[七、升级](#七升级)手动升级。

### 5. 可选：用 watchdog 托管（支持 OTA）

`watchdog.py` 也能在 Linux 上运行，它会拉起 `main.py`，并支持在线更新和失败回滚。将 systemd 的 `ExecStart` 改为：

```ini
ExecStart=/opt/801-file-bucket/.venv/bin/python /opt/801-file-bucket/watchdog.py
```

并加上：

```ini
StandardInput=null
```

> 注意：不要同时运行 systemd 服务和手动启动的 `main.py` / `watchdog.py`，否则会因单实例锁或端口占用而启动失败。

### 6. 防火墙

Ubuntu（ufw）：

```bash
sudo ufw allow 51001/tcp
sudo ufw status
```

CentOS/RHEL（firewalld）：

```bash
sudo firewall-cmd --permanent --add-port=51001/tcp
sudo firewall-cmd --reload
```

## 四、首次登录

1. 打开 `http://服务器IP:51001`；
2. 管理后台入口：`http://服务器IP:51001/login.html`；
3. 默认密码：`admin123`；
4. 登录后进入「设置」，立即修改管理员密码。

使用默认密码期间，设置页会显示提示。密码长度为 6–64 位。

## 五、局域网访问与防火墙

客户端与服务器需要处于同一局域网，或能路由到服务器所在的网段。常见排查顺序：

1. 在服务器本机访问 `http://127.0.0.1:51001`，确认服务正常；
2. 在其他设备访问 `http://服务器IP:51001`；
3. 检查服务器防火墙是否放行 TCP 51001；
4. 检查客户端与服务器是否在同一网段，服务器 IP 是否发生变化；
5. 确认没有其他设备或旧进程占用 51001 端口。

Windows 查看端口占用：

```bat
netstat -ano | findstr :51001
```

Linux 查看端口占用：

```bash
ss -lntp | grep 51001
```

## 六、数据备份与恢复

所有数据都在程序目录的 `data/` 下：`app.db`（含 WAL 文件）和 `uploads/`（文件本体）。备份时必须同时包含数据库和上传目录。

### 停机备份（推荐）

Windows：

1. 运行 `停止项目.bat`；
2. 复制整个 `data` 目录到备份位置；
3. 重新启动服务。

Linux：

```bash
sudo systemctl stop 801-file-bucket
sudo tar czf /path/to/backup-$(date +%F).tar.gz -C /opt/801-file-bucket data
sudo systemctl start 801-file-bucket
```

### 热备份（服务不停止）

SQLite 在 WAL 模式下，直接复制 `app.db` 可能漏掉尚未合并的数据。可以用 SQLite 的备份命令复制数据库，再复制上传目录：

```bash
sqlite3 /opt/801-file-bucket/data/app.db ".backup '/path/to/app-backup.db'"
rsync -a /opt/801-file-bucket/data/uploads/ /path/to/uploads-backup/
```

### 恢复

1. 停止服务；
2. 用备份的 `data` 目录覆盖现有 `data/`（或分别恢复 `app.db` 与 `uploads/`）；
3. 确认 `data/` 的所有者可被服务进程读写；
4. 启动服务。

## 七、升级

### Windows：在线更新（OTA）

1. 修改代码后，双击 `打包更新.bat` 运行 `打包更新.py`；
2. 脚本会把 `main.py` 中的 `APP_VERSION` 末段加一，并生成 `更新包/801_file_bucket_update_<版本>.zip`；
3. 确保服务由 `守护启动.bat` 运行（守护进程必须有心跳）；
4. 打开管理后台「设置 → 系统更新」，上传更新包；
5. 系统会先解析并显示变更清单，确认后自动备份、替换文件、安装依赖并重启；
6. 新版本连续启动失败时，守护进程会自动回滚到更新前的文件。

更新包不会包含 `data/`、日志、数据库、`.bat` 脚本和虚拟环境。

### Linux：手动升级

```bash
# 1. 备份
sudo systemctl stop 801-file-bucket
sudo tar czf /path/to/backup-$(date +%F).tar.gz -C /opt/801-file-bucket data

# 2. 覆盖程序文件（保留 data/ 和 .venv/）
#    将新版本文件解压覆盖到 /opt/801-file-bucket

# 3. 更新依赖
cd /opt/801-file-bucket
.venv/bin/pip install -r requirements.txt

# 4. 启动
sudo systemctl start 801-file-bucket
sudo systemctl status 801-file-bucket
```

升级前建议先备份 `data/`。程序本身不修改数据库结构时可直接回退程序文件；若已手动迁移数据，请用备份恢复。

## 八、反向代理与访问方式（可选）

801 文件桶默认监听 `0.0.0.0:51001`，可以部署在任意一台客户端能访问到的服务器上。常见有三种访问方式：

| 方式 | 访问地址 | 适用场景 |
| --- | --- | --- |
| 直接访问 | `http://服务器IP:51001` | 内网使用、只跑这一个服务，最简单 |
| 反向代理 + 服务器 IP | `http://服务器IP` 或 `http://服务器IP:8080` | 隐藏 51001、与其他服务共用 80/443 端口 |
| 反向代理 + 域名 | `http://files.example.com` 或 `https://files.example.com` | 需要域名、HTTPS 或对外提供访问 |

### 方式一：直接使用服务器 IP 和端口

不需要 Nginx。部署并启动服务后，放行防火墙的 TCP 51001，其他设备访问：

```
http://服务器IP:51001
```

如果服务器在路由器后面，需要把 51001 端口转发到服务器，外网才能访问；仅内网使用则不需要。

### 方式二：通过 Nginx 反向代理，用服务器 IP 访问

如果希望用 80/443 端口访问、隐藏 51001，或同一台服务器上还跑着其他服务，可以让 Nginx 转发：

```nginx
server {
    listen 80;
    server_name _;

    # 必须大于应用的单文件上限（默认 100 MB）
    client_max_body_size 1024m;

    location / {
        proxy_pass http://127.0.0.1:51001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

保存后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

访问 `http://服务器IP` 即可。如果 80 端口已被其他网站占用，把 `listen 80;` 改成 `listen 8080;`，访问地址相应变成 `http://服务器IP:8080`。

### 方式三：通过反向代理配置域名

1. 在域名服务商处添加解析记录：

   | 类型 | 主机记录 | 记录值 |
   | --- | --- | --- |
   | A | `files`（或 `@`） | 服务器的公网 IP |
   | AAAA | `files`（可选） | 服务器的 IPv6 地址 |

2. 等解析生效（通常几分钟到几小时），将 Nginx 配置中的 `server_name _;` 改成域名：

```nginx
server {
    listen 80;
    server_name files.example.com;

    client_max_body_size 1024m;

    location / {
        proxy_pass http://127.0.0.1:51001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

3. 重新加载 Nginx 后，访问 `http://files.example.com`。

如果服务器位于 NAT/路由器之后，还需要在路由器上把 80 端口转发到服务器；使用 HTTPS 时同时转发 443。

> 服务器在中国大陆时，绑定域名对外提供网站服务通常需要完成 ICP 备案，否则 80/443 可能被服务商拦截。

启用 HTTPS 时可使用 Certbot 自动申请证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d files.example.com
```

### 反向代理注意事项

- `client_max_body_size` 必须不小于后台上传上限，否则大文件会在代理层被拒绝。
- Nginx 与 801 文件桶部署在同一台机器时，应用会通过 `X-Forwarded-For` 取到真实客户端 IP，无需额外配置；如果代理在另一台机器上，需要设置环境变量 `FORWARDED_ALLOW_IPS` 为代理的 IP。
- 使用反向代理后，应关闭路由器上对 51001 的端口转发，只对外开放 80/443。
- 反向代理层可以再叠加访问控制（如仅允许内网来源、添加 Basic Auth），降低文件桶直接暴露的风险。

## 九、常见问题

### 其他设备打不开页面

先在本机确认 `http://127.0.0.1:51001` 正常，再检查防火墙、网段和服务器 IP。Windows 请用管理员身份运行 `开放局域网访问.bat`；Linux 请放行 TCP 51001。

### 提示端口被占用

```bat
netstat -ano | findstr :51001
taskkill /F /PID <PID>
```

```bash
ss -lntp | grep 51001
kill <PID>
```

注意先停止旧实例再启动新实例。服务自身还有 `51002` 单实例锁、守护进程有 `51003` 锁，重复启动会被拒绝。

### 忘记管理员密码

先停止服务，然后删除两项密码设置，重启后会恢复默认密码 `admin123`：

Windows / Linux 通用（在项目目录执行）：

```bash
python -c "import sqlite3; c=sqlite3.connect('data/app.db'); c.execute(\"delete from fb_setting where key in ('admin_password_hash','admin_password_is_default')\"); c.commit(); c.close()"
```

Linux 使用虚拟环境中的解释器：

```bash
.venv/bin/python -c "import sqlite3; c=sqlite3.connect('data/app.db'); c.execute(\"delete from fb_setting where key in ('admin_password_hash','admin_password_is_default')\"); c.commit(); c.close()"
```

重启后立即登录并修改密码。

### 上传大文件失败

按顺序检查：

1. 管理后台的「单文件上限」；
2. 磁盘额度与剩余空间；
3. 扩展名白名单是否拦截了该类型；
4. 使用 Nginx 时检查 `client_max_body_size`。

### 守护进程启动后立即退出

查看 `watchdog.log` 和 `server.log`。常见原因是端口被占用、依赖缺失、或已有一个实例在运行。Windows 可先运行 `停止项目.bat` 清理旧进程。

### 时间显示不对

服务统一使用中国时间（UTC+8），不跟随服务器系统时区。Linux 的 systemd 配置中已设置 `TZ=Asia/Shanghai`。

### 数据看板的内存卡片为空

内存统计依赖 Windows API，Linux 下该卡片为空属于预期行为，不影响其他功能。
