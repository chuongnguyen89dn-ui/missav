import { chromium } from 'playwright';
import http from 'node:http';
const originalCreateServer=http.createServer.bind(http);const AV='https://www.av01.media';const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};let cache={at:0,items:[]};
const avProxySessions=new Map();
let avBrowserPromise=null;
let avBrowserContextPromise=null;
const avMediaCache=new Map();
const avMediaInflight=new Map();
const AV_MEDIA_CACHE_MAX=8;

async function avBrowser(){
  if(!avBrowserPromise) avBrowserPromise=chromium.launch({headless:true});
  return avBrowserPromise;
}
async function avBrowserContext(){
  if(!avBrowserContextPromise){
    avBrowserContextPromise=(async()=>{
      const browser=await avBrowser();
      return browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        extraHTTPHeaders:{Referer:AV+'/'}
      });
    })();
  }
  return avBrowserContextPromise;
}
function avCacheGet(key){
  const v=avMediaCache.get(key);
  if(!v)return null;
  avMediaCache.delete(key);avMediaCache.set(key,v);
  return v;
}
function avCachePut(key,v){
  avMediaCache.delete(key);avMediaCache.set(key,v);
  while(avMediaCache.size>AV_MEDIA_CACHE_MAX)avMediaCache.delete(avMediaCache.keys().next().value);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function avBrowserFetchRaw(url,id){
  const context=await avBrowserContext();
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await context.request.get(url,{timeout:30000});
      const body=await response.body();
      last={status:response.status(),headers:response.headers(),body,url};
      console.log('[AV01_BROWSER_FETCH]',JSON.stringify({id,attempt,status:last.status,bytes:body.length,url}));
      if(last.status===200)return last;
      if(![502,503,504].includes(last.status))return last;
    }catch(e){
      console.error('[AV01_BROWSER_FETCH_ERROR]',JSON.stringify({id,attempt,error:e.message}));
    }
    if(attempt<3)await sleep(attempt*250);
  }
  return last||{status:504,headers:{'content-type':'text/plain'},body:Buffer.from('browser fetch failed'),url};
}
async function avBrowserFetch(url,id,key){
  const cached=avCacheGet(key);
  if(cached){console.log('[AV01_MEDIA_CACHE_HIT]',JSON.stringify({id,key,bytes:cached.body.length}));return cached;}
  if(avMediaInflight.has(key))return avMediaInflight.get(key);
  const p=avBrowserFetchRaw(url,id).then(r=>{if(r.status===200)avCachePut(key,r);return r}).finally(()=>avMediaInflight.delete(key));
  avMediaInflight.set(key,p);
  return p;
}

async function avResolveSession(id){
  const geo=await fetch('https://files.iw01.xyz/edge/geo.js?json',{
    headers:{'User-Agent':'Mozilla/5.0','Referer':AV+'/'},
    signal:AbortSignal.timeout(60000)
  });
  if(!geo.ok)throw Error('AV01 geo '+geo.status);
  const g=await geo.json();
  const qs=new URLSearchParams({token_v2:String(g.token_v2),expires:String(g.expires),ip:String(g.ip)});
  const tr=await fetch('https://customers.iw01.xyz/api/v1/videos/'+id+'/cdn-access?'+qs,{
    headers:{'User-Agent':'Mozilla/5.0','Referer':AV+'/'},
    signal:AbortSignal.timeout(15000)
  });
  if(!tr.ok)throw Error('AV01 cdn-access '+tr.status);
  const tj=await tr.json();
  if(!tj.access_token)throw Error('AV01 no access_token');
  return {token:tj.access_token,ro:tj.ro||'',created:Date.now()};
}

function avSigned(url,s){
  const u=new URL(url);
  if(!u.hostname.endsWith('iw01.xyz'))return u.toString();
  u.searchParams.set('access_token',s.token);
  if(s.ro)u.searchParams.set('ro',s.ro);
  return u.toString();
}

function avSession(id){
  const s=avProxySessions.get(String(id));
  if(s&&Date.now()-s.created<120000)return Promise.resolve(s);
  return avResolveSession(id).then(s=>{avProxySessions.set(String(id),s);return s});
}

async function avFetchText(url,s){
  const r=await fetch(avSigned(url,s),{
    headers:{'User-Agent':'Mozilla/5.0','Referer':AV+'/'},
    signal:AbortSignal.timeout(45000)
  });
  if(!r.ok)throw Error('AV01 media '+r.status);
  return {text:await r.text(),url:r.url};
}

function avRewritePlaylist(text,base,id){
  return text.split(/\r?\n/).map(line=>{
    if(!line.trim())return line;
    let out=line.replace(/URI="([^"]+)"/g,(_,v)=>{
      const target=new URL(v,base).toString();
      return 'URI="/av01/'+id+'/proxy?u='+encodeURIComponent(target)+'"';
    });
    if(out.trim()&&!out.trim().startsWith('#')){
      const target=new URL(out.trim(),base).toString();
      out='/av01/'+id+'/proxy?u='+encodeURIComponent(target);
    }
    return out;
  }).join('\n')+'\n';
}
function avFirstMediaTargets(text,base){
  const out=[];
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/URI="([^"]+)"/);if(m)out.push(new URL(m[1],base).toString());
    const s=line.trim();if(s&&!s.startsWith('#'))out.push(new URL(s,base).toString());
    if(out.length>=3)break;
  }
  return [...new Set(out)];
}
async function avWarmMedia(id,s,targets){
  for(const target of targets){
    try{
      const u=new URL(target);const key=id+':'+u.pathname;
      if(avCacheGet(key)||avMediaInflight.has(key))continue;
      avBrowserFetch(avSigned(u.toString(),s),id,key).catch(()=>{});
    }catch{}
  }
}

