(function () {
    var APP = window.APP;
    var trendChart = null;
    var lastData = null;
    var lastSig = null;

    APP.init('dashboard', async function () {
        document.addEventListener('themechange', function () {
            if (!lastData) return;
            lastSig = null;
            paintResources(lastData);
            renderTrend(lastData.trend);
        });
        if (await load()) startAuto();
    });

    async function load() {
        var app = document.getElementById('app');
        var data;
        try {
            data = await APP.api('/api/dashboard');
        } catch (e) {
            if (e.status === 403) {
                app.innerHTML = '<div class="card"><div class="card-body text-center py-5">' +
                    '<div class="text-muted-2 mb-3">仅管理员可见</div>' +
                    '<a class="btn btn-primary" href="/">返回首页</a></div></div>';
            } else {
                app.innerHTML = '<div class="card"><div class="card-body text-center py-5">' +
                    '<div class="text-muted-2 mb-3">' + APP.esc(e.message) + '</div>' +
                    '<button class="btn btn-primary" id="retryBtn">重新加载</button></div></div>';
                document.getElementById('retryBtn').addEventListener('click', load);
            }
            return false;
        }
        lastData = data;
        setRefreshSec(data.refresh_sec);
        render(data, app);
        return true;
    }

    function render(d, app) {
        var s = d.stats || {};
        var disk = d.disk || {};

        app.classList.add('dash-page');
        app.innerHTML = '' +
            '<div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">' +
            '  <h5 class="mb-0"><i class="bi bi-bar-chart text-brand"></i> 数据看板</h5>' +
            '  <button class="btn btn-sm btn-outline-primary" id="refreshBtn"><i class="bi bi-arrow-clockwise"></i> 刷新</button>' +
            '</div>' +
            '<div class="row g-3 gx-lg-4">' +
            statCard('项目桶', s.buckets, 'bi-archive', 'col-6 col-md-3 col-xl') +
            statCard('文件', s.files, 'bi-file-earmark', 'col-6 col-md-3 col-xl') +
            statCard('设备', s.devices, 'bi-people', 'col-6 col-md-3 col-xl') +
            statCard('总占用', APP.fmtBytes(s.size), 'bi-hdd', 'col-6 col-md-3 col-xl') +
            statCard('单文件上限', APP.fmtMb(d.max_upload_mb || 0), 'bi-speedometer2', 'col-12 col-xl') +
            '</div>' +
            '<div class="row g-3 gx-lg-4">' +
            '  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-memory text-brand"></i> 内存</div>' +
            '    <div class="card-body" id="memBody"></div></div></div>' +
            '  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-hdd text-brand"></i> 磁盘 ' + APP.esc(disk.mount || '') + '</div>' +
            '    <div class="card-body" id="diskBody"></div></div></div>' +
            '</div>' +
            '<div class="card"><div class="card-header"><i class="bi bi-database-check text-brand"></i> 项目存储额度</div>' +
            '  <div class="card-body" id="quotaBody"></div></div>' +
            '<div class="card"><div class="card-header"><i class="bi bi-graph-up text-brand"></i> 近 30 天上传趋势</div>' +
            '  <div class="card-body"><div class="chart-box"><canvas id="trendChart"></canvas></div></div></div>' +
            '<div class="row g-3 gx-lg-4">' +
            '  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-trophy text-brand"></i> 各桶排行</div>' +
            '    <div class="card-body" id="rankBox"></div></div></div>' +
            '  <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-pie-chart text-brand"></i> 文件类型分布</div>' +
            '    <div class="card-body" id="typeBox"></div></div></div>' +
            '</div>';

        lastSig = null;
        paintResources(d);

        document.getElementById('refreshBtn').addEventListener('click', async function () {
            if (await load()) APP.toast('已刷新');
        });
        renderRanking(d.ranking || []);
        renderTypes(d.types || [], s.files || 0);
        renderTrend(d.trend || []);
    }

    function paintResources(d) {
        var mem = d.memory || {};
        var pm = d.process_memory || {};
        var disk = d.disk || {};
        var q = d.quota || {};
        var sig = JSON.stringify([mem, pm, disk, q]);
        if (sig === lastSig) return;
        lastSig = sig;
        var brand = cssVar('--brand', '#1a73e8');
        var memBody = document.getElementById('memBody');
        var diskBody = document.getElementById('diskBody');
        var quotaBody = document.getElementById('quotaBody');
        if (memBody) memBody.innerHTML = memoryHtml(mem, pm, brand);
        if (diskBody) diskBody.innerHTML = diskHtml(disk, brand);
        if (quotaBody) quotaBody.innerHTML = quotaHtml(q, brand);
    }

    var autoTimer = null;
    var refreshSec = 10;

    function setRefreshSec(sec) {
        var n = Math.max(5, Math.min(300, Number(sec) || 10));
        if (n === refreshSec && autoTimer) return;
        refreshSec = n;
        if (autoTimer) startAuto();
    }

    function startAuto() {
        if (autoTimer) clearInterval(autoTimer);
        autoTimer = setInterval(autoRefresh, refreshSec * 1000);
    }

    async function autoRefresh() {
        if (document.hidden) return;
        var data;
        try {
            data = await APP.api('/api/dashboard');
        } catch (e) {
            return;
        }
        lastData = data;
        setRefreshSec(data.refresh_sec);
        paintResources(data);
    }

    window.addEventListener('pagehide', function () {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    });

    function cssVar(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    function statCard(label, value, icon, col) {
        return '<div class="' + col + '"><div class="stat-box">' +
            '<div class="stat-num">' + APP.esc(value) + '</div>' +
            '<div class="stat-label"><i class="bi ' + icon + '"></i> ' + APP.esc(label) + '</div>' +
            '</div></div>';
    }

    function infoTiles(items) {
        return '<div class="info-grid">' + items.map(function (it) {
            return '<div class="info-tile"><div class="k">' + APP.esc(it[0]) + '</div>' +
                '<div class="v">' + APP.esc(it[1]) + '</div></div>';
        }).join('') + '</div>';
    }

    function stackedBar(label, segments, shownPct) {
        var total = 0;
        segments.forEach(function (s) { total += Number(s.pct) || 0; });
        var bars = segments.map(function (s) {
            var pct = Math.max(0, Math.min(100, Number(s.pct) || 0));
            if (!pct) return '';
            return '<div class="progress-bar" role="progressbar" style="width:' + pct + '%;background:' +
                s.color + '" title="' + APP.esc(s.title) + '"></div>';
        }).join('');
        var legend = segments.map(function (s) {
            return '<span class="me-3 d-inline-flex align-items-center"><i class="legend-dot" style="background:' +
                s.color + '"></i>' + APP.esc(s.title) + '</span>';
        }).join('');
        var shownVal = typeof shownPct === 'number' ? shownPct : total;
        var shown = shownVal < 1 ? shownVal.toFixed(2) : shownVal.toFixed(1);
        return '<div class="info-bar">' +
            '<div class="d-flex justify-content-between small text-muted-2 mb-1"><span>' + APP.esc(label) +
            '</span><span class="fw-semibold">' + shown + '%</span></div>' +
            '<div class="progress">' + bars + '</div>' +
            '<div class="small text-muted-2 mt-1">' + legend + '</div></div>';
    }

    function memoryHtml(mem, pm, brand) {
        if (!mem || !mem.total) return '<div class="empty">暂无数据</div>';
        var appMem = pm.working_set || 0;
        var totalMem = Number(mem.total) || 0;
        var usedMem = Number(mem.used) || 0;
        var pct = totalMem ? appMem / totalMem * 100 : 0;
        var usedPct = totalMem ? usedMem / totalMem * 100 : 0;
        var other = Math.max(0, usedMem - appMem);
        var free = Math.max(0, totalMem - usedMem);
        return infoTiles([
            ['软件占用', APP.fmtBytes(appMem)],
            ['峰值内存', APP.fmtBytes(pm.peak_working_set)],
            ['占总内存', (pct < 1 ? pct.toFixed(2) : pct.toFixed(1)) + '%'],
            ['电脑已用', APP.fmtBytes(mem.used) + ' / ' + APP.fmtBytes(mem.total)]
        ]) + stackedBar('内存占用', [
            { pct: totalMem ? other / totalMem * 100 : 0, color: '#94a3b8', title: '其他占用 ' + APP.fmtBytes(other) },
            { pct: pct, color: brand, title: '软件占用 ' + APP.fmtBytes(appMem) },
            { pct: totalMem ? free / totalMem * 100 : 0, color: 'var(--line)', title: '剩余 ' + APP.fmtBytes(free) }
        ], usedPct);
    }

    function diskHtml(disk, brand) {
        if (disk.error) return '<div class="empty">' + APP.esc(disk.error) + '</div>';
        var used = Number(disk.used) || 0;
        var total = Number(disk.total) || 0;
        var appSize = Number(disk.app_size) || 0;
        var ready = disk.ready !== false;
        var other = Math.max(0, used - appSize);
        var free = Math.max(0, Number(disk.free) || 0);
        var appPct = total ? appSize / total * 100 : 0;
        var usedPct = total ? used / total * 100 : 0;
        var dm = /^([A-Za-z]):/.exec(disk.mount || '');
        var label = '项目占用' + (dm ? dm[1].toUpperCase() + '盘' : '') + '百分比';
        var appText = ready ? APP.fmtBytes(appSize) : '统计中…';
        return infoTiles([
            ['磁盘已用', APP.fmtBytes(used) + ' / ' + APP.fmtBytes(total)],
            ['磁盘剩余', APP.fmtBytes(disk.free)],
            ['程序占用 + 数据目录', (ready ? APP.fmtBytes(disk.program_size) : '统计中…') + ' + ' +
                (ready ? APP.fmtBytes(disk.data_size) : '统计中…') + ' = ' + appText]
        ]) + stackedBar(label, [
            { pct: total ? other / total * 100 : 0, color: '#94a3b8', title: '其他占用 ' + APP.fmtBytes(other) },
            { pct: appPct, color: brand, title: '项目占用 ' + appText },
            { pct: total ? free / total * 100 : 0, color: 'var(--line)', title: '剩余 ' + APP.fmtBytes(free) }
        ], usedPct);
    }

    function quotaHtml(q, brand) {
        if (!q.quota_bytes) return '<div class="empty">暂无数据</div>';
        var used = Number(q.used_bytes) || 0;
        var quota = Number(q.quota_bytes) || 0;
        var pct = quota ? Math.min(100, used / quota * 100) : 0;
        var color = pct >= 90 ? '#d93025' : brand;
        return infoTiles([
            ['总额度', '磁盘剩余 ' + APP.fmtBytes(q.disk_free) + ' × ' + q.percent + '% = ' +
                APP.fmtBytes(Math.round(Number(q.disk_free) * q.percent / 100))],
            ['已占用', APP.fmtBytes(used)],
            ['剩余额度', APP.fmtBytes(Math.max(0, quota - used))]
        ]) +
            '<div class="info-bar">' +
            '<div class="d-flex justify-content-between small text-muted-2 mb-1"><span>额度使用</span>' +
            '<span class="fw-semibold">' + (pct < 1 ? pct.toFixed(2) : pct.toFixed(1)) + '%</span></div>' +
            '<div class="progress"><div class="progress-bar" style="width:' + pct + '%;background:' + color + '"></div></div>' +
            '</div>';
    }

    function barRow(label, countText, pct, color) {
        return '<div class="bar-row">' +
            '<div class="bar-label" title="' + APP.esc(label) + '">' + APP.esc(label) + '</div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(1, pct) + '%;background:' + color + '"></div></div>' +
            '<div class="bar-count">' + APP.esc(countText) + '</div>' +
            '</div>';
    }

    function renderRanking(ranking) {
        var host = document.getElementById('rankBox');
        if (!ranking.length) {
            host.innerHTML = '<div class="empty">暂无</div>';
            return;
        }
        var max = Math.max.apply(null, ranking.map(function (r) { return r.size || 0; })) || 1;
        var brand = cssVar('--brand', '#1a73e8');
        host.innerHTML = ranking.map(function (r) {
            return barRow(r.name, APP.fmtBytes(r.size) + ' · ' + r.files, (r.size || 0) / max * 100, brand);
        }).join('');
    }

    function renderTypes(types, totalFiles) {
        var host = document.getElementById('typeBox');
        if (!types.length) {
            host.innerHTML = '<div class="empty">暂无</div>';
            return;
        }
        var max = Math.max.apply(null, types.map(function (t) { return t.count || 0; })) || 1;
        var total = totalFiles || types.reduce(function (a, t) { return a + t.count; }, 0);
        var brand = cssVar('--brand', '#1a73e8');
        host.innerHTML = types.map(function (t) {
            var pctOfAll = total ? t.count / total * 100 : 0;
            return barRow(t.label, t.count + ' 个 · ' + pctOfAll.toFixed(1) + '%', (t.count || 0) / max * 100, brand);
        }).join('');
    }

    function renderTrend(trend) {
        var canvas = document.getElementById('trendChart');
        if (!canvas) return;
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
        }
        var brand = cssVar('--brand', '#1a73e8');
        var muted = cssVar('--muted', '#6b7280');
        var line = cssVar('--line', '#eef1f5');
        var textStrong = cssVar('--text-strong', '#1f2937');
        var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        trendChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: trend.map(function (t) { return t.date; }),
                datasets: [{
                    label: '上传',
                    data: trend.map(function (t) { return t.count; }),
                    backgroundColor: brand,
                    borderRadius: 4,
                    maxBarThickness: 18
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark ? '#0b0e12' : '#111827',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff'
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: muted, precision: 0 },
                        grid: { color: line }
                    }
                }
            }
        });
        void textStrong;
    }
})();
