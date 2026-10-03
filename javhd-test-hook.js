import http from 'node:http';

const originalCreateServer = http.createServer.bind(http);
const AV = 'https://www.av01.media';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*'
};

// AV01 stays INSIDE the existing MissAV addon, as its own test catalog.
// This does not touch the existing MissAV or IkiSoda routes in server.js.
const AV_IDS = [
  221258,221256,221255,221254,221253,
  221235,221232,221230,221229,221218,
  221176,221175,221174,221132,221131,
  221130,221129,221128,221127,221126
];

let catalogCache = {at: 0, items: []};

async function avFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Origin': AV,
      'Referer': AV + '/',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('AV01 HTTP ' + response.status);
  return response;
}

// Metadata is deliberately lightweight. Playback is the priority; the existing
// MissAV/IkiSoda metadata code remains untouched.
async function avItems() {
  if (Date.now() - catalogCache.at < 60_000 && catalogCache.items.length) {
    return catalogCache.items;
  }

  catalogCache = {
    at: Date.now(),
    items: AV_IDS.map(id => ({
      id,
      title: 'AV01 ' + id
    }))
  };
  return catalogCache.items;
}

function avMeta(x) {
  return {
    id: 'av01:' + x.id,
    type: 'movie',
    name: x.title,
    posterShape: 'poster',
    description: 'AV01 playback test · resolve fresh HLS on Play',
    language: 'Tiếng Nhật'
  };
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function signAv01Url(rawUrl, token, ro = '') {
  const url = new URL(rawUrl);
  if (!url.hostname.endsWith('iw01.xyz')) return url.toString();

  url.searchParams.set('access_token', token);
  if (ro && !url.searchParams.has('ro')) url.searchParams.set('ro', ro);
  return url.toString();
}

function rewriteAv01Manifest(text, manifestUrl, token, ro = '') {
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;

    let out = line.replace(/URI="([^"]+)"/g, (_, value) => {
      const absolute = new URL(value, manifestUrl).toString();
      return 'URI="' + signAv01Url(absolute, token, ro) + '"';
    });

    const trimmed = out.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      out = signAv01Url(new URL(trimmed, manifestUrl).toString(), token, ro);
    }
    return out;
  }).join('\n') + '\n';
}

/*
 * Resolve exactly when Nuvio asks for the stream.
 *
 * geo.js -> cdn-access -> fresh access_token
 *        -> known working sv3 1080p manifest
 *        -> rewrite CDN segment URLs with fresh token
 *        -> return HLS to Nuvio
 *
 * Video segments are NOT proxied through Render; Nuvio requests the signed
 * iw01.xyz URLs directly.
 */
async function resolveAv01(id) {
  const geoResponse = await avFetch('https://files.iw01.xyz/edge/geo.js?json');
  const geo = await geoResponse.json();

  for (const key of ['token_v2', 'expires', 'ip']) {
    if (geo[key] == null) throw new Error('geo.js missing ' + key);
  }

  const tokenResponse = await avFetch(
    'https://customers.iw01.xyz/api/v1/videos/' + id + '/cdn-access?' +
      new URLSearchParams({
        token_v2: String(geo.token_v2),
        expires: String(geo.expires),
        ip: String(geo.ip)
      }).toString(),
    {
      headers: {
        'Accept': 'application/json,*/*'
      }
    }
  );

  const tokenJson = await tokenResponse.json();
  const token = tokenJson.access_token;
  if (!token) throw new Error('cdn-access returned no access_token');

  // This is the exact sv3 1080p manifest family used by the working VLC V3 test.
  const manifestUrl =
    AV + '/api/v1/videos/' + id + '/manifest/index90-sv3-v1-a1.m3u8';

  const manifestResponse = await avFetch(manifestUrl, {
    headers: {
      'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*'
    }
  });

  const manifestText = await manifestResponse.text();
  const rewritten = rewriteAv01Manifest(
    manifestText,
    manifestResponse.url,
    token
  );

  console.log('[AV01_PLAY]', JSON.stringify({
    id,
    manifestStatus: manifestResponse.status,
    bytes: Buffer.byteLength(rewritten),
    mode: 'fresh-token-sv3-direct'
  }));

  return rewritten;
}

http.createServer = function patchedCreateServer(handler, ...rest) {
  return originalCreateServer(async (req, res) => {
    const path = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname
    );

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }

      if (path === '/manifest.json') {
        return sendJson(res, {
          id: 'community.missav.hls.test',
          version: '0.5.0-av01-playback',
          name: 'MissAV 1080p',
          description: 'MissAV + original IkiSoda + AV01 play-on-demand test',
          resources: ['catalog', 'meta', 'stream'],
          types: ['movie'],
          catalogs: [
            {type: 'movie', id: 'missav-1080', name: 'MissAV · Verified 1080p'},
            {type: 'movie', id: 'ikisoda', name: 'ikisoda'},
            {type: 'movie', id: 'av01-test', name: 'Test AV01'}
          ],
          idPrefixes: ['missav:', 'ikisoda:', 'av01:']
        });
      }

      if (path === '/catalog/movie/av01-test.json') {
        const items = await avItems();
        return sendJson(res, {metas: items.map(avMeta)});
      }

      let match = path.match(/^\/meta\/movie\/av01:(\d+)\.json$/);
      if (match) {
        const items = await avItems();
        const item = items.find(x => String(x.id) === match[1]);
        return item
          ? sendJson(res, {meta: avMeta(item)})
          : sendJson(res, {error: 'Not found'}, 404);
      }

      match = path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);
      if (match) {
        const id = Number(match[1]);
        if (!AV_IDS.includes(id)) return sendJson(res, {streams: []}, 404);

        // Nuvio gets a local resolver URL. It does NOT receive a stale token.
        return sendJson(res, {
          streams: [{
            name: 'AV01 · Native HLS · fresh on Play',
            title: 'AV01 ' + id + ' · resolve fresh HLS',
            url: '/av01/' + id + '/master.m3u8',
            behaviorHints: {
              notWebReady: true,
              proxyHeaders: {
                request: {
                  Referer: AV + '/',
                  'User-Agent': 'Mozilla/5.0'
                }
              }
            }
          }]
        });
      }

      match = path.match(/^\/av01\/(\d+)\/master\.m3u8$/);
      if (match) {
        const id = Number(match[1]);
        if (!AV_IDS.includes(id)) return sendJson(res, 'unknown AV01 id', 404);

        const playlist = await resolveAv01(id);
        res.writeHead(200, {
          ...cors,
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(playlist)
        });
        return res.end(playlist);
      }

      // Backward-compatible alias for clients that cached the temporary route.
      match = path.match(/^\/av01\/play\/(\d+)\.m3u8$/);
      if (match) {
        const id = Number(match[1]);
        if (!AV_IDS.includes(id)) return sendJson(res, 'unknown AV01 id', 404);
        const playlist = await resolveAv01(id);
        res.writeHead(200, {
          ...cors,
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(playlist)
        });
        return res.end(playlist);
      }

      return handler(req, res);
    } catch (error) {
      console.error('[AV01_PLAY_ERROR]', JSON.stringify({
        path,
        type: error?.name || 'Error',
        message: error?.message || String(error)
      }));
      return sendJson(res, {
        error: 'AV01 playback resolver failed',
        message: error?.message || String(error)
      }, 502);
    }
  }, ...rest);
};
