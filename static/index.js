(function () {
    var APP = window.APP;
    var GROUP_KEY = 'fb_group_mode';

    function loadGroupMode() {
        var mode = null;
        try { mode = localStorage.getItem(GROUP_KEY); } catch (e) {}
        return (mode === 'type' || mode === 'time') ? mode : 'default';
    }

    function saveGroupMode(mode) {
        try { localStorage.setItem(GROUP_KEY, mode); } catch (e) {}
    }

    var state = {
        me: null, bucket: null, files: [], replaceId: null, groupMode: loadGroupMode(),
        selectMode: false, selected: {}, packing: false, filter: ''
    };

    var TYPE_KEYS = [
        ['图片', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tif', 'tiff', 'heic']],
        ['视频', ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts']],
        ['音频', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma']],
        ['文档', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'odt']],
        ['压缩包', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']],
        ['代码', APP.TEXT_EXTS || []]
    ];

    function fileTypeLabel(ext) {
        ext = String(ext || '').toLowerCase();
        for (var i = 0; i < TYPE_KEYS.length; i++) {
            if (TYPE_KEYS[i][1].indexOf(ext) >= 0) return TYPE_KEYS[i][0];
        }
        return '其它';
    }

    function closeContextMenu() {
        var menu = document.getElementById('ctxMenu');
        if (menu) {
            menu.hidden = true;
            menu.innerHTML = '';
        }
    }

    document.addEventListener('click', function (e) {
        var menu = document.getElementById('ctxMenu');
        if (!menu || menu.hidden) return;
        if (menu.contains(e.target)) return;
        closeContextMenu();
    });

    document.addEventListener('scroll', function () {
        var menu = document.getElementById('ctxMenu');
        if (menu && !menu.hidden) closeContextMenu();
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeContextMenu();
    });

    window.addEventListener('resize', closeContextMenu);

    function groupByType(files) {
        var buckets = {};
        files.forEach(function (f) {
            var key = fileTypeLabel(f.ext);
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(f);
        });
        var order = ['图片', '视频', '音频', '文档', '压缩包', '代码', '其它'];
        var groups = [];
        order.forEach(function (key) {
            if (buckets[key] && buckets[key].length) {
                groups.push({ key: key, files: buckets[key] });
            }
        });
        return groups;
    }
    var bucketId = new URLSearchParams(location.search).get('bucket');

    document.addEventListener('nicknamechange', function () {
        if (state.bucket) loadBucket(state.bucket.id, true);
    });

    APP.init('home', async function (me) {
        state.me = me;
        if (bucketId) {
            await renderBucket(bucketId);
        } else {
            await renderHome();
        }
    });

    // ───────── 首页 ─────────

    async function renderHome() {
        var app = document.getElementById('app');
        app.innerHTML = '' +
            '<div class="row g-3">' +
            '  <div class="col-lg-6">' +
            '    <div class="card h-100 mb-0">' +
            '      <div class="card-header d-flex align-items-center justify-content-between gap-2">' +
            '        <span>我建的桶</span>' +
            '        <button id="createBtn" class="btn btn-sm btn-primary"><i class="bi bi-plus-lg"></i> 新建</button>' +
            '      </div>' +
            '      <div class="card-body" id="myBuckets"></div></div>' +
            '  </div>' +
            '  <div class="col-lg-6">' +
            '    <div class="card h-100 mb-0">' +
            '      <div class="card-header d-flex align-items-center justify-content-between gap-2">' +
            '        <span>我去过的桶</span>' +
            '        <button id="joinBtn" class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-in-right"></i> 加入</button>' +
            '      </div>' +
            '      <div class="card-body" id="visitedBuckets"></div></div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="createModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <form id="createForm" class="m-0">' +
            '        <div class="modal-header"><h5 class="modal-title">新建项目桶</h5>' +
            '          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '        <div class="modal-body">' +
            '          <label class="form-label small text-muted-2" for="newBucketName">储存桶名</label>' +
            '          <input id="newBucketName" class="form-control" maxlength="60" required>' +
            '        </div>' +
            '        <div class="modal-footer">' +
            '          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '          <button type="submit" class="btn btn-primary">新建</button>' +
            '        </div>' +
            '      </form>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="joinModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <form id="joinForm" class="m-0">' +
            '        <div class="modal-header"><h5 class="modal-title">加入项目桶</h5>' +
            '          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '        <div class="modal-body">' +
            '          <label class="form-label small text-muted-2" for="codeInput">6 位识别码</label>' +
            '          <input id="codeInput" class="form-control" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required>' +
            '        </div>' +
            '        <div class="modal-footer">' +
            '          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '          <button type="submit" class="btn btn-primary">加入</button>' +
            '        </div>' +
            '      </form>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="shareManageModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title">分享链接管理</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body" id="shareManageList"></div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="ctx-menu" id="ctxMenu" hidden></div>';

        var createModal = document.getElementById('createModal');
        var joinModal = document.getElementById('joinModal');
        var nameInput = document.getElementById('newBucketName');
        var codeInput = document.getElementById('codeInput');

        document.getElementById('createBtn').addEventListener('click', function () {
            nameInput.value = '';
            bootstrap.Modal.getOrCreateInstance(createModal).show();
        });
        createModal.addEventListener('shown.bs.modal', function () { nameInput.focus(); });

        document.getElementById('joinBtn').addEventListener('click', function () {
            codeInput.value = '';
            bootstrap.Modal.getOrCreateInstance(joinModal).show();
        });
        joinModal.addEventListener('shown.bs.modal', function () { codeInput.focus(); });

        codeInput.addEventListener('input', function () {
            codeInput.value = codeInput.value.replace(/[^0-9]/g, '');
        });

        document.getElementById('createForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            var name = nameInput.value.trim();
            if (!name) {
                APP.toast('请输入储存桶名', 'error');
                nameInput.focus();
                return;
            }
            try {
                var b = await APP.api('/api/buckets', { method: 'POST', body: { name: name } });
                APP.flash('已创建');
                location.href = '/?bucket=' + encodeURIComponent(b.id);
            } catch (err) {
                APP.toast(err.message, 'error');
            }
        });

        document.getElementById('joinForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            var code = codeInput.value.replace(/\D/g, '');
            if (code.length !== 6) {
                APP.toast('请输入 6 位识别码', 'error');
                codeInput.focus();
                return;
            }
            try {
                var r = await APP.api('/api/buckets/lookup?code=' + encodeURIComponent(code));
                APP.flash('已进入');
                location.href = '/?bucket=' + encodeURIComponent(r.bucket_id);
            } catch (err) {
                APP.toast(err.message, 'error');
            }
        });

        var shareList = document.getElementById('shareManageList');
        shareList.addEventListener('click', async function (e) {
            var copyBtn = e.target.closest('[data-share-copy]');
            if (copyBtn) {
                var ok = await APP.copyText(location.origin + '/s/' + copyBtn.dataset.shareCopy);
                APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
                return;
            }
            var delBtn = e.target.closest('[data-share-del]');
            if (!delBtn) return;
            var sure = await APP.confirm('删除分享链接', '删除后该链接将无法访问。', '删除');
            if (!sure) return;
            try {
                await APP.api('/api/shares/' + encodeURIComponent(delBtn.dataset.shareDel), { method: 'DELETE' });
                await loadShareManage(shareList.dataset.bucketId);
                APP.toast('已删除');
            } catch (err) {
                APP.toast(err.message, 'error');
            }
        });

        bindBucketList(document.getElementById('myBuckets'), false);
        bindBucketList(document.getElementById('visitedBuckets'), true);
        bindHomeMenu();

        await loadHome();
    }

    async function loadHome() {
        var myHost = document.getElementById('myBuckets');
        var visitHost = document.getElementById('visitedBuckets');
        if (!myHost) return;
        var data;
        try {
            data = await APP.api('/api/home');
        } catch (e) {
            myHost.innerHTML = '<div class="empty">加载失败</div>';
            visitHost.innerHTML = '';
            APP.toast(e.message, 'error');
            return;
        }
        myHost.innerHTML = bucketListHtml(data.my_buckets, false);
        visitHost.innerHTML = bucketListHtml(data.visited_buckets, true);
    }

    function bucketListHtml(items, showVisit) {
        if (!items.length) return '<div class="empty">暂无</div>';
        return items.map(function (b) {
            var meta = '<span class="pill pill-muted">' + b.file_count + ' 个文件</span>' +
                '<span class="pill pill-muted">' + APP.fmtBytes(b.size) + '</span>';
            if (showVisit && b.last_visit_at) {
                meta += '<span class="pill pill-muted">上次访问时间 ' + APP.fmtTime(b.last_visit_at) + '</span>';
            }
            return '' +
                '<div class="bucket-item" data-bucket="' + APP.esc(b.id) + '">' +
                '  <div class="bucket-main">' +
                '    <div class="bucket-title">' +
                '      <a href="/?bucket=' + encodeURIComponent(b.id) + '" class="bucket-name" title="' + APP.esc(b.name) + '">' + APP.esc(b.name) + '</a>' +
                '      <span class="pill">' + APP.esc(b.code) + '</span>' +
                meta +
                '    </div>' +
                '  </div>' +
                '  <div class="bucket-actions">' +
                '    <a class="btn btn-sm btn-outline-primary" href="/?bucket=' + encodeURIComponent(b.id) + '">进入</a>' +
                '  </div>' +
                '</div>';
        }).join('');
    }

    var menuBucket = null;

    function bucketMenuBtn(act, icon, label, danger) {
        return '<button type="button" class="ctx-item' + (danger ? ' is-danger' : '') + '" data-act="' + act + '">' +
            '<i class="bi ' + icon + '"></i><span>' + label + '</span></button>';
    }

    function openBucketMenu(id, visited, x, y) {
        var menu = document.getElementById('ctxMenu');
        if (!menu) return;
        menuBucket = id;
        var html = bucketMenuBtn('shares', 'bi-share', '分享链接管理') +
            bucketMenuBtn('copy', 'bi-link-45deg', '复制链接');
        if (visited) html += bucketMenuBtn('forget', 'bi-x-circle', '删除记录', true);
        menu.innerHTML = html;
        menu.hidden = false;
        menu.style.left = '0px';
        menu.style.top = '0px';
        var rect = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
    }

    function bindBucketList(host, visited) {
        host.addEventListener('click', function (e) {
            var item = e.target.closest('.bucket-item');
            if (!item) return;
            if (e.target.closest('a, button')) return;
            if (String(window.getSelection()).length) return;
            location.href = '/?bucket=' + encodeURIComponent(item.dataset.bucket);
        });
        host.addEventListener('contextmenu', function (e) {
            var item = e.target.closest('.bucket-item');
            if (!item) return;
            e.preventDefault();
            openBucketMenu(item.dataset.bucket, visited, e.clientX, e.clientY);
        });
    }

    function bindHomeMenu() {
        var menu = document.getElementById('ctxMenu');
        if (!menu) return;
        menu.addEventListener('click', async function (e) {
            var btn = e.target.closest('[data-act]');
            if (!btn || !menuBucket) return;
            var id = menuBucket;
            var act = btn.dataset.act;
            closeContextMenu();
            menuBucket = null;
            if (act === 'shares') {
                openShareManage(id);
            } else if (act === 'copy') {
                var ok = await APP.copyText(APP.bucketLink(id));
                APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
            } else if (act === 'forget') {
                try {
                    await APP.api('/api/visits/' + encodeURIComponent(id), { method: 'DELETE' });
                    await loadHome();
                    APP.toast('已删除');
                } catch (err) {
                    APP.toast(err.message, 'error');
                }
            }
        });
    }

    function shareItemHtml(s) {
        var names = (s.names || []).join('、');
        return '' +
            '<div class="share-item">' +
            '  <div class="share-item-main">' +
            '    <div class="share-item-title">/s/' + APP.esc(s.id) + '</div>' +
            '    <div class="file-meta">' +
            '      <span class="pill pill-muted">' + s.file_count + ' 个文件</span>' +
            '      <span class="pill pill-muted">' + APP.fmtTime(s.created_at) + '</span>' +
            '    </div>' +
            (names ? '    <div class="share-files">' + APP.esc(names) + '</div>' : '') +
            '  </div>' +
            '  <div class="file-actions">' +
            '    <button type="button" class="btn btn-sm btn-outline-secondary" data-share-copy="' + APP.esc(s.id) + '" title="复制链接">' +
            '      <i class="bi bi-link-45deg"></i></button>' +
            (s.can_delete
                ? '    <button type="button" class="btn btn-sm btn-outline-danger" data-share-del="' + APP.esc(s.id) + '" title="删除">' +
                  '      <i class="bi bi-trash"></i></button>'
                : '') +
            '  </div>' +
            '</div>';
    }

    async function openShareManage(bucketId) {
        var list = document.getElementById('shareManageList');
        if (!list) return;
        list.dataset.bucketId = bucketId;
        list.innerHTML = '<div class="empty">加载中</div>';
        bootstrap.Modal.getOrCreateInstance(document.getElementById('shareManageModal')).show();
        await loadShareManage(bucketId);
    }

    async function loadShareManage(bucketId) {
        var list = document.getElementById('shareManageList');
        if (!list) return;
        var data;
        try {
            data = await APP.api('/api/buckets/' + encodeURIComponent(bucketId) + '/shares');
        } catch (e) {
            list.innerHTML = '<div class="empty">' + APP.esc(e.message) + '</div>';
            return;
        }
        if (!data.items.length) {
            list.innerHTML = '<div class="empty">暂无</div>';
            return;
        }
        list.innerHTML = data.items.map(shareItemHtml).join('');
    }

    // ───────── 桶页 ─────────

    async function renderBucket(id) {
        var app = document.getElementById('app');
        try {
            var b = await APP.api('/api/buckets/' + encodeURIComponent(id));
            state.bucket = b;
            state.files = b.files;
        } catch (e) {
            app.innerHTML = '' +
                '<div class="card"><div class="card-body text-center py-5">' +
                '  <div class="text-muted-2 mb-3">' + APP.esc(e.message) + '</div>' +
                '  <a class="btn btn-primary" href="/">返回首页</a>' +
                '</div></div>';
            return;
        }
        renderBucketPage();
    }

    async function loadBucket(id, keepPage) {
        try {
            var b = await APP.api('/api/buckets/' + encodeURIComponent(id));
            state.bucket = b;
            state.files = b.files;
            if (!keepPage) return;
            if (!document.getElementById('fileList')) {
                renderBucketPage();
                return;
            }
            var title = document.getElementById('bucketTitle');
            if (title) title.textContent = b.name;
            var fc = document.getElementById('statFileCount');
            if (fc) fc.textContent = b.file_count + ' 个文件';
            var ts = document.getElementById('statTotalSize');
            if (ts) ts.textContent = APP.fmtBytes(b.total_size);
            var dh = document.getElementById('diskMiniHost');
            if (dh) dh.innerHTML = diskBarHtml(b);
            renderFiles();
        } catch (e) {
            APP.toast(e.message, 'error');
        }
    }

    function diskBarHtml(b) {
        if (!b.disk_mount) return '';
        var diskPct = Number(b.disk_percent) || 0;
        var diskUsed = Number(b.disk_used_percent) || 0;
        var diskOther = Number(b.disk_other_percent) || 0;
        var diskFree = Number(b.disk_free_percent) || 0;
        var diskLetter = (/^([A-Za-z]):/.exec(b.disk_mount) || [])[1];
        var diskName = '项目占用' + (diskLetter ? diskLetter.toUpperCase() + '盘' : '') + '百分比';
        var tip = '其他占用 ' + diskOther.toFixed(1) + '% · ' + diskName + ' ' + diskPct.toFixed(1) +
            '% · 剩余 ' + diskFree.toFixed(1) + '%';
        var quotaTotal = Number(b.quota_total_bytes) || 0;
        var quotaRemain = Number(b.quota_remaining_bytes) || 0;
        var quotaPct = Number(b.quota_remaining_percent) || 0;
        var rest = quotaTotal ? '<span class="disk-mini-rest' + (quotaPct < 10 ? ' is-low' : '') +
            '">剩余可用空间：' + APP.fmtBytes(quotaRemain) + ' - ' + quotaPct.toFixed(1) + '%</span>' : '';
        return '<div class="disk-mini" title="' + tip + '">' +
            '<span class="disk-mini-label">磁盘占用：</span>' +
            '<div class="disk-mini-bar">' +
            '<span class="is-other" style="width:' + diskOther.toFixed(1) + '%"></span>' +
            '<span class="is-app" style="width:' + diskPct.toFixed(1) + '%"></span>' +
            '<span class="is-free" style="width:' + diskFree.toFixed(1) + '%"></span>' +
            '</div>' +
            '<span class="disk-mini-text">' + diskUsed.toFixed(1) + '%</span>' + rest + '</div>';
    }

    function renderBucketPage() {
        var b = state.bucket;
        var me = state.me;
        var canManage = b.is_owner || b.is_admin;
        var link = APP.bucketLink(b.id);
        var limitText = me && me.is_admin ? '单文件不限' : ('单文件 ' + APP.fmtMb(me ? me.max_upload_mb : 100));
        var uploadsOn = !me || me.uploads_enabled !== false;
        var diskBar = diskBarHtml(b);
        var app = document.getElementById('app');

        app.innerHTML = '' +
            '<div class="card">' +
            '  <div class="card-body">' +
            '    <div class="d-flex flex-wrap align-items-start gap-2 justify-content-between">' +
            '      <div style="min-width:0">' +
            '        <h5 class="mb-1" id="bucketTitle">' + APP.esc(b.name) + '</h5>' +
            '        <div class="d-flex flex-wrap gap-1 mt-1">' +
            '          <span class="pill pill-muted">创建者 ' + APP.esc(b.owner_nickname) + '</span>' +
            '          <span class="pill pill-muted" id="statFileCount">' + b.file_count + ' 个文件</span>' +
            '          <span class="pill pill-muted" id="statTotalSize">' + APP.fmtBytes(b.total_size) + '</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="d-flex gap-2 flex-wrap">' +
            (canManage ? '        <button class="btn btn-sm btn-outline-secondary" id="renameBucket"><i class="bi bi-pencil"></i> 改名</button>' : '') +
            (canManage ? '        <button class="btn btn-sm btn-outline-danger" id="deleteBucket"><i class="bi bi-trash"></i> 删除</button>' : '') +
            '      </div>' +
            '    </div>' +
            '    <hr>' +
            '    <div class="share-box">' +
            '      <span class="code-badge">' + APP.esc(b.code) + '</span>' +
            '      <div class="share-main">' +
            '        <div class="share-line">' +
            '          <div class="share-link" title="' + APP.esc(link) + '">' + APP.esc(link) + '</div>' +
            '          <div class="share-actions">' +
            '            <button class="btn btn-sm btn-outline-primary" id="copyLink"><i class="bi bi-link-45deg"></i> 复制链接</button>' +
            '            <button class="btn btn-sm btn-outline-primary" id="copyCode"><i class="bi bi-key"></i> 复制识别码</button>' +
            '            <button class="btn btn-sm btn-outline-primary" id="qrBtn"><i class="bi bi-qr-code"></i> 二维码</button>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-header upload-card-header">' +
            '    <div class="upload-head-left"><span>上传文件</span><span id="diskMiniHost">' + diskBar + '</span></div>' +
            '    <div class="upload-head-right">' +
            '      <span class="pill pill-muted">' + APP.esc(uploadsOn ? limitText : '维护中') + '</span>' +
            '      <button type="button" class="btn btn-sm btn-outline-primary" id="newTextBtn"' + (uploadsOn ? '' : ' disabled') + '><i class="bi bi-file-earmark-plus"></i> 新建文本</button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="card-body">' +
            '    <div class="dropzone' + (uploadsOn ? '' : ' is-off') + '" id="dropzone">' +
            '      <i class="bi ' + (uploadsOn ? 'bi-cloud-arrow-up' : 'bi-pause-circle') + '"></i>' +
            '      <div class="dropzone-title">' + (uploadsOn ? '选择文件' : '维护中') + '</div>' +
            (uploadsOn ? '      <div class="dropzone-hint">点击打开选择框，或把文件拖到这里</div>' +
                '      <div class="dropzone-hint">可一次选择多个文件，' + APP.esc(limitText) + '</div>' : '') +
            '      <input type="file" id="fileInput" multiple hidden' + (uploadsOn ? '' : ' disabled') + '>' +
            '    </div>' +
            '    <input type="file" id="replaceInput" hidden>' +
            '  </div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">' +
            '    <div class="d-flex flex-wrap align-items-center gap-3">' +
            '      <span>文件列表</span>' +
            '      <div class="btn-group btn-group-sm" role="group" aria-label="分组">' +
            ['default', 'type', 'time'].map(function (mode) {
                var label = mode === 'default' ? '默认' : (mode === 'type' ? '类型' : '时间');
                return '<input type="radio" class="btn-check" name="groupMode" id="gm-' + mode + '" value="' + mode + '"' +
                    (state.groupMode === mode ? ' checked' : '') + '>' +
                    '<label class="btn btn-outline-secondary" for="gm-' + mode + '">' + label + '</label>';
            }).join('') +
            '      </div>' +
            '      <span class="upload-progress" id="uploadProgress" hidden>' +
            '        <span class="upload-progress-label">文件上传进度：</span>' +
            '        <span class="progress upload-progress-track"><span class="progress-bar" id="uploadProgressBar" style="width:0%"></span></span>' +
            '        <span class="upload-progress-pct" id="uploadProgressPct">0.00%</span>' +
            '      </span>' +
            '      <input id="fileFilter" type="search" class="form-control form-control-sm file-filter" placeholder="筛选文件名" value="' + APP.esc(state.filter) + '">' +
            '    </div>' +
            '    <div class="d-flex flex-wrap align-items-center gap-2">' +
            '      <button type="button" class="btn btn-sm btn-outline-secondary" id="selectModeBtn">' +
            (state.selectMode ? '<i class="bi bi-x-lg"></i> 取消' : '<i class="bi bi-check2-square"></i> 多选') +
            '      </button>' +
            '      <div class="dropdown" id="downloadDropdown" hidden>' +
            '        <button type="button" class="btn btn-sm btn-outline-primary dropdown-toggle" id="downloadSelectedBtn" data-bs-toggle="dropdown" disabled>' +
            '          <i class="bi bi-download"></i> 下载 <span id="downloadCount">(0)</span></button>' +
            '        <ul class="dropdown-menu dropdown-menu-end" id="downloadMenu">' +
            '          <li><button type="button" class="dropdown-item" data-dl="zip"><i class="bi bi-file-earmark-zip"></i> 打包下载</button></li>' +
            '          <li><button type="button" class="dropdown-item" data-dl="queue"><i class="bi bi-download"></i> 队列下载</button></li>' +
            '        </ul>' +
            '      </div>' +
            '      <button type="button" class="btn btn-sm btn-primary" id="shareSelectedBtn" disabled hidden>' +
            '        <i class="bi bi-share"></i> 分享 <span id="shareCount">(0)</span></button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="card-body">' +
            '    <div id="uploadRows"></div>' +
            '    <div id="fileList"></div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="qrModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header"><h5 class="modal-title">桶二维码</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body text-center"><div id="qrBox"></div></div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="newTextModal" tabindex="-1" data-bs-backdrop="static">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <form id="newTextForm" class="m-0">' +
            '        <div class="modal-header"><h5 class="modal-title">新建文本</h5>' +
            '          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '        <div class="modal-body">' +
            '          <label class="form-label small text-muted-2" for="newTextName">文件名</label>' +
            '          <input id="newTextName" class="form-control" maxlength="180" required>' +
            '          <textarea id="newTextContent" class="form-control text-editor mt-3" rows="5" spellcheck="false"></textarea>' +
            '        </div>' +
            '        <div class="modal-footer">' +
            '          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '          <button type="submit" class="btn btn-primary">创建</button>' +
            '        </div>' +
            '      </form>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="textModal" tabindex="-1" data-bs-backdrop="static">' +
            '  <div class="modal-dialog modal-dialog-centered modal-xl">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header d-flex align-items-center gap-2">' +
            '        <h5 class="modal-title text-truncate" id="textTitle" style="min-width:0"></h5>' +
            '        <span class="pill pill-muted flex-shrink-0" id="textStats">0 行 · 0 字</span>' +
            '        <button type="button" class="btn-close ms-auto" data-bs-dismiss="modal"></button></div>' +
            '      <div class="modal-body">' +
            '        <textarea id="textContent" class="form-control text-editor" rows="5" spellcheck="false"></textarea>' +
            '      </div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '        <button type="button" class="btn btn-primary" id="textSaveBtn">保存</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="ctx-menu" id="ctxMenu" hidden></div>';

        document.getElementById('copyLink').addEventListener('click', async function () {
            var ok = await APP.copyText(link);
            APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
        });
        document.getElementById('copyCode').addEventListener('click', async function () {
            var ok = await APP.copyText(b.code);
            APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
        });

        var qrModal = document.getElementById('qrModal');
        var qrBox = document.getElementById('qrBox');
        var qrRendered = false;
        document.getElementById('qrBtn').addEventListener('click', function () {
            bootstrap.Modal.getOrCreateInstance(qrModal).show();
        });
        qrModal.addEventListener('shown.bs.modal', function () {
            if (qrRendered) return;
            if (!window.QRCode) {
                APP.toast('二维码加载失败', 'error');
                return;
            }
            qrRendered = true;
            new QRCode(qrBox, {
                text: link,
                width: 220,
                height: 220,
                correctLevel: QRCode.CorrectLevel.M
            });
        });

        var renameBtn = document.getElementById('renameBucket');
        if (renameBtn) renameBtn.addEventListener('click', async function () {
            var name = await APP.prompt('桶名', b.name, '储存桶名', '保存');
            if (!name) return;
            try {
                await APP.api('/api/buckets/' + encodeURIComponent(b.id), { method: 'PATCH', body: { name: name } });
                await loadBucket(b.id, true);
                APP.toast('已修改');
            } catch (e) {
                APP.toast(e.message, 'error');
            }
        });

        var deleteBtn = document.getElementById('deleteBucket');
        if (deleteBtn) deleteBtn.addEventListener('click', async function () {
            var ok = await APP.confirm('删除桶', '「' + b.name + '」及桶内 ' + b.file_count + ' 个文件将全部删除。', '删除');
            if (!ok) return;
            try {
                await APP.api('/api/buckets/' + encodeURIComponent(b.id), { method: 'DELETE' });
                APP.flash('已删除');
                location.href = '/';
            } catch (e) {
                APP.toast(e.message, 'error');
            }
        });

        var dropzone = document.getElementById('dropzone');
        var fileInput = document.getElementById('fileInput');
        var replaceInput = document.getElementById('replaceInput');

        dropzone.addEventListener('click', function () {
            if (!uploadsOn) return;
            fileInput.click();
        });
        dropzone.addEventListener('dragover', function (e) {
            e.preventDefault();
            if (uploadsOn) dropzone.classList.add('drag');
        });
        dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('drag'); });
        dropzone.addEventListener('drop', function (e) {
            e.preventDefault();
            dropzone.classList.remove('drag');
            if (!uploadsOn) return;
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                handleFiles(e.dataTransfer.files);
            }
        });
        fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
            fileInput.value = '';
        });

        replaceInput.addEventListener('change', function () {
            var id = state.replaceId;
            var file = replaceInput.files && replaceInput.files[0];
            replaceInput.value = '';
            state.replaceId = null;
            if (!id || !file) return;
            doReplace(id, file);
        });

        function hideModal(el) {
            return new Promise(function (resolve) {
                if (!el.classList.contains('show')) { resolve(); return; }
                el.addEventListener('hidden.bs.modal', function () { resolve(); }, { once: true });
                bootstrap.Modal.getOrCreateInstance(el).hide();
            });
        }

        var newTextModal = document.getElementById('newTextModal');
        var newTextForm = document.getElementById('newTextForm');
        document.getElementById('newTextBtn').addEventListener('click', function () {
            newTextForm.reset();
            bootstrap.Modal.getOrCreateInstance(newTextModal).show();
        });
        newTextForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            var name = document.getElementById('newTextName').value.trim();
            if (!name) return;
            var submitBtn = newTextForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            try {
                await APP.api('/api/buckets/' + encodeURIComponent(b.id) + '/texts', {
                    method: 'POST',
                    body: { name: name, content: document.getElementById('newTextContent').value }
                });
                await hideModal(newTextModal);
                await loadBucket(b.id, true);
                APP.toast('已创建');
            } catch (err) {
                APP.toast(err.message, 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });

        var textModal = document.getElementById('textModal');
        var textContent = document.getElementById('textContent');
        var textSaveBtn = document.getElementById('textSaveBtn');
        var editingFile = null;
        var editToken = 0;

        function updateTextStats() {
            var v = textContent.value || '';
            var lines = v ? v.split('\n').length : 0;
            var chars = v ? Array.from(v.replace(/\s/g, '')).length : 0;
            var el = document.getElementById('textStats');
            if (el) el.textContent = lines + ' 行 · ' + chars + ' 字';
        }

        textContent.addEventListener('input', updateTextStats);

        textModal.addEventListener('hidden.bs.modal', function () {
            editingFile = null;
            textContent.value = '';
            textSaveBtn.disabled = true;
            updateTextStats();
        });

        async function openTextEditor(f) {
            var token = ++editToken;
            editingFile = null;
            document.getElementById('textTitle').textContent = f.name;
            textContent.value = '';
            textSaveBtn.disabled = true;
            updateTextStats();
            bootstrap.Modal.getOrCreateInstance(textModal).show();
            try {
                var r = await fetch('/api/files/' + encodeURIComponent(f.id) + '/text', { cache: 'no-store' });
                if (!r.ok) {
                    var data = {};
                    try { data = await r.json(); } catch (e2) {}
                    throw new Error(data.detail || '加载失败');
                }
                var text = await r.text();
                if (token !== editToken) return;
                textContent.value = text;
                updateTextStats();
                textSaveBtn.disabled = false;
                editingFile = f;
                textContent.focus();
            } catch (err) {
                if (token !== editToken) return;
                APP.toast(err.message, 'error');
                bootstrap.Modal.getOrCreateInstance(textModal).hide();
            }
        }

        textSaveBtn.addEventListener('click', async function () {
            if (!editingFile) return;
            var f = editingFile;
            textSaveBtn.disabled = true;
            try {
                var blobFile = new File([textContent.value], f.name, { type: 'text/plain;charset=utf-8' });
                await APP.uploadXhr('/api/files/' + encodeURIComponent(f.id) + '/content', 'PUT', blobFile);
                await hideModal(textModal);
                await loadBucket(b.id, true);
                APP.toast('已保存');
            } catch (err) {
                APP.toast(err.message, 'error');
            } finally {
                textSaveBtn.disabled = false;
            }
        });

        renderFiles();
        var filterInput = document.getElementById('fileFilter');
        if (filterInput) filterInput.addEventListener('input', function () {
            state.filter = filterInput.value;
            renderFiles();
        });
        var uploadRowsHost = document.getElementById('uploadRows');
        if (uploadRowsHost) uploadRowsHost.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-upcancel]');
            if (!btn || !uploadBatch) return;
            var id = Number(btn.dataset.upcancel);
            var item = uploadBatch.items.filter(function (x) { return x.id === id; })[0];
            if (!item || item.cancelled) return;
            item.cancelled = true;
            btn.disabled = true;
            if (item.xhr) {
                item.xhr.abort();
            } else {
                item.loaded = item.size;
                removeUploadRow(item);
                paintUploadTotal();
            }
        });
        Array.prototype.forEach.call(
            document.querySelectorAll('input[name="groupMode"]'),
            function (el) {
                el.addEventListener('change', function () {
                    state.groupMode = el.value;
                    saveGroupMode(el.value);
                    renderFiles();
                });
            }
        );

        document.getElementById('selectModeBtn').addEventListener('click', function () {
            setSelectMode(!state.selectMode);
        });

        document.getElementById('shareSelectedBtn').addEventListener('click', async function () {
            var picked = state.files.filter(function (x) { return state.selected[x.id]; });
            if (!picked.length) return;
            try {
                var share = await APP.api('/api/shares', {
                    method: 'POST',
                    body: { file_ids: picked.map(function (f) { return f.id; }) }
                });
                var ok = await APP.copyText(location.origin + '/s/' + share.id);
                setSelectMode(false);
                APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
            } catch (e) {
                APP.toast(e.message, 'error');
            }
        });

        document.getElementById('downloadMenu').addEventListener('click', function (e) {
            var item = e.target.closest('[data-dl]');
            if (!item) return;
            startSelectedDownload(item.dataset.dl);
        });

        function downloadNameFromHeader(cd) {
            if (!cd) return '';
            var m = /filename\*=utf-8''([^;]+)/i.exec(cd);
            if (m) {
                try { return decodeURIComponent(m[1].trim()); } catch (e) {}
            }
            m = /filename="?([^";]+)"?/i.exec(cd);
            return m ? m[1].trim() : '';
        }

        async function startSelectedDownload(mode) {
            var picked = state.files.filter(function (x) { return state.selected[x.id]; });
            if (!picked.length || state.packing) return;
            var btn = document.getElementById('downloadSelectedBtn');
            if (btn) bootstrap.Dropdown.getOrCreateInstance(btn).hide();
            var ids = picked.map(function (f) { return f.id; });
            if (mode === 'queue') {
                ids.forEach(function (id, i) {
                    setTimeout(function () {
                        var a = document.createElement('a');
                        a.href = '/api/files/' + encodeURIComponent(id) + '/download';
                        a.download = '';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }, i * 400);
                });
                APP.toast('开始下载 ' + ids.length + ' 个文件');
                return;
            }
            state.packing = true;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 正在打包';
            }
            try {
                var body = new URLSearchParams();
                body.append('file_ids', ids.join(','));
                var resp = await fetch('/api/buckets/' + encodeURIComponent(state.bucket.id) + '/download.zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body.toString()
                });
                if (!resp.ok) {
                    var detail = '打包失败';
                    try {
                        var j = await resp.json();
                        if (j.detail) detail = j.detail;
                    } catch (e) {}
                    throw new Error(detail);
                }
                var blob = await resp.blob();
                var name = downloadNameFromHeader(resp.headers.get('Content-Disposition')) ||
                    (state.bucket.name + '.zip');
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
                APP.toast('已打包下载');
            } catch (e) {
                APP.toast(e.message || '打包失败', 'error');
            } finally {
                state.packing = false;
                if (btn) btn.innerHTML = '<i class="bi bi-download"></i> 下载 <span id="downloadCount">(0)</span>';
                updateShareBar();
            }
        }

        async function doFileAction(act, f) {
            var id = f.id;
            if (act === 'preview') {
                APP.preview(f);
            } else if (act === 'link') {
                try {
                    var share = await APP.api('/api/shares', {
                        method: 'POST',
                        body: { file_ids: [id] }
                    });
                    var ok = await APP.copyText(location.origin + '/s/' + share.id);
                    APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
                } catch (err) {
                    APP.toast(err.message, 'error');
                }
            } else if (act === 'download') {
                location.href = '/api/files/' + encodeURIComponent(id) + '/download';
            } else if (act === 'rename') {
                var name = await APP.prompt('重命名', f.name, '文件名', '保存');
                if (!name) return;
                try {
                    await APP.api('/api/files/' + encodeURIComponent(id), { method: 'PATCH', body: { name: name } });
                    await loadBucket(state.bucket.id, true);
                    APP.toast('已修改');
                } catch (err) {
                    APP.toast(err.message, 'error');
                }
            } else if (act === 'edit') {
                openTextEditor(f);
            } else if (act === 'replace') {
                state.replaceId = id;
                replaceInput.click();
            } else if (act === 'delete') {
                var sure = await APP.confirm('删除文件', '删除「' + f.name + '」？', '删除');
                if (!sure) return;
                try {
                    await APP.api('/api/files/' + encodeURIComponent(id), { method: 'DELETE' });
                    await loadBucket(state.bucket.id, true);
                    APP.toast('已删除');
                } catch (err) {
                    APP.toast(err.message, 'error');
                }
            }
        }

        var ctxMenu = document.getElementById('ctxMenu');
        var ctxFile = null;

        function menuBtn(act, icon, label, danger) {
            return '<button type="button" class="ctx-item' + (danger ? ' is-danger' : '') + '" data-act="' + act + '">' +
                '<i class="bi ' + icon + '"></i><span>' + label + '</span></button>';
        }

        function openContextMenu(f, x, y) {
            var isText = (APP.TEXT_EXTS || []).indexOf(String(f.ext || '').toLowerCase()) >= 0;
            var html = '';
            if (f.previewable) html += menuBtn('preview', 'bi-eye', '预览');
            html += menuBtn('link', 'bi-share', '分享链接');
            html += menuBtn('download', 'bi-download', '下载');
            if (f.is_mine) {
                var canUpload = !state.me || state.me.uploads_enabled !== false;
                html += menuBtn('rename', 'bi-tag', '重命名');
                if (isText && canUpload) html += menuBtn('edit', 'bi-pencil-square', '编辑');
                if (canUpload) html += menuBtn('replace', 'bi-upload', '替换');
            }
            if (f.is_mine || state.bucket.is_admin) html += menuBtn('delete', 'bi-trash', '删除', true);
            ctxFile = f;
            ctxMenu.innerHTML = html;
            ctxMenu.hidden = false;
            ctxMenu.style.left = '0px';
            ctxMenu.style.top = '0px';
            var rect = ctxMenu.getBoundingClientRect();
            ctxMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
            ctxMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
        }

        ctxMenu.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-act]');
            if (!btn || !ctxFile) return;
            var f = ctxFile;
            var act = btn.dataset.act;
            closeContextMenu();
            doFileAction(act, f);
        });

        var fileList = document.getElementById('fileList');
        fileList.addEventListener('click', function (e) {
            if (!state.selectMode) return;
            var row = e.target.closest('.file-row');
            if (!row) return;
            var rowId = row.dataset.id;
            if (state.selected[rowId]) delete state.selected[rowId];
            else state.selected[rowId] = true;
            renderFiles();
        });

        fileList.addEventListener('contextmenu', function (e) {
            if (state.selectMode) return;
            var row = e.target.closest('.file-row');
            if (!row) { closeContextMenu(); return; }
            var f = state.files.filter(function (x) { return x.id === row.dataset.id; })[0];
            if (!f) return;
            e.preventDefault();
            openContextMenu(f, e.clientX, e.clientY);
        });

        fileList.addEventListener('dblclick', function (e) {
            if (state.selectMode) return;
            var row = e.target.closest('.file-row');
            if (!row) return;
            var f = state.files.filter(function (x) { return x.id === row.dataset.id; })[0];
            if (!f || !f.previewable) return;
            APP.preview(f);
        });
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    // 按中国时间直接切字符串，避免跟随设备时区
    function groupKeyOf(iso) {
        var s = String(iso || '');
        var mm = parseInt(s.slice(14, 16), 10);
        if (!s || isNaN(mm)) return '';
        return s.slice(0, 10) + ' ' + s.slice(11, 13) + ':' + pad2(Math.floor(mm / 10) * 10);
    }

    function groupLabel(key) {
        if (!key) return '—';
        var hh = parseInt(key.slice(11, 13), 10);
        var mm = parseInt(key.slice(14, 16), 10);
        var end = mm + 10;
        var eh = hh + Math.floor(end / 60);
        var endText = eh >= 24 ? '次日 ' + pad2(end % 60) + ':00' : pad2(eh) + ':' + pad2(end % 60);
        return key.slice(0, 10) + ' ' + pad2(hh) + ':' + pad2(mm) + ' - ' + endText;
    }

    function fileRowHtml(f, counts) {
        var versionTag = (f.version > 1 || counts[f.name] > 1) ? '<span class="ver-tag">（V' + f.version + '）</span>' : '';
        var rowCls = 'file-row' +
            (state.selectMode ? ' selectable' : '') +
            (state.selected[f.id] ? ' selected' : '');
        return '' +
            '<div class="' + rowCls + '" data-id="' + APP.esc(f.id) + '">' +
            '  <i class="bi ' + APP.fileIcon(f.ext) + ' file-icon"></i>' +
            '  <div class="file-main">' +
            '    <div class="file-name">' + APP.esc(f.name) + versionTag + '</div>' +
            '    <div class="file-meta">' +
            '      <span class="pill pill-muted">上传者：' + APP.esc(f.uploader) + '</span>' +
            '      <span class="pill pill-muted">' + APP.fmtBytes(f.size) + '</span>' +
            '      <span class="pill pill-muted">上传时间 ' + APP.fmtTime(f.created_at) + '</span>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    function updateShareBar() {
        var n = Object.keys(state.selected).length;
        var btn = document.getElementById('shareSelectedBtn');
        if (btn) {
            btn.disabled = n === 0;
            var count = document.getElementById('shareCount');
            if (count) count.textContent = '(' + n + ')';
        }
        var dl = document.getElementById('downloadSelectedBtn');
        if (dl) {
            dl.disabled = state.packing || n === 0;
            var dlCount = document.getElementById('downloadCount');
            if (dlCount && !state.packing) dlCount.textContent = '(' + n + ')';
        }
    }

    function setSelectMode(on) {
        state.selectMode = on;
        state.selected = {};
        var toggle = document.getElementById('selectModeBtn');
        if (toggle) {
            toggle.innerHTML = on
                ? '<i class="bi bi-x-lg"></i> 取消'
                : '<i class="bi bi-check2-square"></i> 多选';
        }
        var shareBtn = document.getElementById('shareSelectedBtn');
        if (shareBtn) shareBtn.hidden = !on;
        var dlDrop = document.getElementById('downloadDropdown');
        if (dlDrop) dlDrop.hidden = !on;
        renderFiles();
    }

    function renderFiles() {
        var host = document.getElementById('fileList');
        if (!host) return;
        updateShareBar();
        var files = state.files.slice().sort(function (a, b) {
            return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        });
        var needle = state.filter.trim().toLowerCase();
        if (needle) {
            files = files.filter(function (f) {
                return String(f.name || '').toLowerCase().indexOf(needle) >= 0;
            });
        }
        if (!files.length) {
            host.innerHTML = '<div class="empty">暂无</div>';
            return;
        }
        var counts = {};
        files.forEach(function (f) { counts[f.name] = (counts[f.name] || 0) + 1; });
        var row = function (f) { return fileRowHtml(f, counts); };

        if (state.groupMode === 'default') {
            host.innerHTML = files.map(row).join('');
            return;
        }

        var groups;
        if (state.groupMode === 'type') {
            groups = groupByType(files);
        } else {
            var timeGroups = [];
            files.forEach(function (f) {
                var key = groupKeyOf(f.created_at);
                var g = timeGroups.length ? timeGroups[timeGroups.length - 1] : null;
                if (!g || g.key !== key) {
                    g = { key: key, files: [] };
                    timeGroups.push(g);
                }
                g.files.push(f);
            });
            groups = timeGroups.map(function (g) {
                return { key: groupLabel(g.key), files: g.files };
            });
        }

        host.innerHTML = groups.map(function (g) {
            return '<div class="file-group">' +
                '<div class="file-group-title"><span class="pill pill-muted">' + APP.esc(g.key) + '</span></div>' +
                g.files.map(row).join('') +
                '</div>';
        }).join('');
    }

    var uploadBatch = null;
    var uploadSeq = 0;

    function extOfName(name) {
        var i = String(name || '').lastIndexOf('.');
        return i > 0 ? String(name).slice(i + 1).toLowerCase() : '';
    }

    function uploadRowHtml(item) {
        return '<div class="file-row upload-file-row" data-up="' + item.id + '">' +
            '<i class="bi ' + APP.fileIcon(extOfName(item.file.name)) + ' file-icon"></i>' +
            '<div class="file-main">' +
            '  <div class="file-name">' + APP.esc(item.file.name) + '</div>' +
            '  <div class="file-meta upload-file-meta">' +
            '    <span class="progress upload-file-track"><span class="progress-bar" id="upbar-' + item.id + '" style="width:0%"></span></span>' +
            '    <span class="upload-file-pct" id="uppct-' + item.id + '">0.00%</span>' +
            '  </div>' +
            '</div>' +
            '<div class="file-actions">' +
            '  <button type="button" class="btn btn-sm btn-outline-danger" data-upcancel="' + item.id + '">取消</button>' +
            '</div>' +
            '</div>';
    }

    function beginUpload(files) {
        var total = 0;
        var items = files.map(function (file) {
            var size = Number(file.size) || 0;
            total += size;
            return { id: ++uploadSeq, file: file, size: size, loaded: 0, xhr: null, cancelled: false };
        });
        uploadBatch = { total: total, items: items };
        var host = document.getElementById('uploadRows');
        if (host) host.innerHTML = items.map(uploadRowHtml).join('');
        var box = document.getElementById('uploadProgress');
        if (box) box.hidden = false;
        paintUploadProgress(0);
        return items;
    }

    function paintUploadProgress(loaded) {
        if (!uploadBatch) return;
        var pct = uploadBatch.total
            ? Math.min(100, Math.max(0, loaded / uploadBatch.total * 100))
            : (loaded > 0 ? 100 : 0);
        var bar = document.getElementById('uploadProgressBar');
        var label = document.getElementById('uploadProgressPct');
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = pct.toFixed(2) + '%';
    }

    function paintUploadTotal() {
        if (!uploadBatch) return;
        var loaded = 0;
        uploadBatch.items.forEach(function (it) { loaded += it.loaded; });
        paintUploadProgress(loaded);
    }

    function setItemProgress(item, loaded) {
        item.loaded = Math.min(item.size, Math.max(0, loaded));
        var pct = item.size ? item.loaded / item.size * 100 : (item.loaded > 0 ? 100 : 0);
        var bar = document.getElementById('upbar-' + item.id);
        var label = document.getElementById('uppct-' + item.id);
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = pct.toFixed(2) + '%';
        paintUploadTotal();
    }

    function removeUploadRow(item) {
        var row = document.querySelector('[data-up="' + item.id + '"]');
        if (row) row.remove();
    }

    function endUpload() {
        if (uploadBatch) paintUploadProgress(uploadBatch.total || 1);
        uploadBatch = null;
        var box = document.getElementById('uploadProgress');
        if (box) setTimeout(function () {
            if (!uploadBatch) box.hidden = true;
        }, 1200);
    }

    async function handleFiles(fileList) {
        var me = state.me || {};
        var maxBytes = me.is_admin ? 0 : (me.max_upload_mb || 100) * 1024 * 1024;
        var files = Array.prototype.slice.call(fileList);
        var failed = 0, stopped = 0, dups = [];
        var queue = [];
        files.forEach(function (file) {
            if (maxBytes && file.size > maxBytes) {
                APP.toast('「' + file.name + '」超过 ' + APP.fmtBytes(maxBytes), 'error');
                failed++;
            } else {
                queue.push(file);
            }
        });
        var items = queue.length ? beginUpload(queue) : [];
        var cancelledAny = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.cancelled) { cancelledAny = true; continue; }
            var file = item.file;
            try {
                await APP.uploadXhr(
                    '/api/buckets/' + encodeURIComponent(state.bucket.id) + '/files', 'POST', file,
                    function (pct) { setItemProgress(item, item.size * pct / 100); },
                    function (xhr) { item.xhr = xhr; }
                );
                item.loaded = item.size;
            } catch (err) {
                if (item.cancelled) {
                    cancelledAny = true;
                } else if (err.data && err.data.duplicate) {
                    dups.push({ name: file.name, info: err.data.duplicate });
                } else if (err.aborted) {
                    stopped++;
                } else {
                    APP.toast('「' + file.name + '」' + err.message, 'error');
                    failed++;
                }
                item.loaded = item.size;
            }
            item.xhr = null;
            removeUploadRow(item);
            paintUploadTotal();
        }
        if (items.length) endUpload();
        await loadBucket(state.bucket.id, true);
        if (dups.length) {
            APP.alert('文件已上传过', dups.map(function (d) {
                var info = d.info;
                var head = info.name === d.name
                    ? '「' + d.name + '」已经上传过'
                    : '「' + d.name + '」与「' + info.name + '」内容相同';
                return head + '\n上传者：' + info.uploader + '\n上传时间：' + APP.fmtTime(info.created_at);
            }).join('\n\n'));
        }
        if (cancelledAny) APP.toast('已取消上传');
        else if (failed) APP.toast(failed + ' 个文件上传失败', 'error');
        else if (stopped) APP.toast('已停止 ' + stopped + ' 个文件');
        else if (!dups.length) APP.toast('上传完成');
    }

    async function doReplace(id, file) {
        var me = state.me || {};
        var maxBytes = me.is_admin ? 0 : (me.max_upload_mb || 100) * 1024 * 1024;
        if (maxBytes && file.size > maxBytes) {
            APP.toast('文件超过 ' + APP.fmtBytes(maxBytes), 'error');
            return;
        }
        var item = beginUpload([file])[0];
        try {
            await APP.uploadXhr(
                '/api/files/' + encodeURIComponent(id) + '/content', 'PUT', file,
                function (pct) { setItemProgress(item, item.size * pct / 100); },
                function (xhr) { item.xhr = xhr; }
            );
            await loadBucket(state.bucket.id, true);
            APP.toast('已替换');
        } catch (err) {
            if (item.cancelled) {
                APP.toast('已取消上传');
            } else if (err.aborted) {
                APP.toast('已停止上传');
            } else {
                APP.toast(err.message, 'error');
            }
        } finally {
            item.xhr = null;
            removeUploadRow(item);
            endUpload();
        }
    }
})();
