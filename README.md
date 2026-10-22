# 801 文件桶

局域网文件收集与共享服务。打开浏览器就能用：建一个项目桶，把 6 位识别码发给大家，谁都能上传、下载、预览文件，也能生成分享链接或打包下载。无需注册，单机部署，数据保存在本地。

## 部署

### Windows

1. 安装 [Python 3.10+](https://www.python.org/downloads/)，安装时勾选 **Add Python to PATH**。
2. 双击 `安装依赖.bat`。
3. 双击 `启动项目.bat`，浏览器会自动打开 <http://127.0.0.1:51001>。
4. 局域网访问：右键以管理员身份运行 `开放局域网访问.bat`，其他设备访问 `http://本机IP:51001`。

长期运行双击 `守护启动.bat`；需要开机自启时，右键管理员运行 `设置守护自启.bat`。

### Linux

```bash
sudo apt install -y python3 python3-venv
cd /opt/801-file-bucket      # 换成实际解压目录
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python main.py
```

浏览器访问 `http://服务器IP:51001`。需要后台常驻时可以用 systemd：

```ini
# /etc/systemd/system/801-file-bucket.service
[Unit]
Description=801 File Bucket
After=network.target

[Service]
WorkingDirectory=/opt/801-file-bucket
ExecStart=/opt/801-file-bucket/.venv/bin/python /opt/801-file-bucket/main.py
Restart=always
Environment=TZ=Asia/Shanghai

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 801-file-bucket
```

> 以 root 运行最简单。想用普通用户运行，先把程序目录和 `data/` 的属主改成该用户，再在 unit 里加 `User=用户名`。

### 首次登录

管理后台：`http://服务器IP:51001/login.html`。默认密码 `admin123`，登录后立即在「设置」里修改。

## 反向代理与域名（可选）

想用 Nginx 的 80/443 端口访问或绑定域名，可以这样转发：

```nginx
server {
    listen 80;
    server_name _;                # 绑定域名时改成 files.example.com
    client_max_body_size 1024m;

    location / {
        proxy_pass http://127.0.0.1:51001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

用服务器 IP 访问就打开 `http://服务器IP`；用域名访问，先在域名服务商添加 A 记录指向服务器 IP。需要 HTTPS 时执行 `sudo certbot --nginx -d 你的域名`。`client_max_body_size` 要大于后台上传上限。

## 功能

- 匿名设备身份，无需注册
- 项目桶 + 6 位识别码
- 拖拽/批量上传，图片、视频、文本在线预览
- 在线新建和编辑文本文件
- 多选打包 ZIP 下载
- 分享链接
- 数据看板
- 管理后台：文件管理、上传限制、扩展名规则、磁盘配额、修改密码
- 守护进程与在线更新

## 数据

所有数据都在 `data/`：`app.db` 是数据库，`uploads/` 是文件本体。备份时停掉服务，复制整个 `data/` 目录即可。

## 安全

- 默认管理员密码是 `admin123`，必须修改。
- 默认 HTTP、没有用户账号体系，建议只在内网使用；对外访问请加 HTTPS 和访问控制。
- 可用扩展名白名单限制上传类型。

## 许可证

[MIT](LICENSE)

开发者：明灯花月夜 · <https://mdhyy.cn>
