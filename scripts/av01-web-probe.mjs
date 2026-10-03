import { chromium } from 'playwright';
import fs from 'node:fs';

const id = process.argv[2];
const waitMinutes = Number(process.argv[3] || 35);

if (!/^\\d+$/.test(id || '')) {
  console.error('Usage: npm run probe:av01 -- 221293 [minutes]');
  process.exit(2);
}

const url = `https://www.av01.media/en/video/${id}/`;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'
});
const page = await context.newPage();

const events = [];
const started = Date.now();

function redact(u) {
  try {
    const x = new URL(u);
    for (const k of ['access_token', 'token_v2', 'token', 'hb']) {
      if (x.searchParams.has(k)) x.searchParams.set(k, '[REDACTED]');
    }
    return x.toString();
  } catch { return u; }
}

function parseJwtExp(u) {
  try {
    const token = new URL(u).searchParams.get('access_token');
    if (!token || token.split('.').length !== 3) return null;
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return { iat: p.iat || null, exp: p.exp || null, ip: p.ip || null, sub: p.sub || null };
  } catch { return null; }
}

function record(kind, req, extra = {}) {
  const raw = req.url();
  if (!/geo\\.js|cdn-access|manifest|m3u8|m4s|init\\.mp4|access_token/i.test(raw)) return;
  const h = req.headers();
  const row = {
    t_ms: Date.now() - started,
    kind,
    method: req.method(),
    url: redact(raw),
    resourceType: req.resourceType(),
    headers: {
      referer: h.referer || null,
      origin: h.origin || null,
      range: h.range || null,
      cookiePresent: !!h.cookie,
      authorizationPresent: !!h.authorization
    },
    tokenClaims: parseJwtExp(raw),
    ...extra
  };
  events.push(row);
  console.log(JSON.stringify(row));
}

page.on('request', req => record('request', req));
page.on('response', async res => {
  const req = res.request();
  const raw = req.url();
  if (!/geo\\.js|cdn-access|manifest|m3u8|m4s|init\\.mp4|access_token/i.test(raw)) return;
  record('response', req, { status: res.status(), responseUrl: redact(res.url()) });
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('[PAGE_READY]', url);
console.log('[ACTION] Click Play once. The probe will observe the whole session for', waitMinutes, 'minutes.');
console.log('[ACTION] Do not close the browser. If AV01 refreshes credentials, it will appear as geo.js/cdn-access events.');

await page.waitForTimeout(waitMinutes * 60 * 1000);

fs.writeFileSync(`av01-web-probe-${id}-lifecycle.json`, JSON.stringify({
  id,
  page: url,
  durationMinutes: waitMinutes,
  capturedAt: new Date().toISOString(),
  events
}, null, 2));

console.log(`[SAVED] av01-web-probe-${id}-lifecycle.json`);
await browser.close();
