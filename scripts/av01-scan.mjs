#!/usr/bin/env node
import fs from "node:fs/promises";
const BASE="https://www.av01.media", UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";
const LIMIT=20,target=Number(process.argv[2]||20),delay=Number(process.env.AV01_DELAY_MS||1800),started=Date.now();
const include=["big tits","big boobs","large breasts","huge breasts","huge tits","huge boobs","busty","big breasts"];
const exclude=["toy","sex toys","dildo","anal","cross dressing","lesbian","gay","shemale","transsexual","mature","熟女","mother","milf"];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let state={started_at:new Date().toISOString(),next_page:1,scanned:0,metadata:0,quality_checked:0,valid:0,target,rejections:{no_id:0,year:0,include:0,exclude:0,quality:0,error:0},movies:[],seen:[]};\n// A new workflow run is a clean 20-valid batch. Resume is opt-in only.\nif(process.env.AV01_RESUME==="1"){try{state={...state,...JSON.parse(await fs.readFile("data/av01-progress.json","utf8"))};state.target=target}catch{}}
const seen=new Set(state.seen||[]); const accepted=new Set((state.movies||[]).map(x=>String(x.id)));
async function save(){
 state.valid=state.movies.length;state.seen=[...seen];state.updated_at=new Date().toISOString();
 const mins=Math.max((Date.now()-started)/60000,.01);state.session_rate_per_min=+(state.scanned/mins).toFixed(2);
 await fs.writeFile("data/av01-progress.json",JSON.stringify(state,null,2));
 await fs.writeFile("data/av01-catalog.json",JSON.stringify({updated_at:state.updated_at,movies:state.movies},null,2));
}
async function req(url,opt={}){
 for(let attempt=0;attempt<7;attempt++){
  if(delay)await sleep(delay);
  const r=await fetch(url,{...opt,headers:{"User-Agent":UA,"Referer":BASE+"/","Accept":"application/json,text/plain,*/*",...(opt.body?{"Content-Type":"application/json"}:{}),...(opt.headers||{})}});
  if(r.ok)return r;
  if(r.status===429||r.status>=500){
   const ra=Number(r.headers.get("retry-after")||0)*1000;
   const wait=Math.max(ra,Math.min(120000,5000*2**attempt))+Math.floor(Math.random()*1500);
   console.log(JSON.stringify({event:"retry",status:r.status,attempt:attempt+1,wait_ms:wait,url:new URL(url).pathname}));
   await sleep(wait);continue;
  }
  throw new Error("HTTP "+r.status+" "+new URL(url).pathname);
 }
 throw new Error("retry exhausted "+new URL(url).pathname);
}
function yearOf(v){for(const k of ["published_time","uploaded_time","release_date","date","year"]){const m=String(v?.[k]??"").match(/20(?:24|25|26)/);if(m)return Number(m[0])}return null}
function blob(v){return [...(Array.isArray(v.tags)?v.tags:[]),v.title||"",v.description||""].map(x=>typeof x==="string"?x:(x?.name||x?.title||"")).join(" ").toLowerCase()}
async function has1080(id){state.quality_checked++;const r=await req(BASE+`/api/v1/videos/${id}/manifest/master.m3u8`,{headers:{Accept:"application/vnd.apple.mpegurl,*/*"}});const m=await r.text();return /RESOLUTION=\d+x(?:1080|1[1-9]\d\d|[2-9]\d{3})/i.test(m)||/sv3-v1-a1\.m3u8/i.test(m)}
for(let page=Number(state.next_page||1);state.movies.length<target;page++){
 const r=await req(BASE+"/api/v1/videos/search?lang=en",{method:"POST",body:JSON.stringify({query:"",pagination:{page,limit:LIMIT}})});
 const j=await r.json(),rows=j?.data?.items||j?.data?.videos||j?.items||j?.videos||j?.data||[];
 if(!Array.isArray(rows)||!rows.length){console.log("[END] no more rows at page",page);break}
 for(const row of rows){
  if(state.movies.length>=target)break;
  const id=String(row?.id||row?.video_id||"");if(!id){state.rejections.no_id++;continue}
  if(seen.has(id)){continue} seen.add(id);state.scanned++;
  try{
   const d=await (await req(BASE+`/api/v1/videos/${id}`)).json();state.metadata++;
   const v=d?.data||d,y=yearOf(v),b=blob(v);
   if(!y||y<2024||y>2026){state.rejections.year++;continue}
   if(!include.some(x=>b.includes(x))){state.rejections.include++;continue}
   if(exclude.some(x=>b.includes(x))){state.rejections.exclude++;continue}
   if(!await has1080(id)){state.rejections.quality++;continue}
   if(!accepted.has(id)){accepted.add(id);state.movies.push({id,dvd_id:v.dvd_id||v.code||row.code||null,title:v.title||row.title||null,description:v.description||null,duration:v.duration||null,views:v.views||null,published_time:v.published_time||null,uploaded_time:v.uploaded_time||null,maker:v.maker||null,actresses:v.actresses||[],tags:v.tags||[],cover:v.cover||null,poster:v.cover||v.poster||`https://files.iw01.xyz/covers/${id}/800.webp`,year:y,quality:"1080p+",raw:v})}
  }catch(e){state.rejections.error++;console.error("[ITEM]",id,e.message)}
  if(state.scanned%5===0||state.movies.length)await save();
  console.log(JSON.stringify({page,scanned:state.scanned,metadata:state.metadata,quality_checked:state.quality_checked,valid:state.movies.length,target,rejections:state.rejections}));
 }
 state.next_page=page+1;await save();
}
await save();console.log(JSON.stringify({done:state.movies.length>=target,scanned:state.scanned,valid:state.movies.length,target,next_page:state.next_page,rate_per_min:state.session_rate_per_min}));
process.exit(state.movies.length>=target?0:3);
