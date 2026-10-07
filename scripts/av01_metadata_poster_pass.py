#!/usr/bin/env python3
# AV01 metadata/poster enrichment pass.
# Reads every numeric AV01 id currently present in data/av01-catalog.json.
# Independent checkpoint/resume. Does NOT resolve/probe video streams.

import argparse, json, re, time, subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests

BASE="https://www.av01.media"
CATALOG=Path("data/av01-catalog.json")
DEFAULT_OUT=Path("av01_metadata_pass")
RETRY_SECONDS=180
SAVE_EVERY=1
BATCH_SIZE=20
PUBLISH_PATH=Path("data/av01-metadata-catalog.json")

def now():
    return datetime.now(timezone.utc).isoformat()

def atomic_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)

def norm(s):
    return re.sub(r"\s+"," ",(s or "").strip())

def numeric_id(x):
    m=re.search(r"(\d+)",str(x or ""))
    return m.group(1) if m else ""

def load_catalog():
    raw=json.loads(CATALOG.read_text(encoding="utf-8"))
    if isinstance(raw,list): movies=raw
    elif isinstance(raw,dict):
        movies=next((raw[k] for k in ("movies","data","items","results") if isinstance(raw.get(k),list)),[])
    else: movies=[]
    out=[]; seen=set()
    for m in movies:
        vid=numeric_id(m.get("id") or m.get("video_id") or m.get("_id"))
        if vid and vid not in seen:
            seen.add(vid); out.append((vid,m))
    return out

