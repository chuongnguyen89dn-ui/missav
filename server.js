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
const streams=[{name:'Surrit 1080p · server proxy',title:'1080p · Render Referer proxy',url:(ROOT || 'https://missav-uimx.onrender.com')+'/hls/1080p/video.m3u8'},{name:'Surrit 1080p · direct headers',title:'1080p · Referer test',url:VIDEO,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'},response:{'Access-Control-Allow-Origin':'*'}}}}];
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
  return json(res,{test:'FTHTD-213 Surrit 1080p from Render',upstreamStatus:upstream.status,upstreamContentType:upstream.headers.get('content-type'),playlistValid:isPlaylist,playlistLines:isPlaylist?body.split(/\\r?\\n/).length:0,elapsedMs:Date.now()-started,bodyPreview:isPlaylist?body.slice(0,240):body.slice(0,160),note:upstream.status===403?'Surrit rejected the request from Render':'This checks playlist only, not segment playback'});
 }catch(e){return json(res,{test:'FTHTD-213 Surrit 1080p from Render',upstreamStatus:null,playlistValid:false,error:e?.name||'FetchError',message:e?.message||'Unknown',elapsedMs:Date.now()-started},502);}
}
http.createServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
if(path==='/' || path==='/health')return json(res,{status:'ok',manifest:ROOT?ROOT+'/manifest.json':'/manifest.json',source:'Surrit direct test, no video proxy'});
if(path==='/diagnose' || path==='/diagnose.json')return diagnose(req,res);
if(path.startsWith('/hls/'))return proxyHls(req,res,path);
if(path==='/manifest.json')return json(res,manifest);
if(path==='/catalog/movie/missav-test.json')return json(res,{metas:[meta]});
if(path==='/meta/movie/'+id+'.json')return json(res,{meta});
if(path==='/stream/movie/'+id+'.json')return json(res,{streams});
return json(res,{error:'Not found'},404);
}).listen(PORT,'0.0.0.0',()=>console.log('Test addon listening on '+PORT));
