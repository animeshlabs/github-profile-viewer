/* ==========================================================================
   GH//VIEWER — application controller
   state · hash router · tabs · search + suggestions · keyboard · theme
   ========================================================================== */
(function (GV) {
  'use strict';

  const $ = GV.$;
  const $$ = GV.$$;

  /* ---------------- state ---------------- */
  const state = {
    user: null,
    repos: [],
    events: [],
    stats: null,
    followers: [],
    following: [],
    followersLoaded: false,
    followingLoaded: false,
    followersDone: false,
    followingDone: false,
    tab: 'overview',
    filters: { q: '', sort: 'stars', lang: 'all', dir: 'desc' },
    shown: 12,
    loading: false,
    error: null,
    countdownTimer: null
  };

  let els = {};
  let suppressHash = false;

  /* ================= views ================= */
  function showView(name) {
    ['hero', 'loader', 'error', 'profile'].forEach((k) => {
      els[k].hidden = k !== name;
    });
    if (name !== 'error') stopCountdown();
  }

  function goHome() {
    state.user = null;
    state.loading = false;
    GV.charts.clear();
    showView('hero');
    document.title = 'GH//VIEWER — Futuristic GitHub Profile Viewer';
    clearHash();
  }

  /* ================= hash routing ================= */
  function readHash() {
    const m = /^#\/?(?:u\/)?([A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?)$/.exec(location.hash || '');
    return m ? m[1] : null;
  }

  function setHash(name) {
    const h = '#' + name;
    if (location.hash === h) return;
    suppressHash = true;
    try {
      history.replaceState(null, '', h);
    } catch (e) {
      location.hash = name;
    }
    setTimeout(() => { suppressHash = false; }, 30);
  }

  function clearHash() {
    suppressHash = true;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* ignore */ }
    setTimeout(() => { suppressHash = false; }, 30);
  }

  /* ================= load profile ================= */
  async function loadProfile(rawName) {
    const name = String(rawName || '').trim().replace(/^@/, '');
    if (!name || state.loading) return;

    if (!GV.isValidUser(name)) {
      GV.toast('"' + name + '" is not a valid GitHub username.', 'err');
      shake();
      return;
    }

    state.loading = true;
    hideSuggest();
    showView('loader');

    try {
      const user = await GV.api.user(name);

      const results = await Promise.allSettled([
        GV.api.allRepos(user.login),
        GV.api.events(user.login)
      ]);

      if (results[0].status === 'rejected') warnPartial(results[0].reason);
      if (results[1].status === 'rejected') warnPartial(results[1].reason);

      const repos = results[0].status === 'fulfilled' ? results[0].value : [];
      const events = results[1].status === 'fulfilled' ? results[1].value : [];

      state.user = user;
      state.repos = repos;
      state.events = events;
      state.stats = GV.render.computeStats(user, repos, events);
      state.followers = [];
      state.following = [];
      state.followersLoaded = false;
      state.followingLoaded = false;
      state.followersDone = false;
      state.followingDone = false;
      state.filters = { q: '', sort: 'stars', lang: 'all', dir: 'desc' };
      state.shown = 12;
      state.tab = 'overview';

      resetToolbar();
      setTabCounts();
      showView('profile');
      renderAll();
      switchTab('overview');
      setHash(user.login);
      addRecent(user);
      document.title = user.login + ' // GH//VIEWER';

      window.scrollTo({ top: 0, behavior: GV.reduced() ? 'auto' : 'smooth' });
      requestAnimationFrame(() => GV.charts.redrawAll());
    } catch (err) {
      state.error = { err: err, name: name };
      renderError(err, name);
      showView('error');
    } finally {
      state.loading = false;
    }
  }

  function warnPartial(reason) {
    const msg = reason && reason.message ? reason.message : 'Some data could not be loaded.';
    GV.toast(msg, reason && reason.type === 'rate' ? 'warn' : 'err', 5000);
  }

  function renderAll() {
    GV.charts.clear();
    GV.render.side($('#sideCol'), state);
    GV.render.overview($('#panel-overview'), state);
    GV.render.activity($('#activityList'), state.events);
    $('#activityEmpty').hidden = state.events.length > 0;
    applyRepoFilters();
    observeReveals();
  }

  function setTabCounts() {
    $('#cntRepos').textContent = GV.compact(state.user.public_repos || 0);
    $('#cntActivity').textContent = GV.compact(state.events.length);
    $('#cntFollowers').textContent = GV.compact(state.user.followers || 0);
    $('#cntFollowing').textContent = GV.compact(state.user.following || 0);
  }

  /* ================= tabs ================= */
  function switchTab(tab) {
    if (!document.getElementById('panel-' + tab)) return;
    state.tab = tab;
    $$('.tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('.panel').forEach((p) => {
      const on = p.id === 'panel-' + tab;
      p.hidden = !on;
      p.classList.toggle('is-active', on);
    });
    if (tab === 'followers' || tab === 'following') ensurePeople(tab);
    if (tab === 'overview') requestAnimationFrame(() => GV.charts.redrawAll());
  }

  /* ================= people (lazy) ================= */
  const peopleSel = {
    followers: { list: '#followersList', empty: '#followersEmpty', more: '#followersMoreWrap' },
    following: { list: '#followingList', empty: '#followingEmpty', more: '#followingMoreWrap' }
  };

  async function ensurePeople(which) {
    if (state[which + 'Loaded'] || !state.user) return;
    state[which + 'Loaded'] = true;
    const sel = peopleSel[which];
    const listEl = $(sel.list);
    listEl.innerHTML = '<div class="panel-empty" style="grid-column:1/-1;padding:26px">SCANNING NETWORK…</div>';
    $(sel.empty).hidden = true;
    $(sel.more).hidden = true;

    try {
      const page1 = await GV.api.people(state.user.login, which, 1);
      state[which] = page1;
      state[which + 'Done'] = page1.length < 100;
      renderPeople(which);
    } catch (err) {
      state[which + 'Loaded'] = false;
      listEl.innerHTML = '';
      $(sel.empty).hidden = false;
      $(sel.empty).querySelector('p').textContent = err.message || 'Could not load this list.';
      GV.toast(err.message || 'Could not load list', 'err');
    }
  }

  async function loadMorePeople(which) {
    const sel = peopleSel[which];
    const btn = $(sel.more + ' button') || $(which + 'More');
    if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
    try {
      const page = Math.floor(state[which].length / 100) + 1;
      const data = await GV.api.people(state.user.login, which, page);
      state[which] = state[which].concat(data);
      state[which + 'Done'] = data.length < 100;
      renderPeople(which);
    } catch (err) {
      GV.toast(err.message || 'Could not load more', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'LOAD MORE'; }
    }
  }

  function renderPeople(which) {
    const sel = peopleSel[which];
    const list = state[which] || [];
    $(sel.list).innerHTML = GV.render.people(list);
    $(sel.empty).hidden = list.length > 0;
    $(sel.more).hidden = list.length === 0 || state[which + 'Done'];
  }

  /* ================= repositories ================= */
  function resetToolbar() {
    $('#repoSearch').value = '';
    $('#repoSort').value = 'stars';
    $('#repoDir').textContent = '↓';
    const langs = uniqueLangs();
    $('#repoLang').innerHTML = '<option value="all">All</option>' +
      langs.map((l) => '<option value="' + GV.escape(l) + '">' + GV.escape(l) + '</option>').join('');
    $('#repoLang').value = 'all';
    $('#repoCount').textContent = '';
  }

  function uniqueLangs() {
    const counts = Object.create(null);
    state.repos.forEach((r) => {
      const l = r.language || 'Other';
      counts[l] = (counts[l] || 0) + 1;
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }

  function filteredRepos() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    const list = state.repos.filter((r) => {
      if (f.lang !== 'all' && (r.language || 'Other') !== f.lang) return false;
      if (!q) return true;
      const hay = (r.name + ' ' + (r.description || '') + ' ' + (r.topics || []).join(' ')).toLowerCase();
      return hay.indexOf(q) > -1;
    });

    const cmp = {
      stars: (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
      forks: (a, b) => (b.forks_count || 0) - (a.forks_count || 0),
      updated: (a, b) => new Date(b.pushed_at || b.updated_at || 0) - new Date(a.pushed_at || a.updated_at || 0),
      size: (a, b) => (b.size || 0) - (a.size || 0),
      name: (a, b) => a.name.localeCompare(b.name)
    };

    if (f.sort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name) * (f.dir === 'asc' ? 1 : -1));
    } else {
      list.sort(cmp[f.sort] || cmp.stars);
      if (f.dir === 'asc') list.reverse();
    }
    return list;
  }

  function repoCard(r) {
    const topics = (r.topics || []).slice(0, 4);
    const langColor = r.language ? GV.render.langColor(r.language, 0) : 'var(--dim)';
    const flags =
      (r.fork ? '<span class="flag flag--fork">FORK</span>' : '') +
      (r.archived ? '<span class="flag flag--arch">ARCHIVED</span>' : '');

    return '<article class="card repo-card">' +
      '<div class="rc-head">' +
        '<span style="display:flex;gap:9px;align-items:center;min-width:0">' +
          '<span class="repo-ico">' + GV.icon('repo', 16) + '</span>' +
          '<h3><a href="' + GV.escape(r.html_url) + '" target="_blank" rel="noopener noreferrer">' + GV.escape(r.name) + '</a></h3>' +
        '</span>' +
        (flags ? '<span class="repo-flags">' + flags + '</span>' : '') +
      '</div>' +
      '<p class="repo-desc' + (r.description ? '' : ' is-empty') + '">' +
        GV.escape(r.description || 'No description provided.') + '</p>' +
      (topics.length
        ? '<div class="topics">' + topics.map((t) => '<span class="topic">' + GV.escape(t) + '</span>').join('') + '</div>'
        : '<div class="topics"></div>') +
      '<div class="repo-foot">' +
        '<span class="rf-lang" style="color:' + langColor + '"><i style="background:' + langColor + '"></i>' +
          GV.escape(r.language || 'Other') + '</span>' +
        '<span class="rf-stars">' + GV.icon('star', 13) + GV.compact(r.stargazers_count || 0) + '</span>' +
        '<span>' + GV.icon('fork', 13) +GV.compact(r.forks_count || 0) + '</span>' +
        '<span>' + GV.icon('pulse', 13) + GV.timeAgo(r.pushed_at || r.updated_at) + '</span>' +
        (r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION'
          ? '<span>' + GV.icon('tag', 13) + GV.escape(r.license.spdx_id) + '</span>' : '') +
        (r.homepage
          ? '<a class="rf-demo" href="' + GV.escape(r.homepage) + '" target="_blank" rel="noopener noreferrer">DEMO ↗</a>'
          : '') +
      '</div>' +
      '</article>';
  }

  function applyRepoFilters() {
    const list = filteredRepos();
    const visible = list.slice(0, state.shown);
    const listEl = $('#repoList');
    listEl.innerHTML = visible.map(repoCard).join('');
    $('#repoEmpty').hidden = list.length > 0;
    $('#repoMoreWrap').hidden = list.length <= state.shown;
    $('#repoCount').textContent = list.length
      ? 'SHOWING ' + visible.length + ' / ' + list.length
      : '';
    if (state.user && state.repos.length < (state.user.public_repos || 0)) {
      $('#repoCount').textContent += ' · CAPPED AT ' + state.repos.length;
    }
  }

  /* ================= error ================= */
  function renderError(err, name) {
    const type = (err && err.type) || 'http';
    const map = {
      notfound: { code: '// HTTP 404', title: 'PROFILE NOT FOUND', ico: 'search' },
      rate: { code: '// HTTP 403', title: 'QUOTA EXHAUSTED', ico: 'clock' },
      network: { code: '// LINK DOWN', title: 'UPLINK FAILED', ico: 'alert' },
      http: { code: '// HTTP ERROR', title: 'TRANSMISSION ERROR', ico: 'alert' }
    };
    const m = map[type] || map.http;
    $('#errorIco').innerHTML = GV.icon(m.ico, 34);
    $('#errorCode').textContent = m.code;
    $('#errorTitle').textContent = m.title;

    let base;
    if (type === 'notfound') {
      base = 'No public GitHub account matches \u201C' + name + '\u201D. Check the spelling, or run a fresh search.';
    } else if (type === 'rate') {
      base = err.message;
    } else {
      base = err.message || 'Something went wrong while contacting the GitHub API.';
    }
    $('#errorMsg').textContent = base;
    if (type === 'rate') startCountdown(err.extra && err.extra.reset);
    document.title = m.title + ' // GH//VIEWER';
  }

  function startCountdown(resetTs) {
    stopCountdown();
    if (!resetTs) return;
    const p = $('#errorMsg');
    const tick = () => {
      const left = resetTs - Date.now();
      if (left <= 0) { stopCountdown(); return; }
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      p.textContent = $('#errorMsg').dataset.base +
        ' Resets in ' + mm + ':' + String(ss).padStart(2, '0') + '.';
    };
    $('#errorMsg').dataset.base = $('#errorMsg').textContent.replace(/ Resets in .*$/, '');
    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  function stopCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  /* ================= suggestions ================= */
  let suggestId = 0;
  let activeIndex = -1;

  function showSuggest(html) {
    const box = els.suggest;
    box.innerHTML = html;
    box.hidden = false;
    els.searchInput.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  }

  function hideSuggest() {
    els.suggest.hidden = true;
    els.suggest.innerHTML = '';
    els.searchInput.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function suggestionItems() {
    return $$('.suggest-item', els.suggest);
  }

  function renderRecentSuggest() {
    const list = GV.store.get('recent', []);
    if (!list.length) { hideSuggest(); return; }
    showSuggest(
      '<div class="suggest-title">RECENT SCANS</div>' +
      list.map((u) => suggestRow({ login: u.login, avatar_url: u.avatar })).join('') +
      '<div class="suggest-foot"><span class="suggest-title" style="padding:0">localStorage</span>' +
      '<button class="link-btn" type="button" data-clear-recent>CLEAR</button></div>'
    );
  }

  function suggestRow(u, meta) {
    return '<button class="suggest-item" type="button" role="option" data-user="' + GV.escape(u.login) + '">' +
      '<img src="' + GV.escape(GV.render.avatarUrl(u.avatar_url, 80)) + '" alt="" loading="lazy">' +
      '<span class="s-body"><span class="s-login">' + GV.escape(u.login) + '</span>' +
      '<span class="s-name">' + GV.escape(u.name || '—') + '</span></span>' +
      (meta ? '<span class="s-meta">' + meta + '</span>' : '') +
      '</button>';
  }

  async function fetchSuggestions(q) {
    const id = ++suggestId;
    try {
      const res = await GV.api.search(q);
      if (id !== suggestId || els.searchInput.value.trim() !== q) return;
      if (!res.items || !res.items.length) {
        showSuggest('<div class="suggest-empty">No users match \u201C' + GV.escape(q) + '\u201D</div>');
        return;
      }
      showSuggest('<div class="suggest-title">MATCHES</div>' +
        res.items.map((u) => suggestRow(u, '★ ' + GV.compact(u.followers))).join(''));
    } catch (err) {
      if (id !== suggestId) return;
      if (err.type === 'rate') {
        showSuggest('<div class="suggest-empty">Search quota exhausted — wait a minute, then try again.</div>');
      } else if (err.type === 'network') {
        showSuggest('<div class="suggest-empty">Network unavailable — cannot search right now.</div>');
      }
    }
  }

  function moveSuggestion(delta) {
    const items = suggestionItems();
    if (!items.length) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('is-active', i === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  /* ================= recents ================= */
  function addRecent(user) {
    let list = GV.store.get('recent', []);
    list = list.filter((u) => u.login.toLowerCase() !== user.login.toLowerCase());
    list.unshift({ login: user.login, avatar: user.avatar_url });
    GV.store.set('recent', list.slice(0, 6));
    renderRecentChips();
  }

  function renderRecentChips() {
    const list = GV.store.get('recent', []);
    els.recentWrap.hidden = !list.length;
    els.recentList.innerHTML = list.map((u) =>
      '<button class="chip" type="button" data-user="' + GV.escape(u.login) + '">@' + GV.escape(u.login) + '</button>'
    ).join('');
  }

  /* ================= theme ================= */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    GV.store.set('theme', t);
    const dark = t === 'dark';
    els.themeBtn.innerHTML = GV.icon(dark ? 'sun' : 'moon', 19);
    els.themeBtn.setAttribute('aria-pressed', String(!dark));
    const meta = document.getElementById('metaTheme');
    if (meta) meta.content = dark ? '#05070f' : '#eef2fb';
    GV.bus.emit('theme', t);
    if (state.user) {
      renderAll();
      switchTab(state.tab);
    } else {
      GV.charts.redrawAll();
    }
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    GV.toast(document.documentElement.dataset.theme === 'dark' ? 'Dark mode engaged' : 'Light mode engaged', 'info', 1800);
  }

  /* ================= modal ================= */
  let lastFocused = null;

  function openModal() {
    lastFocused = document.activeElement;
    els.modal.hidden = false;
    $('#shortcutsClose').focus();
  }

  function closeModal() {
    els.modal.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  /* ================= helpers ================= */
  function shake() {
    const target = els.heroInput.closest('.hero-search') || els.searchInput.closest('.search');
    if (!target) return;
    target.classList.remove('shake');
    void target.offsetWidth;
    target.classList.add('shake');
    setTimeout(() => target.classList.remove('shake'), 600);
  }

  function focusSearch() {
    if (els.hero.hidden === false) {
      els.heroInput.focus();
      els.heroInput.select();
    } else {
      els.searchInput.focus();
      els.searchInput.select();
    }
  }

  let revealObs = null;

  function observeReveals() {
    const nodes = $$('.reveal:not(.in)');
    if (!('IntersectionObserver' in window) || GV.reduced()) {
      nodes.forEach((n) => n.classList.add('in'));
      return;
    }
    if (!revealObs) {
      revealObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            revealObs.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    nodes.forEach((n) => revealObs.observe(n));
  }

  function typewriter() {
    const el = els.typeTarget;
    if (!el) return;
    const phrases = ['GITHUB PROFILE', 'TOP CONTRIBUTORS', 'REPO INSIGHTS', 'YOUR NEXT HIRE'];
    if (GV.reduced()) { el.textContent = phrases[0]; return; }
    let pi = 0, ci = 0, deleting = false;
    (function tick() {
      const word = phrases[pi];
      ci += deleting ? -1 : 1;
      if (ci < 0) ci = 0;
      el.innerHTML = GV.escape(word.slice(0, ci)) + '<i class="type-caret"></i>';
      let delay = deleting ? 34 : 68;
      if (!deleting && ci === word.length) { delay = 1900; deleting = true; }
      else if (deleting && ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; delay = 300; }
      setTimeout(tick, delay);
    })();
  }

  /* ================= share / export ================= */
  async function shareProfile() {
    if (!state.user) return;
    const url = location.href;
    const data = {
      title: state.user.login + ' // GH//VIEWER',
      text: 'GitHub profile scan of ' + state.user.login,
      url: url
    };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (e) { /* fall through */ }
    }
    const ok = await GV.copy(url);
    GV.toast(ok ? 'Profile link copied to clipboard' : 'Could not copy the link', ok ? 'ok' : 'err');
  }

  function exportProfile() {
    if (!state.user) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      source: 'GH//VIEWER (GitHub REST API v3)',
      profile: state.user,
      stats: {
        stars: state.stats.stars,
        forks: state.stats.forks,
        languages: state.stats.langList,
        accountAgeDays: state.stats.accountDays
      },
      repositories: state.repos,
      recentActivity: state.events
    };
    const ok = GV.download(payload, state.user.login + '-github-profile.json');
    GV.toast(ok ? 'JSON export downloaded' : 'Export failed', ok ? 'ok' : 'err');
  }

  /* ================= wiring ================= */
  function bind() {
    /* --- search forms --- */
    els.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const items = suggestionItems();
      if (activeIndex > -1 && items[activeIndex]) {
        loadProfile(items[activeIndex].dataset.user);
        return;
      }
      loadProfile(els.searchInput.value);
    });

    els.heroForm.addEventListener('submit', (e) => {
      e.preventDefault();
      loadProfile(els.heroInput.value);
    });

    const onSearchInput = GV.debounce(() => {
      const q = els.searchInput.value.trim();
      if (q.length < 2) { suggestId++; renderRecentSuggest(); return; }
      fetchSuggestions(q);
    }, 380);

    els.searchInput.addEventListener('input', onSearchInput);
    els.searchInput.addEventListener('focus', () => {
      if (!els.searchInput.value.trim()) renderRecentSuggest();
    });
    els.searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!els.suggest.contains(document.activeElement)) hideSuggest();
      }, 170);
    });
    els.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggestion(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggestion(-1); }
      else if (e.key === 'Escape') { hideSuggest(); els.searchInput.blur(); }
    });
    els.suggest.addEventListener('mousedown', (e) => {
      if (e.target.closest('.suggest-item')) e.preventDefault();
    });

    /* --- tabs --- */
    els.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (btn) switchTab(btn.dataset.tab);
    });
    els.tabs.addEventListener('keydown', (e) => {
      const order = ['overview', 'repos', 'activity', 'followers', 'following'];
      const i = order.indexOf(state.tab);
      if (e.key === 'ArrowRight') switchTab(order[(i + 1) % order.length]);
      if (e.key === 'ArrowLeft') switchTab(order[(i - 1 + order.length) % order.length]);
    });

    /* --- repo toolbar --- */
    $('#repoSearch').addEventListener('input', GV.debounce((e) => {
      state.filters.q = e.target.value;
      state.shown = 12;
      applyRepoFilters();
    }, 220));
    $('#repoSort').addEventListener('change', (e) => {
      state.filters.sort = e.target.value;
      state.shown = 12;
      applyRepoFilters();
    });
    $('#repoLang').addEventListener('change', (e) => {
      state.filters.lang = e.target.value;
      state.shown = 12;
      applyRepoFilters();
    });
    $('#repoDir').addEventListener('click', (e) => {
      state.filters.dir = state.filters.dir === 'desc' ? 'asc' : 'desc';
      e.currentTarget.textContent = state.filters.dir === 'desc' ? '↓' : '↑';
      applyRepoFilters();
    });
    $('#repoMore').addEventListener('click', () => {
      state.shown += 12;
      applyRepoFilters();
    });
    $('#repoReset').addEventListener('click', () => {
      state.filters = { q: '', sort: 'stars', lang: 'all', dir: 'desc' };
      state.shown = 12;
      resetToolbar();
      applyRepoFilters();
    });

    /* --- people paging --- */
    $('#followersMore').addEventListener('click', () => loadMorePeople('followers'));
    $('#followingMore').addEventListener('click', () => loadMorePeople('following'));

    /* --- global delegation --- */
    document.addEventListener('click', (e) => {
      const clearBtn = e.target.closest('[data-clear-recent]');
      if (clearBtn) {
        GV.store.set('recent', []);
        renderRecentChips();
        hideSuggest();
        return;
      }

      const goto = e.target.closest('[data-goto-tab]');
      if (goto) { switchTab(goto.dataset.gotoTab); return; }

      const userEl = e.target.closest('[data-user]');
      if (userEl) {
        if (userEl.tagName === 'A') e.preventDefault();
        loadProfile(userEl.dataset.user);
        return;
      }

      if (e.target.closest('#shareBtn')) { shareProfile(); return; }
      if (e.target.closest('#exportBtn')) { exportProfile(); return; }

      if (e.target.closest && !e.target.closest('.search')) hideSuggest();
    });

    /* --- header buttons --- */
    els.themeBtn.addEventListener('click', toggleTheme);
    $('#shortcutsBtn').addEventListener('click', openModal);
    $('#footerShortcuts').addEventListener('click', openModal);
    $('#shortcutsClose').addEventListener('click', closeModal);
    els.modal.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeModal(); });

    $('#brandLink').addEventListener('click', (e) => {
      e.preventDefault();
      goHome();
      window.scrollTo({ top: 0, behavior: GV.reduced() ? 'auto' : 'smooth' });
    });

    /* --- error actions --- */
    $('#errorRetry').addEventListener('click', () => {
      if (state.error) loadProfile(state.error.name);
    });
    $('#errorHome').addEventListener('click', goHome);

    /* --- to top --- */
    els.toTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: GV.reduced() ? 'auto' : 'smooth' });
    });

    /* --- scroll --- */
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        els.scrollBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        els.toTop.classList.toggle('is-on', window.scrollY > 480);
        ticking = false;
      });
    }, { passive: true });

    /* --- hash --- */
    window.addEventListener('hashchange', () => {
      if (suppressHash) return;
      const u = readHash();
      if (u) {
        if (!state.user || state.user.login.toLowerCase() !== u.toLowerCase()) loadProfile(u);
      } else if (state.user) {
        goHome();
      }
    });

    /* --- keyboard --- */
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
        return;
      }

      if (e.key === 'Escape') {
        if (!els.modal.hidden) { closeModal(); return; }
        hideSuggest();
        if (typing) e.target.blur();
        return;
      }

      if (typing) return;

      if (e.key === '/') { e.preventDefault(); focusSearch(); }
      else if (e.key === '?') { e.preventDefault(); els.modal.hidden ? openModal() : closeModal(); }
      else if (e.key.toLowerCase() === 't') { toggleTheme(); }
      else if (state.user && /^[1-5]$/.test(e.key)) {
        switchTab(['overview', 'repos', 'activity', 'followers', 'following'][Number(e.key) - 1]);
      }
    });

    /* --- card spotlight (fine pointers only) --- */
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches && !GV.reduced()) {
      document.addEventListener('pointermove', (e) => {
        const card = e.target.closest ? e.target.closest('.card') : null;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    }

    /* --- broken images → fallbacks --- */
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || img.dataset.failed) return;
      img.dataset.failed = '1';
      const holder = img.parentElement;
      const label = (img.alt || '?').trim().slice(0, 2).toUpperCase() || '?';
      if (holder && holder.classList.contains('avatar')) {
        holder.classList.add('is-fallback');
        holder.dataset.text = label;
        img.style.display = 'none';
        return;
      }
      const svg =
        "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>" +
        "<rect width='96' height='96' rx='14' fill='#101730'/>" +
        "<path d='M8 8h80v80H8z' fill='none' stroke='#38f2ff' stroke-width='2' opacity='.5'/>" +
        "<text x='48' y='56' font-family='monospace' font-size='34' fill='#38f2ff' " +
        "text-anchor='middle' dominant-baseline='middle'>" + label + "</text></svg>";
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }, true);

    /* --- header height → css var --- */
    const topbar = document.getElementById('topbar');
    const setH = () => document.documentElement.style.setProperty('--header-h', topbar.offsetHeight + 'px');
    if ('ResizeObserver' in window) new ResizeObserver(setH).observe(topbar);
    window.addEventListener('resize', setH);
    setH();

    /* --- quota --- */
    GV.bus.on('quota', (q) => {
      if (typeof q.remaining !== 'number' || typeof q.limit !== 'number' || !q.limit) return;
      const pct = Math.round((q.remaining / q.limit) * 100);
      $('#quotaFill').style.width = Math.max(2, pct) + '%';
      $('#quotaNum').textContent = q.remaining + '/' + q.limit;
      $('#quota').classList.toggle('is-low', pct <= 25);
    });

    /* --- theme bus → redraw charts if someone else changed theme --- */
    GV.bus.on('theme', () => GV.charts.redrawAll());
  }

  /* ================= init ================= */
  function init() {
    els = {
      hero: $('#hero'),
      loader: $('#loader'),
      error: $('#errorState'),
      profile: $('#profileView'),
      searchForm: $('#searchForm'),
      searchInput: $('#searchInput'),
      suggest: $('#suggest'),
      heroForm: $('#heroForm'),
      heroInput: $('#heroInput'),
      recentWrap: $('#recentWrap'),
      recentList: $('#recentList'),
      tabs: $('#tabs'),
      themeBtn: $('#themeBtn'),
      modal: $('#shortcutsModal'),
      toTop: $('#toTop'),
      scrollBar: $('#scrollBar'),
      typeTarget: $('#typeTarget')
    };

    GV.hydrateIcons();
    $('.search-ico').innerHTML = GV.icon('search', 17);
    $('.hero-search__ico').innerHTML = GV.icon('search', 18);
    $('#shortcutsBtn').innerHTML = GV.icon('keyboard', 19);
    $('#ghLink').innerHTML = GV.icon('github', 19);
    $('#shortcutsClose').innerHTML = GV.icon('close', 18);
    els.toTop.innerHTML = GV.icon('arrowUp', 19);

    $$('.quick-card').forEach((card) => {
      const img = card.querySelector('img');
      if (img) img.src = 'https://github.com/' + encodeURIComponent(card.dataset.user) + '.png?size=80';
    });

    renderRecentChips();
    bind();
    applyTheme(GV.store.get('theme', 'dark'));
    observeReveals();
    typewriter();

    const fromHash = readHash();
    if (fromHash) loadProfile(fromHash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.GV);
