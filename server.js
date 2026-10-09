import http from 'node:http';
import {readFileSync} from 'node:fs';

const PORT=Number(process.env.PORT||3000);
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS','access-control-allow-headers':'*'};
function json(res,data,status=200){const body=JSON.stringify(data);res.writeHead(status,{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate','content-length':Buffer.byteLength(body)});res.end(body);}

let catalog={movies:[]};
try{catalog=JSON.parse(readFileSync(new URL('./data/av01-catalog.json',import.meta.url),'utf8'));}catch{}
let movies=Array.isArray(catalog)?catalog:(catalog.movies||[]);

// Enrich by stable AV01 ID without changing the original catalog ordering.
let metadata={movies:[]};
try{metadata=JSON.parse(readFileSync(new URL('./data/av01-metadata-enriched.json',import.meta.url),'utf8'));}catch{}
const metadataById=new Map((metadata.movies||[]).map(item=>[String(item.id),item]));
movies=movies.map(item=>{
  const extra=metadataById.get(String(item.id));
  if(!extra)return item;
  const merged={...item};
  for(const key of ['title','description','poster','official_tags','actresses','maker','release_date']){
    const value=extra[key];
    if(value && (!Array.isArray(value)||value.length))merged[key]=value;
  }
  if(extra.movie_code)merged.dvd_id=extra.movie_code;
  return merged;
});

// Independent verified AVMates image layer, keyed by the original AV01 catalog ID.
let imageData={movies:[]};
try{imageData=JSON.parse(readFileSync(new URL('./data/av01-avmates-cdn-images.json',import.meta.url),'utf8'));}catch{}
const imageById=new Map((imageData.movies||[]).filter(x=>x?.status==='ok'&&x?.poster)
  .map(x=>[String(x.id),x]));
// Show verified scanned films first, in scan result order; preserve original order for the rest.
const originalPosition=new Map(movies.map((x,i)=>[String(x.id),i]));
const scannedPosition=new Map((imageData.movies||[]).filter(x=>x?.status==='ok'&&x?.poster).map((x,i)=>[String(x.id),i]));
movies.sort((a,b)=>{
  const ai=scannedPosition.get(String(a.id)),bi=scannedPosition.get(String(b.id));
  if(ai!==undefined&&bi!==undefined)return ai-bi;
  if(ai!==undefined)return -1;
  if(bi!==undefined)return 1;
  return originalPosition.get(String(a.id))-originalPosition.get(String(b.id));
});
const byId=new Map(movies.map(x=>['av01:'+String(x.id),x]));
// Version verified image URLs so clients do not reuse previously cached thumbnails.
const IMAGE_REV='avmates-20261009-2';
function freshVerifiedImage(url){
  if(!url)return undefined;
  try{
    const parsed=new URL(url);
    parsed.searchParams.set('av01rev',IMAGE_REV);
    return parsed.toString();
  }catch{return url;}
}

// AV01 adaptation of XemXiec's baseMeta: primary Play entry, then image thumbnails.
function meta(x){
  const id='av01:'+x.id;
  const verified=imageById.get(String(x.id));
  const code=x.dvd_id||x.code||'';
  const genres=(x.official_tags||x.tags||[]).map(v=>typeof v==='string'?v:v?.name).filter(Boolean);
  const cast=(x.actresses||[]).map(v=>typeof v==='string'?v:v?.name).filter(Boolean);
  const date=x.release_date||x.upload_date||'';
  const dateString=String(date||'');
  const released=/^\\d{4}-\\d{2}-\\d{2}/.test(dateString)?dateString.slice(0,10)+'T00:00:00.000Z':'2026-01-01T00:00:00.000Z';
  // AVMates *ps.webp is the portrait poster. *pl_poster* is landscape cover, not a Snap.
  const images=(verified?.snapshots||[]).filter(url=>typeof url==='string'&&/jp-\d+\./i.test(url)).map(freshVerifiedImage);
  const landscape=(verified?.snapshots||[]).find(url=>/pl_poster/i.test(url));
  const name=x.title||x.catalog_title||x.code||code||('AV01 '+x.id);
  const m={
    id,type:'movie',name,
    poster:verified?.poster?freshVerifiedImage(verified.poster):(x.poster||x.cover||undefined),
    background:landscape?freshVerifiedImage(landscape):(images[0]||x.background||x.backdrop||undefined),
    description:x.description||undefined,
    website:x.page_url||undefined,
    posterShape:'poster',
    behaviorHints:{defaultVideoId:id},
    releaseInfo:date?dateString.slice(0,10):(x.year?String(x.year):undefined),
    released:date?released:undefined,
    genres,cast:cast.length?cast:undefined,
    director:x.maker?.name?[x.maker.name]:undefined,
    studio:x.maker?.name||undefined,
    language:'Tiếng Nhật'
  };
  const videos=[{id,title:name,released,available:true}];
  images.forEach((thumbnail,i)=>videos.push({
    id:id+':image:'+(i+1),title:'Snap '+(i+1),released,
    season:1,episode:i+1,thumbnail,
    overview:code+' • Snap '+(i+1),available:true
  }));
  m.videos=videos;
  return Object.fromEntries(Object.entries(m).filter(([,v])=>v!==undefined&&v!==''));
}

const manifest={
  id:'community.av01.filtered',
  version:'1.0.1-av01-images',
  name:'AV01',
  description:'AV01 Hottest verified scanner catalog with metadata enrichment',
  resources:['catalog','meta','stream'],
  types:['movie'],
  catalogs:[{type:'movie',id:'av01-filtered',name:'AV01 · Hottest · Filtered 1080p',extra:[{name:'search',isRequired:false}]}],
  idPrefixes:['av01:']
};

http.createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  if(path==='/'||path==='/health')return json(res,{status:'ok',movies:movies.length});
  if(path==='/manifest.json')return json(res,manifest);
  if(path==='/catalog/movie/av01-filtered.json'||path.startsWith('/catalog/movie/av01-filtered/')){
    const extra=path.slice('/catalog/movie/av01-filtered/'.length);
    if(path!=='/catalog/movie/av01-filtered.json'&&!extra.endsWith('.json'))return json(res,{error:'Not found'},404);
    const params=new URLSearchParams(extra.endsWith('.json')?extra.slice(0,-5).replace(/\\//g,'&'):'');
    const query=(params.get('search')||'').trim().toLocaleLowerCase();
    const normalized=query.replace(/[^a-z0-9]/g,'');
    const filtered=!query?movies:movies.filter(x=>{
      const fields=[x.title,x.code,x.dvd_id,x.id,x.description].filter(Boolean).map(v=>String(v).toLocaleLowerCase());
      return fields.some(v=>v.includes(query)||(normalized&&v.replace(/[^a-z0-9]/g,'').includes(normalized)));
    });
    return json(res,{metas:filtered.map(x=>{const m=meta(x);delete m.videos;return m;})});
  }
  if(path.startsWith('/meta/movie/av01:')&&path.endsWith('.json')){
    const x=byId.get(path.slice('/meta/movie/'.length,-5));
    return x?json(res,{meta:meta(x)}):json(res,{error:'Not found'},404);
  }
  if(path.startsWith('/stream/movie/av01:')&&path.endsWith('.json')){
    const requested=path.slice('/stream/movie/'.length,-5);
    if(/:image:\d+$/.test(requested))return json(res,{streams:[]});
    const x=byId.get(requested);
    return x?json(res,{streams:[{name:'AV01 1080p',title:'AV01 source',externalUrl:x.page_url||('https://www.av01.media/en/video/'+x.id)}]}):json(res,{streams:[]});
  }
  return json(res,{error:'Not found'},404);
}).listen(PORT,'0.0.0.0',()=>console.log('AV01 addon listening on '+PORT));
