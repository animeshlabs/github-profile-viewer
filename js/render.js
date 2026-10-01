/* ==========================================================================
   GH//VIEWER — render layer
   pure(ish) view functions: profile card, overview, repos, activity,
   heatmap, people. Chart canvases are initialised right after injection.
   ========================================================================== */
(function (GV) {
  'use strict';

  const $ = GV.$;
  const esc = GV.escape;

  /* ---------- language colours (GitHub palette, darkened for light theme) ---------- */
  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
    'C++': '#f34b7d', 'C#': '#178600', C: '#555555', Go: '#00ADD8', Rust: '#dea584',
    Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
    HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c', Sass: '#a63a79', Vue: '#41b883',
    Shell: '#89e051', Bash: '#89e051', PowerShell: '#012456', 'Jupyter Notebook': '#DA5B0B',
    Lua: '#000080', Scala: '#c22d40', R: '#198CE7', 'Objective-C': '#438eff',
    'Objective-C++': '#438eff', Zig: '#ec915c', Elixir: '#6e4a7e', Haskell: '#5e5086',
    Perl: '#0298c3', Groovy: '#4298b4', MATLAB: '#e16737', Assembly: '#6E4C13',
    Dockerfile: '#384d54', Makefile: '#427819', Markdown: '#083fa1', TeX: '#3D6117',
    Vim: '#199f4b', Svelte: '#ff3e00', Astro: '#ff5a00', 'F#': '#b845fc',
    Clojure: '#db5855', Erlang: '#b83998', OCaml: '#ef7a08', Julia: '#a270ba',
    'PLpgSQL': '#336791', TSQL: '#e38c00', 'Jupyter': '#DA5B0B', 'Vue HTML': '#41b883'
  };

  function shade(hex, amt) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    let n = parseInt(full, 16);
    if (isNaN(n)) return hex;
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (10 - r) * amt);
    g = Math.round(g + (16 - g) * amt);
    b = Math.round(b + (32 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function tint(hex, amt) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    if (isNaN(n)) return hex;
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function relativeLum(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    if (isNaN(n)) return 1;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function langColor(name, i) {
    const base = LANG_COLORS[name] || GV.charts.palette(i || 0);
    const light = document.documentElement.dataset.theme === 'light';
    if (light) return shade(base, 0.42);
    /* dark theme: lift very dark language colours (#555555, #701516 …)
       so bars and donut segments stay readable on the dark canvas */
    const L = relativeLum(base);
    return L < 0.45 ? tint(base, Math.min(0.5, 0.2 + (0.45 - L) * 0.65)) : base;
  }

  function avatarUrl(url, size) {
    if (!url) return '';
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 's=' + (size || 200);
  }

  /* =======================================================================
     stats
     ======================================================================= */
  function computeStats(user, repos, events) {
    const s = {
      stars: 0, forks: 0, size: 0, openIssues: 0,
      langs: Object.create(null), langList: [],
      topRepos: [], topForks: [],
      events: (events || []).length,
      reposFetched: (repos || []).length,
      forks_total: 0, gists: user.public_gists || 0
    };

    (repos || []).forEach((r) => {
      const st = r.stargazers_count || 0;
      const fk = r.forks_count || 0;
      s.stars += st;
      s.forks += fk;
      s.size += r.size || 0;
      s.openIssues += r.open_issues_count || 0;
      const lang = r.language || 'Other';
      if (!s.langs[lang]) s.langs[lang] = { label: lang, count: 0, stars: 0 };
      s.langs[lang].count++;
      s.langs[lang].stars += st;
    });

    s.langList = Object.keys(s.langs)
      .map((k) => s.langs[k])
      .sort((a, b) => b.stars - a.stars || b.count - a.count);

    s.topRepos = (repos || []).slice()
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
      .slice(0, 6);

    s.topForks = (repos || []).slice()
      .sort((a, b) => (b.forks_count || 0) - (a.forks_count || 0))
      .slice(0, 5);

    const created = new Date(user.created_at);
    s.accountDays = Math.max(1, Math.floor((Date.now() - created.getTime()) / 86400000));
    s.accountYears = (s.accountDays / 365.25);
    s.avgStars = s.reposFetched ? s.stars / s.reposFetched : 0;
    s.topLang = s.langList.length ? s.langList[0].label : '—';
    s.perDay = s.events ? (s.events / 90) : 0;
    return s;
  }

  function donutSegments(stats) {
    const useStars = stats.stars > 0;
    const sorted = stats.langList.slice().sort((a, b) =>
      useStars ? b.stars - a.stars : b.count - a.count);
    if (!sorted.length) return [];
    const key = (l) => (useStars ? l.stars : l.count);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    const items = top.map((l, i) => ({
      label: l.label,
      value: key(l),
      color: langColor(l.label, i),
      display: (useStars ? '★' : '') + GV.compact(key(l))
    }));
    if (rest.length) {
      items.push({
        label: 'Other (' + rest.length + ')',
        value: rest.reduce((n, l) => n + key(l), 0),
        color: document.documentElement.dataset.theme === 'light' ? '#94a3b8' : '#5b6b8c',
        display: (useStars ? '★' : '') + GV.compact(rest.reduce((n, l) => n + key(l), 0))
      });
    }
    return items;
  }

  /* =======================================================================
     SIDE COLUMN — identity card + language donut
     ======================================================================= */
  function detailRow(icon, label, value) {
    if (!value) return '';
    return '<div class="p-detail"><span class="d-ico">' + GV.icon(icon, 15) + '</span>' +
      '<span class="d-val"><span class="d-label">' + esc(label) + '</span>' + value + '</span></div>';
  }

  function linkOrText(value, isUrl) {
    if (!value) return '';
    if (isUrl) {
      const href = /^https?:\/\//i.test(value) ? value : 'https://' + value;
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(value) + '</a>';
    }
    return esc(value);
  }

  function side(el, ctx) {
    const u = ctx.user;
    const s = ctx.stats;

    const isOrg = u.type === 'Organization';
    const badges =
      '<span class="badge badge--accent">' + (isOrg ? 'ORGANIZATION' : 'ACCOUNT') + '</span>' +
      (u.hireable ? '<span class="badge badge--ok">OPEN TO WORK</span>' : '') +
      (u.site_admin ? '<span class="badge">STAFF</span>' : '') +
      (!isOrg && u.two_factor_authentication ? '<span class="badge badge--ok">2FA</span>' : '');

    const details =
      detailRow('pin', 'Location', esc(u.location || '')) +
      detailRow('building', 'Company', linkOrText(u.company, false)) +
      detailRow('link', 'Website', u.blog ? linkOrText(u.blog, true) : '') +
      detailRow('mail', 'Email', u.email ? '<a href="mailto:' + esc(u.email) + '">' + esc(u.email) + '</a>' : '') +
      detailRow('globe', 'Twitter', u.twitter_username ? '<a href="https://twitter.com/' + esc(u.twitter_username) + '" target="_blank" rel="noopener noreferrer">@' + esc(u.twitter_username) + '</a>' : '') +
      detailRow('calendar', 'Joined', esc(GV.dateFmt(u.created_at))) +
      detailRow('clock', 'Last seen', esc(GV.timeAgo(u.updated_at || u.created_at)));

    el.innerHTML =
      '<div class="card p-card">' +
        '<div class="avatar"><img src="' + esc(avatarUrl(u.avatar_url, 260)) + '" alt="' + esc(u.name || u.login) + '" width="132" height="132"><span class="status-dot" title="online"></span></div>' +
        '<h2 class="p-name">' + esc(u.name || u.login) + '</h2>' +
        '<a class="p-login" href="' + esc(u.html_url) + '" target="_blank" rel="noopener noreferrer">@' + esc(u.login) + '</a>' +
        '<p class="p-bio' + (u.bio ? '' : ' is-empty') + '">' + esc(u.bio || (isOrg ? 'No description provided.' : 'This account has no bio.')) + '</p>' +
        '<div class="p-badges">' + badges + '</div>' +

        '<div class="p-stats">' +
          '<div class="p-stat"><b data-count="' + (u.public_repos || 0) + '">0</b><span>Repos</span></div>' +
          '<div class="p-stat"><b data-count="' + (u.followers || 0) + '">0</b><span>Followers</span></div>' +
          '<div class="p-stat"><b data-count="' + (u.following || 0) + '">0</b><span>Following</span></div>' +
          '<div class="p-stat"><b data-count="' + (u.public_gists || 0) + '">0</b><span>Gists</span></div>' +
        '</div>' +

        '<div class="p-details">' + details + '</div>' +

        '<div class="p-actions">' +
          '<a class="btn btn-primary" href="' + esc(u.html_url) + '" target="_blank" rel="noopener noreferrer">' + GV.icon('github', 15) + ' VIEW ON GITHUB</a>' +
          '<button class="btn btn-ghost" type="button" id="shareBtn">' + GV.icon('share', 15) + ' SHARE</button>' +
          '<button class="btn btn-ghost" type="button" id="exportBtn">' + GV.icon('download', 15) + ' EXPORT JSON</button>' +
        '</div>' +
      '</div>' +

      '<div class="card chart-card">' +
        '<div class="card-head"><h3 class="card-title">' + GV.icon('chart', 16) + ' LANGUAGE CORE</h3>' +
        '<span class="card-note">' + (s.stars > 0 ? 'BY STARS' : 'BY REPOS') + '</span></div>' +
        '<div class="chart-body">' +
          '<canvas class="chart-canvas chart-canvas--donut" id="langDonut" aria-label="Language distribution chart" role="img"></canvas>' +
          '<div class="chart-tip" id="langTip"></div>' +
        '</div>' +
        '<div class="legend" id="langLegend"></div>' +
      '</div>';

    const segs = donutSegments(s);
    const canvas = $('#langDonut', el);
    if (segs.length) {
      GV.charts.donut(canvas, segs, {
        centerValue: String(s.langList.length),
        centerLabel: 'languages',
        tipEl: $('#langTip', el),
        legendEl: $('#langLegend', el)
      });
    } else {
      canvas.style.height = '170px';
      GV.charts.donut(canvas, [], { centerLabel: 'no data' });
    }

    GV.$$('[data-count]', el).forEach((node) => {
      GV.countUp(node, Number(node.dataset.count));
    });
  }

  /* =======================================================================
     OVERVIEW
     ======================================================================= */
  function statCard(icon, value, label, sub, count) {
    return '<div class="stat-card">' +
      '<span class="s-ico">' + GV.icon(icon, 20) + '</span>' +
      '<b class="s-val"' + (count !== undefined ? ' data-count="' + count + '"' : '') + '>' + esc(value) + '</b>' +
      '<span class="s-label">' + esc(label) + '</span>' +
      (sub ? '<span class="s-sub">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  function topLangList(stats) {
    const list = stats.langList.slice(0, 6);
    if (!list.length) return '<p class="card-note">No language data available.</p>';
    const maxStars = Math.max(1, list[0].stars);
    const maxCount = Math.max(1, list[0].count);
    const byStars = stats.stars > 0;
    return '<div class="rank-list" style="padding-top:12px">' + list.map((l, i) => {
      const val = byStars ? l.stars : l.count;
      const max = byStars ? maxStars : maxCount;
      const pct = Math.max(4, Math.round(Math.sqrt(val / max) * 100));
      return '<div class="rank-item" style="display:block;padding:9px 6px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span class="legend-dot" style="background:' + langColor(l.label, i) + ';color:' + langColor(l.label, i) + '"></span>' +
          '<span class="rank-main" style="flex:1"><a href="https://github.com/search?q=language:' + encodeURIComponent(l.label) + '&type=repositories" target="_blank" rel="noopener noreferrer">' + esc(l.label) + '</a></span>' +
          '<span class="rank-score">' + (byStars ? '★ ' : '') + GV.compact(val) + '</span>' +
        '</div>' +
        '<div style="height:5px;border-radius:4px;background:var(--line);margin-top:7px;overflow:hidden">' +
          '<i style="display:block;height:100%;width:' + pct + '%;background:' + langColor(l.label, i) + ';border-radius:4px;box-shadow:0 0 8px ' + langColor(l.label, i) + '"></i>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  function rankList(repos) {
    if (!repos.length) return '<p class="card-note">No repositories yet.</p>';
    return '<div class="rank-list">' + repos.map((r, i) =>
      '<div class="rank-item">' +
        '<span class="rank-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="rank-main"><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.name) + '</a>' +
          '<span class="rank-meta"><span>' + (r.language ? esc(r.language) : '—') + '</span><span>⑂ ' + GV.compact(r.forks_count || 0) + '</span></span>' +
        '</span>' +
        '<span class="rank-score">★ ' + GV.compact(r.stargazers_count || 0) + '</span>' +
      '</div>').join('') + '</div>';
  }

  function overview(el, ctx) {
    const u = ctx.user, s = ctx.stats, repos = ctx.repos, events = ctx.events;

    const radarItems = [
      { label: 'Repos', value: logNorm(u.public_repos, 300) },
      { label: 'Stars', value: logNorm(s.stars, 8000) },
      { label: 'Followers', value: logNorm(u.followers, 6000) },
      { label: 'Following', value: logNorm(u.following, 800) },
      { label: 'Gists', value: logNorm(u.public_gists, 200) },
      { label: 'Activity', value: logNorm(s.events, 300) }
    ];

    const topBar = s.topRepos.filter((r) => (r.stargazers_count || 0) > 0).slice(0, 6);

    el.innerHTML =
      '<div class="stat-grid">' +
        statCard('star', '', 'STARS EARNED', 'across ' + s.reposFetched + ' repos', s.stars) +
        statCard('fork', '', 'FORKS RECEIVED', s.openIssues + ' open issues', s.forks) +
        statCard('repo', '', 'PUBLIC REPOS', s.reposFetched + ' loaded', u.public_repos) +
        statCard('users', '', 'FOLLOWERS', u.following + ' following', u.followers) +
        statCard('pulse', s.topLang || '—', 'TOP LANGUAGE', s.langList.length + ' language' + (s.langList.length === 1 ? '' : 's') + ' tracked') +
        statCard('trophy', '', 'ACCOUNT AGE', 'years · since ' + GV.dateFmt(u.created_at), Math.round(s.accountYears * 10) / 10) +
      '</div>' +

      '<div class="viz-grid" style="margin-top:16px">' +
        '<div class="card chart-card">' +
          '<div class="card-head"><h3 class="card-title">' + GV.icon('grid', 16) + ' PROFILE FINGERPRINT</h3><span class="card-note">NORMALIZED</span></div>' +
          '<div class="chart-body"><canvas class="chart-canvas chart-canvas--radar" id="radarChart" role="img" aria-label="Profile fingerprint radar chart"></canvas></div>' +
        '</div>' +
        '<div class="card chart-card">' +
          '<div class="card-head"><h3 class="card-title">' + GV.icon('star', 16) + ' TOP REPOSITORIES</h3><span class="card-note">BY STARS · SQRT</span></div>' +
          '<div class="chart-body"><canvas class="chart-canvas chart-canvas--bar" id="topBarChart" role="img" aria-label="Top repositories bar chart"></canvas></div>' +
        '</div>' +
      '</div>' +

      '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><h3 class="card-title">' + GV.icon('pulse', 16) + ' ACTIVITY PULSE</h3>' +
        '<span class="card-note">LAST 90 DAYS · ' + s.events + ' EVENTS</span></div>' +
        heatmap(events) +
      '</div>' +

      '<div class="viz-grid" style="margin-top:16px">' +
        '<div class="card">' +
          '<div class="card-head"><h3 class="card-title">' + GV.icon('code', 16) + ' LANGUAGE MATRIX</h3>' +
          '<span class="card-note">' + (s.stars > 0 ? 'WEIGHTED BY STARS' : 'BY REPO COUNT') + '</span></div>' +
          topLangList(s) +
        '</div>' +
        '<div class="card">' +
          '<div class="card-head"><h3 class="card-title">' + GV.icon('trophy', 16) + ' MOST STARRED</h3>' +
          '<span class="card-note">TOP ' + s.topRepos.filter((r) => r.stargazers_count > 0).length + '</span></div>' +
          rankList(s.topRepos.filter((r) => (r.stargazers_count || 0) > 0).slice(0, 5)) +
        '</div>' +
      '</div>' +

      '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><h3 class="card-title">' + GV.icon('terminal', 16) + ' LATEST TRANSMISSIONS</h3>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-goto-tab="activity">FULL FEED</button></div>' +
        '<div style="padding:14px 14px 16px"><ul class="activity">' +
          activityItems(sortedEvents(events).slice(0, 4)) +
        '</ul></div>' +
      '</div>';

    GV.charts.radar($('#radarChart', el), radarItems);
    if (topBar.length) {
      GV.charts.hbar($('#topBarChart', el), topBar.map((r, i) => ({
        label: r.name,
        value: r.stargazers_count || 0,
        color: langColor(r.language || '', i)
      })));
    } else {
      GV.charts.hbar($('#topBarChart', el), []);
    }

    GV.$$('[data-count]', el).forEach((node) => {
      const raw = Number(node.dataset.count);
      if (!node.textContent) {
        GV.countUp(node, raw, {
          format: raw % 1
            ? (v) => (Math.round(v * 10) / 10).toFixed(1)
            : (v) => GV.compact(Math.round(v))
        });
      }
    });
  }

  function logNorm(v, cap) {
    v = Number(v) || 0;
    if (v <= 0) return 0.04;
    return Math.min(1, Math.log10(v + 1) / Math.log10(cap + 1));
  }

  /* =======================================================================
     HEATMAP
     ======================================================================= */
  function heatmap(events) {
    const counts = Object.create(null);
    (events || []).forEach((e) => {
      if (!e.created_at) return;
      const k = e.created_at.slice(0, 10);
      counts[k] = (counts[k] || 0) + 1;
    });

    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = end - 89 * 86400000;
    const pad = new Date(start).getUTCDay();
    const gridStart = start - pad * 86400000;
    const weeks = Math.ceil((pad + 90) / 7);
    const gridEnd = gridStart + (weeks * 7 - 1) * 86400000;

    let cells = '';
    let activeDays = 0;
    let total = 0;
    for (let t = gridStart; t <= gridEnd; t += 86400000) {
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      if (t < start || t > end) { cells += '<span class="heat-cell is-pad"></span>'; continue; }
      const n = counts[key] || 0;
      const lv = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
      if (n) { activeDays++; total += n; }
      cells += '<span class="heat-cell" data-lv="' + lv + '" title="' + key + ' · ' + n + ' event' + (n === 1 ? '' : 's') +
        '" aria-label="' + key + ': ' + n + ' events"></span>';
    }

    return '<div class="heat-body">' +
      '<div class="heat-grid" role="grid" aria-label="90 day activity heatmap">' + cells + '</div>' +
      '<div class="heat-foot">' +
        '<span>' + total + ' EVENTS · ' + activeDays + ' ACTIVE DAYS</span>' +
        '<span class="heat-legend">LESS <i data-lv="0"></i><i data-lv="1"></i><i data-lv="2"></i><i data-lv="3"></i><i data-lv="4"></i> MORE</span>' +
      '</div></div>';
  }

  /* =======================================================================
     ACTIVITY
     ======================================================================= */
  function eventInfo(e) {
    const repo = (e.repo && e.repo.name) || '';
    const p = e.payload || {};
    switch (e.type) {
      case 'PushEvent': {
        const commits = (p.commits && p.commits.length) || p.size || 1;
        return {
          ico: 'code', tone: 'var(--chart-1)',
          title: 'Pushed <b>' + commits + '</b> commit' + (commits === 1 ? '' : 's') + ' to',
          lines: (p.commits || []).slice(0, 3).map((c) => String(c.message || '').split('\n')[0])
        };
      }
      case 'WatchEvent': return { ico: 'star', tone: 'var(--chart-5)', title: 'Starred repository' };
      case 'ForkEvent': return { ico: 'fork', tone: 'var(--chart-3)', title: 'Forked repository' };
      case 'IssuesEvent':
        return { ico: 'alert', tone: 'var(--chart-8)', title: GV.capitalize(p.action || 'opened') + ' issue <b>#' + ((p.issue && p.issue.number) || '') + '</b>', sub: p.issue && p.issue.title };
      case 'PullRequestEvent':
        return { ico: 'branch', tone: 'var(--chart-4)', title: GV.capitalize(p.action || 'opened') + ' pull request <b>#' + ((p.pull_request && p.pull_request.number) || '') + '</b>', sub: p.pull_request && p.pull_request.title };
      case 'IssueCommentEvent':
        return { ico: 'pulse', tone: 'var(--chart-6)', title: 'Commented on an issue' };
      case 'PullRequestReviewEvent':
        return { ico: 'check', tone: 'var(--chart-4)', title: 'Reviewed a pull request' };
      case 'PullRequestReviewCommentEvent':
        return { ico: 'branch', tone: 'var(--chart-4)', title: 'Replied on a pull request' };
      case 'CreateEvent':
        return { ico: 'plus', tone: 'var(--chart-7)', title: 'Created ' + esc(p.ref_type || 'a ref') + (p.ref ? ' <b>' + esc(p.ref) + '</b>' : '') };
      case 'DeleteEvent':
        return { ico: 'minus', tone: 'var(--chart-8)', title: 'Deleted ' + esc(p.ref_type || 'a ref') + (p.ref ? ' <b>' + esc(p.ref) + '</b>' : '') };
      case 'ReleaseEvent':
        return { ico: 'tag', tone: 'var(--chart-5)', title: (p.action === 'published' ? 'Published' : 'Updated') + ' release <b>' + esc((p.release && p.release.tag_name) || '') + '</b>' };
      case 'GollumEvent': return { ico: 'repo', tone: 'var(--chart-6)', title: 'Updated the wiki' };
      case 'MemberEvent': return { ico: 'user', tone: 'var(--chart-3)', title: 'Added a collaborator' };
      case 'PublicEvent': return { ico: 'globe', tone: 'var(--chart-1)', title: 'Made a repository public' };
      case 'CommitCommentEvent': return { ico: 'pulse', tone: 'var(--chart-6)', title: 'Commented on a commit' };
      case 'SponsorshipEvent': return { ico: 'heart', tone: 'var(--chart-2)', title: 'Sponsorship activity' };
      case 'DownloadEvent': return { ico: 'download', tone: 'var(--chart-7)', title: 'Downloaded a package' };
      default:
        return { ico: 'pulse', tone: 'var(--chart-6)', title: esc(String(e.type || '').replace('Event', '')) };
    }
  }

  function dayLabel(iso) {
    const key = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
    const p = key.split('-');
    const that = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    const n = new Date();
    const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    const diff = Math.round((today - that) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    if (diff < 365) {
      return new Date(that).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return GV.dateFmt(new Date(that).toISOString());
  }

  /* GitHub returns public events roughly newest-first but NOT strictly —
     sorting keeps day grouping and "latest transmissions" honest. */
  function sortedEvents(events) {
    return (events || []).slice().sort((a, b) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }

  function activityItems(events) {
    if (!events || !events.length) return '';
    let html = '';
    let lastDay = null;
    events.forEach((e) => {
      const info = eventInfo(e);
      const dl = dayLabel(e.created_at);
      if (dl !== lastDay) {
        html += '<li class="act-day">' + esc(dl) + '</li>';
        lastDay = dl;
      }
      const repo = (e.repo && e.repo.name) || '';
      const repoLink = repo
        ? ' <a href="https://github.com/' + esc(repo) + '" target="_blank" rel="noopener noreferrer">' + esc(repo) + '</a>'
        : '';
      html += '<li class="act-item" style="--tone:' + info.tone + '">' +
        '<span class="act-ico">' + GV.icon(info.ico, 17) + '</span>' +
        '<div class="act-body">' +
          '<p class="act-title">' + info.title + repoLink + '</p>' +
          (info.sub ? '<p class="act-meta"><span>' + esc(String(info.sub).slice(0, 90)) + '</span></p>' : '') +
          (info.lines && info.lines.length
            ? '<ul class="act-commits">' + info.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>'
            : '') +
          '<p class="act-meta"><span>' + esc(e.type) + '</span><span>' + esc(GV.timeAgo(e.created_at)) + '</span></p>' +
        '</div></li>';
    });
    return html;
  }

  function activity(el, events) {
    el.innerHTML = activityItems(sortedEvents(events));
  }

  /* =======================================================================
     PEOPLE
     ======================================================================= */
  function personCard(u) {
    return '<a class="person" href="#' + esc(u.login) + '" data-user="' + esc(u.login) + '">' +
      '<img src="' + esc(avatarUrl(u.avatar_url, 120)) + '" alt="' + esc(u.login) + '" loading="lazy" width="56" height="56">' +
      '<span class="p-login-2">@' + esc(u.login) + '</span>' +
      '<span class="p-sub">' + esc(u.name || u.type || '—') + '</span>' +
      '<span class="p-mini"><span>★ ' + GV.compact(u.public_repos || 0) + '</span><span>◈ ' + GV.compact(u.followers || 0) + '</span></span>' +
      '</a>';
  }

  function people(list) {
    return list.map(personCard).join('');
  }

  GV.render = {
    computeStats: computeStats,
    side: side,
    overview: overview,
    activity: activity,
    activityItems: activityItems,
    people: people,
    heatmap: heatmap,
    langColor: langColor,
    avatarUrl: avatarUrl
  };
})(window.GV);