def extract_page(pg, vid, old):
    # Open by known catalog URL first; numeric-ID fallback is stable enough for redirect/canonical discovery.
    u=old.get("url") or f"{BASE}/en/video/{vid}/"
    pg.goto(u,wait_until="domcontentloaded",timeout=45000)
    try: pg.wait_for_load_state("networkidle",timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(1500)

    d=pg.evaluate("""() => {
      const T=e=>(e?.textContent||'').trim();
      const A=e=>e?.getAttribute?.bind(e);
      const metas={};
      for(const m of document.querySelectorAll('meta')){
        const k=m.getAttribute('property')||m.getAttribute('name')||m.getAttribute('itemprop');
        const v=m.getAttribute('content');
        if(k&&v){ if(!metas[k]) metas[k]=[]; if(!metas[k].includes(v)) metas[k].push(v); }
      }
      const jsonld=[...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(x=>x.textContent).filter(Boolean);
      const links=[...document.querySelectorAll('a[href]')].map(a=>({text:T(a),href:a.href}));
      const tags=links.filter(x=>/\/(?:en|vn|ja|zh(?:-cn|-tw)?)\/tag\/\d+(?:\/|$)/i.test(new URL(x.href,location.href).pathname));
      const crumbs=[...document.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="breadcrumb" i] a')].map(a=>({text:T(a),href:a.href}));
      const headings=[...document.querySelectorAll('h1,h2,h3')].map(T).filter(Boolean);
      const times=[...document.querySelectorAll('time,[datetime]')].map(e=>({text:T(e),datetime:e.getAttribute('datetime')||''}));
      const images=[...document.images].map(i=>({src:i.currentSrc||i.src||'',alt:i.alt||'',width:i.naturalWidth||0,height:i.naturalHeight||0}));
      const videoPosters=[...document.querySelectorAll("video")].map(v=>v.poster||v.getAttribute("poster")||"").filter(Boolean);
      const canonical=document.querySelector('link[rel="canonical"]')?.href||location.href;
      const lang=document.documentElement.lang||'';
      const bodyText=T(document.body);
      return {metas,jsonld,tags,crumbs,headings,times,images,videoPosters,canonical,lang,bodyText};
    }""")

    metas=d.get("metas") or {}
    def mfirst(*keys):
        for k in keys:
            v=metas.get(k)
            if isinstance(v,list) and v: return v[0]
            if isinstance(v,str) and v: return v
        return ""

    parsed_ld=[]
    for raw in d.get("jsonld") or []:
        try:
            x=json.loads(raw)
            parsed_ld.extend(x if isinstance(x,list) else [x])
        except Exception: pass

    video_ld={}
    def walk(x):
        nonlocal video_ld
        if isinstance(x,dict):
            typ=x.get("@type")
            if typ in ("VideoObject","Movie") and not video_ld: video_ld=x
            for v in x.values(): walk(v)
        elif isinstance(x,list):
            for v in x: walk(v)
    walk(parsed_ld)

    tags=[]; seen=set()
    for x in d.get("tags") or []:
        name=norm(x.get("text"))
        href=x.get("href") or ""
        if not name or name.casefold() in seen: continue
        seen.add(name.casefold())
        tm=re.search(r"/tag/(\d+)",href)
        tags.append({"name":name,"id":tm.group(1) if tm else "","href":href})

    title=mfirst("og:title","twitter:title") or (d.get("headings") or [""])[0]
    description=mfirst("og:description","description","twitter:description")
    poster=mfirst("og:image","twitter:image") or str(video_ld.get("thumbnailUrl") or "")
    if not poster:
        imgs=d.get("images") or []
        candidates=[x.get("src") for x in imgs if x.get("src") and int(x.get("width") or 0)>=240 and int(x.get("height") or 0)>=120]
        poster=candidates[0] if candidates else ""
        if poster: poster_source="rendered.img"

    # Keep both normalized useful fields and raw page metadata so no available metadata is discarded.
    result={
      "id":vid,
      "url":d.get("canonical") or pg.url,
      "title":title,
      "description":description,
      "poster":poster,
      "poster_stable":poster,
      "poster_source":poster_source,
      "official_tags":[x["name"] for x in tags],
      "official_tag_refs":tags,
      "upload_date":str(video_ld.get("uploadDate") or video_ld.get("datePublished") or ""),
      "duration":str(video_ld.get("duration") or ""),
      "content_url":str(video_ld.get("contentUrl") or ""),
      "embed_url":str(video_ld.get("embedUrl") or ""),
      "keywords":video_ld.get("keywords") or mfirst("keywords"),
      "author":video_ld.get("author") or video_ld.get("creator") or "",
      "interaction_statistic":video_ld.get("interactionStatistic") or "",
      "language":d.get("lang") or "",
      "headings":d.get("headings") or [],
      "breadcrumbs":d.get("crumbs") or [],
      "times":d.get("times") or [],
      "meta":metas,
      "jsonld":parsed_ld,
      "scanned_at":now()
    }
    return result

def poster_probe(url):
    if not url: return {"ok":False,"status":0,"content_type":"","bytes":0}
    try:
        r=requests.get(url,timeout=20,stream=True,headers={"User-Agent":"Mozilla/5.0","Referer":BASE+"/"})
        n=0
        for chunk in r.iter_content(65536):
            n+=len(chunk)
            if n>=131072: break
        ct=r.headers.get("content-type","")
        return {"ok":r.status_code==200 and ct.startswith("image/") and n>0,
                "status":r.status_code,"content_type":ct,"bytes_checked":n}
    except Exception as e:
        return {"ok":False,"status":0,"error":repr(e)}

def git_run(*args, check=True):
    return subprocess.run(["git",*args],check=check,text=True,capture_output=True)

def publish_batch(results, cp, force=False):
    """Publish every 20 newly completed metadata records, same cadence as link scanner.
    Git failures are publication failures only; they never turn a META OK movie into pending.
    """
    published=int(cp.get("published_count",0) or 0)
    ordered=sorted(results.values(),key=lambda x:int(x.get("id") or 0))
    total=len(ordered)
    target=total if force else (total//BATCH_SIZE)*BATCH_SIZE
    if target<=published: return True
    payload={
      "version":1,"kind":"av01-metadata-poster","updated_at":now(),
      "count":target,"movies":ordered[:target]
    }
    atomic_json(PUBLISH_PATH,payload)
    try:
        # Rebase immediately before publication so a long metadata run can coexist with link-scanner pushes.
        git_run("pull","--rebase","origin","av01-metadata-poster-pass")
        git_run("add",str(PUBLISH_PATH).replace("\\","/"))
        status=git_run("status","--porcelain",check=False).stdout
        if str(PUBLISH_PATH).replace("\\","/") in status:
            git_run("commit","-m",f"data(av01): publish metadata/poster through {target} movies")
        git_run("push","origin","HEAD:av01-metadata-poster-pass")
        cp["published_count"]=target
        cp["last_publish_at"]=now()
        print(f"[META PUBLISHED] {target}",flush=True)
        return True
    except Exception as e:
        cp["publish_error"]=repr(e)
        print(f"[META PUBLISH RETRY LATER] target={target} {e!r}",flush=True)
        return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",default=str(DEFAULT_OUT))
    ap.add_argument("--headed",action="store_true")
    ap.add_argument("--retry-pending",action="store_true")
    ap.add_argument("--test20",action="store_true",help="stop after first 20 META OK records are published")
    args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    cp_path=out/"checkpoint.json"; result_path=out/"metadata.json"
    cp={"done":[],"pending":{},"started_at":now(),"source_catalog":str(CATALOG)}
    if cp_path.exists():
        try: cp.update(json.loads(cp_path.read_text(encoding="utf-8")))
        except Exception: pass
    results={}
    if result_path.exists():
        try: results=json.loads(result_path.read_text(encoding="utf-8"))
        except Exception: results={}
    done=set(map(str,cp.get("done") or []))
    pending=cp.get("pending") or {}

    from playwright.sync_api import sync_playwright
    catalog=load_catalog()
    print(f"[META] GitHub/local catalog IDs={len(catalog)} done={len(done)} pending={len(pending)}",flush=True)

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=not args.headed)
        ctx=browser.new_context(locale="en-US",user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36")
        pg=ctx.new_page()
        for idx,(vid,old) in enumerate(catalog,1):
            if vid in done: continue
            if vid in pending and not args.retry_pending:
                last=float(pending[vid].get("ts_epoch",0) or 0)
                if time.time()-last<RETRY_SECONDS: continue
            try:
                meta=extract_page(pg,vid,old)
                probe=poster_probe(meta.get("poster") or meta.get("poster_stable"))
                meta["poster_probe"]=probe
                if not meta.get("title") or not meta.get("official_tags"):
                    raise RuntimeError("metadata incomplete: missing title/tags")
                if not probe.get("ok"):
                    raise RuntimeError(f"poster failed: {probe}")
                results[vid]=meta
                done.add(vid); pending.pop(vid,None)
                print(f"[META OK] {idx}/{len(catalog)} id={vid} tags={len(meta['official_tags'])} poster={probe.get('status')}",flush=True)
            except Exception as e:
                pending[vid]={"error":repr(e),"ts":now(),"ts_epoch":time.time()}
                print(f"[META PENDING] {idx}/{len(catalog)} id={vid} {e!r}",flush=True)
            cp.update({"done":sorted(done,key=lambda x:int(x)),"pending":pending,"updated_at":now(),
                       "catalog_ids":len(catalog),"done_count":len(done),"pending_count":len(pending)})
            atomic_json(result_path,results); atomic_json(cp_path,cp)
            publish_batch(results,cp)
            atomic_json(cp_path,cp)
            if args.test20 and int(cp.get("published_count",0) or 0)>=20:
                print("[META TEST20 DONE] 20 records published to GitHub; stop for inspection.",flush=True)
                break
        browser.close()

    # Merge enrichment into a separate catalog file. Never overwrite live catalog automatically.
    enriched=[]
    for vid,old in catalog:
        x=dict(old)
        if vid in results:
            x.update(results[vid])
            x["metadata_ok"]=True
            x["poster_ok"]=bool(results[vid].get("poster_probe",{}).get("ok"))
        enriched.append(x)
    atomic_json(out/"av01-catalog-enriched.json",enriched)
    print(f"[META DONE PASS] source={len(catalog)} ok={len(done)} pending={len(pending)}",flush=True)

if __name__=="__main__":
    main()
