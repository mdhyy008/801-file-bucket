(function () {
    var APP = window.APP;
    var fileId = location.pathname.replace(/^\/f\//, '').replace(/\/+$/, '');

    APP.init('', async function () {
        var host = document.getElementById('app');
        if (!/^[0-9a-f]{32}$/.test(fileId)) {
            renderError(host, '链接无效');
            return;
        }
        var f;
        try {
            f = await APP.api('/api/files/' + encodeURIComponent(fileId) + '/info');
        } catch (e) {
            renderError(host, e.status === 404 ? '文件不存在或已删除' : e.message);
            return;
        }
        renderFile(host, f);
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

    function renderFile(host, f) {
        host.innerHTML = '' +
            '<div class="card download-page">' +
            '  <div class="card-body text-center">' +
            '    <i class="bi ' + APP.fileIcon(f.ext) + ' download-icon"></i>' +
            '    <div class="download-name">' + APP.esc(f.name) + '</div>' +
            '    <div class="d-flex justify-content-center flex-wrap gap-1 mt-2">' +
            '      <span class="pill pill-muted">' + APP.fmtBytes(f.size) + '</span>' +
            '      <span class="pill pill-muted">上传者 ' + APP.esc(f.uploader) + '</span>' +
            '      <span class="pill pill-muted">' + APP.fmtTime(f.created_at) + '</span>' +
            '    </div>' +
            '    <div class="d-flex justify-content-center flex-wrap gap-2 mt-3">' +
            '      <a class="btn btn-primary" href="/api/files/' + encodeURIComponent(f.id) + '/download">' +
            '        <i class="bi bi-download"></i> 下载</a>' +
            (f.previewable
                ? '      <button type="button" class="btn btn-outline-primary" id="previewBtn">' +
                  '<i class="bi bi-eye"></i> 预览</button>'
                : '') +
            '    </div>' +
            '  </div>' +
            '</div>';

        var previewBtn = document.getElementById('previewBtn');
        if (previewBtn) previewBtn.addEventListener('click', function () { APP.preview(f); });
    }
})();
