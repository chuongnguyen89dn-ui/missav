
import {readFileSync} from 'node:fs';
const verified = JSON.parse(readFileSync(new URL('./data/catalog-verified.json',import.meta.url),'utf8'));
const verifiedMetadata = JSON.parse(readFileSync(new URL('./data/metadata-verified-nuvio.json',import.meta.url),'utf8'));
const rawScan = Object.fromEntries(verified.map(f=>[f.url,f]));
const ikisodaCatalog = JSON.parse(readFileSync(new URL('./data/ikisoda-catalog.json',import.meta.url),'utf8'));
const filmById = new Map(verified.map(f=>['missav:'+f.code.toLowerCase(),f]));
function uniqNames(items){return [...new Set((items||[]).map(x=>typeof x==='string'?x:x?.name).map(x=>String(x||'').trim()).filter(Boolean))];}
function metaLinks(items,category){return (items||[]).filter(x=>x&&x.name).map(x=>({name:String(x.name).trim(),category,url:x.url||'stremio:///search?search='+encodeURIComponent(String(x.name).trim())}));}
function filmMeta(f){
 const m=verifiedMetadata[f.code]||{};
 const genres=uniqNames(m.genres).length?uniqNames(m.genres):(f.genres||'').split(',').map(x=>x.trim()).filter(Boolean);
 const cast=uniqNames(m.actresses);
 const director=uniqNames(m.directors);
 const date=m.release_date||f.release_date||'';
 const links=[
  ...metaLinks(m.actresses,'actor'),
  ...genres.map(name=>({name,category:'genre',url:'stremio:///search?search='+encodeURIComponent(name)})),
  ...metaLinks(m.directors,'director'),
  ...metaLinks(m.series,'series'),
  ...metaLinks(m.makers,'studio'),
  ...metaLinks(m.labels,'label')
 ];
 const meta={
  id:'missav:'+f.code.toLowerCase(),type:'movie',
  name:String(m.title||f.title||f.code).trim(),
  poster:m.poster||f.poster||undefined,posterShape:'poster',
  description:m.description||f.description||undefined,
  releaseInfo:date?date.slice(0,4):undefined,
  released:date?new Date(date+'T00:00:00.000Z').toISOString():undefined,
  genres,genre:genres,
  cast:cast.length?cast:undefined,
  director:director.length?director:undefined,
  language:'Tiếng Nhật',
  links
 };
 return Object.fromEntries(Object.entries(meta).filter(([,v])=>v!==undefined&&v!==''));
}
const publicManifest={id:'community.missav.hls.test',version:'0.4.0',name:'MissAV 1080p',description:'174 verified 1080p entries with Nuvio-native Vietnamese metadata',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'missav-1080',name:'MissAV · Verified 1080p'},{type:'movie',id:'ikisoda',name:'ikisoda'}],idPrefixes:['missav:','ikisoda:']};
const ikisodaMovies=ikisodaCatalog.movies||[];
const ikisodaById=new Map(ikisodaMovies.map(x=>[x.id,x]));
function ikisodaMetaFor(x){return {id:x.id,type:'movie',name:x.name,poster:x.poster,posterShape:'poster',releaseInfo:x.release.slice(0,4),released:new Date(x.release+'T00:00:00.000Z').toISOString(),genres:x.genres,genre:x.genres,description:[x.code,x.studio,x.duration].filter(Boolean).join(' · '),language:'Tiếng Nhật'};}
function ikisodaStreamFor(x){return [{name:'IkiSoda 1080p · CDN DIRECT',title:'1080p · verified HTTP 206 video/mp4',url:x.url,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:'https://ikisoda.com/','User-Agent':'Mozilla/5.0'}}}}];}
async function ikisodaResolve(req,res){
 const pageUrl='https://ikisoda.com/videos/hsm-061-hino-akari-s-cosplay-debut-erection-explosion/';
 try{
  const page=await fetch(pageUrl,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,*/*'},redirect:'follow',signal:AbortSignal.timeout(15000)});
  const html=await page.text();
  const raw=[...html.matchAll(/https?:\\?\/\\?\/ikisoda\.com\\?\/get_file\\?\/[^"'<>\\s]+?22675_1080p\.mp4\\?\/?(?:\\?[^"'<>\\s]*)?/gi)].map(m=>m[0].replaceAll('\\/','/').replaceAll('&amp;','&'));
  const getFile=raw[0];
  if(!getFile){console.log('[IKISODA_RESOLVE]',JSON.stringify({stage:'html',status:page.status,found:false}));return json(res,{error:'1080 URL not found in current IkiSoda page'},502);}
  const rnd=getFile.includes('?')?getFile:getFile+'?rnd='+Date.now();
  const headers={'User-Agent':'Mozilla/5.0','Referer':pageUrl,'Origin':'https://ikisoda.com'};
  const probe=await fetch(rnd,{headers:{...headers,Range:'bytes=0-1'},redirect:'manual',signal:AbortSignal.timeout(15000)});
  const location=probe.headers.get('location');
  console.log('[IKISODA_RESOLVE]',JSON.stringify({stage:'get_file',status:probe.status,hasLocation:!!location}));
  if(location){
   const signed=new URL(location,rnd).toString();
   res.writeHead(302,{...cors,location:signed,'cache-control':'no-store'});
   return res.end();
  }
  if(probe.ok||probe.status===206){
   res.writeHead(302,{...cors,location:rnd,'cache-control':'no-store'});return res.end();
  }
  return json(res,{error:'IkiSoda resolver failed',upstreamStatus:probe.status},502);
 }catch(e){console.error('[IKISODA_ERROR]',e.message);return json(res,{error:'IkiSoda unavailable',type:e.name,message:e.message},502);}
}
function publicStream(f){
 const source=f.streams_1080.find(s=>s.quality==='1080p'&&s.verification==='master_resolution_1080');
 const u=new URL(source.url);
 const mirror='https://surrit.mrstcdn.store'+u.pathname+u.search;
 return [{name:'Mirror 1080p · DIRECT · no Render bandwidth',title:'1080p · same successful test path',url:mirror,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'}}}}];
}
async function filmProxy(req,res,path){
 const match=path.match(new RegExp('^/play/([a-z0-9-]+)/(.+)$','i'));
 if(!match)return json(res,{error:'Invalid stream path'},400);
 const film=filmById.get('missav:'+match[1].toLowerCase());
 if(!film)return json(res,{error:'Unknown film'},404);
 const source=film.streams_1080.find(s=>s.quality==='1080p'&&s.verification==='master_resolution_1080');
 const sourceUrl=new URL(source.url);
 const basePath=sourceUrl.pathname.slice(0,sourceUrl.pathname.indexOf('/1080p/'))+'/';
 const suffix=match[2];
 if(suffix.split('/').some(x=>x==='..')||!new RegExp('^[a-zA-Z0-9_./-]+$').test(suffix))return json(res,{error:'Invalid media path'},400);
 const original=new URL(req.url,'http://localhost');
 const target=new URL(suffix+original.search,sourceUrl.origin+basePath);
 if(target.origin!==sourceUrl.origin||!target.pathname.startsWith(basePath))return json(res,{error:'Invalid upstream'},400);
 const headers={Referer:film.url||REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'};
 if(req.headers.range)headers.Range=req.headers.range;
 try{
  const upstream=await fetch(target,{headers,signal:AbortSignal.timeout(25000)});
  console.log('[FILM_HLS]',JSON.stringify({code:film.code,file:suffix,status:upstream.status,method:req.method}));
  if(!upstream.ok){res.writeHead(upstream.status,{...cors,'content-type':'text/plain'});return res.end('Upstream HTTP '+upstream.status);}
  const playlist=target.pathname.endsWith('.m3u8');
  const out={...cors,'content-type':playlist?'application/vnd.apple.mpegurl':upstream.headers.get('content-type')||'application/octet-stream','cache-control':'no-store'};
  for(const h of ['content-range','accept-ranges','content-length'])if(!playlist&&upstream.headers.has(h))out[h]=upstream.headers.get(h);
  if(playlist){
   const rewriteUri=(u)=>{
    const resolved=new URL(u,target);
    if(resolved.origin!==sourceUrl.origin||!resolved.pathname.startsWith(basePath))return u;
    return '/play/'+encodeURIComponent(film.code.toLowerCase())+'/'+resolved.pathname.slice(basePath.length)+resolved.search;
   };
   const body=(await upstream.text()).split(String.fromCharCode(10)).map(line=>{
    const trimmed=line.trim();
    if(!trimmed)return line;
    return trimmed.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,u)=>'URI="'+rewriteUri(u)+'"'):rewriteUri(trimmed);
   }).join(String.fromCharCode(10));
   res.writeHead(200,{...out,'content-length':Buffer.byteLength(body)});
   return res.end(req.method==='HEAD'?'':body);
  }
  res.writeHead(upstream.status,out);
  if(req.method==='HEAD')return res.end();
  const {Readable}=await import('node:stream');
  Readable.fromWeb(upstream.body).on('error',e=>{console.error('[FILM_HLS_PIPE]',film.code,e.message);res.destroy();}).pipe(res);
 }catch(e){console.error('[FILM_HLS_ERROR]',film.code,suffix,e.message);if(!res.headersSent)return json(res,{error:'Upstream unavailable',type:e.name},502);res.destroy();}
}

import http from 'node:http';
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.env.PUBLIC_URL?.replace(/\/$/, '') || '';
const VIDEO = 'https://surrit.com/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/1080p/video.m3u8';
const REF = 'https://missav.ws/';
const id = 'missav:fthtd-213';
const cors = {'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};
function json(res, data, status=200) { const body=JSON.stringify(data);res.writeHead(status, {...cors,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});res.end(body); }
const manifest={id:'community.missav.hls.test',version:'0.1.2',name:'MissAV HLS Test',description:'Isolated 1080p page-Referer HLS proxy test',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'missav-test',name:'Test 1080p'}],idPrefixes:['missav:']};
const meta={id,type:'movie',name:'FTHTD-213 — 1080p test',description:'Surrit HLS; playback requires Referer https://missav.ws/'};
const MIRROR_DIRECT = 'https://surrit.mrstcdn.store/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/1080p/video.m3u8';
const streams=[{name:'Mirror 1080p · DIRECT · no Render bandwidth',title:'1080p · Nuvio → mirror directly (test first)',url:MIRROR_DIRECT,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'}}}},{name:'Mirror 1080p · server proxy TEST',title:'1080p · mirror via Render (experimental)',url:(ROOT || 'https://missav-uimx.onrender.com')+'/mirror/1080p/video.m3u8'},{name:'Surrit 1080p · server proxy',title:'1080p · Render Referer proxy',url:(ROOT || 'https://missav-uimx.onrender.com')+'/hls/1080p/video.m3u8'},{name:'Surrit 1080p · direct headers',title:'1080p · Referer test',url:VIDEO,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'},response:{'Access-Control-Allow-Origin':'*'}}}}];
const HLS_BASE = 'https://surrit.com/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/';
async function proxyHls(req,res,path){
 const suffix=path.slice('/hls/'.length);
 if(!suffix || suffix.split('/').some(x=>x==='..') || !/^[a-zA-Z0-9_./-]+$/.test(suffix))return json(res,{error:'Invalid path'},400);
 const target=new URL(suffix,HLS_BASE);
 if(target.origin!=='https://surrit.com' || !target.pathname.startsWith(new URL(HLS_BASE).pathname))return json(res,{error:'Invalid upstream'},400);
 try{
 const headers={Referer:'https://missav.ws/vi/fthtd-213', 'User-Agent':'Mozilla/5.0'};
 if(req.headers.range)headers.Range=req.headers.range;
 const upstream=await fetch(target,{headers,signal:AbortSignal.timeout(25000)});
 if(!upstream.ok){console.log('[HLS_UPSTREAM]',JSON.stringify({path:suffix,status:upstream.status,referer:headers.Referer,origin:headers.Origin||null}));res.writeHead(upstream.status,{...cors,'content-type':'text/plain'});return res.end('Upstream HTTP '+upstream.status); }
 const playlist=suffix.endsWith('.m3u8');
 const outHeaders={...cors,'content-type':playlist?'application/vnd.apple.mpegurl':(upstream.headers.get('content-type')||'application/octet-stream'),'cache-control':'no-store'};
 for(const h of ['content-range','accept-ranges','content-length'])if(upstream.headers.has(h)&&!playlist)outHeaders[h]=upstream.headers.get(h);
 if(playlist){
 console.log('[HLS_PLAYLIST_OK]',JSON.stringify({path:suffix,status:upstream.status}));
 let body=await upstream.text();
 body=body.split(/(\r?\n)/).map(line=>{
 const t=line.trim();
 if(!t)return line;
 if(t.startsWith('#')){
 return line.replace(/URI="([^"]+)"/g,(_,u)=>'URI="'+rewrite(u,target)+'"');
 }
 return rewrite(t,target);
 }).join('');
 res.writeHead(200,{...outHeaders,'content-length':Buffer.byteLength(body)});return res.end(body);
 }
 res.writeHead(upstream.status,outHeaders);
 if(req.method==='HEAD')return res.end();
 const {Readable}=await import('node:stream');
 Readable.fromWeb(upstream.body).on('error',()=>res.destroy()).pipe(res);
 }catch(e){if(!res.headersSent)json(res,{error:'Upstream unavailable'},502);else res.destroy();}
}
function rewrite(value,base){
 const url=new URL(value,base);
 if(url.origin!=='https://surrit.com'||!url.pathname.startsWith(new URL(HLS_BASE).pathname))return value;
 return '/hls/'+url.pathname.slice(new URL(HLS_BASE).pathname.length)+url.search;
}
async function diagnose(req,res){
 const target=new URL('1080p/video.m3u8',HLS_BASE);
 const started=Date.now();
 try{
  const upstream=await fetch(target,{headers:{Referer:REF,Origin:'https://missav.ws/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
  const body=await upstream.text();
  const isPlaylist=body.trimStart().startsWith('#EXTM3U');
  return json(res,{test:'FTHTD-213 Surrit 1080p from Render',upstreamStatus:upstream.status,upstreamContentType:upstream.headers.get('content-type'),playlistValid:isPlaylist,playlistLines:isPlaylist?body.split(/\r?\n/).length:0,elapsedMs:Date.now()-started,bodyPreview:isPlaylist?body.slice(0,240):body.slice(0,160),note:upstream.status===403?'Surrit rejected the request from Render':'This checks playlist only, not segment playback'});
 }catch(e){return json(res,{test:'FTHTD-213 Surrit 1080p from Render',upstreamStatus:null,playlistValid:false,error:e?.name||'FetchError',message:e?.message||'Unknown',elapsedMs:Date.now()-started},502);}
}
async function diagnoseMirrors(req,res){
 const candidates=[
  {name:'Original Surrit',url:'https://surrit.com/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/1080p/video.m3u8'},
  {name:'Reported mirror (unverified)',url:'https://surrit.mrstcdn.store/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/1080p/video.m3u8'}
 ];
 const results=await Promise.all(candidates.map(async c=>{
  const started=Date.now();
  try{
   const response=await fetch(c.url,{headers:{Referer:REF,Origin:'https://missav.ws/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(12000),redirect:'follow'});
   const body=await response.text();
   const playlistValid=response.ok&&body.trimStart().startsWith('#EXTM3U');
   return {name:c.name,host:new URL(c.url).hostname,status:response.status,contentType:response.headers.get('content-type'),playlistValid,elapsedMs:Date.now()-started,preview:playlistValid?body.slice(0,120):body.slice(0,80),note:playlistValid?'Playlist accessible; segments and Nuvio playback NOT tested':'Not a verified playable source'};
  }catch(e){return {name:c.name,host:new URL(c.url).hostname,status:null,playlistValid:false,error:e.name,message:e.message,elapsedMs:Date.now()-started};}
 }));
 return json(res,{film:'FTHTD-213',test:'candidate 1080p playlist hosts from Render',results,warning:'A playlist HTTP 200 is not proof of segment access or Nuvio playback'});
}
const MIRROR_BASE = 'https://surrit.mrstcdn.store/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/';
async function mirrorProxy(req,res,path){
 const suffix=path.slice('/mirror/'.length);
 if(!suffix||suffix.split('/').some(x=>x==='..')||!/^[a-zA-Z0-9_./-]+$/.test(suffix))return json(res,{error:'Invalid path'},400);
 const base=new URL(MIRROR_BASE), target=new URL(suffix+new URL(req.url,'http://localhost').search,base);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))return json(res,{error:'Invalid upstream'},400);
 try{
  const headers={Referer:REF,Origin:'https://missav.ws/','User-Agent':'Mozilla/5.0'};
  if(req.headers.range)headers.Range=req.headers.range;
  const upstream=await fetch(target,{headers,signal:AbortSignal.timeout(25000)});
  if(!upstream.ok){console.log('[MIRROR_UPSTREAM]',JSON.stringify({path:suffix,status:upstream.status}));return json(res,{error:'Mirror upstream error',status:upstream.status},upstream.status);}
  const playlist=suffix.endsWith('.m3u8');
  const out={...cors,'content-type':playlist?'application/vnd.apple.mpegurl':upstream.headers.get('content-type')||'application/octet-stream','cache-control':'no-store'};
  for(const h of ['content-range','accept-ranges','content-length'])if(!playlist&&upstream.headers.has(h))out[h]=upstream.headers.get(h);
  if(playlist){
   const body=(await upstream.text()).split(/(\r?\n)/).map(line=>{
    const rewriteMirror=u=>{const v=new URL(u,target);return v.origin===base.origin&&v.pathname.startsWith(base.pathname)?'/mirror/'+v.pathname.slice(base.pathname.length)+v.search:u;};
    const t=line.trim();
    return !t?line:t.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,u)=>'URI="'+rewriteMirror(u)+'"'):rewriteMirror(t);
   }).join('');
   res.writeHead(200,{...out,'content-length':Buffer.byteLength(body)});return res.end(req.method==='HEAD'?'':body);
  }
  res.writeHead(upstream.status,out);
  if(req.method==='HEAD')return res.end();
  const {Readable}=await import('node:stream');
  Readable.fromWeb(upstream.body).on('error',()=>res.destroy()).pipe(res);
 }catch(e){if(!res.headersSent)return json(res,{error:'Mirror unavailable',type:e.name},502);res.destroy();}
}
async function diagnoseMirrorSegments(req,res){
 const base=new URL(MIRROR_BASE), target=new URL('1080p/video.m3u8',base);
 const headers={Referer:REF,Origin:'https://missav.ws/','User-Agent':'Mozilla/5.0'};
 try{
  const playlistResponse=await fetch(target,{headers,signal:AbortSignal.timeout(12000)});
  const body=await playlistResponse.text();
  if(!playlistResponse.ok||!body.trimStart().startsWith('#EXTM3U'))return json(res,{playlistStatus:playlistResponse.status,playlistValid:false},502);
  const lines=body.split(/\r?\n/);
  const first=lines.map(x=>x.trim()).find(x=>x&&!x.startsWith('#'));
  const key=lines.join('\n').match(/#EXT-X-KEY:[^\n]*URI="([^"]+)"/)?.[1];
  const sample=async (name,uri)=>{
   if(!uri)return {name,available:false,reason:'No URI in playlist'};
   const url=new URL(uri,target);
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return {name,available:false,reason:'External URL; not fetched',host:url.hostname};
   try{
    const r=await fetch(url,{headers:{...headers,Range:'bytes=0-1023'},signal:AbortSignal.timeout(12000)});
    const type=r.headers.get('content-type');const sampleBytes=new Uint8Array(await r.arrayBuffer());
    return {name,status:r.status,contentType:type,bytesRead:sampleBytes.length,available:r.ok&&sampleBytes.length>0};
   }catch(e){return {name,available:false,error:e.name,message:e.message};}
  };
  const checks=await Promise.all([sample('first media entry',first),...(key?[sample('encryption key',key)]:[])]);
  return json(res,{film:'FTHTD-213',playlistStatus:playlistResponse.status,playlistValid:true,hasKey:!!key,checks,note:'Only first media entry sampled; Nuvio playback still requires testing'});
 }catch(e){return json(res,{error:e.name,message:e.message},502);}
}
http.createServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
if(path==='/' || path==='/health')return json(res,{status:'ok',manifest:ROOT?ROOT+'/manifest.json':'/manifest.json',verified:verified.length,source:'Verified 1080p catalog; direct headers'});
if(path==='/diagnose-mirror-segments.json')return diagnoseMirrorSegments(req,res);
if(path.startsWith('/mirror/'))return mirrorProxy(req,res,path);
if(path==='/diagnose-mirrors.json')return diagnoseMirrors(req,res);
if(path==='/diagnose' || path==='/diagnose.json')return diagnose(req,res);
if(path.startsWith('/hls/'))return proxyHls(req,res,path);
if(path.startsWith('/play/'))return filmProxy(req,res,path);
if(path==='/manifest.json')return json(res,publicManifest);
if(path==='/catalog/movie/missav-1080.json')return json(res,{metas:verified.map(filmMeta)});
if(path==='/catalog/movie/ikisoda.json')return json(res,{metas:ikisodaMovies.map(ikisodaMetaFor)});
if(path.startsWith('/meta/movie/ikisoda:')&&path.endsWith('.json')){const x=ikisodaById.get(path.slice('/meta/movie/'.length,-5));return x?json(res,{meta:ikisodaMetaFor(x)}):json(res,{error:'Not found'},404);}
if(path.startsWith('/stream/movie/ikisoda:')&&path.endsWith('.json')){const x=ikisodaById.get(path.slice('/stream/movie/'.length,-5));return x?json(res,{streams:ikisodaStreamFor(x)}):json(res,{streams:[]});}
if(path==='/ikisoda/hsm-061.mp4')return ikisodaResolve(req,res);

if(path.startsWith('/meta/movie/missav:')&&path.endsWith('.json')){const f=filmById.get(path.slice('/meta/movie/'.length,-5));return f?json(res,{meta:filmMeta(f)}):json(res,{error:'Not found'},404);}
if(path.startsWith('/stream/movie/missav:')&&path.endsWith('.json')){const f=filmById.get(path.slice('/stream/movie/'.length,-5));return f?json(res,{streams:publicStream(f)}):json(res,{streams:[]});}
if(path==='/catalog-status.json')return json(res,{total:Object.keys(rawScan).length,verified:verified.length,excluded:Object.keys(rawScan).length-verified.length});
if(path==='/catalog/movie/missav-test.json')return json(res,{metas:[meta]});
if(path==='/meta/movie/'+id+'.json')return json(res,{meta});
if(path==='/stream/movie/'+id+'.json')return json(res,{streams});
return json(res,{error:'Not found'},404);
}).listen(PORT,'0.0.0.0',()=>console.log('Test addon listening on '+PORT));
