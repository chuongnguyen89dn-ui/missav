#!/usr/bin/env python3
# AV01 metadata/poster enrichment pass.
# Reads every numeric AV01 id currently present in data/av01-catalog.json.
# Independent checkpoint/resume. Does NOT resolve/probe video streams.

import argparse, json, re, time, subprocess
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests

BASE="https://www.av01.media"
ROOT=Path(".")
DMM="https://pics.dmm.co.jp/mono/movie/adult"
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


def movie_code(old, meta=None):
    """Extract product code from AV01 data/title. Never treat AV01.tv as a code."""
    for src in (old, meta or {}):
        for k in ("code","product_code","dvd_id","number"):
            v=str(src.get(k) or "").strip()
            if v and v.upper()!="AV-01":
                return v.upper()
    title=str((meta or {}).get("title") or old.get("title") or "")
    head=title.split("•",1)[0].split("-lada",1)[0].strip()
    pats=[
        r"^(FC2)[-_ ]?(PPV)[-_ ]?(\\d{4,10})(?:\\b|$)",
        r"^([0-9]{2,4}[A-Za-z]{2,12})[-_ ]?(\\d{2,7})(?:\\b|$)",
        r"^([A-Za-z]{2,12})[-_ ]?(\\d{2,7})(?:\\b|$)",
    ]
    for i,pat in enumerate(pats):
        m=re.search(pat,head,re.I)
        if not m: continue
        if i==0: code=f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        else: code=f"{m.group(1)}-{m.group(2)}"
        if code.upper()!="AV-01": return code.upper()
    return ""

def dmm_poster(code):
    slug=re.sub(r"[^a-z0-9]","",(code or "").lower())
    return f"{DMM}/{slug}/{slug}pl.jpg" if slug else ""

