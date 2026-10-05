#!/usr/bin/env node
import fs from "node:fs/promises";
import { chromium } from "playwright";

const BASE="https://www.av01.media";
const START=BASE+"/vn/videos/hottest";
const TARGET=Number(process.argv[2]||20);
const include=["big tits","big boobs","large breasts","huge breasts","huge tits","huge boobs","busty","big breasts"];
const exclude=["toy","sex toys","dildo","anal","cross dressing","lesbian","gay","shemale","transsexual","mature","熟女","mother","milf"];
const state={started_at:new Date().toISOString(),source:START,scanned:0,metadata:0,quality_checked:0,valid:0,target:TARGET,rejections:{year:0,include:0,exclude:0,quality:0,error:0},movies:[],seen:[]};
const seen=new Set(), accepted=new Set();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function names(a){return (Array.isArray(a)?a:[]).map(x=>typeof x==="string"?x:(x?.name||x?.title||"")).filter(Boolean)}
function yearOf(v){for(const k of ["published_time","uploaded_time","release_date","date","year"]){const m=String(v?.[k]??"").match(/20(?:24|25|26)/);if(m)return Number(m[0])}return null}
function blob(v){return [...names(v?.tags),v?.title||"",v?.description||""].join(" ").toLowerCase()}
async function save(){
 state.valid=state.movies.length;state.seen=[...seen];state.updated_at=new Date().toISOString();
 await fs.mkdir("data",{recursive:true});
 await fs.writeFile("data/av01-progress.json",JSON.stringify(state,null,2));
 await fs.writeFile("data/av01-catalog.json",JSON.stringify({updated_at:state.updated_at,source:START,movies:state.movies},null,2));
}
async function api(context,path,accept="application/json,text/plain,*/*"){
 const r=await context.request.get(BASE+path,{headers:{Referer:BASE+"/",Accept:accept}});
 if(!r.ok())throw new Error(path+" HTTP "+r.status());
 return r;
}
async function metadata(context,id){state.metadata++;const r=await api(context,`/api/v1/videos/${id}`);const j=await r.json();return j?.data||j}
async function has1080(context,id){
 state.quality_checked++;
 const r=await api(context,`/api/v1/videos/${id}/manifest/master.m3u8`,"application/vnd.apple.mpegurl,*/*");
 const t=await r.text();
 return /RESOLUTION=\d+x(?:1080|1[1-9]\d\d|[2-9]\d{3})/i.test(t)||/index90-sv3-v1-a1\.m3u8/i.test(t)||/sv3-v1-a1\.m3u8/i.test(t);
}
function idFromHref(h){return String(h||"").match(/\/video\/(\d+)(?:\/|$)/)?.[1]||null}
async function collectLinks(page){
 return await page.locator('a[href*="/video/"]').evaluateAll(as=>[...new Set(as.map(a=>a.href))]);
}
async function processId(context,id,href){
 if(!id||seen.has(id)||state.movies.length>=TARGET)return;seen.add(id);state.scanned++;
 try{
  const v=await metadata(context,id), y=yearOf(v), b=blob(v);
  let reason=null;
  if(!y||y<2024||y>2026){state.rejections.year++;reason="year"}
  else if(!include.some(x=>b.includes(x))){state.rejections.include++;reason="include"}
  else if(exclude.some(x=>b.includes(x))){state.rejections.exclude++;reason="exclude"}
  else if(!await has1080(context,id)){state.rejections.quality++;reason="quality"}
  if(!reason&&!accepted.has(id)){
   accepted.add(id);
   state.movies.push({id,dvd_id:v.dvd_id||v.code||null,title:v.title||v.dvd_id||v.code||("AV01 "+id),description:v.description||null,duration:v.duration||null,published_time:v.published_time||null,uploaded_time:v.uploaded_time||null,maker:v.maker||null,actresses:v.actresses||[],tags:v.tags||[],cover:v.cover||v.poster||null,poster:v.cover||v.poster||`https://files.iw01.xyz/covers/${id}/800.webp`,year:y,quality:"1080p+",page_url:href||`${BASE}/vn/video/${id}`});
  }
  console.log(JSON.stringify({id,result:reason||"ACCEPT",scanned:state.scanned,quality_checked:state.quality_checked,valid:state.movies.length,target:TARGET,rejections:state.rejections}));
 }catch(e){state.rejections.error++;console.error("[ITEM]",id,e.message)}
 await save();
}
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:"vi-VN"});
const page=await context.newPage();
console.log("[START]",START,"target",TARGET);
await page.goto(START,{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(2500);
let stagnant=0,lastCount=0,round=0;
while(state.movies.length<TARGET&&stagnant<8){
 round++;
 const links=await collectLinks(page);
 for(const href of links){await processId(context,idFromHref(href),href);if(state.movies.length>=TARGET)break}
 if(state.movies.length>=TARGET)break;
 const before=links.length;
 const buttons=page.getByText(/load\s*more|xem\s*thêm|tải\s*thêm/i);
 let clicked=false;
 try{const n=await buttons.count();for(let i=0;i<n;i++){if(await buttons.nth(i).isVisible()){await buttons.nth(i).click({timeout:5000});clicked=true;break}}}catch{}
 if(!clicked)await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 await page.waitForTimeout(2500);
 const after=(await collectLinks(page)).length;
 stagnant=(after<=Math.max(before,lastCount))?stagnant+1:0;lastCount=after;
 console.log(JSON.stringify({event:"LOAD_MORE",round,visible_video_links:after,stagnant,valid:state.movies.length,target:TARGET}));
}
await save();await browser.close();
console.log(JSON.stringify({done:state.movies.length>=TARGET,scanned:state.scanned,valid:state.movies.length,target:TARGET,rejections:state.rejections,output:"data/av01-catalog.json"}));
process.exit(state.movies.length>=TARGET?0:3);