async function avProxyTarget(req,res,id,target){
  const s=await avSession(id);
  const u=new URL(target);
  if(!u.hostname.endsWith('iw01.xyz'))throw Error('AV01 target host rejected');
  const key=id+':'+u.pathname;
  console.log('[AV01_MEDIA_PROXY]', JSON.stringify({id,path:u.pathname}));
  const r=await avBrowserFetch(avSigned(u.toString(),s),id,key);
  console.log('[AV01_UPSTREAM_RESULT]',JSON.stringify({id,status:r.status,type:r.headers['content-type']||'',url:u.toString()}));
  if(r.status!==200){
    const detail=Buffer.from(r.body).toString('utf8');
    console.error('[AV01_UPSTREAM_ERROR]',JSON.stringify({id,status:r.status,detail:detail.slice(0,500)}));
    res.writeHead(r.status,{...cors,'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    return res.end('AV01 upstream '+r.status+'\n');
  }

  const type=r.headers['content-type']||'application/octet-stream';
  if(type.includes('mpegurl')||u.pathname.endsWith('.m3u8')){
    const text=Buffer.from(r.body).toString('utf8');
    const rewritten=avRewritePlaylist(text,r.url,id);
    console.log('[AV01_CHILD_PLAYLIST]',JSON.stringify({id,bytes:Buffer.byteLength(rewritten),url:r.url}));
    res.writeHead(200,{...cors,'content-type':'application/vnd.apple.mpegurl; charset=utf-8','cache-control':'no-store'});
    return res.end(rewritten);
  }

  res.writeHead(200,{...cors,'content-type':type,'cache-control':'private, max-age=120'});
  if(req.method==='HEAD')return res.end();
  return res.end(r.body);
}

async function avMaster(req,res,id){
  console.log('[AV01_MASTER_START]', JSON.stringify({id}));
  const s=await avSession(id);
  const master='https://customers.iw01.xyz/api/v1/videos/'+id+'/manifest/index90-sv3-v1-a1.m3u8';
  const r=await fetch(avSigned(master,s),{
    headers:{'User-Agent':'Mozilla/5.0','Referer':AV+'/'},
    signal:AbortSignal.timeout(45000)
  });
  console.log('[AV01_MASTER_UPSTREAM]', JSON.stringify({id,status:r.status,url:r.url}));
  if(!r.ok)throw Error('AV01 manifest '+r.status);
  const text=await r.text();
  const warmTargets=avFirstMediaTargets(text,r.url);
  const rewritten=avRewritePlaylist(text,r.url,id);
  console.log('[AV01_PROXY]',JSON.stringify({id,status:r.status,bytes:Buffer.byteLength(rewritten),warm:warmTargets.length}));
  res.writeHead(200,{...cors,'content-type':'application/vnd.apple.mpegurl; charset=utf-8','cache-control':'no-store'});
  res.end(rewritten);
  setImmediate(()=>avWarmMedia(id,s,warmTargets));
}

async function aj(url,opt={}){const r=await fetch(url,{...opt,headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Origin':AV,'Referer':AV+'/',...(opt.headers||{})},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('AV01 '+r.status);return r.json()}
async function items(){if(Date.now()-cache.at<60000&&cache.items.length)return cache.items;const j=await aj(AV+'/api/v1/videos/search?lang=en',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'',pagination:{page:1,limit:20}})});cache={at:Date.now(),items:j.videos||[]};return cache.items}
function tagName(x){return typeof x==='string'?x:(x?.name||x?.title||'')}
function meta(x){return Object.fromEntries(Object.entries({id:'av01:'+x.id,type:'movie',name:x?.title_translations?.en||x.title||x.dvd_id||String(x.id),poster:x.cover||x.poster||undefined,posterShape:'poster',description:x?.description_translations?.en||x.description||undefined,genres:(x.tags||[]).map(tagName).filter(Boolean),language:'Tiếng Nhật'}).filter(([,v])=>v!==undefined&&v!==''))}
function send(res,d,s=200){const b=JSON.stringify(d);res.writeHead(s,{...cors,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'});res.end(b)}
http.createServer=function(handler,...rest){return originalCreateServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);try{if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}if(path==='/manifest.json')return send(res,{id:'community.missav.hls.test',version:'0.4.4-av01-perf',name:'MissAV 1080p',description:'Original MissAV + original IkiSoda + isolated AV01 test',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'missav-1080',name:'MissAV · Verified 1080p'},{type:'movie',id:'ikisoda',name:'ikisoda'},{type:'movie',id:'av01-test',name:'Test AV01'}],idPrefixes:['missav:','ikisoda:','av01:']});if(path==='/catalog/movie/av01-test.json')return send(res,{metas:(await items()).map(meta)});
let m=path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);
if(m)return send(res,{streams:[{name:'AV01 Native HLS',title:'AV01 '+m[1]+' · fresh resolve on Play',url:'https://missav-uimx.onrender.com/av01/'+m[1]+'/master.m3u8',behaviorHints:{filename:'av01.m3u8'}}]});
m=path.match(/^\/av01\/(\d+)\/master\.m3u8$/);
if(m)return await avMaster(req,res,Number(m[1]));
m=path.match(/^\/av01\/(\d+)\/proxy$/);
if(m)return await avProxyTarget(req,res,Number(m[1]),new URL(req.url,'http://localhost').searchParams.get('u')||'');m=path.match(/^\/meta\/movie\/av01:(\d+)\.json$/);if(m){const x=(await items()).find(v=>String(v.id)===m[1]);return x?send(res,{meta:meta(x)}):send(res,{error:'Not found'},404)}return handler(req,res)}catch(e){console.error('[AV01_TEST]',e);return send(res,{error:e.message},502)}},...rest)};
