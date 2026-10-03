import { chromium } from 'playwright';
import fs from 'node:fs';

const id = process.argv[2];
if (!/^\d+$/.test(id || '')) {
  console.error('Usage: npm run probe:av01 -- 221293');
  process.exit(2);
}

const url = `https://www.av01.media/en/video/${id}/`;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146 Safari/537.36'
});
const page = await context.newPage();

const rows = [];
const started = Date.now();
const add = (type, req, extra = {}) => {
  const u = req.url();
  if (!/m3u8|m4s|mp4|manifest|cdn-access|geo\.js|stream|video/i.test(u)) return;
  const h = req.headers();
  rows.push({
    t_ms: Date.now() - started,
    type,
    method: req.method(),
    url: u,
    resourceType: req.resourceType(),
    headers: {
      referer: h.referer || null,
      origin: h.origin || null,
      range: h.range || null,
      cookie: h.cookie ? '[REDACTED]' : null,
      authorization: h.authorization ? '[REDACTED]' : null,
      userAgent: h['user-agent'] || null
    },
    ...extra
  });
  console.log(JSON.stringify(rows.at(-1)));
};

page.on('request', req => add('request', req));
page.on('response', async res => {
  const req = res.request();
  if (!/m3u8|m4s|mp4|manifest|cdn-access|geo\.js|stream|video/i.test(res.url())) return;
  add('response', req, { status: res.status(), responseUrl: res.url() });
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('[PAGE_READY]', url);
console.log("[ACTION] Click the site Play button. Capture runs for 20 seconds.");

await page.waitForTimeout(20000);

fs.writeFileSync(`av01-web-probe-${id}.json`, JSON.stringify({
  id,
  page: url,
  capturedAt: new Date().toISOString(),
  events: rows
}, null, 2));

console.log(`[SAVED] av01-web-probe-${id}.json`);
await browser.close();
