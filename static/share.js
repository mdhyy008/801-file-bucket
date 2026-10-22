(function () {
    var APP = window.APP;
    var shareId = location.pathname.replace(/^\/s\//, '').replace(/\/+$/, '');

    APP.init('', async function () {
        var host = document.getElementById('app');
        if (!/^[0-9a-f]{8}$/.test(shareId)) {
            renderError(host, '链接无效');
            return;
        }
        var data;
        try {
            data = await APP.api('/api/shares/' + encodeURIComponent(shareId));
        } catch (e) {
            renderError(host, e.status === 404 ? '分享不存在或已删除' : e.message);
            return;
        }
        renderShare(host, data.files || []);
    });

    function renderError(host, message) {
        host.innerHTML = '' +
            '<div class="card download-page">' +
            '  <div class="card-body text-center">' +
            '    <i class="bi bi-file-earmark-x download-icon"></i>' +
            '    <div class="download-name">' + APP.esc(message) + '</div>' +
            '    <a class="btn btn-outline-primary mt-3" href="/"><i class="bi bi-house"></i> 返回首页</a>' +
            '  </div>' +
            '</div>';
    }

    function rowHtml(f) {
        if (!f) {
            return '' +
                '<div class="file-row">' +
                '  <i class="bi bi-file-earmark-x file-icon"></i>' +
                '  <div class="file-main"><div class="file-name">文件不存在或已删除</div></div>' +
                '</div>';
        }
        var previewBtn = f.previewable
            ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="preview" data-id="' +
              APP.esc(f.id) + '" title="预览"><i class="bi bi-eye"></i></button>'
            : '';
        return '' +
            '<div class="file-row">' +
            '  <i class="bi ' + APP.fileIcon(f.ext) + ' file-icon"></i>' +
            '  <div class="file-main">' +
            '    <div class="file-name">' + APP.esc(f.name) + '</div>' +
            '    <div class="file-meta">' +
            '      <span class="pill pill-muted">上传者：' + APP.esc(f.uploader) + '</span>' +
            '      <span class="pill pill-muted">' + APP.fmtBytes(f.size) + '</span>' +
            '      <span class="pill pill-muted">上传时间 ' + APP.fmtTime(f.created_at) + '</span>' +
            '    </div>' +
            '  </div>' +
            '  <div class="file-actions">' + previewBtn +
            '    <a class="btn btn-sm btn-outline-secondary" href="/api/files/' + encodeURIComponent(f.id) +
            '/download" title="下载"><i class="bi bi-download"></i></a>' +
            '  </div>' +
            '</div>';
    }

    function renderShare(host, files) {
        host.innerHTML = '' +
            '<div class="card">' +
            '  <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">' +
            '    <span>分享文件</span>' +
            '    <button type="button" class="btn btn-sm btn-outline-primary" id="copyShareLink">' +
            '      <i class="bi bi-link-45deg"></i> 复制链接</button>' +
            '  </div>' +
            '  <div class="card-body">' + files.map(rowHtml).join('') + '</div>' +
            '</div>';

        document.getElementById('copyShareLink').addEventListener('click', async function () {
            var ok = await APP.copyText(location.href);
            APP.toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
        });

        host.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-act="preview"]');
            if (!btn) return;
            var f = files.filter(function (x) { return x && x.id === btn.dataset.id; })[0];
            if (f) APP.preview(f);
        });
    }
})();
