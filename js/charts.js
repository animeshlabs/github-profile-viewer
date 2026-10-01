/* ==========================================================================
   GH//VIEWER — canvas chart engine
   donut (languages) · radar (profile fingerprint) · hbar (top repos)
   DPR aware, animated, hover interactive, resize friendly
   ========================================================================== */
(function (GV) {
  'use strict';

  const registry = [];
  let themeToken = 0;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette(i) {
    return cssVar('--chart-' + ((i % 8) + 1));
  }

  function withAlpha(hex, a) {
    const h = hex.replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    if (isNaN(n)) return 'rgba(56,242,255,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width || canvas.clientWidth || 240));
    const h = Math.max(100, Math.round(rect.height || canvas.clientHeight || 200));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  function animate(draw) {
    if (GV.reduced()) { draw(1); return function () {}; }
    let raf = 0;
    let stopped = false;
    const t0 = performance.now();
    const tick = (now) => {
      if (stopped) return;
      const p = Math.min(1, (now - t0) / 850);
      draw(easeOut(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }

  function register(chart) {
    registry.push(chart);
    return chart;
  }

  /* =======================================================================
     DONUT — language distribution
     ======================================================================= */
  function donut(canvas, data, opts) {
    opts = opts || {};
    const tipEl = opts.tipEl || null;
    const legendEl = opts.legendEl || null;
    const segments = (data || []).filter((d) => d.value > 0);
    const total = segments.reduce((s, d) => s + d.value, 0);
    let active = -1;
    let stopAnim = function () {};
    let angles = [];
    let geo = null;

    function legend() {
      if (!legendEl) return;
      if (!segments.length) { legendEl.innerHTML = ''; return; }
      legendEl.innerHTML = segments.map((d, i) => {
        const pct = total ? Math.round((d.value / total) * 100) : 0;
        return '<button type="button" class="legend-row" data-i="' + i + '">' +
          '<span class="legend-dot" style="background:' + d.color + ';color:' + d.color + '"></span>' +
          '<span class="legend-label">' + GV.escape(d.label) + '</span>' +
          '<span class="legend-val">' + pct + '%</span></button>';
      }).join('');
      GV.$$('.legend-row', legendEl).forEach((row) => {
        const i = Number(row.dataset.i);
        row.addEventListener('mouseenter', () => { active = i; draw(last); syncLegend(); });
        row.addEventListener('mouseleave', () => { active = -1; draw(last); syncLegend(); });
      });
    }

    function syncLegend() {
      if (!legendEl) return;
      GV.$$('.legend-row', legendEl).forEach((r) => {
        r.classList.toggle('is-active', Number(r.dataset.i) === active);
      });
    }

    let last = 1;

    function draw(progress) {
      last = progress;
      const f = fit(canvas);
      const ctx = f.ctx, w = f.w, h = f.h;
      const cx = w / 2, cy = h / 2;
      const outer = Math.min(w, h) / 2 - 12;
      const inner = outer * 0.64;
      geo = { cx: cx, cy: cy, inner: inner - 8, outer: outer + 12 };

      if (!segments.length || !total) {
        ctx.fillStyle = cssVar('--dim');
        ctx.font = '12px ' + cssVar('--font-mono');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NO LANGUAGE DATA', cx, cy);
        angles = [];
        return;
      }

      const gap = segments.length > 1 ? 0.028 : 0;
      let start = -Math.PI / 2;
      angles = [];

      /* track */
      ctx.beginPath();
      ctx.arc(cx, cy, (outer + inner) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#8899bb', 0.1);
      ctx.lineWidth = outer - inner;
      ctx.stroke();

      segments.forEach((d, i) => {
        const sweep = (d.value / total) * Math.PI * 2 * progress;
        const a0 = start + gap / 2;
        const a1 = start + Math.max(gap, sweep) - gap / 2;
        angles.push([start, start + (d.value / total) * Math.PI * 2]);
        if (a1 > a0) {
          const isActive = active === i;
          ctx.beginPath();
          ctx.arc(cx, cy, isActive ? outer + 4 : outer, a0, a1);
          ctx.arc(cx, cy, inner, a1, a0, true);
          ctx.closePath();
          ctx.fillStyle = d.color;
          ctx.shadowColor = withAlpha(d.color, 0.55);
          ctx.shadowBlur = isActive ? 22 : 9;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        start += (d.value / total) * Math.PI * 2;
      });

      /* center */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cssVar('--text');
      ctx.font = '700 ' + Math.max(16, inner * 0.42) + 'px ' + cssVar('--font-display');
      ctx.fillText(opts.centerValue || String(segments.length), cx, cy - 7);
      ctx.fillStyle = cssVar('--dim');
      ctx.font = '500 ' + Math.max(9, inner * 0.17) + 'px ' + cssVar('--font-mono');
      ctx.fillText((opts.centerLabel || 'LANGS').toUpperCase(), cx, cy + inner * 0.26);
    }

    function hit(ev) {
      if (!geo || !angles.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const dx = x - geo.cx, dy = y - geo.cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < geo.inner || r > geo.outer) { hideTip(); if (active !== -1) { active = -1; draw(last); syncLegend(); } return; }
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      let found = -1;
      for (let i = 0; i < angles.length; i++) {
        let s = angles[i][0] + Math.PI / 2;
        let e = angles[i][1] + Math.PI / 2;
        s = ((s % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        e = ((e % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const inSeg = s <= e ? (a >= s && a <= e) : (a >= s || a <= e);
        if (inSeg) { found = i; break; }
      }
      if (found !== active) { active = found; draw(last); syncLegend(); }
      if (found >= 0 && tipEl) {
        const d = segments[found];
        const pct = Math.round((d.value / total) * 100);
        tipEl.innerHTML = GV.escape(d.label) + ' · ' + GV.escape(d.display || GV.compact(d.value)) + ' · ' + pct + '%';
        tipEl.style.left = x + 'px';
        tipEl.style.top = y + 'px';
        tipEl.classList.add('is-on');
      }
    }

    function hideTip() { if (tipEl) tipEl.classList.remove('is-on'); }

    canvas.addEventListener('mousemove', hit);
    canvas.addEventListener('mouseleave', () => {
      hideTip();
      if (active !== -1) { active = -1; draw(last); syncLegend(); }
    });

    legend();

    const chart = {
      el: canvas,
      redraw() { draw(1); },
      animateIn() { stopAnim(); stopAnim = animate(draw); },
      destroy() {
        stopAnim();
        canvas.removeEventListener('mousemove', hit);
      }
    };
    chart.animateIn();
    return register(chart);
  }

  /* =======================================================================
     RADAR — profile fingerprint
     ======================================================================= */
  function radar(canvas, data, opts) {
    opts = opts || {};
    const items = data || [];
    let stopAnim = function () {};
    let last = 1;

    function draw(progress) {
      last = progress;
      const f = fit(canvas);
      const ctx = f.ctx, w = f.w, h = f.h;
      const cx = w / 2, cy = h / 2 + 4;
      const radius = Math.min(w, h) / 2 - 34;
      const n = items.length;
      if (!n || radius <= 10) return;

      const angleAt = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
      const pointAt = (i, k) => {
        const a = angleAt(i);
        return [cx + Math.cos(a) * radius * k, cy + Math.sin(a) * radius * k];
      };

      /* rings */
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring++) {
        const k = ring / 4;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = pointAt(i, k);
          i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.strokeStyle = withAlpha('#8899bb', ring === 4 ? 0.28 : 0.12);
        ctx.stroke();
      }

      /* axes */
      for (let i = 0; i < n; i++) {
        const p = pointAt(i, 1);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p[0], p[1]);
        ctx.strokeStyle = withAlpha('#8899bb', 0.16);
        ctx.stroke();
      }

      /* data polygon */
      ctx.beginPath();
      items.forEach((d, i) => {
        const p = pointAt(i, Math.max(0.04, d.value * progress));
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      });
      ctx.closePath();
      const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      grad.addColorStop(0, withAlpha(palette(0), 0.42));
      grad.addColorStop(1, withAlpha(palette(1), 0.28));
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette(0);
      ctx.shadowColor = withAlpha(palette(0), 0.7);
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* dots */
      items.forEach((d, i) => {
        const p = pointAt(i, Math.max(0.04, d.value * progress));
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.4, 0, Math.PI * 2);
        ctx.fillStyle = cssVar('--bg');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = palette(1);
        ctx.stroke();
      });

      /* labels */
      ctx.font = '500 9.5px ' + cssVar('--font-mono');
      ctx.fillStyle = cssVar('--dim');
      items.forEach((d, i) => {
        const p = pointAt(i, 1.19);
        const a = angleAt(i);
        const cos = Math.cos(a);
        ctx.textAlign = Math.abs(cos) < 0.25 ? 'center' : cos > 0 ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.label.toUpperCase(), p[0], p[1]);
      });
    }

    const chart = {
      el: canvas,
      redraw() { draw(1); },
      animateIn() { stopAnim(); stopAnim = animate(draw); },
      destroy() { stopAnim(); }
    };
    chart.animateIn();
    return register(chart);
  }

  /* =======================================================================
     HBAR — top repositories by stars
     ======================================================================= */
  function hbar(canvas, data, opts) {
    opts = opts || {};
    const rows = (data || []).slice(0, 7);
    let stopAnim = function () {};
    let last = 1;

    function draw(progress) {
      last = progress;
      const f = fit(canvas);
      const ctx = f.ctx, w = f.w, h = f.h;
      if (!rows.length) {
        ctx.fillStyle = cssVar('--dim');
        ctx.font = '12px ' + cssVar('--font-mono');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NO REPOSITORIES YET', w / 2, h / 2);
        return;
      }

      const max = Math.max(1, rows[0].value);
      const sqrtMax = Math.sqrt(max);
      const narrow = w < 340;
      const labelW = narrow ? 0 : Math.min(126, w * 0.34);
      const valW = 52;
      const barX = labelW + (narrow ? 0 : 12);
      const barMax = Math.max(30, w - barX - valW);
      const rowH = h / rows.length;
      const barH = Math.min(15, rowH * 0.38);

      rows.forEach((d, i) => {
        const yMid = i * rowH + rowH / 2;
        const yBar = yMid - barH / 2;
        const p = Math.max(0, Math.min(1, (progress - i * 0.07) / 0.65));
        const eased = easeOut(Math.max(0, p));
        /* sqrt scale: one dominant repo must not flatten every other bar */
        const bw = Math.max(3, (Math.sqrt(Math.max(0, d.value)) / sqrtMax) * barMax * eased);
        const color = d.color || palette(i);

        if (narrow) {
          ctx.font = '500 10px ' + cssVar('--font-mono');
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = cssVar('--muted');
          ctx.fillText(trim(d.label, Math.floor(w / 6.4)), 0, yMid - barH / 2 - 4);
        } else {
          ctx.font = '500 11px ' + cssVar('--font-mono');
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = cssVar('--muted');
          ctx.fillText(trim(d.label, 17), labelW, yMid);
        }

        /* track */
        ctx.fillStyle = withAlpha('#8899bb', 0.1);
        roundRect(ctx, barX, yBar, barMax, barH, barH / 2);
        ctx.fill();

        /* bar */
        const g = ctx.createLinearGradient(barX, 0, barX + bw, 0);
        g.addColorStop(0, withAlpha(color, 0.65));
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        ctx.shadowColor = withAlpha(color, 0.6);
        ctx.shadowBlur = 10;
        roundRect(ctx, barX, yBar, bw, barH, barH / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        /* value */
        ctx.font = '700 10.5px ' + cssVar('--font-mono');
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = cssVar('--text');
        ctx.fillText(GV.compact(d.value), w, yMid);
      });
    }

    function roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function trim(s, n) {
      s = String(s);
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    const chart = {
      el: canvas,
      redraw() { draw(1); },
      animateIn() { stopAnim(); stopAnim = animate(draw); },
      destroy() { stopAnim(); }
    };
    chart.animateIn();
    return register(chart);
  }

  /* =======================================================================
     public API
     ======================================================================= */
  GV.charts = {
    donut: donut,
    radar: radar,
    hbar: hbar,
    palette: palette,
    withAlpha: withAlpha,

    clear() {
      registry.splice(0).forEach((c) => { try { c.destroy(); } catch (e) {} });
    },

    redrawAll() {
      registry.slice().forEach((c) => { try { c.redraw(); } catch (e) {} });
    }
  };

  const onResize = GV.debounce(() => GV.charts.redrawAll(), 160);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
})(window.GV);
