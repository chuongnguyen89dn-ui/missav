#!/usr/bin/env node
import fs from "node:fs/promises";
const BASE="https://www.av01.media", UA="Mozilla/5.0";
const LIMIT=20, target=Number(process.argv[2]||20), start=Date.now();
const include=["big tits","big boobs","large breasts","huge breasts","huge tits","huge boobs","busty","big breasts"];
const exclude=["toy","sex toys","dildo","anal","cross dressing","lesbian","gay","shemale","transsexual","mature","熟女","mother","milf"];
const out=[]; let page=1, scanned=0, metadata=0, rejected=0;
const req=async(u,o={})=>{const r=await fetch(u,{...o,headers:{"User-Agent":UA,Referer:BASE+"/","Content-Type":"application/json",...(o.headers||{})}});if(!r.ok)throw new Error(r.status+" "+u);return r};
const text=x=>JSON.stringify(x??"").toLowerCase();
function yearOf(v){const s=JSON.stringify(v);const m=s.match(/20(?:24|25|26)/);return m?Number(m[0]):null}
function tagsOf(v){return [...(v.tags||[]),(v.title||""),(v.description||"")].map(x=>typeof x==="string"?x:(x?.name||"")).join(" ").toLowerCase()}
async function has1080(id){
 const r=await req(BASE+`/api/v1/videos/${id}/manifest/master.m3u8`);
 const m=await r.text();
 return /RESOLUTION=\d+x(1080|1[1-9]\d\d|[2-9]\d{3})/i.test(m)||/index\d*-sv3-v1-a1\.m3u8/i.test(m);
}
while(out.length<target){
 const r=await req(BASE+"/api/v1/videos/search?lang=en",{method:"POST",body:JSON.stringify({query:"",pagination:{page,limit:LIMIT}})});
 const j=await r.json(); const rows=j?.data?.items||j?.data?.videos||j?.items||j?.videos||j?.data||[];
 if(!Array.isArray(rows)||!rows.length)break;
 for(const row of rows){
  if(out.length>=target)break; scanned++;
  try{
   const id=row.id||row.video_id; if(!id){rejected++;continue}
   const d=await (await req(BASE+`/api/v1/videos/${id}`)).json(); metadata++;
   const v=d?.data||d; const y=yearOf(v), blob=tagsOf(v);
   if(!y||y<2024||y>2026||!include.some(x=>blob.includes(x))||exclude.some(x=>blob.includes(x))){rejected++;continue}
   if(!await has1080(id)){rejected++;continue}
   const poster=v.cover||v.poster||`https://files.iw01.xyz/covers/${id}/800.webp`;
   out.push({id:String(id),dvd_id:v.dvd_id||v.code||row.dvd_id||row.code||null,title:v.title||row.title||null,description:v.description||null,duration:v.duration||null,views:v.views||null,published_time:v.published_time||null,uploaded_time:v.uploaded_time||null,maker:v.maker||null,actresses:v.actresses||[],tags:v.tags||[],cover:v.cover||null,poster,year:y,quality:"1080p+",raw:v});
   const sec=(Date.now()-start)/1000; console.log(JSON.stringify({page,scanned,valid:out.length,target,rate_per_min:+(scanned/sec*60).toFixed(2)}));
  }catch(e){rejected++;console.error("[ITEM]",row?.id,e.message)}
 }
 page++;
 await fs.writeFile("data/av01-progress.json",JSON.stringify({started_at:new Date(start).toISOString(),updated_at:new Date().toISOString(),next_page:page,scanned,metadata,rejected,valid:out.length,target,rate_per_min:+(scanned/((Date.now()-start)/60000)).toFixed(2),movies:out},null,2));
}
await fs.writeFile("data/av01-catalog.json",JSON.stringify({updated_at:new Date().toISOString(),movies:out},null,2));
console.log(JSON.stringify({done:true,page,scanned,valid:out.length,target,elapsed_sec:+((Date.now()-start)/1000).toFixed(1),rate_per_min:+(scanned/((Date.now()-start)/60000)).toFixed(2)}));
