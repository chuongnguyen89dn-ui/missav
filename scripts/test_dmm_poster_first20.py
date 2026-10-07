#!/usr/bin/env python3
# Test DMM poster rule against the first 20 movies in AV01 catalog order.
import json, re
from pathlib import Path
import requests

CATALOG=Path("data/av01-catalog.json")
OUT=Path("data/dmm-poster-test20.json")
DMM="https://pics.dmm.co.jp/mono/movie/adult"
UA={"User-Agent":"Mozilla/5.0"}

def load_movies():
    raw=json.loads(CATALOG.read_text(encoding="utf-8"))
    if isinstance(raw,list): return raw
    for k in ("movies","data","items","results"):
        if isinstance(raw,dict) and isinstance(raw.get(k),list): return raw[k]
    return []

def movie_code(m):
    # Prefer explicit code fields, then extract JAV code from title.
    for k in ("code","product_code","dvd_id","number"):
        v=str(m.get(k) or "").strip()
        if re.fullmatch(r"[A-Za-z]{2,12}-?\d{2,6}",v):
            return v.upper()
    title=str(m.get("title") or "")
    hit=re.search(r"(?<![A-Za-z0-9])([A-Za-z]{2,12})[-_ ]?(\d{2,6})(?!\d)",title)
    return (hit.group(1)+"-"+hit.group(2)).upper() if hit else ""

def dmm_url(code):
    slug=re.sub(r"[^a-z0-9]","",code.lower())
    return f"{DMM}/{slug}/{slug}pl.jpg" if slug else ""

def probe(url):
    try:
        r=requests.get(url,headers=UA,timeout=20,stream=True,allow_redirects=True)
        ct=(r.headers.get("content-type") or "").lower()
        n=0
        for c in r.iter_content(65536):
            n+=len(c)
            if n>=131072: break
        return {"ok":r.status_code==200 and ct.startswith("image/") and n>0,
                "status":r.status_code,"content_type":ct,"bytes_checked":n,
                "final_url":r.url}
    except Exception as e:
        return {"ok":False,"error":repr(e)}

def main():
    movies=load_movies()[:20]
    rows=[]
    for i,m in enumerate(movies,1):
        code=movie_code(m)
        url=dmm_url(code)
        p=probe(url) if url else {"ok":False,"error":"movie_code_not_found"}
        row={"order":i,"av01_id":str(m.get("id") or m.get("video_id") or ""),
             "title":m.get("title") or "","code":code,"poster":url,"probe":p}
        rows.append(row)
        print(f"[DMM] {i}/20 id={row['av01_id']} code={code or '-'} poster={'OK' if p.get('ok') else 'FAIL'}",flush=True)
    payload={"source":"DMM pics","rule":"lowercase movie code, remove separators => {slug}/{slug}pl.jpg",
             "attempted":len(rows),"ok":sum(1 for x in rows if x["probe"].get("ok")),
             "failed":sum(1 for x in rows if not x["probe"].get("ok")),"movies":rows}
    OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"[DONE] ok={payload['ok']} failed={payload['failed']} report={OUT}",flush=True)

if __name__=="__main__":
    main()
