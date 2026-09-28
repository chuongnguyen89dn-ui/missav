#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname} from 'node:path';

const DEFAULT_ORIGIN='https://missav.ws';
const UA='Mozilla/5.0 (compatible; MissAV-link-diagnostic/1.0)';
const timeout=Number(process.env.FETCH_TIMEOUT_MS||12000);
const args=process.argv.slice(2);
const flag=(name,def=null)=>{const i=args.indexOf(name);return i<0?def:args[i+1]??def;};
const decode=s=>s.replace(/\\u002[fF]/g,'/').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&#x2f;/gi,'/').replace(/&#47;/g,'/').replace(/&quot;/g,'"');
const unique=a=>[...new Set(a.filter(Boolean))];
const clean=s=>decode(s).replace(/\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));
function urls(html,base){
 const decoded=clean(html), out=[];
 const patterns=[/https?:\/\/[^\s"'<>\\]+/gi,/(?:src|href|file|source|playlist|hls|url)\s*[:=]\s*["']([^"']+)["']/gi];
 for(const re of patterns){let m;while((m=re.exec(decoded))){let raw=(m[1]||m[0]).replace(/[),;]+$/,'');try{const u=new URL(raw,base);if(['http:','https:'].includes(u.protocol))out.push(u.href);}catch{}}}
 return unique(out);
}
function metadata(html,base){
 const ld=[];for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{ld.push(JSON.parse(m[1]));}catch{}}
 const tags={};for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const tag=m[0],key=tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1],value=tag.match(/content=["']([^"']*)["']/i)?.[1];if(key&&value)tags[key]=decode(value);}
 const title=tags['og:title']||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()||null;
 const image=tags['og:image']||null;
 return {title,description:tags['og:description']||tags.description||null,image:image?new URL(image,base).href:null,jsonLd:ld};
}
function extract(html,page){
 const all=urls(html,page), playlists=all.filter(u=>/\.m3u8(?:[?#]|$)/i.test(u)), media=all.filter(u=>/\.(?:mp4|mpd)(?:[?#]|$)/i.test(u));
 const ids=unique([...html.matchAll(/(?:surrit(?:\.mrstcdn\.store|\.com)?\/|["'])([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|["'])/gi)].map(m=>m[1].toLowerCase()));
 const code=page.match(/\/(?:[a-z]{2}\/)?([a-z]{2,12}[-_]?\d{2,8})(?:[/?#]|$)/i)?.[1]?.toUpperCase()||null;
 const mirrorCandidates=unique(playlists.filter(u=>new URL(u).hostname==='surrit.com').map(u=>u.replace('https://surrit.com/','https://surrit.mrstcdn.store/')));
 return {page,code,metadata:metadata(html,page),playlists,media,mirrorCandidates,uuids:ids,notes:['Candidates extracted from page HTML; dynamic browser requests may be absent.','Mirror URLs are hypotheses until independently checked.','No video is downloaded or proxied by this script.']};
}
async function get(url,headers={}){const r=await fetch(url,{headers:{'User-Agent':UA,Referer:DEFAULT_ORIGIN+'/',...headers},signal:AbortSignal.timeout(timeout)});return r;}
async function probe(url,page){try{const r=await get(url,{Referer:page||DEFAULT_ORIGIN+'/'});const body=(await r.text()).slice(0,100000);return {url,status:r.status,contentType:r.headers.get('content-type'),playlistValid:r.ok&&body.trimStart().startsWith('#EXTM3U'),note:'Playlist only; segments and Nuvio playback not verified'};}catch(e){return {url,status:null,playlistValid:false,error:e.name};}}
async function main(){
 const page=flag('--url'),input=flag('--html'),out=flag('--out','data/link-results.json'),check=args.includes('--probe');
 if(!page&&!input)throw Error('Usage: node scripts/extract-links.mjs --url https://missav.ws/... [--probe] [--out data/link-results.json] OR --html saved.html --base https://missav.ws/...');
 const base=page||flag('--base');if(!base)throw Error('--base required with --html');
 const parsed=new URL(base);if(!['https:','http:'].includes(parsed.protocol))throw Error('Only HTTP(S) page URLs supported');
 let html;if(input)html=await readFile(input,'utf8');else{const r=await get(base);if(!r.ok)throw Error('Page HTTP '+r.status);html=await r.text();}
 const result=extract(html,base);
 if(check)result.probes=await Promise.all([...result.playlists,...result.mirrorCandidates].slice(0,8).map(u=>probe(u,base)));
 await mkdir(dirname(out),{recursive:true});
 await writeFile(out,JSON.stringify({...result,extractedAt:new Date().toISOString()},null,2)+'\n');
 console.log(JSON.stringify({out,code:result.code,playlists:result.playlists.length,mirrorCandidates:result.mirrorCandidates.length,probes:result.probes?.length||0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
export {extract,urls};
