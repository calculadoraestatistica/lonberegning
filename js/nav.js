/* ==========================================================================
   nav.js — mobil hamburger-menu for lonberegning.dk
   Wirer .nav-toggle (aria-expanded) til .main-nav (#menu) med .is-open.
   Ingen globale symboler; kolliderer ikke med escHtml/updateKommuneInfo m.fl.
   ========================================================================== */
(function () {
  'use strict';

  function init() {
    var btn = document.querySelector('.nav-toggle');
    var nav = document.getElementById('menu') || document.querySelector('.main-nav');
    if (!btn || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Luk menu' : 'Åbn menu');
    }

    btn.addEventListener('click', function () {
      setOpen(!nav.classList.contains('is-open'));
    });

    // Luk med Escape og returnér fokus til knappen
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        btn.focus();
      }
    });

    // Luk ved klik/tap udenfor menuen
    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });

    // Luk når et menupunkt vælges (ankernavigation på samme side)
    nav.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      if (a) setOpen(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
