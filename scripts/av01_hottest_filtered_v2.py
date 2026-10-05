#!/usr/bin/env python3
import json,time,requests
from pathlib import Path
from urllib.parse import urljoin,parse_qs,urlparse,urlencode,urlunparse

BASE="https://www.av01.media"; TARGET=20
OUT=Path("av01_hottest_filtered"); POSTERS=OUT/"posters"; DATA=Path("data")
OUT.mkdir(exist_ok=True); POSTERS.mkdir(exist_ok=True); DATA.mkdir(exist_ok=True)
INC=["big tits","big boobs","large breasts","huge breasts","huge tits","huge boobs","busty","big breasts"]
EXC=["toy","sex toys","dildo","anal","cross dressing","lesbian","gay","shemale","transsexual","mature","熟女","mother","milf"]
s=requests.Session(); s.headers.update({"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36","Accept":"application/json,text/plain,*/*","Accept-Language":"en-US,en;q=0.9","Origin":BASE,"Referer":BASE+"/en/videos/hottest"})

def names(a):
    z=[]
    for x in a or []:
        if isinstance(x,dict): z.append(x.get("name") or x.get("title") or x.get("name_en") or str(x.get("id","")))
        else:z.append(str(x))
    return [x for x in z if x]

def yearof(m):
    for k in ("published_time","uploaded_time","release_date","date","year"):
        import re
        q=re.search(r"20(?:24|25|26)",str(m.get(k,"")))
        if q:return int(q.group())
    return None

def signed_asset(url):
    if not url:return None
    u=urljoin(BASE,url)
    try:
        g=s.get("https://files.iw01.xyz/edge/geo.js?json",headers={"Origin":BASE,"Referer":BASE+"/"},timeout=15)
        if g.ok:
            j=g.json();p=urlparse(u);q=parse_qs(p.query,keep_blank_values=True)
            for k in ("token_v2","expires","ip"):
                if k in j and k not in q:q[k]=[str(j[k])]
            u=urlunparse(p._replace(query=urlencode(q,doseq=True)))
    except Exception:pass
    return u

def save_poster(meta,vid):
    cand=[]
    if isinstance(meta.get("cover"),str):cand.append(meta["cover"])
    cand += [f"https://files.iw01.xyz/covers/{vid}/800.webp",f"https://files.iw01.xyz/covers/{vid}/400.webp"]
    for raw in dict.fromkeys(cand):
        try:
            r=s.get(signed_asset(raw),headers={"Referer":BASE+"/","Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8"},timeout=20)
            ct=(r.headers.get("content-type") or "").lower()
            if r.ok and ct.startswith("image/") and len(r.content)>500:
                ext=".jpg" if "jpeg" in ct else ".png" if "png" in ct else ".webp"
                f=POSTERS/(str(vid)+ext);f.write_bytes(r.content);return str(f)
        except Exception:pass
    return None

def has1080(vid):
    try:
        r=s.get(f"{BASE}/api/v1/videos/{vid}/manifest/master.m3u8",headers={"Accept":"application/vnd.apple.mpegurl,*/*"},timeout=20)
        if not r.ok:return False
        t=r.text.lower()
        import re
        return bool(re.search(r"resolution=\d+x(?:1080|1[1-9]\d\d|[2-9]\d{3})",t)) or "sv3-v1-a1.m3u8" in t
    except Exception:return False

accepted=[];seen=set();page=1;stats={"scanned":0,"year":0,"include":0,"exclude":0,"quality":0,"error":0}
while len(accepted)<TARGET:
    r=s.post(BASE+"/api/v1/videos/search?lang=en",json={"query":"","pagination":{"page":page,"limit":20}},timeout=30)
    print("[LIST]",page,r.status_code,flush=True);r.raise_for_status()
    listing=r.json(); videos=listing.get("videos") or []
    if not videos:break
    for v in videos:
        if len(accepted)>=TARGET:break
        vid=str(v.get("id") or "")
        if not vid or vid in seen:continue
        seen.add(vid);stats["scanned"]+=1
        try:
            d=s.get(f"{BASE}/api/v1/videos/{vid}",timeout=20)
            meta=d.json() if d.ok else v
            (OUT/f"{vid}.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding="utf-8")
            y=yearof(meta)
            tags=names(meta.get("tags"))
            b=(" ".join(tags+[str(meta.get("title","")),str(meta.get("description",""))])).lower()
            mi=[x for x in INC if x in b]; me=[x for x in EXC if x in b]
            reason=None
            if not y or y<2024 or y>2026:stats["year"]+=1;reason="year"
            elif not mi:stats["include"]+=1;reason="include"
            elif me:stats["exclude"]+=1;reason="exclude"
            elif not has1080(vid):stats["quality"]+=1;reason="quality"
            if not reason:
                poster=save_poster(meta,vid)
                accepted.append({"id":meta.get("id") or vid,"dvd_id":meta.get("dvd_id"),"title":meta.get("title"),"title_en":(meta.get("title_translations") or {}).get("en"),"description":meta.get("description"),"description_en":(meta.get("description_translations") or {}).get("en"),"tags":tags,"actresses":names(meta.get("actresses")),"cover":meta.get("cover"),"poster_file":poster,"poster":meta.get("cover") or f"https://files.iw01.xyz/covers/{vid}/800.webp","year":y,"quality":"1080p+","page_url":f"{BASE}/vn/video/{vid}"})
            print(json.dumps({"id":vid,"result":reason or "ACCEPT","matched_include":mi,"matched_exclude":me,"valid":len(accepted),"target":TARGET,"stats":stats},ensure_ascii=False),flush=True)
        except Exception as e:
            stats["error"]+=1;print("[ITEM]",vid,repr(e),flush=True)
        (DATA/"av01-progress.json").write_text(json.dumps({"page":page,"valid":len(accepted),"target":TARGET,"stats":stats,"movies":accepted},ensure_ascii=False,indent=2),encoding="utf-8")
    page+=1;time.sleep(1)

catalog={"updated_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"source":BASE+"/vn/videos/hottest","movies":accepted}
(DATA/"av01-catalog.json").write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"done":len(accepted)>=TARGET,"valid":len(accepted),"target":TARGET,"next_page":page,"stats":stats},ensure_ascii=False))
raise SystemExit(0 if len(accepted)>=TARGET else 3)
