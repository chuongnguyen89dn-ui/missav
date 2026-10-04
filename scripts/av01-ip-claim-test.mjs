#!/usr/bin/env node
import fs from "node:fs/promises";

const VIDEO_ID = process.argv[2] || "221293";
const MODE = process.argv[3] || "--show-geo";
const TARGET_IP = process.argv[4] || "";

const BASE = "https://www.av01.media";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

function jwtPayload(token) {
  const p = token.split(".");
  if (p.length !== 3) throw new Error("access_token không phải JWT 3 phần");
  const s = p[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(s + "=".repeat((4 - s.length % 4) % 4), "base64").toString("utf8"));
}

function redact(s) {
  return s ? String(s).slice(0, 8) + "...[redacted]" : "";
}

async function getGeo() {
  const r = await fetch("https://files.iw01.xyz/edge/geo.js?json", {
    headers: { "User-Agent": UA, Origin: BASE, Referer: BASE + "/" }
  });
  if (!r.ok) throw new Error(`geo.js HTTP ${r.status}`);
  return await r.json();
}

async function issue(ip) {
  const geo = await getGeo();
  const params = new URLSearchParams({
    token_v2: geo.token_v2,
    expires: String(geo.expires),
    ip
  });

  const u = `https://customers.iw01.xyz/api/v1/videos/${encodeURIComponent(VIDEO_ID)}/cdn-access?${params}`;
  const r = await fetch(u, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*",
      Origin: BASE,
      Referer: BASE + "/"
    }
  });

  const body = await r.text();
  if (!r.ok) throw new Error(`cdn-access HTTP ${r.status}: ${body.slice(0, 300)}`);

  const j = JSON.parse(body);
  if (!j.access_token) throw new Error("cdn-access không trả access_token");

  const claims = jwtPayload(j.access_token);
  return { geo, requestedIp: ip, claims, accessToken: j.access_token };
}

async function showGeo() {
  const geo = await getGeo();
  console.log("geo.js:");
  console.log(JSON.stringify({
    ip: geo.ip,
    expires: geo.expires,
    token_v2_present: Boolean(geo.token_v2)
  }, null, 2));
}

async function issueFor(ip) {
  const result = await issue(ip);
  const out = {
    videoId: VIDEO_ID,
    requestedIp: result.requestedIp,
    issuedAt: new Date().toISOString(),
    tokenClaims: result.claims,
    accessToken: result.accessToken
  };
  const path = "av01-target-token.json";
  await fs.writeFile(path, JSON.stringify(out, null, 2), "utf8");

  console.log("\ncdn-access trả HTTP 200.");
  console.log("requested IP :", result.requestedIp);
  console.log("JWT ip       :", result.claims.ip ?? "(không có)");
  console.log("JWT iat      :", result.claims.iat ?? "(không có)");
  console.log("JWT exp      :", result.claims.exp ?? "(không có)");
  console.log("JWT sub      :", result.claims.sub ?? "(không có)");
  console.log("token        :", redact(result.accessToken));
  console.log("\nĐã lưu token vào: " + path);
  console.log("KHÔNG đăng file này công khai.");
  console.log("\nNếu JWT ip == requested IP, hãy copy file sang máy/mạng IP đó và chạy:");
  console.log("  node scripts/av01-ip-claim-test.mjs " + VIDEO_ID + " --test-token");
}

async function testToken() {
  const path = "av01-target-token.json";
  const raw = await fs.readFile(path, "utf8");
  const saved = JSON.parse(raw);
  const token = saved.accessToken;
  const claims = jwtPayload(token);

  const manifestUrl = `${BASE}/api/v1/videos/${encodeURIComponent(VIDEO_ID)}/manifest/index90-sv3-v1-a1.m3u8`;
  const mr = await fetch(manifestUrl, {
    headers: { "User-Agent": UA, Referer: BASE + "/" }
  });
  if (!mr.ok) throw new Error(`manifest HTTP ${mr.status}`);

  const lines = (await mr.text()).split(/\\r?\\n/);
  const segment = lines.find(x => x.trim() && !x.startsWith("#"));
  if (!segment) throw new Error("Không tìm thấy segment trong manifest");

  const media = new URL(segment.trim(), manifestUrl);
  media.searchParams.set("access_token", token);

  const t0 = performance.now();
  const r = await fetch(media, {
    headers: { "User-Agent": UA, Referer: BASE + "/" },
    signal: AbortSignal.timeout(15000)
  });
  const bytes = (await r.arrayBuffer()).byteLength;
  const sec = (performance.now() - t0) / 1000;

  console.log("JWT ip        :", claims.ip ?? "(không có)");
  console.log("JWT exp       :", claims.exp ?? "(không có)");
  console.log("HTTP segment  :", r.status);
  console.log("time          :", sec.toFixed(3) + "s");
  console.log("bytes         :", bytes);

  if (r.ok) {
    console.log("\nKẾT QUẢ: token được chấp nhận từ mạng đang chạy script.");
  } else {
    console.log("\nKẾT QUẢ: token không được chấp nhận từ mạng đang chạy script.");
  }
}

try {
  if (MODE === "--show-geo") await showGeo();
  else if (MODE === "--issue-for") {
    if (!TARGET_IP) throw new Error("Thiếu IP. Ví dụ: --issue-for 1.2.3.4");
    await issueFor(TARGET_IP);
  } else if (MODE === "--test-token") await testToken();
  else throw new Error("Mode: --show-geo | --issue-for <IP> | --test-token");
} catch (e) {
  console.error("ERROR:", e?.message || e);
  process.exitCode = 1;
}
