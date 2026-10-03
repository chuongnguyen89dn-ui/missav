import { chromium } from 'playwright';
import http from 'node:http';

const originalCreateServer = http.createServer.bind(http);
const AV = 'https://www.av01.media';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*'
};

let catalogCache = { at: 0, items: [] };
let browserPromise = null;
const sessions = new Map();
const sessionInflight = new Map();
const mediaCache = new Map();
const mediaInflight = new Map();
const MEDIA_CACHE_MAX = 16;
const SESSION_TTL = 90000;

function safeErr(e) {
  return String(e?.message || e || 'error')
    .replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')
    .replace(/ro=[^&\s]+/g, 'ro=[redacted]')
    .slice(0, 500);
}

async function browser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

function cleanHeaders(h = {}) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase();
    if (key.startsWith(':')) continue;
    if (['host', 'content-length', 'cookie'].includes(key)) continue;
    out[k] = v;
  }
  return out;
}

function signUrl(url, s) {
  const u = new URL(url);
  if (!u.hostname.endsWith('iw01.xyz')) return u.toString();
  u.searchParams.set('access_token', s.token);
  if (s.ro) u.searchParams.set('ro', s.ro);
  return u.toString();
}

function cacheKey(id, u) {
  const q = new URLSearchParams(u.search);
  q.delete('access_token');
  q.delete('ro');
  const qs = q.toString();
  return `${id}:${u.pathname}${qs ? `?${qs}` : ''}`;
}

function cacheGet(key) {
  const v = mediaCache.get(key);
  if (!v) return null;
  mediaCache.delete(key);
  mediaCache.set(key, v);
  return v;
}

function cachePut(key, v) {
  mediaCache.delete(key);
  mediaCache.set(key, v);
  while (mediaCache.size > MEDIA_CACHE_MAX) {
    mediaCache.delete(mediaCache.keys().next().value);
  }
}

async function closeSession(id) {
  const s = sessions.get(String(id));
  sessions.delete(String(id));
  if (s?.context) {
    try { await s.context.close(); } catch {}
  }
}

async function resolveBrowserSession(id) {
  const b = await browser();
  const pageUrl = `${AV}/en/video/${id}/`;
  const context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: UA,
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  const page = await context.newPage();
  const state = {
    manifestUrl: '',
    manifestHeaders: {},
    token: '',
    ro: '',
    cdnHeaders: {}
  };

  page.on('request', req => {
    try {
      const url = req.url();
      const lo = url.toLowerCase();
      if (lo.includes('/api/v1/videos/') && lo.includes('sv3-v1-a1.m3u8')) {
        state.manifestUrl = url;
        state.manifestHeaders = cleanHeaders(req.headers());
      }
      if (lo.includes('customers.iw01.xyz') && (lo.includes('sv3-v1-a1') || lo.includes('file90-'))) {
        const q = new URL(url).searchParams;
        const token = q.get('access_token');
        if (token) {
          state.token = token;
          state.ro = q.get('ro') || '';
          state.cdnHeaders = cleanHeaders(req.headers());
        }
      }
    } catch {}
  });

  try {
    console.log('[AV01_V3_RESOLVE_START]', JSON.stringify({ id }));
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    try {
      await page.locator('video').first().evaluate(v => { try { v.muted = true; v.play(); } catch {} });
    } catch {}

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && (!state.manifestUrl || !state.token)) {
      await page.waitForTimeout(200);
    }

    if (!state.manifestUrl) throw new Error('AV01 browser manifest not captured');
    if (!state.token) throw new Error('AV01 browser CDN token not captured');

    const manifestHeaders = {
      ...state.manifestHeaders,
      Referer: pageUrl,
      'User-Agent': state.manifestHeaders['user-agent'] || UA
    };
    const mr = await context.request.get(state.manifestUrl, {
      headers: manifestHeaders,
      timeout: 10000
    });
    if (mr.status() !== 200) throw new Error(`AV01 captured manifest ${mr.status()}`);
    const manifestText = await mr.text();

    const s = {
      id: Number(id),
      pageUrl,
      context,
      manifestUrl: state.manifestUrl,
      manifestText,
      manifestHeaders,
      cdnHeaders: {
        ...state.cdnHeaders,
        Referer: pageUrl,
        'User-Agent': state.cdnHeaders['user-agent'] || UA
      },
      token: state.token,
      ro: state.ro,
      created: Date.now()
    };
    sessions.set(String(id), s);
    console.log('[AV01_V3_RESOLVE_OK]', JSON.stringify({ id, manifestBytes: Buffer.byteLength(manifestText), token: true }));
    return s;
  } catch (e) {
    try { await context.close(); } catch {}
    console.error('[AV01_V3_RESOLVE_ERROR]', JSON.stringify({ id, error: safeErr(e) }));
    throw e;
  } finally {
    try { await page.close(); } catch {}
  }
}

