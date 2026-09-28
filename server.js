import http from 'node:http';
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.env.PUBLIC_URL?.replace(/\/$/, '') || '';
const VIDEO = 'https://surrit.com/d20f4a25-16db-4cd0-86bd-c02ee44cfa98/1080p/video.m3u8';
const REF = 'https://missav.ws/';
const id = 'missav:ft htd-213'.replace(' ', '');
const cors = {'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};
function json(res, data, status=200) { const body=JSON.stringify(data);res.writeHead(status, {...cors,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});res.end(body); }
const manifest={id:'community.missav.hls.test',version:'0.1.0',name:'MissAV HLS Test',description:'Isolated 1080p header test; no HLS proxy',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'missav-test',name:'Test 1080p'}],idPrefixes:['missav:']};
const meta={id,type:'movie',name:'FTHTD-213 — 1080p test',description:'Surrit HLS; playback requires Referer https://missav.ws/'};
const streams=[{name:'Surrit 1080p · direct headers',title:'1080p · Referer test',url:VIDEO,behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:REF,Origin:'https://missav.ws','User-Agent':'Mozilla/5.0'},response:{'Access-Control-Allow-Origin':'*'}}}}];
http.createServer((req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
if(path==='/' || path==='/health')return json(res,{status:'ok',manifest:ROOT?ROOT+'/manifest.json':'/manifest.json',source:'Surrit direct test, no video proxy'});
if(path==='/manifest.json')return json(res,manifest);
if(path==='/catalog/movie/missav-test.json')return json(res,{metas:[meta]});
if(path==='/meta/movie/'+id+'.json')return json(res,{meta});
if(path==='/stream/movie/'+id+'.json')return json(res,{streams});
return json(res,{error:'Not found'},404);
}).listen(PORT,'0.0.0.0',()=>console.log('Test addon listening on '+PORT));
