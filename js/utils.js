/* ==========================================================================
   GH//VIEWER — utils: bus, formatting, storage, toast, icons, count-up
   ========================================================================== */
window.GV = window.GV || {};

(function (GV) {
  'use strict';

  /* ---------- tiny event bus ---------- */
  const listeners = Object.create(null);
  GV.bus = {
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return () => GV.bus.off(evt, fn);
    },
    off(evt, fn) {
      listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
    },
    emit(evt, data) {
      (listeners[evt] || []).slice().forEach((fn) => {
        try { fn(data); } catch (err) { console.error('[bus]', evt, err); }
      });
    }
  };

  /* ---------- selectors ---------- */
  GV.$ = (sel, root) => (root || document).querySelector(sel);
  GV.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------- formatting ---------- */
  const nf = new Intl.NumberFormat('en-US');

  GV.num = (n) => nf.format(Number(n) || 0);

  GV.compact = (n) => {
    n = Number(n) || 0;
    const abs = Math.abs(n);
    if (abs < 1000) return String(n);
    const units = [
      { v: 1e9, s: 'B' },
      { v: 1e6, s: 'M' },
      { v: 1e3, s: 'k' }
    ];
    for (let i = 0; i < units.length; i++) {
      if (abs >= units[i].v) {
        const v = n / units[i].v;
        const out = v >= 100 ? String(Math.round(v)) : v.toFixed(1);
        return out.replace(/\.0$/, '') + units[i].s;
      }
    }
    return String(n);
  };

  GV.timeAgo = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min' + (m > 1 ? 's' : '') + ' ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr' + (h > 1 ? 's' : '') + ' ago';
    const day = Math.floor(h / 24);
    if (day < 7) return day + ' day' + (day > 1 ? 's' : '') + ' ago';
    if (day < 30) {
      const w = Math.floor(day / 7);
      return w + ' week' + (w > 1 ? 's' : '') + ' ago';
    }
    if (day < 365) {
      const mo = Math.max(1, Math.floor(day / 30.44));
      return mo + ' month' + (mo > 1 ? 's' : '') + ' ago';
    }
    const y = day / 365.25;
    const yi = y < 10 ? Math.floor(y) : Math.round(y);
    return yi + ' year' + (yi > 1 ? 's' : '') + ' ago';
  };

  GV.daysAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

  GV.dateFmt = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  GV.escape = (s) =>
    String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);

  GV.debounce = (fn, wait) => {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  };

  GV.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  GV.reduced = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  GV.capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

  /* ---------- storage ---------- */
  GV.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('gv:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('gv:' + key, JSON.stringify(value)); } catch (e) { /* quota */ }
    }
  };

  /* ---------- toasts ---------- */
  GV.toast = (msg, type, ms) => {
    const host = document.getElementById('toasts');
    if (!host) return;
    type = type || 'info';
    const el = document.createElement('div');
    el.className = 'toast toast--' + (type === 'info' ? 'info' : type);
    if (type === 'info') el.style.setProperty('--tone', 'var(--accent)');
    el.setAttribute('role', 'status');
    el.innerHTML = GV.icon(type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'check') +
      '<span>' + GV.escape(msg) + '</span>';
    host.appendChild(el);
    const kill = () => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    };
    setTimeout(kill, ms || 3200);
    el.addEventListener('click', kill);
  };

  /* ---------- clipboard ---------- */
  GV.copy = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  };

  /* ---------- count up ---------- */
  GV.countUp = (el, to, opts) => {
    if (!el) return;
    const o = opts || {};
    const format = o.format || ((v) => GV.compact(Math.round(v)));
    const target = Number(to) || 0;
    if (GV.reduced() || target === 0) { el.textContent = format(target); return; }
    const dur = o.duration || 900;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ---------- download ---------- */
  GV.download = (data, filename, mime) => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: mime || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch (e) { return false; }
  };

  GV.initials = (name) => {
    const src = String(name || '?').trim();
    const parts = src.split(/[\s-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  };

  /* ---------- icon set (feather-ish, 24x24 stroke) ---------- */
  const PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7.5 9 6 9-6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2M9 15.5h6v5.5H9z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
    fork: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v3a6 6 0 0 0 6 6M18 9v3a6 6 0 0 1-6 6"/>',
    repo: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    pulse: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    download: '<path d="M12 3v12"/><path d="m7 12 5 5 5-5"/><path d="M4 21h16"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    branch: '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    tag: '<path d="M12.6 3H4v8.6L12.4 20a2 2 0 0 0 2.8 0l5.8-5.8a2 2 0 0 0 0-2.8Z"/><circle cx="8" cy="8" r="1.5"/>',
    heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 13v4M9 21h6M10 17h4"/>',
    git: '<circle cx="12" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M12 9v3a3 3 0 0 1-3 3H8M12 12a3 3 0 0 0 3 3h1"/>'
  };

  GV.icon = (name, size) => {
    const s = size || 18;
    if (name === 'github') {
      return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true">' +
        '<path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.3 5 18.3 5.3 18.3 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z"/></svg>';
    }
    const d = PATHS[name] || PATHS.pulse;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };

  /* ---------- validate github username ---------- */
  GV.isValidUser = (name) => /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(String(name || ''));

  /* ---------- populate [data-ico] placeholders in static HTML ---------- */
  GV.hydrateIcons = (root) => {
    GV.$$('[data-ico]', root || document).forEach((el) => {
      if (el.dataset.iconDone) return;
      el.dataset.iconDone = '1';
      el.innerHTML = GV.icon(el.dataset.ico, el.classList.contains('feat-ico') ? 22 : 17);
    });
  };
})(window.GV);
