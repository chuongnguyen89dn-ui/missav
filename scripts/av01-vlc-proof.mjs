#!/usr/bin/env node
import fs from "node:fs/promises";
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
    try { return require("node:fs").existsSync(p); } catch { return false; }
  });
}

const geo = await getGeo();
const token = await getToken(geo);
const claims = jwtPayload(token);

const master = new URL(`/api/v1/videos/${VIDEO_ID}/manifest/master.m3u8`, BASE);
const mr = await fetch(master, {headers:{ "User-Agent":UA, Referer:BASE+"/" }});
if (!mr.ok) throw new Error("master HTTP " + mr.status);
const text = await mr.text();

const signed = rewriteM3U8(text, master, token);
const file = path.join(os.tmpdir(), `av01-${VIDEO_ID}-signed-${Date.now()}.m3u8`);
await fs.writeFile(file, signed, "utf8");

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
const p = spawnSync(vlc, ["--no-video-title-show", "--play-and-exit", file], {stdio:"inherit"});
console.log("\nVLC exit code:", p.status);
if (p.status !== 0) process.exitCode = p.status ?? 1;
