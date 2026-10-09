import http from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

let filteredCatalog={movies:[]};
try{filteredCatalog=JSON.parse(readFileSync(new URL('./data/av01-catalog.json',import.meta.url),'utf8'));}catch{}
const filteredMovies=Array.isArray(filteredCatalog)?filteredCatalog:(filteredCatalog.movies||[]);
let enrichedCatalog={movies:[]};
try{enrichedCatalog=JSON.parse(readFileSync(new URL('./data/av01-metadata-enriched.json',import.meta.url),'utf8'));}catch{}
const enrichedById=new Map((enrichedCatalog.movies||[]).map(x=>[String(x.id),x]));
const filteredById=new Map(filteredMovies.map(x=>[String(x.id),x]));
let verifiedImages={movies:[]};
try{verifiedImages=JSON.parse(readFileSync(new URL('./data/av01-avmates-cdn-images.json',import.meta.url),'utf8'));}catch{}
const verifiedById=new Map((verifiedImages.movies||[]).filter(x=>x?.status==='ok'&&x?.poster).map(x=>[String(x.id),x]));
function verifiedMeta(x){
  const base=filteredMeta(x);
  const verified=verifiedById.get(String(x.id));
  if(!verified)return base;
  const snaps=(verified.snapshots||[]).filter(u=>typeof u==='string'&&/jp-\d+\./i.test(u));
  const videos=[{id:base.id,title:base.name,available:true}];
  snaps.forEach((thumbnail,i)=>videos.push({id:base.id+':image:'+(i+1),title:'Snap '+(i+1),season:1,episode:i+1,thumbnail,available:true}));
  return {...base,poster:verified.poster,background:(verified.snapshots||[]).find(u=>/pl_poster/i.test(u))||base.background,behaviorHints:{defaultVideoId:base.id},videos};
}

function filteredMeta(x){
  const tags=(x.official_tags||x.tags||[]).map(v=>typeof v==='string'?v:(v?.name||v?.title||'')).filter(Boolean);
  return Object.fromEntries(Object.entries({id:`av01:${x.id}`,type:'movie',name:x.title||x.code||`AV01 ${x.id}`,poster:(enrichedById.get(String(x.id))?.poster||`https://av01-production-wzre.onrender.com/av01/${x.id}/poster.jpg`),background:(enrichedById.get(String(x.id))?.poster||`https://av01-production-wzre.onrender.com/av01/${x.id}/poster.jpg`),posterShape:'poster',description:x.description||undefined,releaseInfo:x.year?String(x.year):undefined,genres:tags,genre:tags,language:'Tiếng Nhật'}).filter(([,v])=>v!==undefined&&v!==''));
}

const originalCreateServer = http.createServer.bind(http);
const AV = 'https://www.av01.media';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*'
};

let catalogCache = { at: 0, items: [] };
const sessions = new Map();
const SESSION_TTL = 90000;

function safeErr(e) {
  return String(e?.message || e || 'error')
    .replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')
    .replace(/ro=[^&\s]+/g, 'ro=[redacted]')
    .slice(0, 500);
}

function signUrl(url, s) {
  const u = new URL(url);
  if (!u.hostname.endsWith('iw01.xyz')) return u.toString();
  u.searchParams.set('access_token', s.token);
  if (s.ro) u.searchParams.set('ro', s.ro);
  return u.toString();
}

async function resolveSession(id) {
  const geo = await fetch('https://files.iw01.xyz/edge/geo.js?json', {
    headers: { 'User-Agent': UA, 'Referer': `${AV}/` },
    signal: AbortSignal.timeout(4000)
  });
  if (!geo.ok) throw new Error(`AV01 geo ${geo.status}`);
  const g = await geo.json();
  const qs = new URLSearchParams({
    token_v2: String(g.token_v2),
    expires: String(g.expires),
    ip: String(g.ip)
  });
  const tr = await fetch(`https://customers.iw01.xyz/api/v1/videos/${id}/cdn-access?${qs}`, {
    headers: { 'User-Agent': UA, 'Referer': `${AV}/`, 'Origin': AV },
    signal: AbortSignal.timeout(4000)
  });
  if (!tr.ok) throw new Error(`AV01 cdn-access ${tr.status}`);
  const tj = await tr.json();
  if (!tj.access_token) throw new Error('AV01 no access_token');
  const s = { token: tj.access_token, ro: tj.ro || '', created: Date.now() };
  sessions.set(String(id), s);
  return s;
}

