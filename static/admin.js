(function () {
    var APP = window.APP;
    var state = { buckets: [], files: [], total: 0, offset: 0, limit: 100 };

    APP.init('admin', async function (me) {
        if (!me || !me.is_admin) {
            location.replace('/login.html');
            return;
        }
        render();
        await Promise.all([loadBuckets(), loadFiles(true)]);
    });

    function render() {
        document.getElementById('app').innerHTML = '' +
            '<div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">' +
            '  <h5 class="mb-0"><i class="bi bi-grid-1x2 text-brand"></i> 管理</h5>' +
            '  <button class="btn btn-sm btn-outline-primary" id="refreshBtn"><i class="bi bi-arrow-clockwise"></i> 刷新</button>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">' +
            '    <span>桶列表</span>' +
            '    <div class="input-group input-group-sm" style="max-width:280px">' +
            '      <input id="bucketSearch" class="form-control" placeholder="储存桶名">' +
            '      <button id="bucketSearchBtn" class="btn btn-outline-secondary"><i class="bi bi-search"></i></button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="card-body p-0"><div class="table-responsive"><table class="table table-hover mb-0 admin-table">' +
            '    <thead><tr><th>储存桶名</th><th>识别码</th><th>创建者</th><th>文件</th><th>占用</th><th>创建时间</th><th class="text-end">操作</th></tr></thead>' +
            '    <tbody id="bucketRows"></tbody>' +
            '  </table></div></div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">' +
            '    <span>文件列表</span>' +
            '    <div class="d-flex flex-wrap gap-2">' +
            '      <select id="fileBucket" class="form-select form-select-sm" style="width:auto"></select>' +
            '      <div class="input-group input-group-sm" style="width:220px">' +
            '        <input id="fileSearch" class="form-control" placeholder="文件名 / 桶 / 上传者">' +
            '        <button id="fileSearchBtn" class="btn btn-outline-secondary"><i class="bi bi-search"></i></button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '  <div class="card-body p-0"><div class="table-responsive"><table class="table table-hover mb-0 admin-table">' +
            '    <thead><tr><th>文件名</th><th>桶</th><th>上传者</th><th>大小</th><th>上传时间</th><th class="text-end">操作</th></tr></thead>' +
            '    <tbody id="fileRows"></tbody>' +
            '  </table></div></div>' +
            '  <div class="card-body pt-0 text-center" id="moreBox"></div>' +
            '</div>';

        document.getElementById('refreshBtn').addEventListener('click', async function () {
            var r = await Promise.all([loadBuckets(), loadFiles(true)]);
            if (r[0] !== false && r[1] !== false) APP.toast('已刷新');
        });
        document.getElementById('bucketSearchBtn').addEventListener('click', loadBuckets);
        document.getElementById('bucketSearch').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') loadBuckets();
        });
        document.getElementById('fileSearchBtn').addEventListener('click', function () { loadFiles(true); });
        document.getElementById('fileSearch').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') loadFiles(true);
        });
        document.getElementById('fileBucket').addEventListener('change', function () { loadFiles(true); });

        document.getElementById('bucketRows').addEventListener('click', onBucketAction);
        document.getElementById('fileRows').addEventListener('click', onFileAction);
    }

    async function loadBuckets() {
        var q = document.getElementById('bucketSearch').value.trim();
        var data;
        try {
            data = await APP.api('/api/admin/buckets?q=' + encodeURIComponent(q));
        } catch (e) {
            APP.toast(e.message, 'error');
            return false;
        }
        state.buckets = data.items || [];
        renderBuckets();
        renderBucketSelect();
        return true;
    }

    function renderBuckets() {
        var host = document.getElementById('bucketRows');
        if (!state.buckets.length) {
            host.innerHTML = '<tr><td colspan="7" class="text-center empty">暂无</td></tr>';
            return;
        }
        host.innerHTML = state.buckets.map(function (b) {
            return '<tr>' +
                '<td><a class="text-decoration-none fw-semibold cell-text" title="' + APP.esc(b.name) + '" href="/?bucket=' + encodeURIComponent(b.id) + '">' + APP.esc(b.name) + '</a></td>' +
                '<td><span class="pill">' + APP.esc(b.code) + '</span></td>' +
                '<td><span class="pill pill-muted">' + APP.esc(b.owner) + '</span></td>' +
                '<td><span class="pill pill-muted">' + b.file_count + '</span></td>' +
                '<td><span class="pill pill-muted">' + APP.fmtBytes(b.size) + '</span></td>' +
                '<td class="text-muted-2 small">' + APP.fmtTime(b.created_at) + '</td>' +
                '<td class="text-end text-nowrap">' +
                '  <button class="btn btn-sm btn-outline-secondary" data-bact="rename" data-id="' + APP.esc(b.id) + '" title="改名"><i class="bi bi-pencil"></i></button>' +
                '  <button class="btn btn-sm btn-outline-danger" data-bact="delete" data-id="' + APP.esc(b.id) + '" title="删除"><i class="bi bi-trash"></i></button>' +
                '</td>' +
                '</tr>';
        }).join('');
    }

    function renderBucketSelect() {
        var sel = document.getElementById('fileBucket');
        var cur = sel.value;
        sel.innerHTML = '<option value="">全部桶</option>' + state.buckets.map(function (b) {
            return '<option value="' + APP.esc(b.id) + '">' + APP.esc(b.name) + '</option>';
        }).join('');
        sel.value = cur && state.buckets.some(function (b) { return b.id === cur; }) ? cur : '';
    }

    async function onBucketAction(e) {
        var btn = e.target.closest('[data-bact]');
        if (!btn) return;
        var id = btn.dataset.id;
        var b = state.buckets.filter(function (x) { return x.id === id; })[0];
        if (!b) return;
        if (btn.dataset.bact === 'rename') {
            var name = await APP.prompt('桶名', b.name, '储存桶名', '保存');
            if (!name) return;
            try {
                await APP.api('/api/buckets/' + encodeURIComponent(id), { method: 'PATCH', body: { name: name } });
                await loadBuckets();
                APP.toast('已修改');
            } catch (err) {
                APP.toast(err.message, 'error');
            }
        } else if (btn.dataset.bact === 'delete') {
            var ok = await APP.confirm('删除桶', '「' + b.name + '」及桶内 ' + b.file_count + ' 个文件将全部删除。', '删除');
            if (!ok) return;
            try {
                await APP.api('/api/buckets/' + encodeURIComponent(id), { method: 'DELETE' });
                await Promise.all([loadBuckets(), loadFiles(true)]);
                APP.toast('已删除');
            } catch (err) {
                APP.toast(err.message, 'error');
            }
        }
    }

    async function loadFiles(reset) {
        if (reset) {
            state.offset = 0;
            state.files = [];
        }
        var q = document.getElementById('fileSearch').value.trim();
        var bucketId = document.getElementById('fileBucket').value;
        var url = '/api/admin/files?offset=' + state.offset + '&limit=' + state.limit +
            '&q=' + encodeURIComponent(q) + '&bucket_id=' + encodeURIComponent(bucketId);
        var data;
        try {
            data = await APP.api(url);
        } catch (e) {
            APP.toast(e.message, 'error');
            return false;
        }
        state.total = data.total || 0;
        state.files = state.files.concat(data.items || []);
        state.offset = state.files.length;
        renderFiles();
        return true;
    }

    function renderFiles() {
        var host = document.getElementById('fileRows');
        if (!state.files.length) {
            host.innerHTML = '<tr><td colspan="6" class="text-center empty">暂无</td></tr>';
        } else {
            host.innerHTML = state.files.map(function (f) {
                return '<tr>' +
                    '<td><i class="bi ' + APP.fileIcon(f.ext) + ' text-brand me-1"></i><span class="cell-text" title="' + APP.esc(f.name) + '">' + APP.esc(f.name) + '</span></td>' +
                    '<td><a class="text-decoration-none cell-text" title="' + APP.esc(f.bucket_name) + '" href="/?bucket=' + encodeURIComponent(f.bucket_id) + '">' + APP.esc(f.bucket_name) + '</a></td>' +
                    '<td><span class="pill pill-muted">' + APP.esc(f.uploader) + '</span></td>' +
                    '<td><span class="pill pill-muted">' + APP.fmtBytes(f.size) + '</span></td>' +
                    '<td class="text-muted-2 small">' + APP.fmtTime(f.created_at) + '</td>' +
                    '<td class="text-end text-nowrap">' +
                    '  <a class="btn btn-sm btn-outline-secondary" href="/api/files/' + encodeURIComponent(f.id) + '/download" title="下载"><i class="bi bi-download"></i></a>' +
                    '  <button class="btn btn-sm btn-outline-danger" data-fact="delete" data-id="' + APP.esc(f.id) + '" title="删除"><i class="bi bi-trash"></i></button>' +
                    '</td>' +
                    '</tr>';
            }).join('');
        }
        var more = document.getElementById('moreBox');
        if (state.files.length < state.total) {
            more.innerHTML = '<button class="btn btn-sm btn-outline-primary" id="moreBtn">加载更多（' +
                state.files.length + ' / ' + state.total + '）</button>';
            document.getElementById('moreBtn').addEventListener('click', function () { loadFiles(false); });
        } else {
            more.innerHTML = state.total ? '<span class="text-muted-2 small">' + state.total + ' 个文件</span>' : '';
        }
    }

    async function onFileAction(e) {
        var btn = e.target.closest('[data-fact]');
        if (!btn) return;
        var id = btn.dataset.id;
        var f = state.files.filter(function (x) { return x.id === id; })[0];
        if (!f) return;
        var ok = await APP.confirm('删除文件', '删除「' + f.name + '」？', '删除');
        if (!ok) return;
        try {
            await APP.api('/api/files/' + encodeURIComponent(id), { method: 'DELETE' });
            state.files = state.files.filter(function (x) { return x.id !== id; });
            state.total = Math.max(0, state.total - 1);
            state.offset = state.files.length;
            renderFiles();
            loadBuckets();
            APP.toast('已删除');
        } catch (err) {
            APP.toast(err.message, 'error');
        }
    }
})();