async function getSession(id, force = false) {
  const key = String(id);
  const existing = sessions.get(key);
  if (!force && existing && Date.now() - existing.created < SESSION_TTL) return existing;
  if (force) await closeSession(id);
  if (sessionInflight.has(key)) return sessionInflight.get(key);
  const p = resolveBrowserSession(id).finally(() => sessionInflight.delete(key));
  sessionInflight.set(key, p);
  return p;
}

function rewritePlaylist(text, base, id) {
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    let out = line.replace(/URI="([^"]+)"/g, (_, v) => {
      const target = new URL(v, base).toString();
      return `URI="/av01/${id}/proxy?u=${encodeURIComponent(target)}"`;
    });
    if (out.trim() && !out.trim().startsWith('#')) {
      const target = new URL(out.trim(), base).toString();
      out = `/av01/${id}/proxy?u=${encodeURIComponent(target)}`;
    }
    return out;
  }).join('\n') + '\n';
}

async function fetchMediaOnce(s, target, id) {
  const signed = signUrl(target, s);
  const r = await s.context.request.get(signed, {
    headers: s.cdnHeaders,
    timeout: 5000
  });
  const body = await r.body();
  return { status: r.status(), headers: r.headers(), body, url: target };
}

async function fetchMedia(id, target, key) {
  const cached = cacheGet(key);
  if (cached) {
    console.log('[AV01_MEDIA_CACHE_HIT]', JSON.stringify({ id, key, bytes: cached.body.length }));
    return cached;
  }
  if (mediaInflight.has(key)) return mediaInflight.get(key);

  const p = (async () => {
    let s = await getSession(id);
    try {
      const r1 = await fetchMediaOnce(s, target, id);
      console.log('[AV01_V3_MEDIA]', JSON.stringify({ id, attempt: 1, status: r1.status, bytes: r1.body.length, path: new URL(target).pathname }));
      if (r1.status === 200) {
        cachePut(key, r1);
        return r1;
      }
      if (![502, 503, 504].includes(r1.status)) return r1;
    } catch (e) {
      console.error('[AV01_V3_MEDIA_ERROR]', JSON.stringify({ id, attempt: 1, error: safeErr(e) }));
    }

    s = await getSession(id, true);
    try {
      const r2 = await fetchMediaOnce(s, target, id);
      console.log('[AV01_V3_MEDIA]', JSON.stringify({ id, attempt: 2, status: r2.status, bytes: r2.body.length, path: new URL(target).pathname }));
      if (r2.status === 200) cachePut(key, r2);
      return r2;
    } catch (e) {
      console.error('[AV01_V3_MEDIA_ERROR]', JSON.stringify({ id, attempt: 2, error: safeErr(e) }));
      return { status: 504, headers: { 'content-type': 'text/plain' }, body: Buffer.from('browser media timeout'), url: target };
    }
  })().finally(() => mediaInflight.delete(key));

  mediaInflight.set(key, p);
  return p;
}

async function avMaster(req, res, id) {
  const s = await getSession(id);
  const rewritten = rewritePlaylist(s.manifestText, s.manifestUrl, id);
  console.log('[AV01_V3_MASTER]', JSON.stringify({ id, bytes: Buffer.byteLength(rewritten) }));
  res.writeHead(200, {
    ...cors,
    'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'cache-control': 'no-store'
  });
  return res.end(rewritten);
}