async function getSession(id, force = false) {
  const key = String(id);
  const s = sessions.get(key);
  if (!force && s && Date.now() - s.created < SESSION_TTL) return s;
  return resolveSession(id);
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

function upstreamHeaders() {
  return {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${AV}/`,
    'Origin': AV
  };
}

async function fetchUpstream(id, target, force = false, reqHeaders = {}) {
  const s = await getSession(id, force);
  const headers = { ...upstreamHeaders() };
  if (reqHeaders.range) headers.Range = reqHeaders.range;
  if (reqHeaders['if-range']) headers['If-Range'] = reqHeaders['if-range'];
  return fetch(signUrl(target, s), {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });
}

async function avDirectMaster(req, res, id) {
  const s = await getSession(id);
  const master = `https://customers.iw01.xyz/api/v1/videos/${id}/manifest/index90-sv3-v1-a1.m3u8`;
  let r = await fetch(signUrl(master, s), {
    headers: upstreamHeaders(),
    signal: AbortSignal.timeout(3500)
  });
  if ([502, 503, 504].includes(r.status)) {
    const s2 = await getSession(id, true);
    r = await fetch(signUrl(master, s2), {
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(3500)
    });
  }
  if (!r.ok) throw new Error(`AV01 direct manifest ${r.status}`);
  const text = await r.text();
  const base = r.url || master;
  const direct = text.split(/\\r?\\n/).map(line => {
    if (!line.trim()) return line;
    return line.replace(/URI="([^"]+)"/g, (_, v) => {
      const target = new URL(v, base).toString();
      return `URI="${signUrl(target, s)}"`;
    }).trim().startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, v) => {
      const target = new URL(v, base).toString();
      return `URI="${signUrl(target, s)}"`;
    }) : signUrl(new URL(line.trim(), base).toString(), s);
  }).join('\\n') + '\\n';
  console.log('[AV01_DIRECT_MASTER]', JSON.stringify({ id, bytes: Buffer.byteLength(direct) }));
  res.writeHead(200, {
    ...cors,
    'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'cache-control': 'no-store'
  });
  return res.end(direct);
}

async function avMaster(req, res, id) {
  const s = await getSession(id);
  const master = `https://customers.iw01.xyz/api/v1/videos/${id}/manifest/index90-sv3-v1-a1.m3u8`;
  let r = await fetch(signUrl(master, s), {
    headers: upstreamHeaders(),
    signal: AbortSignal.timeout(6000)
  });
  if ([502, 503, 504].includes(r.status)) {
    const s2 = await getSession(id, true);
    r = await fetch(signUrl(master, s2), {
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(6000)
    });
  }
  console.log('[AV01_NATIVE_MASTER]', JSON.stringify({ id, status: r.status }));
  if (!r.ok) throw new Error(`AV01 manifest ${r.status}`);
  const text = await r.text();
  const rewritten = rewritePlaylist(text, r.url, id);
  res.writeHead(200, {
    ...cors,
    'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'cache-control': 'no-store'
  });
  return res.end(rewritten);
}

