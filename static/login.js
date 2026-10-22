(function () {
    var APP = window.APP;

    APP.init('login', async function (me) {
        if (me && me.is_admin) {
            location.replace('/admin.html');
            return;
        }
        document.getElementById('app').innerHTML = '' +
            '<div class="row justify-content-center">' +
            '  <div class="col-sm-9 col-md-6 col-lg-4">' +
            '    <div class="card">' +
            '      <div class="card-body p-4">' +
            '        <h5 class="mb-3"><i class="bi bi-shield-lock text-brand"></i> 管理员登录</h5>' +
            '        <form id="loginForm">' +
            '          <label class="form-label">密码</label>' +
            '          <input id="password" type="password" class="form-control" autocomplete="current-password" required>' +
            '          <button type="submit" class="btn btn-primary w-100 mt-3"><i class="bi bi-box-arrow-in-right"></i> 登录</button>' +
            '        </form>' +
            '        <div class="text-center mt-3"><a href="/" class="text-decoration-none small">返回首页</a></div>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        var input = document.getElementById('password');
        input.focus();
        document.getElementById('loginForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            var password = input.value;
            if (!password) return;
            try {
                await APP.api('/api/admin/login', { method: 'POST', body: { password: password } });
                APP.flash('已登录');
                location.replace('/admin.html');
            } catch (err) {
                APP.toast(err.message, 'error');
                input.select();
            }
        });
    });
})();
