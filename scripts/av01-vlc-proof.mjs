#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const VIDEO_ID = process.argv[2] || "221293";
const BASE = "https://www.av01.media";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

function jwtPayload(token) {
  const p = token.split(".");
  const s = p[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(s + "=".repeat((4 - s.length % 4) % 4), "base64").toString("utf8"));
}
function sign(raw, token) {
  const u = new URL(raw, BASE);
  if (u.hostname.endsWith("iw01.xyz")) u.searchParams.set("access_token", token);
  return u.toString();
}
function rewriteM3U8(txt, base, token) {
  return txt.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/g, (_, x) => `URI="${sign(new URL(x, base), token)}"`);
    }
    if (!line.trim().startsWith("#")) return sign(new URL(line.trim(), base), token);
    return line;
  }).join("\n");
}
async function getGeo() {
  const r = await fetch("https://files.iw01.xyz/edge/geo.js?json", {headers:{ "User-Agent":UA, Referer:BASE+"/" }});
  if (!r.ok) throw new Error("geo.js HTTP " + r.status);
  return r.json();
}
async function getToken(geo) {
  const u = new URL(`https://customers.iw01.xyz/api/v1/videos/${VIDEO_ID}/cdn-access`);
  u.searchParams.set("token_v2", geo.token_v2);
  u.searchParams.set("expires", geo.expires);
  u.searchParams.set("ip", geo.ip);
  const r = await fetch(u, {headers:{ "User-Agent":UA, Referer:BASE+"/", Accept:"application/json,*/*" }});
  if (!r.ok) throw new Error("cdn-access HTTP " + r.status + ": " + (await r.text()).slice(0,200));
  const j = await r.json();
  if (!j.access_token) throw new Error("cdn-access không trả access_token");
  return j.access_token;
}
function findVlc() {
  const candidates = [
    process.env.VLC_PATH,
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"
  ].filter(Boolean);
  return candidates.find(p => {
    return existsSync(p);
  });
}

const geo = await getGeo();
const token = await getToken(geo);
const claims = jwtPayload(token);

const master = new URL(`/api/v1/videos/${VIDEO_ID}/manifest/master.m3u8`, BASE);
const mr = await fetch(master, {headers:{ "User-Agent":UA, Referer:BASE+"/" }});
if (!mr.ok) throw new Error("master HTTP " + mr.status);
const masterText = await mr.text();

function chooseVariant(masterText, baseURL) {
  const lines = masterText.split(/\\r?\\n/);
  let best = null;
  let bandwidth = 0;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const m = line.match(/(?:^|,)BANDWIDTH=(\\d+)/);
      bandwidth = m ? Number(m[1]) : 0;
      continue;
    }
    if (bandwidth > 0 && line.trim() && !line.startsWith("#")) {
      const u = new URL(line.trim(), baseURL);
      if (!best || bandwidth > best.bandwidth) best = { bandwidth, url: u };
      bandwidth = 0;
    }
  }
  return best?.url ?? baseURL;
}

const mediaURL = chooseVariant(masterText, master);
const mediaResponse = await fetch(mediaURL, {
  headers: { "User-Agent": UA, Referer: BASE + "/" }
});
if (!mediaResponse.ok) throw new Error("media playlist HTTP " + mediaResponse.status);
const mediaText = await mediaResponse.text();

// The token belongs on CDN objects (customers.iw01.xyz). Sign the MEDIA
// playlist's init/segment/key URI attributes, not the public variant URL.
const signed = rewriteM3U8(mediaText, mediaURL, token);
const file = path.join(os.tmpdir(), `av01-${VIDEO_ID}-signed-${Date.now()}.m3u8`);
await fs.writeFile(file, signed, "utf8");

// Preflight the first CDN object so a 403 is caught before VLC starts.
const firstObject = signed.split(/\\r?\\n/)
  .map(x => x.trim())
  .find(x => x && !x.startsWith("#") && x.includes("iw01.xyz"));
if (!firstObject) throw new Error("Không tìm thấy CDN object đã ký trong media playlist");
const firstObjectResponse = await fetch(firstObject, {
  headers: { "User-Agent": UA, Referer: BASE + "/" }
});
console.log("first CDN object HTTP:", firstObjectResponse.status);
if (!firstObjectResponse.ok) {
  throw new Error("CDN object preflight HTTP " + firstObjectResponse.status);
}
console.log("AV01 VLC proof");
console.log("video:", VIDEO_ID);
console.log("geo IP:", geo.ip);
console.log("JWT IP:", claims.ip);
console.log("JWT exp:", claims.exp);
console.log("signed playlist:", file);

const vlc = findVlc();
if (!vlc) {
  console.log("\nVLC chưa tìm thấy.");
  console.log("Mở file trên bằng VLC thủ công:");
  console.log(file);
  process.exit(2);
}

console.log("\nĐang mở VLC...");
const out = path.join(os.tmpdir(), `av01-${VIDEO_ID}-vlc-proof-${Date.now()}.mp4`);
const log = path.join(os.tmpdir(), `av01-${VIDEO_ID}-vlc-proof-${Date.now()}.log`);
const args = [
  "--intf", "dummy",
  "--no-video-title-show",
  "--verbose=2",
  "--run-time=15",
  "--play-and-exit",
  "--sout", `#transcode{vcodec=h264,acodec=mp4a}:std{access=file,mux=mp4,dst=${out}}`,
  file
];
const p = spawnSync(vlc, args, {encoding:"utf8"});
await fs.writeFile(log, (p.stdout || "") + "\n" + (p.stderr || ""), "utf8");
const stat = await fs.stat(out).catch(() => null);
console.log("\nVLC exit code:", p.status);
console.log("proof output:", out);
console.log("proof bytes:", stat?.size ?? 0);
console.log("VLC log:", log);

if (p.status !== 0 || !stat || stat.size < 100000) {
  console.log("\nPLAYBACK PROOF: FAIL");
  console.log("Không coi exit code là bằng chứng playback.");
  console.log("Xem log:", log);
  process.exitCode = 1;
} else {
  console.log("\nPLAYBACK PROOF: PASS");
  console.log("VLC đã decode/transcode được HLS thành MP4 trong 15 giây.");
}