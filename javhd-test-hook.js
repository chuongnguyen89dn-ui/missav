import http from 'node:http';

const originalCreateServer = http.createServer.bind(http);
const TEST_ID = 'javhd:dsod-044-test';

// KEEP the exact direct HLS that was already proven to play. Do not replace the
// playback path while metadata work is being validated.
const TEST_HLS = 'https://stream4.javhdz.today/universal-stream-hls/f8d4829651b46962abb1652dd557b9185cdff94e/playlist.m3u8';
const SOURCE_PAGE = 'https://www.javhd.today/vi/368572/mosaic-dsod-044-welfare-full-erection-addiction-hidamari-garden-riho-a-medical-care-worker-devotedly-manages-the-release-of-a-sexually-insatiable-elderly-man-suffering-from-severe-ejaculation-addiction-shishido-riho/';
const POSTER = 'https://pics.javhd.today/videos/tmb/000/368/572/1.jpg';
const SNAPSHOTS = Array.from({length: 8}, (_, i) =>
  `https://pics.dmm.co.jp/digital/video/dsod00044/dsod00044jp-${i + 1}.jpg`
);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*'
};

const testMeta = {
  id: TEST_ID,
  type: 'movie',
  name: 'DSOD-044 · Shishido Riho',
  poster: POSTER,
  posterShape: 'poster',
  language: 'Japanese',
  genres: ['JAVHD', 'DSOD'],
  cast: ['Shishido Riho'],
  description: 'DSOD-044 · Shishido Riho. JAVHD single-movie validation entry. Direct HLS playback remains pinned to the stream4 URL that already passed the addon playback test.',
  website: SOURCE_PAGE,
  background: SNAPSHOTS[7],
  logo: POSTER,
  behaviorHints: {
    defaultVideoId: TEST_ID,
    hasScheduledVideos: false
  },
  // Keep the complete discovered sample set available to clients/tools that
  // preserve extra metadata fields. Stremio-compatible clients simply ignore it.
  snapshots: SNAPSHOTS,
  javhd: {
    sourceId: '368572',
    code: 'DSOD-044',
    source: SOURCE_PAGE,
    snapshots: SNAPSHOTS,
    metadataStatus: 'partial-verified',
    note: 'Unknown fields such as runtime/release date are intentionally not invented.'
  }
};

const testStreams = [{
  name: 'JAVHD · Myserver HLS',
  title: 'DSOD-044 · stream4.javhdz.today · direct HLS',
  url: TEST_HLS,
  behaviorHints: {
    notWebReady: true,
    proxyHeaders: {request: {
      Referer: SOURCE_PAGE,
      Origin: 'https://www.javhd.today',
      'User-Agent': 'Mozilla/5.0'
    }}
  }
}];

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

http.createServer = function patchedCreateServer(handler, ...rest) {
  return originalCreateServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (path === '/manifest.json') {
      return sendJson(res, {
        id: 'community.missav.hls.test',
        version: '0.4.2-javhd-metadata',
        name: 'MissAV 1080p',
        description: 'MissAV addon + isolated JAVHD DSOD-044 playback/metadata validation',
        resources: ['catalog', 'meta', 'stream'],
        types: ['movie'],
        catalogs: [
          {type: 'movie', id: 'missav-1080', name: 'MissAV · Verified 1080p'},
          {type: 'movie', id: 'ikisoda', name: 'ikisoda'},
          {type: 'movie', id: 'javhd-test', name: 'JAVHD · TEST 1 PHIM'}
        ],
        idPrefixes: ['missav:', 'ikisoda:', 'javhd:']
      });
    }
    if (path === '/catalog/movie/javhd-test.json') return sendJson(res, {metas: [testMeta]});
    if (path === `/meta/movie/${TEST_ID}.json`) return sendJson(res, {meta: testMeta});
    if (path === `/stream/movie/${TEST_ID}.json`) return sendJson(res, {streams: testStreams});
    return handler(req, res);
  }, ...rest);
};
