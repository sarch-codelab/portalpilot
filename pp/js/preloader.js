(function () {
    var preloader = document.getElementById('preloader');
    var start = Date.now();
    function hide() {
        if (!preloader || preloader.classList.contains('hidden')) return;
        var delay = Math.max(0, 900 - (Date.now() - start));
        setTimeout(function () { preloader.classList.add('hidden'); }, delay);
    }
    if (document.readyState === 'complete') { hide(); }
    window.addEventListener('load', hide);
    setTimeout(hide, 3200);
})();