async function avProxyTarget(req, res, id, target) {
  const u = new URL(target);
  if (!u.hostname.endsWith('iw01.xyz') && !u.hostname.endsWith('av01.media')) {
    throw new Error('AV01 target host rejected');
  }
  const key = cacheKey(id, u);
  const r = await fetchMedia(id, u.toString(), key);
  const type = r.headers['content-type'] || 'application/octet-stream';

  if (r.status !== 200) {
    res.writeHead(r.status, { ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(`AV01 upstream ${r.status}\n`);
  }

  if (type.includes('mpegurl') || u.pathname.endsWith('.m3u8')) {
    const text = Buffer.from(r.body).toString('utf8');
    const rewritten = rewritePlaylist(text, r.url, id);
    res.writeHead(200, { ...cors, 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(rewritten);
  }

  res.writeHead(200, { ...cors, 'content-type': type, 'cache-control': 'private, max-age=180' });
  if (req.method === 'HEAD') return res.end();
  return res.end(r.body);
}

async function aj(url, opt = {}) {
  const r = await fetch(url, {
    ...opt,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json,text/plain,*/*',
      'Origin': AV,
      'Referer': `${AV}/`,
      ...(opt.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`AV01 ${r.status}`);
  return r.json();
}

async function items() {
  if (Date.now() - catalogCache.at < 60000 && catalogCache.items.length) return catalogCache.items;
  const j = await aj(`${AV}/api/v1/videos/search?lang=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', pagination: { page: 1, limit: 20 } })
  });
  catalogCache = { at: Date.now(), items: j.videos || [] };
  return catalogCache.items;
}

function tagName(x) { return typeof x === 'string' ? x : (x?.name || x?.title || ''); }
function meta(x) {
  return Object.fromEntries(Object.entries({
    id: `av01:${x.id}`,
    type: 'movie',
    name: x?.title_translations?.en || x.title || x.dvd_id || String(x.id),
    poster: x.cover || x.poster || undefined,
    posterShape: 'poster',
    description: x?.description_translations?.en || x.description || undefined,
    genres: (x.tags || []).map(tagName).filter(Boolean),
    language: 'Tiếng Nhật'
  }).filter(([, v]) => v !== undefined && v !== ''));
}

function send(res, d, s = 200) {
  const b = JSON.stringify(d);
  res.writeHead(s, {
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(b),
    'cache-control': 'no-store'
  });
  res.end(b);
}

http.createServer = function(handler, ...rest) {
  return originalCreateServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      if (path === '/manifest.json') {
        return send(res, {
          id: 'community.missav.hls.test',
          version: '0.5.0-av01-v3-browser',
          name: 'MissAV 1080p',
          description: 'Original MissAV + original IkiSoda + AV01 browser-captured resolver',
          resources: ['catalog', 'meta', 'stream'],
          types: ['movie'],
          catalogs: [
            { type: 'movie', id: 'missav-1080', name: 'MissAV · Verified 1080p' },
            { type: 'movie', id: 'ikisoda', name: 'ikisoda' },
            { type: 'movie', id: 'av01-test', name: 'Test AV01' }
          ],
          idPrefixes: ['missav:', 'ikisoda:', 'av01:']
        });
      }
      if (path === '/catalog/movie/av01-test.json') return send(res, { metas: (await items()).map(meta) });

      let m = path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);
      if (m) {
        return send(res, { streams: [{
          name: 'AV01 Browser HLS',
          title: `AV01 ${m[1]} · browser captured`,
          url: `https://missav-uimx.onrender.com/av01/${m[1]}/master.m3u8`,
          behaviorHints: { filename: 'av01.m3u8' }
        }] });
      }

      m = path.match(/^\/av01\/(\d+)\/master\.m3u8$/);
      if (m) return await avMaster(req, res, Number(m[1]));

      m = path.match(/^\/av01\/(\d+)\/proxy$/);
      if (m) {
        const target = new URL(req.url, 'http://localhost').searchParams.get('u') || '';
        return await avProxyTarget(req, res, Number(m[1]), target);
      }

      m = path.match(/^\/meta\/movie\/av01:(\d+)\.json$/);
      if (m) {
        const x = (await items()).find(v => String(v.id) === m[1]);
        return x ? send(res, { meta: meta(x) }) : send(res, { error: 'Not found' }, 404);
      }

      return handler(req, res);
    } catch (e) {
      console.error('[AV01_V3_TEST]', JSON.stringify({ path, error: safeErr(e) }));
      return send(res, { error: safeErr(e) }, 502);
    }
  }, ...rest);
};