def extract_page(pg, vid, old):
    # Open by known catalog URL first; numeric-ID fallback is stable enough for redirect/canonical discovery.
    u=old.get("url") or f"{BASE}/en/video/{vid}/"
    pg.goto(u,wait_until="domcontentloaded",timeout=25000)
    try: pg.wait_for_load_state("networkidle",timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(1500)

    d=pg.evaluate(r"""() => {
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
      const tags=links.filter(x=>{ const p=new URL(x.href,location.href).pathname; return /\/tag\//i.test(p) || /\/tags?\//i.test(p); });
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
    if not tags:
        old_tags=old.get("official_tags") or old.get("tags") or []
        if isinstance(old_tags,str): old_tags=[x.strip() for x in old_tags.split(",") if x.strip()]
        for x in old_tags:
            name=norm(x.get("name") if isinstance(x,dict) else str(x))
            if name and name.casefold() not in seen:
                seen.add(name.casefold()); tags.append({"name":name,"id":"","href":""})

    title=mfirst("og:title","twitter:title","title") or str(video_ld.get("name") or "") or (d.get("headings") or [""])[0] or str(old.get("title") or "")
    description=mfirst("og:description","description","twitter:description")
    poster_source=""
    vp=d.get("videoPosters") or []
    poster=vp[0] if vp else ""
    if poster: poster_source="video.poster"
    if not poster:
        poster=mfirst("og:image","twitter:image") or str(video_ld.get("thumbnailUrl") or "")
        if poster: poster_source="meta/jsonld"
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

def poster_auth_info(url):
    """Describe AV01 cover signing without assuming it equals HLS access_token."""
    try:
        q=parse_qs(urlparse(url or "").query)
        exp=int((q.get("expires") or ["0"])[0] or 0)
        return {"signed":bool(q.get("token_v2")),"expires":exp,"expires_at":datetime.fromtimestamp(exp,timezone.utc).isoformat() if exp else "","ip":(q.get("ip") or [""])[0]}
    except Exception as e:
        return {"signed":False,"error":repr(e)}

def poster_probe(url):
    if not url: return {"ok":False,"status":0,"content_type":"","bytes":0}
    try:
        r=requests.get(url,timeout=20,stream=True,headers={"User-Agent":"Mozilla/5.0","Referer":BASE+"/"})
        n=0
        for chunk in r.iter_content(65536):
            n+=len(chunk)
            if n>=131072: break
        ct=r.headers.get("content-type","")
        final=r.url
        placeholder=("noimage" in final.lower() or "now_printing" in final.lower())
        return {"ok":r.status_code==200 and ct.startswith("image/") and n>0 and not placeholder,
                "status":r.status_code,"content_type":ct,"bytes_checked":n,
                "placeholder":placeholder,"final_url":final}
    except Exception as e:
        return {"ok":False,"status":0,"error":repr(e)}

def git_run(*args, check=True):
    return subprocess.run(["git",*args],check=check,text=True,capture_output=True)

def publish_batch(results, cp, force=False):
    """Publish every 20 newly completed metadata records, same cadence as link scanner.
    Git failures are publication failures only; they never turn a META OK movie into pending.
    """
    published=int(cp.get("published_count",0) or 0)
    # Preserve the original addon/catalog order; never sort by numeric AV01 id.
    source_order=[vid for vid,_ in load_catalog()]
    ordered=[results[vid] for vid in source_order if vid in results]
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
    ap.add_argument("--test20",action="store_true")
    ap.add_argument("--headed",action="store_true")
    args=ap.parse_args()
    catalog=load_catalog()
    if args.test20: catalog=catalog[:20]
    out=DEFAULT_OUT/("test20" if args.test20 else "full")
    out.mkdir(parents=True,exist_ok=True)
    results={}; failures={}
    from playwright.sync_api import sync_playwright
    print(f"[META START] IDs={len(catalog)}",flush=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=not args.headed)
        ctx=browser.new_context(locale="en-US",user_agent="Mozilla/5.0")
        pg=ctx.new_page()
        for idx,(vid,oldm) in enumerate(catalog,1):
            try:
                meta=extract_page(pg,vid,oldm)
                # Metadata always comes from AV01. Poster comes only from DMM.
                code=movie_code(oldm,meta)
                dmm=dmm_poster(code)
                probe=poster_probe(dmm) if dmm else {"ok":False,"status":0,"error":"movie_code_not_found"}
                final=str(probe.get("final_url") or "")
                placeholder=("noimage" in final.lower() or "now_printing" in final.lower())
                if placeholder: probe["ok"]=False
                probe["placeholder"]=placeholder
                meta["movie_code"]=code
                meta["poster"]=dmm if probe.get("ok") else None
                meta["poster_stable"]=meta["poster"]
                meta["poster_source"]="dmm" if probe.get("ok") else ""
                meta["poster_probe"]=probe
                meta["poster_dmm_missing"]=not bool(probe.get("ok"))
                meta.pop("poster_auth",None)
                missing=[]
                if not meta.get("title"): missing.append("title")
                if not meta.get("official_tags"): missing.append("tags")
                # Missing DMM poster is allowed and never makes AV01 metadata incomplete.
                meta["missing_fields"]=missing
                meta["metadata_complete"]=not missing
                results[vid]=meta
                print(f"[META] {idx}/{len(catalog)} id={vid} missing={missing}",flush=True)
            except Exception as e:
                failures[vid]={"error":repr(e),"at":now()}
                print(f"[META ERROR] {idx}/{len(catalog)} id={vid} {e!r}",flush=True)
            atomic_json(out/"results.json",results)
            atomic_json(out/"failures.json",failures)
        browser.close()
    report={"attempted":len(catalog),"records":len(results),"errors":len(failures),
            "complete":sum(1 for x in results.values() if x.get("metadata_complete")),
            "incomplete":sum(1 for x in results.values() if not x.get("metadata_complete")),
            "failures":failures,"updated_at":now()}
    atomic_json(out/"report.json",report)
    if args.test20:
        atomic_json(ROOT/"data"/"av01-metadata-test20-report.json",report)
        atomic_json(ROOT/"data"/"av01-metadata-test20-results.json",results)
        try:
            git_run("add","data/av01-metadata-test20-report.json","data/av01-metadata-test20-results.json")
            git_run("commit","-m","test(av01): save latest metadata test20 results",check=False)
            git_run("push","origin","HEAD:av01-metadata-poster-pass")
            print("[GITHUB] TEST20 RESULTS PUSHED",flush=True)
        except Exception as e:
            print(f"[GITHUB ERROR] {e!r}",flush=True)
    print(f"[META DONE] attempted={report['attempted']} records={report['records']} complete={report['complete']} incomplete={report['incomplete']} errors={report['errors']}",flush=True)
    print(f"[REPORT] {out/'report.json'}",flush=True)

if __name__=="__main__":
    main()
