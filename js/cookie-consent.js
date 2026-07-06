/* lonberegning.dk — cookie consent banner + Google Consent Mode v2 (GDPR)
 * Standalone, no dependencies. Stores choice in localStorage as 'lb-consent' = 'granted' | 'denied'.
 */
(function () {
  'use strict';
  var KEY = 'lb-consent';

  /* Google Consent Mode v2: default everything to denied BEFORE any consent decision. */
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied'
  });

  function grantAll() {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted'
    });
  }

  function read() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, v); } catch (_) {}
  }

  var stored = read();
  if (stored === 'granted') grantAll();

  var CSS = [
    '.cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;',
    'background:var(--c-surface,var(--c-cream-2,#ffffff));color:var(--c-text,#23262d);',
    'border-top:1px solid var(--c-line,#d8dbe2);box-shadow:0 -4px 18px rgba(0,0,0,.12);',
    'padding:14px 16px;font-size:.95rem;line-height:1.45}',
    '.cookie-banner.is-hidden{opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease}',
    '.cookie-banner__inner{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:10px}',
    '@media (min-width:640px){.cookie-banner__inner{flex-direction:row;align-items:center}}',
    '.cookie-banner__text{margin:0;flex:1}',
    '.cookie-banner__text a{color:inherit;text-decoration:underline}',
    '.cookie-banner__actions{display:flex;gap:8px;flex-shrink:0}',
    '.cookie-banner .cc-btn{cursor:pointer;font:inherit;font-weight:600;border-radius:8px;',
    'padding:8px 16px;border:1px solid var(--c-primary,var(--c-ink,#1f2937))}',
    '.cookie-banner .cc-btn--primary{background:var(--c-primary,var(--c-ink,#1f2937));color:#fff}',
    '.cookie-banner .cc-btn--ghost{background:transparent;color:var(--c-text,#23262d);',
    'border-color:var(--c-line,#9aa1ad)}'
  ].join('');

  function buildBanner() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'cookie-banner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Cookieindstillinger');
    wrap.innerHTML = [
      '<div class="cookie-banner__inner">',
      '  <p class="cookie-banner__text">Vi bruger cookies til annoncer (Google AdSense) og til at forbedre sitet. Læs mere i vores ',
      '  <a href="/privatlivspolitik.html">privatlivspolitik</a>.</p>',
      '  <div class="cookie-banner__actions">',
      '    <button type="button" class="cc-btn cc-btn--ghost" data-cookie="deny">Afvis</button>',
      '    <button type="button" class="cc-btn cc-btn--primary" data-cookie="grant">Accepter</button>',
      '  </div>',
      '</div>'
    ].join('');
    return wrap;
  }

  function init() {
    if (read() === 'granted' || read() === 'denied') return;
    var banner = buildBanner();
    document.body.appendChild(banner);

    banner.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cookie]');
      if (!t) return;
      var action = t.getAttribute('data-cookie');
      write(action === 'grant' ? 'granted' : 'denied');
      if (action === 'grant') grantAll();
      banner.classList.add('is-hidden');
      setTimeout(function () { banner.remove(); }, 250);
      document.dispatchEvent(new CustomEvent('lb:consent', { detail: { value: action } }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.CookieConsent = { read: read };
})();
