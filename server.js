import http from 'node:http';
import {readFileSync} from 'node:fs';

const PORT=Number(process.env.PORT||3000);
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};
function json(res,data,status=200){const body=JSON.stringify(data);res.writeHead(status,{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate','content-length':Buffer.byteLength(body)});res.end(body);}

let catalog={movies:[]};
try{catalog=JSON.parse(readFileSync(new URL('./data/av01-catalog.json',import.meta.url),'utf8'));}catch{}
let movies=Array.isArray(catalog)?catalog:(catalog.movies||[]);

// The 20 metadata-pass records enrich the same scanner catalog by AV01 id.
// They are not exposed as a second/test catalog.
let metadata20={movies:[]};
try{metadata20=JSON.parse(readFileSync(new URL('./data/av01-addon-test20.json',import.meta.url),'utf8'));}catch{}
const enriched=new Map((metadata20.movies||[]).map(x=>[String(x.id),x]));
movies=movies.map(x=>{
  const e=enriched.get(String(x.id));
  if(!e)return x;
  return {...x,...e,id:x.id,poster:e.poster||x.poster||x.cover||undefined};
});
const byId=new Map(movies.map(x=>['av01:'+String(x.id),x]));

function meta(x){
  const genres=(x.official_tags||x.tags||[]).map(v=>typeof v==='string'?v:v?.name).filter(Boolean);
  const cast=(x.actresses||[]).map(v=>typeof v==='string'?v:v?.name).filter(Boolean);
  const date=x.release_date||x.upload_date||'';
  const m={
    id:'av01:'+x.id,type:'movie',
    name:x.title||x.code||x.dvd_id||('AV01 '+x.id),
    poster:x.poster||x.cover||undefined,posterShape:'poster',
    description:x.description||undefined,
    releaseInfo:date?String(date).slice(0,4):(x.year?String(x.year):undefined),
    released:date?new Date(date).toISOString():undefined,
    genres,genre:genres,cast:cast.length?cast:undefined,
    director:x.maker?.name?[x.maker.name]:undefined,
    language:'Tiếng Nhật'
  };
  return Object.fromEntries(Object.entries(m).filter(([,v])=>v!==undefined&&v!==''));
}

const manifest={
  id:'community.av01.filtered',
  version:'1.0.0-av01-only',
  name:'AV01',
  description:'AV01 Hottest verified scanner catalog with metadata enrichment',
  resources:['catalog','meta','stream'],
  types:['movie'],
  catalogs:[{type:'movie',id:'av01-filtered',name:'AV01 · Hottest · Filtered 1080p'}],
  idPrefixes:['av01:']
};

http.createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  if(path==='/'||path==='/health')return json(res,{status:'ok',movies:movies.length,enriched:movies.filter(x=>enriched.has(String(x.id))).length});
  if(path==='/manifest.json')return json(res,manifest);
  if(path==='/catalog/movie/av01-filtered.json')return json(res,{metas:movies.map(meta)});
  if(path.startsWith('/meta/movie/av01:')&&path.endsWith('.json')){
    const x=byId.get(path.slice('/meta/movie/'.length,-5));
    return x?json(res,{meta:meta(x)}):json(res,{error:'Not found'},404);
  }
  if(path.startsWith('/stream/movie/av01:')&&path.endsWith('.json')){
    const x=byId.get(path.slice('/stream/movie/'.length,-5));
    return x?json(res,{streams:[{name:'AV01 1080p',title:'AV01 source',externalUrl:x.page_url||('https://www.av01.media/en/video/'+x.id)}]}):json(res,{streams:[]});
  }
  if(path==='/__av01_status.json')return json(res,{movies:movies.length,metadata20_loaded:enriched.size,metadata20_matched:movies.filter(x=>enriched.has(String(x.id))).length});
  return json(res,{error:'Not found'},404);
}).listen(PORT,'0.0.0.0',()=>console.log('AV01 addon listening on '+PORT));
