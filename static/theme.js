(function () {
    var KEY = 'fbTheme';
    var AUTO_KEY = 'fbThemeAuto';
    var mode = 'light';
    var auto = false;

    function cnHour() {
        return (new Date().getUTCHours() + 8) % 24;
    }

    function autoMode() {
        var h = cnHour();
        return (h >= 18 || h < 6) ? 'dark' : 'light';
    }

    function readAuto() {
        try {
            return localStorage.getItem(AUTO_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function write(m, a) {
        try {
            localStorage.setItem(KEY, m);
            localStorage.setItem(AUTO_KEY, a ? '1' : '0');
        } catch (e) {}
    }

    function setTheme(m) {
        mode = m;
        document.documentElement.setAttribute('data-bs-theme', mode);
        document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: mode } }));
    }

    auto = readAuto();
    if (auto) {
        mode = autoMode();
    } else {
        try {
            mode = localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
        } catch (e) {}
    }
    document.documentElement.setAttribute('data-bs-theme', mode);

    setInterval(function () {
        if (!auto) return;
        var m = autoMode();
        if (m !== mode) setTheme(m);
    }, 60000);

    window.FBTheme = {
        get: function () {
            return mode;
        },
        isAuto: function () {
            return auto;
        },
        toggle: function () {
            auto = false;
            var next = mode === 'dark' ? 'light' : 'dark';
            write(next, false);
            setTheme(next);
        },
        setAuto: function (on) {
            auto = !!on;
            write(mode, auto);
            if (auto) setTheme(autoMode());
        }
    };
})();
