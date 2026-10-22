(function () {
    var APP = window.APP = window.APP || {};
    var DEV_KEY = 'fb_device';

    var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];
    var VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'mov', 'ogv'];
    var TEXT_EXTS = [
        'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yml', 'yaml',
        'ini', 'conf', 'cfg', 'toml', 'py', 'js', 'ts', 'jsx', 'tsx', 'go', 'java',
        'c', 'h', 'cpp', 'hpp', 'cs', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql',
        'html', 'htm', 'css', 'scss', 'less', 'vue'
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        var units = ['KB', 'MB', 'GB', 'TB', 'PB'];
        var i = -1;
        do {
            n /= 1024;
            i++;
        } while (n >= 1024 && i < units.length - 1);
        var v = n >= 100 ? n.toFixed(0) : (n >= 10 ? n.toFixed(1) : n.toFixed(2));
        return v + ' ' + units[i];
    }

    function fmtMb(mb) {
        mb = Number(mb) || 0;
        if (mb < 1024) return mb + ' MB';
        var gb = mb / 1024;
        return (gb % 1 ? gb.toFixed(1) : gb.toFixed(0)) + ' GB';
    }

    function fmtTime(iso) {
        if (!iso) return '—';
        return String(iso).replace('T', ' ').slice(0, 16);
    }

    function fileIcon(ext) {
        if (IMAGE_EXTS.indexOf(ext) >= 0) return 'bi-file-earmark-image';
        if (ext === 'pdf') return 'bi-file-earmark-pdf';
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].indexOf(ext) >= 0) return 'bi-file-earmark-zip';
        if (['doc', 'docx', 'rtf', 'odt'].indexOf(ext) >= 0) return 'bi-file-earmark-word';
        if (['xls', 'xlsx', 'csv'].indexOf(ext) >= 0) return 'bi-file-earmark-excel';
        if (['ppt', 'pptx'].indexOf(ext) >= 0) return 'bi-file-earmark-ppt';
        if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts'].indexOf(ext) >= 0) return 'bi-film';
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'].indexOf(ext) >= 0) return 'bi-music-note-beamed';
        if (TEXT_EXTS.indexOf(ext) >= 0) return 'bi-file-earmark-code';
        return 'bi-file-earmark';
    }

    function deviceHeaders() {
        var h = {};
        try {
            var id = localStorage.getItem(DEV_KEY);
            if (id) h['X-Device-Id'] = id;
        } catch (e) {}
        return h;
    }

    async function api(path, opts) {
        opts = opts || {};
        var headers = Object.assign({}, opts.headers || {}, deviceHeaders());
        var body = opts.body;
        if (body && !(body instanceof FormData) && typeof body !== 'string') {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }
        var res = await fetch(path, {
            method: opts.method || 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: headers,
            body: body
        });
        var data = null;
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('application/json') >= 0) {
            try { data = await res.json(); } catch (e) {}
        }
        if (!res.ok) {
            var detail = data && data.detail;
            var msg = '请求失败（' + res.status + '）';
            if (typeof detail === 'string') msg = detail;
            else if (Array.isArray(detail)) msg = detail.map(function (x) { return x.msg; }).join('；');
            else if (data && data.message) msg = data.message;
            var err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function loadMe() {
        try {
            APP.me = await api('/api/me');
            if (APP.me && APP.me.device_id) {
                try { localStorage.setItem(DEV_KEY, APP.me.device_id); } catch (e) {}
            }
        } catch (e) {
            APP.me = null;
        }
        return APP.me;
    }

    function toast(msg, type) {
        var host = document.getElementById('toastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toastHost';
            host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            host.style.zIndex = '2000';
            document.body.appendChild(host);
        }
        var el = document.createElement('div');
        el.className = 'toast align-items-center border-0 ' +
            (type === 'error' ? 'text-bg-danger' : (type === 'warn' ? 'text-bg-warning' : 'text-bg-success'));
        el.innerHTML = '<div class="d-flex"><div class="toast-body"></div>' +
            '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
        el.querySelector('.toast-body').textContent = msg;
        host.appendChild(el);
        var t = bootstrap.Toast.getOrCreateInstance(el, { delay: 2600 });
        el.addEventListener('hidden.bs.toast', function () { el.remove(); });
        t.show();
    }

    var FLASH_KEY = 'fb_flash';

    function flash(msg, type) {
        try {
            sessionStorage.setItem(FLASH_KEY, JSON.stringify({ msg: msg, type: type || 'success' }));
        } catch (e) {}
    }

    function showFlash() {
        var raw = null;
        try {
            raw = sessionStorage.getItem(FLASH_KEY);
            sessionStorage.removeItem(FLASH_KEY);
        } catch (e) {}
        if (!raw) return;
        try {
            var d = JSON.parse(raw);
            if (d && d.msg) toast(d.msg, d.type);
        } catch (e) {}
    }

    function copyText(text) {
        return new Promise(function (resolve) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '0';
            ta.style.top = '0';
            ta.style.width = '2px';
            ta.style.height = '2px';

            function onCopy(e) {
                e.clipboardData.setData('text/plain', text);
                e.preventDefault();
            }

            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            document.addEventListener('copy', onCopy);
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.removeEventListener('copy', onCopy);
            ta.remove();
            if (ok) {
                resolve(true);
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { resolve(true); })
                    .catch(function () { resolve(false); });
            } else {
                resolve(false);
            }
        });
    }

    function navHtml(me, active) {
        var admin = !!(me && me.is_admin);
        var dashVisible = admin || !!(me && me.dashboard_visible);
        var nick = me ? me.nickname : '';
        return '' +
            '<nav class="navbar navbar-expand-lg navbar-dark site-navbar sticky-top">' +
            '  <div class="container-fluid app-container py-0">' +
            '    <a class="navbar-brand" href="/"><i class="bi bi-archive"></i> 801 文件桶</a>' +
            '    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain">' +
            '      <span class="navbar-toggler-icon"></span>' +
            '    </button>' +
            '    <div class="collapse navbar-collapse" id="navMain">' +
            '      <ul class="navbar-nav me-auto">' +
            '        <li class="nav-item"><a class="nav-link ' + (active === 'home' ? 'active' : '') + '" href="/"><i class="bi bi-house"></i> 首页</a></li>' +
            (dashVisible ? '        <li class="nav-item"><a class="nav-link ' + (active === 'dashboard' ? 'active' : '') + '" href="/dashboard.html"><i class="bi bi-bar-chart"></i> 看板</a></li>' : '') +
            (admin ? '        <li class="nav-item"><a class="nav-link ' + (active === 'admin' ? 'active' : '') + '" href="/admin.html"><i class="bi bi-grid-1x2"></i> 管理</a></li>' : '') +
            (admin ? '        <li class="nav-item"><a class="nav-link ' + (active === 'settings' ? 'active' : '') + '" href="/settings.html"><i class="bi bi-sliders"></i> 设置</a></li>' : '') +
            '      </ul>' +
            '      <div class="d-flex align-items-center gap-2 text-white flex-wrap">' +
            '        <button type="button" class="nav-pill" id="nickBtn" title="个人信息">' +
            '          <i class="bi bi-person-circle"></i> <span class="nick-text" id="nickText">' + esc(nick) + '</span></button>' +
            '        <button type="button" class="btn btn-sm btn-light" id="themeBtn" title="深浅色切换"><i class="bi bi-moon-stars"></i></button>' +
            (admin
                ? '        <button type="button" class="btn btn-sm btn-light" id="logoutBtn" title="退出管理员"><i class="bi bi-box-arrow-right"></i> 退出</button>'
                : '        <a class="btn btn-sm btn-light" href="/login.html" title="管理员登录"><i class="bi bi-shield-lock"></i> 登录</a>') +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</nav>';
    }

    function syncThemeIcon() {
        var icon = document.querySelector('#themeBtn i');
        if (!icon) return;
        icon.className = 'bi ' + (window.FBTheme && window.FBTheme.get() === 'dark' ? 'bi-sun' : 'bi-moon-stars');
    }

    var bound = false;

    function injectModals() {
        if (document.getElementById('nickModal')) return;
        var host = document.createElement('div');
        host.innerHTML = '' +
            '<div class="modal fade" id="profileModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-640">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title">个人信息</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body"><div class="info-grid" id="profileGrid"></div></div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">关闭</button>' +
            '        <button type="button" class="btn btn-primary" id="profileEditBtn"><i class="bi bi-pencil"></i> 修改昵称</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="nickModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <form id="nickForm">' +
            '        <div class="modal-header"><h5 class="modal-title">昵称</h5>' +
            '          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '        <div class="modal-body"><input id="nickInput" class="form-control" maxlength="20" required></div>' +
            '        <div class="modal-footer">' +
            '          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '          <button type="submit" class="btn btn-primary">保存</button>' +
            '        </div>' +
            '      </form>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="alertModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-640">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title" id="alertTitle"></h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body"><div class="confirm-msg" id="alertMsg"></div></div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">知道了</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="confirmModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-640">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title" id="confirmTitle"></h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body"><div class="confirm-msg" id="confirmMsg"></div></div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" id="confirmCancel">取消</button>' +
            '        <button type="button" class="btn btn-danger" id="confirmOk">删除</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="promptModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-640">' +
            '    <div class="modal-content">' +
            '      <form id="promptForm">' +
            '        <div class="modal-header"><h5 class="modal-title" id="promptTitle"></h5>' +
            '          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '        <div class="modal-body">' +
            '          <label class="form-label small text-muted-2" id="promptLabel">名称</label>' +
            '          <input id="promptInput" class="form-control" maxlength="180" required>' +
            '        </div>' +
            '        <div class="modal-footer">' +
            '          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '          <button type="submit" class="btn btn-primary" id="promptOk">保存</button>' +
            '        </div>' +
            '      </form>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="autoThemeModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title">主题</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body">' +
            '        <div class="form-check form-switch">' +
            '          <input id="autoThemeSwitch" type="checkbox" class="form-check-input">' +
            '          <label class="form-check-label" for="autoThemeSwitch">跟随时间</label>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="previewModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-xl modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title" id="previewTitle"></h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body" id="previewBody"></div>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        while (host.firstChild) document.body.appendChild(host.firstChild);
    }

    var confirmResolve = null;

    function confirmDialog(title, message, okText, danger) {
        if (confirmResolve) {
            confirmResolve(false);
            confirmResolve = null;
        }
        document.getElementById('confirmTitle').textContent = title || '确认';
        document.getElementById('confirmMsg').textContent = message || '';
        var ok = document.getElementById('confirmOk');
        ok.textContent = okText || '删除';
        ok.className = 'btn ' + (danger === false ? 'btn-primary' : 'btn-danger');
        return new Promise(function (resolve) {
            confirmResolve = resolve;
            var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmModal'));
            modal.show();
        });
    }

    var promptResolve = null;

    function promptDialog(title, value, label, okText) {
        if (promptResolve) {
            promptResolve(null);
            promptResolve = null;
        }
        document.getElementById('promptTitle').textContent = title || '修改';
        document.getElementById('promptLabel').textContent = label || '名称';
        document.getElementById('promptOk').textContent = okText || '保存';
        var input = document.getElementById('promptInput');
        input.value = value || '';
        return new Promise(function (resolve) {
            promptResolve = resolve;
            var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('promptModal'));
            modal.show();
        });
    }

    function alertDialog(title, message) {
        document.getElementById('alertTitle').textContent = title || '提示';
        document.getElementById('alertMsg').textContent = message || '';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('alertModal')).show();
    }

    function openProfile() {
        if (!APP.me) return;
        var me = APP.me;
        var items = [
            ['昵称', me.nickname || '—'],
            ['身份', me.is_admin ? '管理员' : '普通用户'],
            ['设备 ID', me.device_id || '—'],
            ['单文件上限', me.is_admin ? '不限' : fmtMb(me.max_upload_mb || 100)],
            ['首次使用', fmtTime(me.created_at)],
            ['最近访问', fmtTime(me.last_seen_at)]
        ];
        document.getElementById('profileGrid').innerHTML = items.map(function (it) {
            return '<div class="info-tile"><div class="k">' + esc(it[0]) + '</div>' +
                '<div class="v">' + esc(it[1]) + '</div></div>';
        }).join('');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('profileModal')).show();
    }

    function openNickname() {
        if (!APP.me) return;
        var input = document.getElementById('nickInput');
        input.value = APP.me.nickname || '';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('nickModal')).show();
        setTimeout(function () { input.focus(); input.select(); }, 220);
    }

    function openAutoTheme() {
        var sw = document.getElementById('autoThemeSwitch');
        sw.checked = !!(window.FBTheme && window.FBTheme.isAuto());
        bootstrap.Modal.getOrCreateInstance(document.getElementById('autoThemeModal')).show();
    }

    function openPreview(file) {
        var body = document.getElementById('previewBody');
        document.getElementById('previewTitle').textContent = file.name;
        var url = '/api/files/' + encodeURIComponent(file.id) + '/preview';
        var ext = (file.ext || '').toLowerCase();
        if (IMAGE_EXTS.indexOf(ext) >= 0) {
            body.innerHTML = '<div class="text-center"><img alt="" class="img-fluid" style="max-height:70vh" src="' +
                esc(url) + '"></div>';
        } else if (VIDEO_EXTS.indexOf(ext) >= 0) {
            body.innerHTML = '<div class="text-center"><video class="preview-video" controls autoplay muted playsinline preload="auto" src="' +
                esc(url) + '"></video></div>';
        } else if (ext === 'pdf') {
            body.innerHTML = '<iframe class="preview-frame" src="' + esc(url) + '"></iframe>';
        } else if (TEXT_EXTS.indexOf(ext) >= 0) {
            var pre = document.createElement('pre');
            pre.className = 'preview-text';
            pre.textContent = '加载中…';
            body.innerHTML = '';
            body.appendChild(pre);
            fetch(url, { credentials: 'same-origin', cache: 'no-store' })
                .then(function (r) {
                    if (!r.ok) throw new Error('加载失败');
                    var truncated = r.headers.get('X-Text-Truncated') === '1';
                    return r.text().then(function (text) { return { text: text, truncated: truncated }; });
                })
                .then(function (res) {
                    if (res.truncated) {
                        var note = document.createElement('div');
                        note.className = 'preview-truncated';
                        note.textContent = '仅显示前 512 KB';
                        body.insertBefore(note, pre);
                    }
                    pre.textContent = res.text || '';
                })
                .catch(function () { pre.textContent = '加载失败'; });
        }
        var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('previewModal'));
        modal.show();

        var video = body.querySelector('video');
        if (video) video.play().catch(function () {});
    }

    function uploadXhr(url, method, file, onProgress, onReady) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.withCredentials = true;
            var did = null;
            try { did = localStorage.getItem(DEV_KEY); } catch (e) {}
            if (did) xhr.setRequestHeader('X-Device-Id', did);
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total * 100);
            };
            xhr.onabort = function () {
                var err = new Error('已停止');
                err.aborted = true;
                reject(err);
            };
            if (onReady) onReady(xhr);
            xhr.onload = function () {
                var data = {};
                try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(data);
                } else {
                    var msg = data.detail || data.message || ('上传失败（' + xhr.status + '）');
                    if (Array.isArray(msg)) msg = msg.map(function (x) { return x.msg; }).join('；');
                    var err = new Error(msg);
                    err.status = xhr.status;
                    err.data = data;
                    reject(err);
                }
            };
            xhr.onerror = function () { reject(new Error('网络错误')); };
            var fd = new FormData();
            fd.append('file', file);
            xhr.send(fd);
        });
    }

    function bucketLink(id) {
        return location.origin + '/?bucket=' + encodeURIComponent(id);
    }

    function bindModals() {
        if (bound) return;
        bound = true;

        document.getElementById('nickForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            var input = document.getElementById('nickInput');
            var value = input.value.trim();
            if (!value) return;
            try {
                var r = await api('/api/device/nickname', { method: 'POST', body: { nickname: value } });
                if (APP.me) APP.me.nickname = r.nickname;
                var el = document.getElementById('nickText');
                if (el) el.textContent = r.nickname;
                bootstrap.Modal.getOrCreateInstance(document.getElementById('nickModal')).hide();
                toast('昵称已修改');
                document.dispatchEvent(new CustomEvent('nicknamechange', { detail: { nickname: r.nickname } }));
            } catch (err) {
                toast(err.message, 'error');
            }
        });

        var confirmModal = document.getElementById('confirmModal');
        document.getElementById('confirmOk').addEventListener('click', function () {
            var r = confirmResolve;
            confirmResolve = null;
            bootstrap.Modal.getOrCreateInstance(confirmModal).hide();
            if (r) r(true);
        });
        document.getElementById('confirmCancel').addEventListener('click', function () {
            var r = confirmResolve;
            confirmResolve = null;
            bootstrap.Modal.getOrCreateInstance(confirmModal).hide();
            if (r) r(false);
        });
        confirmModal.addEventListener('hidden.bs.modal', function () {
            if (confirmResolve) {
                var r = confirmResolve;
                confirmResolve = null;
                r(false);
            }
        });

        var promptModal = document.getElementById('promptModal');
        document.getElementById('promptForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var value = document.getElementById('promptInput').value.trim();
            if (!value) return;
            var r = promptResolve;
            promptResolve = null;
            bootstrap.Modal.getOrCreateInstance(promptModal).hide();
            if (r) r(value);
        });
        promptModal.addEventListener('hidden.bs.modal', function () {
            if (promptResolve) {
                var r = promptResolve;
                promptResolve = null;
                r(null);
            }
        });

        document.getElementById('autoThemeSwitch').addEventListener('change', function () {
            var on = this.checked;
            if (window.FBTheme) window.FBTheme.setAuto(on);
            syncThemeIcon();
            toast(on ? '已开启' : '已关闭');
        });

        var previewModal = document.getElementById('previewModal');
        previewModal.addEventListener('hidden.bs.modal', function () {
            document.getElementById('previewBody').innerHTML = '';
        });
    }

    function bindNav(me) {
        var nickBtn = document.getElementById('nickBtn');
        if (nickBtn) nickBtn.addEventListener('click', openProfile);

        var profileEditBtn = document.getElementById('profileEditBtn');
        if (profileEditBtn) profileEditBtn.addEventListener('click', function () {
            bootstrap.Modal.getOrCreateInstance(document.getElementById('profileModal')).hide();
            setTimeout(openNickname, 220);
        });

        var themeBtn = document.getElementById('themeBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', function () {
                if (window.FBTheme) window.FBTheme.toggle();
                syncThemeIcon();
            });
            themeBtn.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                openAutoTheme();
            });
        }
        syncThemeIcon();

        var logout = document.getElementById('logoutBtn');
        if (logout) logout.addEventListener('click', async function () {
            try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
            flash('已退出');
            location.href = '/';
        });
    }

    async function init(active, cb) {
        injectModals();
        bindModals();
        var me = await loadMe();
        var host = document.getElementById('navHost');
        if (host) host.innerHTML = navHtml(me, active);
        bindNav(me);
        document.addEventListener('themechange', syncThemeIcon);
        if (cb) await cb(me);
        showFlash();
        return me;
    }

    APP.init = init;
    APP.api = api;
    APP.me = null;
    APP.toast = toast;
    APP.flash = flash;
    APP.esc = esc;
    APP.fmtBytes = fmtBytes;
    APP.fmtMb = fmtMb;
    APP.fmtTime = fmtTime;
    APP.fileIcon = fileIcon;
    APP.copyText = copyText;
    APP.confirm = confirmDialog;
    APP.prompt = promptDialog;
    APP.alert = alertDialog;
    APP.preview = openPreview;
    APP.uploadXhr = uploadXhr;
    APP.bucketLink = bucketLink;
    APP.IMAGE_EXTS = IMAGE_EXTS;
    APP.TEXT_EXTS = TEXT_EXTS;
})();
