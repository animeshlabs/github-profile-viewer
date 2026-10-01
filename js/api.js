/* ==========================================================================
   GH//VIEWER — GitHub REST API layer
   caching, quota tracking, error taxonomy, paged helpers
   ========================================================================== */
(function (GV) {
  'use strict';

  const BASE = 'https://api.github.com';
  const cache = new Map();          // url -> { t, ttl, data }
  const MAX_REPO_PAGES = 3;         // hard cap = 300 repos

  function ApiError(type, message, extra) {
    this.name = 'ApiError';
    this.type = type;               // notfound | rate | network | http | partial
    this.message = message;
    this.extra = extra || {};
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  GV.ApiError = ApiError;

  /* ---------- quota (per resource: core vs search) ---------- */
  const quotas = {
    core: { remaining: null, limit: null, reset: null },
    search: { remaining: null, limit: null, reset: null }
  };
  GV.getQuota = () => quotas.core;

  function syncQuota(res, resource) {
    const q = quotas[resource] || quotas.core;
    const r = res.headers.get('x-ratelimit-remaining');
    const l = res.headers.get('x-ratelimit-limit');
    const rs = res.headers.get('x-ratelimit-reset');
    if (r !== null) q.remaining = parseInt(r, 10);
    if (l !== null) q.limit = parseInt(l, 10);
    if (rs !== null) q.reset = parseInt(rs, 10) * 1000;
    if (resource === 'core' && q.remaining !== null) {
      GV.bus.emit('quota', Object.assign({}, q));
    }
  }

  /* ---------- core fetch ---------- */
  async function get(url, ttl, resource) {
    resource = resource || 'core';
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.data;

    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new ApiError('network', 'Could not reach api.github.com. Check your connection and try again.');
    }

    syncQuota(res, resource);

    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch (e) { /* noop */ }

      if (res.status === 404) {
        throw new ApiError('notfound', body.message || 'Not Found');
      }
      if (res.status === 403 || res.status === 429) {
        const reset = (quotas[resource] || quotas.core).reset;
        const left = reset ? Math.max(0, reset - Date.now()) : 0;
        const mins = Math.ceil(left / 60000);
        throw new ApiError('rate',
          (body.message || 'API rate limit exceeded.') +
          (mins > 0 ? ' Quota resets in ~' + mins + ' min.' : ''),
          { reset: reset });
      }
      if (res.status === 422) {
        throw new ApiError('http', body.message || 'Invalid request.');
      }
      throw new ApiError('http', body.message || ('GitHub API error (HTTP ' + res.status + ').'));
    }

    const data = await res.json();
    cache.set(url, { t: Date.now(), ttl: ttl || 300000, data: data });
    return data;
  }

  function userUrl(u) { return BASE + '/users/' + encodeURIComponent(u); }

  GV.api = {
    user(name, opts) {
      return get(userUrl(name), (opts && opts.ttl) || 300000);
    },

    repos(name, page) {
      return get(userUrl(name) + '/repos?per_page=100&page=' + (page || 1) + '&sort=updated', 600000);
    },

    /* all repos up to 3 pages (300), sequential to keep ordering sane */
    async allRepos(name, onProgress) {
      const out = [];
      for (let page = 1; page <= MAX_REPO_PAGES; page++) {
        const batch = await GV.api.repos(name, page);
        out.push.apply(out, batch);
        if (onProgress) onProgress(out.length);
        if (batch.length < 100) break;
      }
      return out;
    },

    people(name, which, page) {
      return get(userUrl(name) + '/' + which + '?per_page=100&page=' + (page || 1), 300000);
    },

    events(name) {
      return get(userUrl(name) + '/events/public?per_page=100', 120000);
    },

    search(q) {
      return get(BASE + '/search/users?q=' + encodeURIComponent(q) + '&per_page=6', 60000, 'search');
    },

    clearCache() { cache.clear(); }
  };
})(window.GV);