async function avProxyTarget(req, res, id, target) {
  const u = new URL(target);
  if (!u.hostname.endsWith('iw01.xyz')) throw new Error('AV01 target host rejected');

  let r;
  const started = Date.now();
  const reqHeaders = {
    range: req.headers.range,
    'if-range': req.headers['if-range']
  };
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      r = await fetchUpstream(id, u.toString(), attempt > 1, reqHeaders);
      console.log('[AV01_NATIVE_FETCH_ATTEMPT]', JSON.stringify({
        id, path: u.pathname, attempt, status: r.status, ms: Date.now() - started
      }));
      if (![502, 503, 504].includes(r.status) || attempt === 3) break;
      try { await r.body?.cancel(); } catch {}
    } catch (e) {
      lastError = e;
      console.error('[AV01_NATIVE_FETCH_RETRY]', JSON.stringify({
        id, path: u.pathname, attempt, ms: Date.now() - started, error: safeErr(e)
      }));
      if (attempt < 3) continue;
    }
  }
  if (!r) {
    console.error('[AV01_NATIVE_FETCH_ERROR]', JSON.stringify({
      id, path: u.pathname, attempts: 3, ms: Date.now() - started, error: safeErr(lastError)
    }));
    res.writeHead(504, { ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('AV01 upstream timeout after retries\n');
  }

  const type = r.headers.get('content-type') || 'application/octet-stream';
  console.log('[AV01_NATIVE_FETCH]', JSON.stringify({ id, status: r.status, path: u.pathname, ms: Date.now() - started }));

  if (!r.ok) {
    res.writeHead(r.status, { ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(`AV01 upstream ${r.status}\n`);
  }

  if (type.includes('mpegurl') || u.pathname.endsWith('.m3u8')) {
    const text = await r.text();
    const rewritten = rewritePlaylist(text, r.url, id);
    res.writeHead(200, { ...cors, 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(rewritten);
  }

  const headers = {
    ...cors,
    'content-type': type,
    'cache-control': 'public, max-age=300'
  };
  const len = r.headers.get('content-length');
  const range = r.headers.get('content-range');
  const acceptRanges = r.headers.get('accept-ranges');
  const etag = r.headers.get('etag');
  const lastModified = r.headers.get('last-modified');
  if (len) headers['content-length'] = len;
  if (range) headers['content-range'] = range;
  if (acceptRanges) headers['accept-ranges'] = acceptRanges;
  if (etag) headers.etag = etag;
  if (lastModified) headers['last-modified'] = lastModified;

  res.writeHead(r.status, headers);
  if (req.method === 'HEAD' || !r.body) return res.end();

  const nodeStream = Readable.fromWeb(r.body);
  nodeStream.on('error', err => {
    console.error('[AV01_NATIVE_STREAM_ERROR]', JSON.stringify({ id, path: u.pathname, error: safeErr(err) }));
    if (!res.destroyed) res.destroy(err);
  });
  nodeStream.pipe(res);
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
          version: '0.6.3-av01-native-stream',
          name: 'MissAV 1080p',
          description: 'Original MissAV + original IkiSoda + AV01 lightweight native streaming proxy',
          resources: ['catalog', 'meta', 'stream'],
          types: ['movie'],
          catalogs: [
            { type: 'movie', id: 'missav-1080', name: 'MissAV · Verified 1080p' },
            { type: 'movie', id: 'ikisoda', name: 'ikisoda' },
            { type: 'movie', id: 'av01-filtered', name: 'AV01 · Hottest · Filtered 1080p' }
          ],
          idPrefixes: ['missav:', 'ikisoda:', 'av01:']
        });
      }
      if (path === '/catalog/movie/av01-test.json') return send(res, { metas: (await items()).map(meta) });
      if (path === '/catalog/movie/av01-filtered.json') return send(res, { metas: filteredMovies.map(x=>{const m=verifiedMeta(x);delete m.videos;return m;}) });

      let m = path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);
      if (m) {
        return send(res, { streams: [{
          name: 'AV01 Native Streaming',
          title: `AV01 ${m[1]} · native streaming`,
          url: `https://av01-production-wzre.onrender.com/av01/${m[1]}/master.m3u8`,
          behaviorHints: { filename: 'av01.m3u8' }
        }] });
      }

      m = path.match(/^\/av01\/(\d+)\/poster\.jpg$/);
      if (m) {
        const id=m[1];
        const candidates=[
          `${AV}/media/videos/tmb/${id}/1.jpg`,
          `https://files.iw01.xyz/covers/${id}/800.webp`
        ];
        for (const u of candidates) {
          try {
            const r=await fetch(u,{headers:{'User-Agent':UA,'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8','Referer':`${AV}/en/video/${id}/`},redirect:'follow',signal:AbortSignal.timeout(8000)});
            if (!r.ok) continue;
            const b=Buffer.from(await r.arrayBuffer());
            res.writeHead(200,{...cors,'content-type':r.headers.get('content-type')||'image/jpeg','content-length':b.length,'cache-control':'public, max-age=86400'});
            return res.end(b);
          } catch {}
        }
        res.writeHead(404,{...cors,'content-type':'text/plain'}); return res.end('poster unavailable');
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
        const fx = filteredById.get(m[1]);
        if (fx) return send(res, { meta: verifiedMeta(fx) });
        const x = (await items()).find(v => String(v.id) === m[1]);
        return x ? send(res, { meta: meta(x) }) : send(res, { error: 'Not found' }, 404);
      }

      return handler(req, res);
    } catch (e) {
      console.error('[AV01_NATIVE_TEST]', JSON.stringify({ path, error: safeErr(e) }));
      return send(res, { error: safeErr(e) }, 502);
    }
  }, ...rest);
};
