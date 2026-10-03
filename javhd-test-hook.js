import http from 'node:http';
const originalCreateServer=http.createServer.bind(http);const AV='https://www.av01.media';const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};let cache={at:0,items:[]};
const avProxySessions=new Map();

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

async function avProxyTarget(req,res,id,target){
  const s=await avSession(id);
  const u=new URL(target);
  if(!u.hostname.endsWith('iw01.xyz'))throw Error('AV01 target host rejected');
  // Keep the request shape identical to the browser-tested V3 path.
  // Browser-side resolution is intentionally not used for the media body:
  // Playwright is used only to refresh the signed session when needed.
  console.log('[AV01_MEDIA_PROXY]', JSON.stringify({id, path:u.pathname}));
  console.log('[AV01_UPSTREAM_START]',JSON.stringify({id,host:u.hostname,path:u.pathname}));
  const r=await fetch(avSigned(u.toString(),s),{
    headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Referer':AV+'/',
      'sec-ch-ua-platform':'"Windows"',
      'sec-ch-ua':'"Not=A?Brand";v="99", "HeadlessChrome";v="151", "Chromium";v="151"',
      'sec-ch-ua-mobile':'?0'
    },
    signal:AbortSignal.timeout(60000)
  });
  console.log('[AV01_UPSTREAM_RESULT]',JSON.stringify({id,status:r.status,type:r.headers.get('content-type')||'',url:r.url}));
  if(!r.ok){
    const detail=await r.text().catch(()=> '');
    console.error('[AV01_UPSTREAM_ERROR]',JSON.stringify({id,status:r.status,detail:detail.slice(0,500)}));
    res.writeHead(r.status,{...cors,'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    return res.end('AV01 upstream '+r.status+'\n');
  }

  const type=r.headers.get('content-type')||'application/octet-stream';
  if(type.includes('mpegurl')||u.pathname.endsWith('.m3u8')){
    const text=await r.text();
    const rewritten=avRewritePlaylist(text,r.url,id);
    console.log('[AV01_CHILD_PLAYLIST]',JSON.stringify({id,bytes:Buffer.byteLength(rewritten),url:r.url}));
    res.writeHead(200,{...cors,'content-type':'application/vnd.apple.mpegurl; charset=utf-8','cache-control':'no-store'});
    return res.end(rewritten);
  }

  res.writeHead(200,{...cors,'content-type':type,'cache-control':'no-store'});
  if(req.method==='HEAD')return res.end();
  for await(const chunk of r.body)res.write(chunk);
  return res.end();
}

async function avMaster(req,res,id){
  console.log('[AV01_MASTER_START]', JSON.stringify({id}));
  const s=await avSession(id);
  // Refresh the signed session through the same browser resolver used by V3.
  const master='https://customers.iw01.xyz/api/v1/videos/'+id+'/manifest/index90-sv3-v1-a1.m3u8';
  const r=await fetch(avSigned(master,s),{
    headers:{'User-Agent':'Mozilla/5.0','Referer':AV+'/'},
    signal:AbortSignal.timeout(45000)
  });
  console.log('[AV01_MASTER_UPSTREAM]', JSON.stringify({id,status:r.status,url:r.url}));
  if(!r.ok)throw Error('AV01 manifest '+r.status);
  const text=await r.text();
  const rewritten=avRewritePlaylist(text,r.url,id);
  console.log('[AV01_PROXY]',JSON.stringify({id,status:r.status,bytes:Buffer.byteLength(rewritten)}));
  res.writeHead(200,{...cors,'content-type':'application/vnd.apple.mpegurl; charset=utf-8','cache-control':'no-store'});
  return res.end(rewritten);
}

async function aj(url,opt={}){const r=await fetch(url,{...opt,headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Origin':AV,'Referer':AV+'/',...(opt.headers||{})},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('AV01 '+r.status);return r.json()}
async function items(){if(Date.now()-cache.at<60000&&cache.items.length)return cache.items;const j=await aj(AV+'/api/v1/videos/search?lang=en',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'',pagination:{page:1,limit:20}})});cache={at:Date.now(),items:j.videos||[]};return cache.items}
function tagName(x){return typeof x==='string'?x:(x?.name||x?.title||'')}
function meta(x){return Object.fromEntries(Object.entries({id:'av01:'+x.id,type:'movie',name:x?.title_translations?.en||x.title||x.dvd_id||String(x.id),poster:x.cover||x.poster||undefined,posterShape:'poster',description:x?.description_translations?.en||x.description||undefined,genres:(x.tags||[]).map(tagName).filter(Boolean),language:'Tiếng Nhật'}).filter(([,v])=>v!==undefined&&v!==''))}
function send(res,d,s=200){const b=JSON.stringify(d);res.writeHead(s,{...cors,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'});res.end(b)}
http.createServer=function(handler,...rest){return originalCreateServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);try{if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}if(path==='/manifest.json')return send(res,{id:'community.missav.hls.test',version:'0.4.3-av01-isolated',name:'MissAV 1080p',description:'Original MissAV + original IkiSoda + isolated AV01 test',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'missav-1080',name:'MissAV · Verified 1080p'},{type:'movie',id:'ikisoda',name:'ikisoda'},{type:'movie',id:'av01-test',name:'Test AV01'}],idPrefixes:['missav:','ikisoda:','av01:']});if(path==='/catalog/movie/av01-test.json')return send(res,{metas:(await items()).map(meta)});
let m=path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);
if(m)return send(res,{streams:[{name:'AV01 Native HLS',title:'AV01 '+m[1]+' · fresh resolve on Play',url:'https://missav-uimx.onrender.com/av01/'+m[1]+'/master.m3u8',behaviorHints:{filename:'av01.m3u8'}}]});
m=path.match(/^\/av01\/(\d+)\/master\.m3u8$/);
if(m)return avMaster(req,res,Number(m[1]));
m=path.match(/^\/av01\/(\d+)\/proxy$/);
if(m)return avProxyTarget(req,res,Number(m[1]),new URL(req.url,'http://localhost').searchParams.get('u')||'');m=path.match(/^\/meta\/movie\/av01:(\d+)\.json$/);if(m){const x=(await items()).find(v=>String(v.id)===m[1]);return x?send(res,{meta:meta(x)}):send(res,{error:'Not found'},404)}m=path.match(/^\/stream\/movie\/av01:(\d+)\.json$/);if(m)return send(res,{streams:[]});return handler(req,res)}catch(e){console.error('[AV01_TEST]',e);return send(res,{error:e.message},502)}},...rest)};
