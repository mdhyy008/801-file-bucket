(function () {
    var APP = window.APP;
    var state = { diskFree: 0, used: 0, quota: 0, percent: 20 };

    APP.init('settings', async function (me) {
        if (!me || !me.is_admin) {
            location.replace('/login.html');
            return;
        }
        render();
        await load();
    });

    function render() {
        document.getElementById('app').innerHTML = '' +
            '<div id="pwdNotice"></div>' +
            '<div class="card">' +
            '  <div class="card-header"><i class="bi bi-sliders text-brand"></i> 上传与存储</div>' +
            '  <div class="card-body">' +
            '    <div class="row g-3">' +
            '      <div class="col-md-4">' +
            '        <label class="form-label">单文件上限（MB）</label>' +
            '        <input id="maxMb" type="number" min="1" max="102400" class="form-control">' +
            '      </div>' +
            '      <div class="col-md-4">' +
            '        <label class="form-label d-flex justify-content-between align-items-center">' +
            '          <span>磁盘剩余占用比例（%）</span><span class="text-brand" id="quotaPctVal">20%</span></label>' +
            '        <input id="quotaPct" type="range" min="1" max="90" step="1" class="form-range">' +
            '      </div>' +
            '      <div class="col-md-4">' +
            '        <label class="form-label">预计额度</label>' +
            '        <div id="quotaPreview" class="form-control-plaintext fw-semibold">—</div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="row g-3 mt-1">' +
            '      <div class="col-md-4">' +
            '        <label class="form-label">单桶文件数量上限（0 不限）</label>' +
            '        <input id="maxFiles" type="number" min="0" max="100000" class="form-control">' +
            '      </div>' +
            '      <div class="col-md-4">' +
            '        <label class="form-label">看板刷新间隔（秒）</label>' +
            '        <input id="dashRefresh" type="number" min="5" max="300" class="form-control">' +
            '      </div>' +
            '      <div class="col-md-4">' +
            '        <label class="form-label">文件扩展名</label>' +
            '        <div class="input-group">' +
            '          <select id="extMode" class="form-select" style="max-width:110px">' +
            '            <option value="off">不限制</option>' +
            '            <option value="allow">仅允许</option>' +
            '            <option value="deny">禁止</option>' +
            '          </select>' +
            '          <input id="extList" class="form-control" placeholder="exe,bat,cmd">' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="form-check form-switch mt-3">' +
            '      <input id="uploadsEnabled" type="checkbox" class="form-check-input">' +
            '      <label class="form-check-label" for="uploadsEnabled">上传总开关</label>' +
            '    </div>' +
            '    <div class="form-check form-switch mt-3">' +
            '      <input id="dashVisible" type="checkbox" class="form-check-input">' +
            '      <label class="form-check-label" for="dashVisible">看板普通用户可见</label>' +
            '    </div>' +
            '    <div class="mt-3"><button id="saveBtn" class="btn btn-primary"><i class="bi bi-check2"></i> 保存</button></div>' +
            '    <hr>' +
            '    <div class="info-grid" id="quotaInfo"></div>' +
            '  </div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-body d-flex align-items-center justify-content-between gap-3">' +
            '    <div>管理员密码</div>' +
            '    <button id="pwdOpenBtn" class="btn btn-outline-primary"><i class="bi bi-shield-lock"></i> 修改</button>' +
            '  </div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-body d-flex align-items-center justify-content-between gap-3">' +
            '    <div>分享链接</div>' +
            '    <button id="clearSharesBtn" class="btn btn-outline-danger"><i class="bi bi-link-45deg"></i> 全部失效</button>' +
            '  </div>' +
            '</div>' +
            '<div class="card">' +
            '  <div class="card-body d-flex align-items-center justify-content-between gap-3">' +
            '    <div>系统版本：<span class="fw-semibold" id="otaCurVersion">—</span></div>' +
            '    <button id="otaOpenBtn" class="btn btn-outline-primary"><i class="bi bi-cloud-arrow-up"></i> 更新</button>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="pwdModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header">' +
            '        <h5 class="modal-title">修改管理员密码</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>' +
            '      </div>' +
            '      <div class="modal-body">' +
            '        <div class="mb-3"><label class="form-label">原密码</label>' +
            '          <input id="oldPwd" type="password" autocomplete="current-password" class="form-control"></div>' +
            '        <div class="mb-3"><label class="form-label">新密码</label>' +
            '          <input id="newPwd" type="password" autocomplete="new-password" class="form-control"></div>' +
            '        <div><label class="form-label">确认新密码</label>' +
            '          <input id="newPwd2" type="password" autocomplete="new-password" class="form-control"></div>' +
            '      </div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>' +
            '        <button id="pwdBtn" class="btn btn-primary"><i class="bi bi-check2"></i> 保存</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="modal fade" id="otaModal" tabindex="-1">' +
            '  <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header">' +
            '        <h5 class="modal-title"><i class="bi bi-cloud-arrow-up"></i> 系统更新</h5>' +
            '        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>' +
            '      </div>' +
            '      <div class="modal-body">' +
            '        <div id="otaStepPick">' +
            '          <input type="file" class="form-control" id="otaFile" accept=".zip">' +
            '        </div>' +
            '        <div id="otaStepConfirm" class="d-none">' +
            '          <div class="alert alert-warning py-2 d-none" id="otaOldWarn">' +
            '            <i class="bi bi-exclamation-triangle"></i> 这是旧版本，不能更新</div>' +
            '          <div class="alert alert-danger py-2 d-none" id="otaChecksumWarn">' +
            '            <i class="bi bi-shield-exclamation"></i> 校验码无效，不能更新</div>' +
            '          <div class="alert alert-danger py-2 d-none" id="otaWatchdogWarn">' +
            '            <i class="bi bi-heart-pulse"></i> 守护进程未运行，不能更新</div>' +
            '          <div class="d-flex align-items-center gap-2 flex-wrap mb-3">' +
            '            <span class="ota-version-pill" id="otaNewVersion">—</span>' +
            '            <span class="ota-checksum-pill" id="otaChecksum">—</span>' +
            '            <span class="text-muted-2 small" id="otaBuildAt"></span>' +
            '          </div>' +
            '          <div class="section-subtitle">更新日志</div>' +
            '          <div class="ota-block ota-changelog mb-3" id="otaChangelog"></div>' +
            '          <div class="small text-muted-2 mb-1">将覆盖更新 <span class="fw-semibold text-brand" id="otaOverwriteCount">0</span> 个文件（共 <span id="otaFileCount">0</span> 个，内容相同跳过 <span id="otaSameCount">0</span> 个）</div>' +
            '          <div class="small text-muted-2 mb-1 d-none" id="otaDeleteInfo">将删除 <span class="fw-semibold text-brand" id="otaDeleteCount">0</span> 个旧文件</div>' +
            '          <div class="ota-block ota-file-list" id="otaFileTree"></div>' +
            '        </div>' +
            '        <div id="otaStepProgress" class="d-none">' +
            '          <div class="d-flex justify-content-between mb-2">' +
            '            <span id="otaProgLabel">正在更新…</span>' +
            '            <span class="text-muted-2" id="otaProgCount"></span>' +
            '          </div>' +
            '          <div class="progress" style="height:8px;">' +
            '            <div class="progress-bar" id="otaProgBar" style="width:0%"></div>' +
            '          </div>' +
            '          <div class="small text-muted-2 mt-2 text-truncate" id="otaProgFile"></div>' +
            '        </div>' +
            '      </div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" id="otaCancelBtn" data-bs-dismiss="modal">取消</button>' +
            '        <button type="button" class="btn btn-outline-secondary d-none" id="otaBackBtn">返回</button>' +
            '        <button type="button" class="btn btn-primary" id="otaUploadBtn"><i class="bi bi-cloud-arrow-up"></i> 上传</button>' +
            '        <button type="button" class="btn btn-primary d-none" id="otaApplyBtn"><i class="bi bi-check-lg"></i> 确认更新</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        document.getElementById('quotaPct').addEventListener('input', updatePreview);
        document.getElementById('quotaPct').addEventListener('change', updatePreview);
        document.getElementById('saveBtn').addEventListener('click', saveSettings);
        document.getElementById('extMode').addEventListener('change', function () {
            document.getElementById('extList').disabled = this.value === 'off';
        });
        document.getElementById('clearSharesBtn').addEventListener('click', clearShares);
        document.getElementById('pwdOpenBtn').addEventListener('click', openPwdModal);
        document.getElementById('pwdBtn').addEventListener('click', savePassword);
        document.getElementById('pwdModal').addEventListener('shown.bs.modal', function () {
            document.getElementById('oldPwd').focus();
        });
        document.getElementById('otaOpenBtn').addEventListener('click', openOtaModal);
        document.getElementById('otaUploadBtn').addEventListener('click', otaParse);
        document.getElementById('otaApplyBtn').addEventListener('click', otaApply);
        document.getElementById('otaBackBtn').addEventListener('click', function () { otaShowStep('pick'); });
        document.getElementById('otaFile').addEventListener('change', function () {
            var pick = document.getElementById('otaStepPick');
            var f = this.files && this.files[0];
            var old = document.getElementById('otaPickedName');
            if (old) old.remove();
            if (f) {
                var div = document.createElement('div');
                div.id = 'otaPickedName';
                div.className = 'small text-muted-2 mt-2 text-truncate';
                div.textContent = f.name;
                pick.appendChild(div);
            }
        });
    }

    async function load() {
        var d;
        try {
            d = await APP.api('/api/admin/settings');
        } catch (e) {
            APP.toast(e.message, 'error');
            return;
        }
        state.diskFree = d.disk_free || 0;
        state.used = d.used_bytes || 0;
        state.quota = d.quota_bytes || 0;
        state.percent = d.disk_quota_percent || 20;
        document.getElementById('maxMb').value = d.max_upload_mb || 100;
        document.getElementById('quotaPct').value = state.percent;
        document.getElementById('dashVisible').checked = !!d.dashboard_visible;
        document.getElementById('uploadsEnabled').checked = d.uploads_enabled !== false;
        document.getElementById('maxFiles').value = d.max_files_per_bucket || 0;
        document.getElementById('dashRefresh').value = d.dashboard_refresh_sec || 10;
        var extMode = d.ext_mode || 'off';
        document.getElementById('extMode').value = extMode;
        document.getElementById('extList').value = d.ext_list || '';
        document.getElementById('extList').disabled = extMode === 'off';
        document.getElementById('pwdNotice').innerHTML = d.is_default_password
            ? '<div class="alert alert-warning py-2">默认密码：admin123</div>'
            : '';
        updatePreview();
        renderQuotaInfo();
        try {
            var v = await APP.api('/api/version');
            otaCurVer = (v && v.version) || '—';
        } catch (e) {}
        document.getElementById('otaCurVersion').textContent = otaCurVer;
    }

    function fmt(n) { return APP.fmtBytes(n); }

    function updatePreview() {
        var pct = Number(document.getElementById('quotaPct').value) || 0;
        var preview = document.getElementById('quotaPreview');
        document.getElementById('quotaPctVal').textContent = pct + '%';
        if (!state.diskFree || pct < 1) {
            preview.textContent = '—';
            return;
        }
        var bytes = Math.floor(state.diskFree * pct / 100);
        preview.textContent = fmt(state.diskFree) + ' × ' + pct + '% = ' + fmt(bytes);
    }

    function renderQuotaInfo() {
        var host = document.getElementById('quotaInfo');
        if (!host) return;
        var items = [
            ['当前额度', fmt(state.quota)],
            ['已占用', fmt(state.used)],
            ['磁盘剩余', fmt(state.diskFree)],
            ['剩余额度', fmt(Math.max(0, state.quota - state.used))]
        ];
        host.innerHTML = items.map(function (it) {
            return '<div class="info-tile"><div class="k">' + APP.esc(it[0]) + '</div>' +
                '<div class="v">' + APP.esc(it[1]) + '</div></div>';
        }).join('');
    }

    async function saveSettings() {
        var maxMb = Number(document.getElementById('maxMb').value);
        var pct = Number(document.getElementById('quotaPct').value);
        if (!(maxMb >= 1 && maxMb <= 102400)) {
            APP.toast('单文件上限需在 1–102400 MB 之间', 'error');
            return;
        }
        if (!(pct >= 1 && pct <= 90)) {
            APP.toast('磁盘占用比例需在 1–90% 之间', 'error');
            return;
        }
        var maxFiles = Number(document.getElementById('maxFiles').value) || 0;
        if (!(maxFiles >= 0 && maxFiles <= 100000)) {
            APP.toast('单桶文件数量上限需在 0–100000 之间', 'error');
            return;
        }
        var refreshSec = Number(document.getElementById('dashRefresh').value) || 10;
        if (!(refreshSec >= 5 && refreshSec <= 300)) {
            APP.toast('看板刷新间隔需在 5–300 秒之间', 'error');
            return;
        }
        try {
            var r = await APP.api('/api/admin/settings', {
                method: 'POST',
                body: {
                    max_upload_mb: Math.round(maxMb),
                    dashboard_visible: document.getElementById('dashVisible').checked,
                    disk_quota_percent: Math.round(pct),
                    uploads_enabled: document.getElementById('uploadsEnabled').checked,
                    ext_mode: document.getElementById('extMode').value,
                    ext_list: document.getElementById('extList').value,
                    max_files_per_bucket: Math.round(maxFiles),
                    dashboard_refresh_sec: Math.round(refreshSec)
                }
            });
            state.quota = r.quota_bytes || 0;
            state.used = r.used_bytes || 0;
            state.percent = r.disk_quota_percent || 20;
            state.diskFree = r.disk_free || state.diskFree;
            document.getElementById('extList').value = r.ext_list || '';
            renderQuotaInfo();
            updatePreview();
            APP.toast('已保存');
        } catch (e) {
            APP.toast(e.message, 'error');
        }
    }

    async function clearShares() {
        var ok = await APP.confirm('全部分享', '所有分享链接将立即失效。', '全部失效');
        if (!ok) return;
        try {
            var r = await APP.api('/api/admin/shares', { method: 'DELETE' });
            APP.toast(r.count ? '已失效 ' + r.count + ' 条' : '没有分享');
        } catch (e) {
            APP.toast(e.message, 'error');
        }
    }

    var pwdModal = null;

    function openPwdModal() {
        ['oldPwd', 'newPwd', 'newPwd2'].forEach(function (id) {
            document.getElementById(id).value = '';
        });
        if (!pwdModal) pwdModal = new bootstrap.Modal(document.getElementById('pwdModal'));
        pwdModal.show();
    }

    // ───────── OTA 系统更新：解析校验 → 二次确认 → 覆盖更新（显示进度）→ 重启 ─────────

    var otaModal = null, otaFileObj = null, otaCurVer = '', otaTargetVer = '';

    function openOtaModal() {
        otaFileObj = null;
        var input = document.getElementById('otaFile');
        if (input) input.value = '';
        var old = document.getElementById('otaPickedName');
        if (old) old.remove();
        document.getElementById('otaApplyBtn').disabled = false;
        otaShowStep('pick');
        if (!otaModal) otaModal = new bootstrap.Modal(document.getElementById('otaModal'));
        otaModal.show();
    }

    function otaShowStep(step) {
        document.getElementById('otaStepPick').classList.toggle('d-none', step !== 'pick');
        document.getElementById('otaStepConfirm').classList.toggle('d-none', step !== 'confirm');
        document.getElementById('otaStepProgress').classList.toggle('d-none', step !== 'progress');
        document.getElementById('otaUploadBtn').classList.toggle('d-none', step !== 'pick');
        document.getElementById('otaApplyBtn').classList.toggle('d-none', step !== 'confirm');
        document.getElementById('otaBackBtn').classList.toggle('d-none', step !== 'confirm');
        document.getElementById('otaCancelBtn').classList.toggle('d-none', step === 'progress');
    }

    function otaCompareVersion(a, b) {
        var pa = String(a || '').split('.'), pb = String(b || '').split('.');
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var x = parseInt(pa[i] || '0', 10) || 0, y = parseInt(pb[i] || '0', 10) || 0;
            if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
    }

    function otaChangelogHtml(text) {
        var lines = (text || '').split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
        if (!lines.length) return '<div class="text-muted-2">（无）</div>';
        return '<ul>' + lines.map(function (l) {
            var s = APP.esc(l.replace(/^[-*]\s*/, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
            return '<li>' + s + '</li>';
        }).join('') + '</ul>';
    }

    function otaTreeHtml(files) {
        var root = {};
        files.forEach(function (item) {
            var p = typeof item === 'string' ? item : item.name;
            var changed = typeof item === 'string' ? true : item.changed;
            var parts = p.split('/');
            var node = root;
            for (var i = 0; i < parts.length; i++) {
                if (i === parts.length - 1) (node.__f = node.__f || []).push({ name: parts[i], changed: changed });
                else { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]]; }
            }
        });
        function render(node, depth) {
            var pad = 'padding-left:' + (depth * 16) + 'px;';
            var html = '';
            Object.keys(node).filter(function (k) { return k !== '__f'; }).sort().forEach(function (d) {
                html += '<div class="ota-tree-row" style="' + pad + '"><i class="bi bi-folder2"></i>' + APP.esc(d) + '</div>';
                html += render(node[d], depth + 1);
            });
            (node.__f || []).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
                if (f.changed) {
                    html += '<div class="ota-tree-row" style="' + pad + '"><i class="bi bi-file-earmark"></i>' + APP.esc(f.name) + '</div>';
                } else {
                    html += '<div class="ota-tree-row ota-same" style="' + pad + '" title="内容与当前一致，不会覆盖"><i class="bi bi-file-earmark-check"></i>' + APP.esc(f.name) + '（相同）</div>';
                }
            });
            return html;
        }
        return render(root, 0) || '<div class="text-muted-2">（无）</div>';
    }

    async function otaParse() {
        var input = document.getElementById('otaFile');
        var file = input.files && input.files[0];
        if (!file) { APP.toast('请先选择更新包（zip）', 'error'); return; }
        var btn = document.getElementById('otaUploadBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>解析中...';
        try {
            var fd = new FormData();
            fd.append('file', file);
            var data = await APP.api('/api/system/ota-update?dry_run=true', { method: 'POST', body: fd });
            otaFileObj = file;
            otaTargetVer = data.version || '';
            document.getElementById('otaNewVersion').textContent = 'v' + (data.version || '—');
            document.getElementById('otaChecksum').textContent = data.checksum || '无校验码';
            document.getElementById('otaBuildAt').textContent = data.built_at ? ('构建于 ' + data.built_at) : '';
            document.getElementById('otaChangelog').innerHTML = otaChangelogHtml(data.changelog);
            document.getElementById('otaOverwriteCount').textContent = data.overwrite_count || 0;
            document.getElementById('otaFileCount').textContent = data.count || 0;
            document.getElementById('otaSameCount').textContent = data.same_count || 0;
            document.getElementById('otaDeleteCount').textContent = data.delete_count || 0;
            document.getElementById('otaDeleteInfo').classList.toggle('d-none', !data.delete_count);
            document.getElementById('otaFileTree').innerHTML = otaTreeHtml(data.files || []);
            var isOld = otaCompareVersion(data.version, data.current || otaCurVer) < 0;
            var badCk = !data.checksum_ok;
            var noWatchdog = data.watchdog_ok === false;
            document.getElementById('otaOldWarn').classList.toggle('d-none', !isOld);
            document.getElementById('otaChecksumWarn').classList.toggle('d-none', !badCk);
            document.getElementById('otaWatchdogWarn').classList.toggle('d-none', !noWatchdog);
            document.getElementById('otaApplyBtn').disabled = isOld || badCk || noWatchdog;
            otaShowStep('confirm');
        } catch (e) {
            APP.toast('解析失败：' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> 上传';
        }
    }

    async function otaApply() {
        if (!otaFileObj) { otaShowStep('pick'); return; }
        otaShowStep('progress');
        otaSetProgress(0, 0, '', '正在更新…');
        try {
            var fd = new FormData();
            fd.append('file', otaFileObj);
            await APP.api('/api/system/ota-update', { method: 'POST', body: fd });
        } catch (e) {
            APP.toast('更新失败：' + e.message, 'error');
            otaShowStep('confirm');
            return;
        }
        otaPollProgress();
    }

    function otaSetProgress(done, total, current, label) {
        var pct = total ? Math.round(done / total * 100) : 0;
        document.getElementById('otaProgBar').style.width = pct + '%';
        document.getElementById('otaProgCount').textContent = total ? (done + ' / ' + total) : '';
        if (label) document.getElementById('otaProgLabel').textContent = label;
        document.getElementById('otaProgFile').textContent = current || '';
    }

    async function otaPollProgress() {
        var st;
        try {
            st = await APP.api('/api/system/ota-progress');
        } catch (e) {
            otaWaitRecover();
            return;
        }
        if (st.phase === 'extracting' || st.phase === 'applying' || st.phase === 'deps' || st.phase === 'backup') {
            otaSetProgress(st.done, st.total, st.current, '正在更新…');
            setTimeout(otaPollProgress, 200);
        } else if (st.phase === 'restarting') {
            document.getElementById('otaProgBar').style.width = '100%';
            document.getElementById('otaProgCount').textContent = '';
            document.getElementById('otaProgFile').textContent = '';
            otaCountdown(3, ' 秒后重启', otaWaitRecover);
        } else if (st.phase === 'error') {
            otaShowStep('confirm');
            APP.toast('更新失败：' + (st.message || '未知错误'), 'error');
        } else {
            setTimeout(otaPollProgress, 200);
        }
    }

    function otaCountdown(sec, suffix, done) {
        var box = document.getElementById('otaProgLabel');
        var n = sec;
        function step() {
            if (n <= 0) { done(); return; }
            box.textContent = n + suffix;
            n--;
            setTimeout(step, 1000);
        }
        step();
    }

    function otaWaitRecover() {
        document.getElementById('otaProgLabel').textContent = '正在重启服务…';
        document.getElementById('otaProgFile').textContent = '';
        document.getElementById('otaProgCount').textContent = '';
        setTimeout(function () { otaRefreshCountdown(12); }, 2000);
    }

    function otaRefreshCountdown(sec) {
        document.getElementById('otaProgLabel').textContent = '前端刷新倒计时';
        var box = document.getElementById('otaProgCount');
        var n = sec;
        function step() {
            if (n <= 0) { window.location.reload(); return; }
            box.textContent = n + ' 秒';
            n--;
            setTimeout(step, 1000);
        }
        step();
    }

    async function savePassword() {
        var oldPwd = document.getElementById('oldPwd').value;
        var newPwd = document.getElementById('newPwd').value;
        var newPwd2 = document.getElementById('newPwd2').value;
        if (!oldPwd || !newPwd) {
            APP.toast('请输入密码', 'error');
            return;
        }
        if (newPwd !== newPwd2) {
            APP.toast('两次输入不一致', 'error');
            return;
        }
        try {
            await APP.api('/api/admin/password', {
                method: 'POST',
                body: { old_password: oldPwd, new_password: newPwd }
            });
            document.getElementById('oldPwd').value = '';
            document.getElementById('newPwd').value = '';
            document.getElementById('newPwd2').value = '';
            document.getElementById('pwdNotice').innerHTML = '';
            if (pwdModal) pwdModal.hide();
            APP.toast('已保存');
        } catch (e) {
            APP.toast(e.message, 'error');
        }
    }
})();
