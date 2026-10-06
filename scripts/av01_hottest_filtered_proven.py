#!/usr/bin/env python3
# AV01 EN Hottest pipeline v3
# Official tags -> filter -> resolve queue -> signed 1080 playlist -> 200/200.
# Only successful probe counts toward requested count.

import argparse, json, re, sys, time, subprocess, os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse
import requests

HOT = "https://www.av01.media/en/videos/hottest"
HEARTBEAT_INTERVAL = 30
STALL_SECONDS = 300
PENDING_RETRY_SECONDS = 60

def write_heartbeat(path, **kw):
    try:
        payload={"ts":datetime.now(timezone.utc).isoformat(), **kw}
        Path(path).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    except Exception:
        pass


# Large-breast related tags. "Beautiful Tits" is included because AV01 currently uses it
# on titles that otherwise may not carry literal "Big Tits".
KEEP = [
    ("Big Tits", r"\bbig\s*tits?\b"),
    ("Big Boobs", r"\bbig\s*boobs?\b"),
    ("Large Breasts", r"\blarge\s*breasts?\b"),
    ("Big Breasts", r"\bbig\s*breasts?\b"),
    ("Huge Breasts", r"\bhuge\s*breasts?\b"),
    ("Huge Tits", r"\bhuge\s*tits?\b"),
    ("Huge Boobs", r"\bhuge\s*boobs?\b"),
    ("Busty", r"\bbusty\b"),
    ("Beautiful Tits", r"\bbeautiful\s*tits?\b"),
]

# Hard blocks are evaluated ONLY against official #tags of the current video.
BLOCK = [
    ("Anal", r"^(?:anal|hậu\\s*môn|lỗ\\s*nhị)$"),
    ("Toy/Sex Toys", r"^(?:toy|toys|sex\s*toy|sex\s*toys|dildo|dildos)$"),
    ("Cross Dressing", r"^(?:cross[\s-]*dressing|crossdresser|cross[\s-]*dresser)$"),
    ("Lesbian/Gay", r"^(?:lesbian|gay|đồng\\s*tính\\s*nữ|đồng\\s*tính\\s*nam|bách\\s*hợp)$"),
    ("Shemale/Transsexual", r"^(?:shemale|transsexual|transgender|chuyển\\s*giới|người\\s*chuyển\\s*giới)$"),
    ("Mature", r"^(?:mature|mature\s*woman|mother|milf)$"),
]

def normalize_tag(t):
    return re.sub(r"\s+", " ", re.sub(r"^#+", "", (t or "").strip())).strip()

def keep_hits(tags):
    text = " | ".join(tags)
    return [name for name, pat in KEEP if re.search(pat, text, re.I)]

def block_hits(tags):
    hits = []
    for t in tags:
        nt = normalize_tag(t)
        for name, pat in BLOCK:
            if re.search(pat, nt, re.I) and name not in hits:
                hits.append(name)
    return hits

def sign(u, token, ro=""):
    p = urlparse(u)
    q = parse_qs(p.query, keep_blank_values=True)
    if (p.hostname or "").endswith("iw01.xyz"):
        q["access_token"] = [token]
        if ro and "ro" not in q:
            q["ro"] = [ro]
    return urlunparse(p._replace(query=urlencode(q, doseq=True)))

def rewrite(txt, base, token, ro=""):
    out = []
    for ln in txt.splitlines():
        ln = re.sub(
            r'URI="([^"]+)"',
            lambda m: 'URI="' + sign(urljoin(base, m.group(1)), token, ro) + '"',
            ln,
        )
        if ln.strip() and not ln.strip().startswith("#"):
            ln = sign(urljoin(base, ln.strip()), token, ro)
        out.append(ln)
    return "\n".join(out) + "\n"

def cards(pg):
    return pg.locator("a[href]").evaluate_all("""els=>{
      const s=new Set(),o=[];
      for(const a of els){
        let u,p;
        try{u=new URL(a.getAttribute('href')||'',location.href).href;p=new URL(u).pathname}catch(e){continue}
        if(!/\\/video\\/\\d+(?:\\/|$)/i.test(p)||s.has(u))continue;
        s.add(u);
        const b=a.closest('article,li,[class*="card"],[class*="video"],[class*="item"]')||a.parentElement||a;
        const i=b.querySelector('img')||a.querySelector('img');
        o.push({url:u,text:(b.innerText||a.innerText||'').trim(),
          poster:i?(i.currentSrc||i.src||''):'',alt:i?(i.alt||''):''});
      }
      return o;
    }""")

def load_more_cards(pg, current_count, page=None):
    """Load one exact Hottest API page inside the live browser session and merge its video URLs.
    Returns (cards, item_count, ok).  A successful short/empty page is a real end-of-list signal;
    HTTP/rate-limit failures are not.
    """
    if page is None:
        page = current_count // 20 + 1
    api = f"/api/v1/videos/types/hottest?page={page}&limit=20"
    print(f"[LOAD MORE API] page={page}", flush=True)
    try:
        data = pg.evaluate("""async (u) => {
          const r = await fetch(u, {credentials:'include', headers:{'accept':'application/json'}});
          const text = await r.text();
          return {status:r.status, text};
        }""", api)
        if data.get("status") == 429:
            print("[LOAD MORE API] 429; keep waiting", flush=True)
            return cards(pg), None, False
        if data.get("status") != 200:
            print(f"[LOAD MORE API] HTTP {data.get('status')}", flush=True)
            return cards(pg), None, False
        payload = json.loads(data.get("text") or "{}")
        items = payload.get("data", payload)
        if isinstance(items, dict):
            for k in ("videos","items","results","data"):
                if isinstance(items.get(k), list):
                    items = items[k]; break
        if not isinstance(items, list):
            print("[LOAD MORE API] unexpected payload", flush=True)
            return cards(pg), None, False
        added = pg.evaluate("""(items)=>{
          const root=document.createElement('div'); root.id='av01-scanner-extra'; root.style.display='none';
          for(const v of items){
            const id=String(v.id||v.video_id||v.videoId||'');
            if(!id) continue;
            const slug=String(v.slug||v.code||v.title||id).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
            const a=document.createElement('a'); a.href='/en/video/'+id+'/'+slug; a.textContent=String(v.code||v.title||id);
            root.appendChild(a);
          }
          document.body.appendChild(root); return root.querySelectorAll('a').length;
        }""", items)
        now=cards(pg)
        print(f"[LOAD MORE API] items={len(items)} merged={len(now)}", flush=True)
        return now, len(items), True
    except Exception as e:
        print(f"[LOAD MORE API] failed: {e!r}", flush=True)
        return cards(pg), None, False

def read_meta(pg, c):
    d = pg.evaluate("""()=>{const T=e=>(e?.textContent||'').trim(),m={};
      document.querySelectorAll('meta').forEach(x=>{
        const k=x.getAttribute('property')||x.getAttribute('name');
        if(k&&x.content)m[k]=x.content;
      });
      const heads=[...document.querySelectorAll('h1,h2,h3')].map(T).filter(Boolean);
      const tagLinks=[...document.querySelectorAll('a[href]')].map(a=>({text:T(a),href:a.href}))
        .filter(x=>{
          try{return x.text && /\\/(?:en|vn|ja|zh(?:-cn|-tw)?)\\/tag\\/\\d+(?:\\/|$)/i.test(new URL(x.href,location.href).pathname)}
          catch(e){return false}
        });
      return {metas:m,heads,tagLinks};
    }""")
    tags, seen = [], set()
    for x in d["tagLinks"]:
        t = normalize_tag(x["text"])
        if t and t.lower() not in seen:
            seen.add(t.lower()); tags.append(t)
    mm = d["metas"]
    title = mm.get("og:title") or mm.get("twitter:title") or (d["heads"][0] if d["heads"] else c.get("text",""))
    desc = mm.get("og:description") or mm.get("description") or ""
    poster = mm.get("og:image") or c.get("poster","")
    vm = re.search(r"/video/(\d+)", c["url"])
    sm = re.search(r"/video/\d+/([^/?#]+)", c["url"])
    # Collect useful textual metadata without using poster vision.
    extra = pg.evaluate("""()=> {
      const T=e=>(e?.textContent||'').trim();
      const out={};
      for(const el of document.querySelectorAll('time, [datetime], meta')) {
        const k=el.getAttribute('name')||el.getAttribute('property')||el.getAttribute('itemprop')||'';
        const v=el.getAttribute('datetime')||el.getAttribute('content')||T(el);
        if(k&&v) (out[k] ||= []).push(v);
      }
      const jsonlds=[...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(x=>x.textContent).filter(Boolean);
      return {extra:out,jsonlds};
    }""")
    # The pagination API may supply generic slugs such as "lada" or "lada-3p".
    # Prefer the actual product code embedded in AV01's canonical title.
    title_code = re.search(r"(?i)\\b((?:FC2[- ]?PPV[- ]?\\d+)|(?:[A-Z0-9]{2,12}[-_]\\d{2,7}))\\b", title or "")
    slug_code = sm.group(1).split("-lada")[0].upper() if sm else ""
    real_code = (title_code.group(1).replace("_","-").replace(" ","-").upper() if title_code else slug_code)
    return {
        "id": vm.group(1) if vm else "",
        "code": real_code,
        "url": c["url"], "title": title, "description": desc,
        "poster": poster, "official_tags": tags,
        "official_tag_refs": [{"name": normalize_tag(x["text"]), "href": x["href"], "id": (re.search(r"/tag/(\\d+)", x["href"]).group(1) if re.search(r"/tag/(\\d+)", x["href"]) else "")} for x in d["tagLinks"]],
        "extra_metadata": extra["extra"],
        "jsonld": extra["jsonlds"]
    }

def extract_year(m):
    """Return a publication/release year from AV01 metadata, or 0 when unavailable."""
    vals = []
    for k, arr in (m.get("extra_metadata") or {}).items():
        if re.search(r"date|upload|publish|release", str(k), re.I):
            vals.extend(arr if isinstance(arr,list) else [arr])
    vals.extend(m.get("jsonld") or [])
    for raw in vals:
        text = str(raw)
        # Prefer explicit date-bearing fields in JSON-LD / metadata.
        for pat in (
            r'"(?:datePublished|uploadDate|dateCreated|releaseDate)"\s*:\s*"((?:2024|2025|2026)[^"]*)"',
            r'\b(2024|2025|2026)[-/]\d{1,2}[-/]\d{1,2}\b',
            r'\b(2024|2025|2026)\b'
        ):
            mm = re.search(pat, text, re.I)
            if mm:
                y = re.search(r"20(?:24|25|26)", mm.group(0))
                if y: return int(y.group(0))
    return 0

def wait_for_tags(pg, c, seconds):
    # Do not accept tags=[] immediately. Poll because AV01 hydrates video metadata after DOMContentLoaded.
    deadline = time.time() + seconds
    last = None
    while time.time() < deadline:
        try:
            last = read_meta(pg, c)
            if last["official_tags"]:
                return last
        except Exception:
            pass
        pg.wait_for_timeout(300)
    return last or read_meta(pg, c)

def attach_capture(pg):
    state = {"sv": [], "ph": {}, "ch": {}, "token": "", "ro": ""}
    def on_request(r):
        lo = r.url.lower()
        if "/api/v1/videos/" in lo and "sv3-v1-a1.m3u8" in lo:
            state["sv"].append(r.url)
            state["ph"].update(r.headers)
        if "customers.iw01.xyz" in lo and ("sv3-v1-a1" in lo or "file90-" in lo):
            q = parse_qs(urlparse(r.url).query)
            if q.get("access_token"):
                state["token"] = q["access_token"][0]
                state["ro"] = (q.get("ro") or [""])[0]
                state["ch"] = dict(r.headers)
    pg.on("request", on_request)
    return state

def trigger_player(pg):
    # Try actual video first, then likely play controls. Do not click arbitrary page buttons.
    for sel in ("video", '[aria-label*="play" i]', '[class*="play" i]', '[id*="play" i]'):
        try:
            x = pg.locator(sel)
            if x.count():
                x.first.click(force=True, timeout=700)
                return
        except Exception:
            pass

def download_poster(meta, outdir):
    u = meta.get("poster") or ""
    if not u:
        return ""
    try:
        r = requests.get(u, headers={"Referer": meta["url"], "User-Agent": "Mozilla/5.0"}, timeout=20)
        r.raise_for_status()
        ct = (r.headers.get("content-type") or "").lower()
        ext = ".jpg"
        if "png" in ct: ext = ".png"
        elif "webp" in ct: ext = ".webp"
        f = outdir / f'{meta["id"]}_poster{ext}'
        f.write_bytes(r.content)
        return str(f.resolve())
    except Exception as e:
        print(f"  -> POSTER FAIL {meta.get('code','')}: {e!r}", flush=True)
        return ""

def finish_resolve(job, outdir):
    """Turn already captured sv3/token into direct playlist and probe it."""
    s = requests.Session()
    for ck in job["ctx"].cookies():
        try:
            s.cookies.set(ck["name"], ck["value"], domain=ck.get("domain"), path=ck.get("path","/"))
        except Exception:
            pass
    ban = {"host","content-length","connection","accept-encoding",":authority",":method",":path",":scheme"}
    h = {k:v for k,v in job["cap"]["ph"].items() if k.lower() not in ban}
    h["Referer"] = job["m"]["url"]
    r = s.get(job["cap"]["sv"][-1], headers=h, timeout=25)
    r.raise_for_status()
    direct = rewrite(r.text, r.url, job["cap"]["token"], job["cap"]["ro"])
    f = outdir / f'{job["m"]["id"]}_1080_direct.m3u8'
    f.write_text(direct, encoding="utf-8")

    urls = []
    for ln in direct.splitlines():
        mm = re.search(r'URI="([^"]+)"', ln)
        if mm: urls.append(mm.group(1))
        elif ln.startswith("http"): urls.append(ln)
        if len(urls) >= 2: break

    hh = {k:v for k,v in job["cap"]["ch"].items() if k.lower() not in ban}
    hh["Referer"] = job["m"]["url"]
    checks = []
    for u in urls:
        rr = s.get(u, headers=hh, timeout=20, stream=True)
        checks.append(rr.status_code); rr.close()

    job["m"]["matched_large_breast_tags"] = job["keep"]
    job["m"]["playlist"] = str(f.resolve())
    job["m"]["probe"] = "OK " + "/".join(map(str, checks))
    meta_file = outdir / f'{job["m"]["id"]}_metadata.json'
    meta_file.write_text(json.dumps(job["m"], ensure_ascii=False, indent=2), encoding="utf-8")
    job["m"]["metadata_file"] = str(meta_file.resolve())
    return job["m"], checks

def save_state(path, run_id, accepted, skipped, processed_ids, published_count, next_i=0, next_api_page=1, pending=None, list_exhausted=False):
    tmp = path.with_suffix(".tmp")
    payload={"run_id":run_id,"source":HOT,"accepted":accepted,"skipped":skipped,"processed_ids":sorted(processed_ids),"published_count":published_count,"next_i":next_i,"next_api_page":next_api_page,"pending":pending or [],"list_exhausted":bool(list_exhausted)}
    tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)

def add_pending(pending, item, reason, retry_count=0):
    key=str(item.get("id") or "") or item.get("url","")
    if not key: return
    for p in pending:
        if (str(p.get("id") or "") or p.get("url","")) == key:
            p["reason"]=reason; p["retry_count"]=max(int(p.get("retry_count",0)),retry_count); p["retry_after"]=time.time()+PENDING_RETRY_SECONDS; return
    pending.append({"id":str(item.get("id") or ""),"url":item.get("url",""),"text":item.get("title") or item.get("text",""),"poster":item.get("poster",""),"reason":reason,"retry_count":retry_count,"retry_after":time.time()+PENDING_RETRY_SECONDS})

def publish_batch(repo_root, accepted, run_id):
    n=(len(accepted)//20)*20
    if not n: return 0
    cat=repo_root/"data"/"av01-catalog.json"
    payload={"updated_at":datetime.now(timezone.utc).isoformat(),"source":HOT,"run_id":run_id,"clean_run":True,"count":n,"movies":accepted[:n]}
    cat.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    rel=cat.relative_to(repo_root).as_posix()
    subprocess.run(["git","add","--",rel],cwd=repo_root,check=True)
    changed=subprocess.run(["git","diff","--cached","--quiet"],cwd=repo_root).returncode!=0
    if changed:
        subprocess.run(["git","commit","-m",f"data(av01): publish verified batch through {n} movies"],cwd=repo_root,check=True)
        subprocess.run(["git","push","origin","main"],cwd=repo_root,check=True)
    return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=0, help="0 = scan all Hottest pages")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--tag-wait", type=float, default=4.0)
    ap.add_argument("--resolve-wait", type=float, default=12.0)
    ap.add_argument("--out", default="av01_hottest_filtered_20")
    a = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("pip install requests playwright\nplaywright install chromium"); sys.exit(2)

    repo_root=Path(__file__).resolve().parent.parent
    out=(repo_root/a.out).resolve(); out.mkdir(exist_ok=True)
    state_file=out/"checkpoint.json"
    run_id="av01-clean-en-hottest-20261005"
    accepted, skipped, processed_ids, published_count = [], [], set(), 0
    pending=[]; resume_api_page=0
    if state_file.exists():
        st=json.loads(state_file.read_text(encoding="utf-8"))
        if st.get("run_id")==run_id and st.get("source")==HOT:
            accepted=st.get("accepted",[]); skipped=st.get("skipped",[])
            processed_ids=set(st.get("processed_ids",[])); published_count=int(st.get("published_count",0))
            pending=st.get("pending",[]) or []; resume_api_page=int(st.get("next_api_page",0) or 0)
            print(f"[RESUME] processed={len(processed_ids)} accepted={len(accepted)} published={published_count} pending={len(pending)} api_page={resume_api_page or 'auto'}",flush=True)
        else:
            state_file.unlink()
    else:
        print("[CLEAN RUN] no old AV01 scan data imported",flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        listctx = browser.new_context(viewport={"width":1400,"height":950})
        lp = listctx.new_page()
        lp.goto(HOT, wait_until="domcontentloaded", timeout=45000)
        cs = []
        list_try = 0
        while not cs:
            list_try += 1
            for _ in range(16):
                lp.wait_for_timeout(500)
                cs = cards(lp)
                if cs: break
                try: lp.evaluate("window.scrollTo(0,document.body.scrollHeight)")
                except Exception: pass
            if cs: break
            delay = min(120, 15 * list_try)
            print(f"[LIST WAIT] no candidates; retry#{list_try} in {delay}s", flush=True)
            time.sleep(delay)
            try: lp.reload(wait_until="domcontentloaded", timeout=45000)
            except Exception as e: print(f"[LIST WAIT] reload: {e!r}", flush=True)
        print(f"Candidates: {len(cs)} | resolver slots: {a.workers}", flush=True)

        next_i = 0
        resolvers = []

        # Filtering is sequential/reliable; accepted resolvers remain alive and are polled
        # while subsequent candidates are filtered. This avoids premature program exit.
        no_growth = 0
        next_api_page = resume_api_page or (len(cs) // 20 + 1)
        list_exhausted = False
        heartbeat_file = out/"heartbeat.json"
        last_progress = time.time()
        last_heartbeat = 0
        last_snapshot = (len(cs), len(accepted), len(processed_ids), len(pending))
        while True:
            now_ts=time.time()
            snapshot=(len(cs),len(accepted),len(processed_ids),len(pending))
            if snapshot != last_snapshot:
                last_progress=now_ts; last_snapshot=snapshot
            if now_ts-last_heartbeat >= HEARTBEAT_INTERVAL:
                write_heartbeat(heartbeat_file,status="running",next_i=next_i,candidates=len(cs),
                                accepted=len(accepted),processed=len(processed_ids),pending=len(pending),resolvers=len(resolvers),
                                published=published_count,api_page=next_api_page,seconds_without_progress=int(now_ts-last_progress))
                last_heartbeat=now_ts
            if now_ts-last_progress >= STALL_SECONDS:
                print(f"[WATCHDOG] no progress for {STALL_SECONDS}s; saving checkpoint and restarting process",flush=True)
                save_state(state_file,run_id,accepted,skipped,processed_ids,published_count,next_i,next_api_page,pending,list_exhausted)
                write_heartbeat(heartbeat_file,status="watchdog_restart",accepted=len(accepted),
                                processed=len(processed_ids),api_page=next_api_page)
                raise SystemExit(75)
            # First harvest any resolver that is ready/expired.
            for job in list(resolvers):
                cap = job["cap"]
                if cap["sv"] and cap["token"] and time.time() >= job.get("retry_at",0):
                    try:
                        m, checks = finish_resolve(job, out)
                        if len(checks) >= 2 and all(x == 200 for x in checks[:2]):
                            if m["id"] not in {x.get("id") for x in accepted}: accepted.append(m)
                            processed_ids.add(m["id"])
                            if len(accepted) >= published_count + 20:
                                published_count=publish_batch(repo_root,accepted,run_id)
                                print(f"  -> GITHUB PUBLISHED {published_count}",flush=True)
                            save_state(state_file,run_id,accepted,skipped,processed_ids,published_count,next_i,next_api_page,pending,list_exhausted)
                            print(f"  -> DONE {len(accepted)} {m['code']} {m['probe']}", flush=True)
                            job["ctx"].close(); resolvers.remove(job)
                        else:
                            raise RuntimeError("probe failed "+str(checks))
                    except Exception as e:
                        msg = repr(e)
                        if "429" in msg:
                            job["wait429_tries"] = job.get("wait429_tries", 0) + 1
                            delay = min(120, 15 * job["wait429_tries"])
                            job["retry_at"] = time.time() + delay
                            print(f"  -> WAIT 429 {job['m']['code']} retry#{job['wait429_tries']} in {delay}s", flush=True)
                        else:
                            job["resolve_tries"] += 1
                            if job["resolve_tries"] <= 3:
                                delay = min(120, 15 * job["resolve_tries"])
                                job["retry_at"] = time.time() + delay
                                print(f"  -> RESOLVE RETRY {job['resolve_tries']}/3 {job['m']['code']} in {delay}s: {msg}", flush=True)
                            else:
                                skipped.append({"id":job["m"]["id"],"url":job["m"]["url"],"code":job["m"]["code"],
                                                "official_tags":job["m"]["official_tags"],"reason":"resolve "+msg})
                                processed_ids.add(job["m"]["id"])
                                save_state(state_file,run_id,accepted,skipped,processed_ids,published_count,next_i,next_api_page,pending,list_exhausted)
                                print(f"  -> RESOLVE FAIL {job['m']['code']} after retries: {msg}", flush=True)
                                job["ctx"].close(); resolvers.remove(job)
                elif not (cap["sv"] and cap["token"]) and time.time() >= job["deadline"]:
                    m = job["m"]
                    job["token_tries"] += 1
                    if job["token_tries"] <= 2:
                        print(f"  -> TOKEN RETRY {job['token_tries']}/2 {m['code']} (refresh player)", flush=True)
                        cap["sv"].clear(); cap["token"]=""; cap["ro"]=""
                        try:
                            job["pg"].reload(wait_until="domcontentloaded", timeout=45000)
                            trigger_player(job["pg"])
                        except Exception as e:
                            print(f"     refresh error: {e!r}", flush=True)
                        job["deadline"] = time.time() + a.resolve_wait
                    else:
                        print(f"  -> RESOLVE FAIL {m['code']}: no sv3/token after retries", flush=True)
                        skipped.append({"url":m["url"],"code":m["code"],"official_tags":m["official_tags"],
                                        "reason":"no sv3/token after retries"})
                        job["ctx"].close(); resolvers.remove(job)

            if a.count > 0 and len(accepted) >= a.count:
                break

            # When the current Hottest batch is exhausted, use the site's Load More.
            if next_i >= len(cs) and not list_exhausted:
                grown, item_count, api_ok = load_more_cards(lp, len(cs), next_api_page)
                if api_ok:
                    # Advance the API cursor even when this page contains only duplicates.
                    # Deriving page from merged-card count caused page=9 to repeat forever at 176 cards.
                    next_api_page += 1
                    if len(grown) > len(cs):
                        print(f"[LOAD MORE] candidates {len(cs)} -> {len(grown)}", flush=True)
                        cs = grown
                    no_growth = 0
                    if item_count is not None and item_count < 20:
                        list_exhausted = True
                        print(f"[LOAD MORE] end-of-site confirmed: API returned {item_count} items", flush=True)
                else:
                    no_growth += 1
                    delay = min(120, 15 * no_growth)
                    print(f"[LOAD MORE WAIT] API unavailable; retry page={next_api_page} in {delay}s", flush=True)
                    time.sleep(delay)

            if next_i >= len(cs) and list_exhausted and not resolvers:
                print("[SCAN] Hottest list exhausted and resolver queue empty", flush=True)
                break

            # Keep resolver queue filled, but don't schedule more than needed.
            needed = (a.count - len(accepted) - len(resolvers)) if a.count > 0 else a.workers
            if next_i < len(cs) and len(resolvers) < a.workers and needed > 0:
                idx = next_i + 1
                c = cs[next_i]; next_i += 1
                c = dict(c)
                cm=re.search(r"/video/(\d+)",c["url"]); cid=cm.group(1) if cm else ""
                if cid and cid in processed_ids:
                    continue
                m_id = re.search(r"/video/(\\d+)", c["url"])
                if m_id:
                    c["url"] = re.sub(r"/vn/video/", "/en/video/", c["url"], flags=re.I)
                ctx = browser.new_context(viewport={"width":1100,"height":760})
                pg = ctx.new_page()
                cap = attach_capture(pg)  # BEFORE goto
                try:
                    pg.goto(c["url"], wait_until="domcontentloaded", timeout=45000)
                    m = wait_for_tags(pg, c, a.tag_wait)
                    # Tags are mandatory metadata: retry the VN detail if the EN detail has none.
                    if not m["official_tags"]:
                        alt_url = re.sub(r"/en/video/", "/vn/video/", c["url"], flags=re.I)
                        try:
                            pg.goto(alt_url, wait_until="domcontentloaded", timeout=45000)
                            alt_c = dict(c)
                            alt_c["url"] = alt_url
                            m2 = wait_for_tags(pg, alt_c, max(a.tag_wait, 6.0))
                            if m2["official_tags"]:
                                m = m2
                        except Exception:
                            pass
                    keep = keep_hits(m["official_tags"])
                    block = block_hits(m["official_tags"])
                    year = extract_year(m)
                    m["year"] = year
                    print(f"[{idx}] {m['code']} year={year or '?'} tags={m['official_tags']}\n    prefer={keep or '-'} block={block or '-'}", flush=True)

                    if not m["official_tags"]:
                        skipped.append({"id":m["id"],"code":m["code"],"url":m["url"],"title":m["title"],
                                        "official_tags":[],"year":year,"reason":"official tags unavailable"})
                        print(f"  -> META WAIT {m['code']}: official tags unavailable; leave pending for retry", flush=True)
                        ctx.close()
                    elif year not in (2024, 2025, 2026):
                        skipped.append({"id":m["id"],"code":m["code"],"url":m["url"],"title":m["title"],
                                        "official_tags":m["official_tags"],"year":year,
                                        "reason":"year not 2024-2026" if year else "year unavailable"})
                        if year:
                            processed_ids.add(m["id"])
                            save_state(state_file,run_id,accepted,skipped,processed_ids,published_count,next_i,next_api_page,pending,list_exhausted)
                        else:
                            print(f"  -> META WAIT {m['code']}: year unavailable; leave pending for retry", flush=True)
                        ctx.close()
                    elif block:
                        skipped.append({"id":m["id"],"code":m["code"],"url":m["url"],"title":m["title"],
                                        "official_tags":m["official_tags"],"year":year,
                                        "reason":"BLOCK "+",".join(block)})
                        processed_ids.add(m["id"])
                        save_state(state_file,run_id,accepted,skipped,processed_ids,published_count,next_i,next_api_page,pending,list_exhausted)
                        print(f"  -> BLOCKED {m['code']} {block}", flush=True)
                        ctx.close()
                    else:
                        m["poster_file"] = download_poster(m, out)
                        trigger_player(pg)
                        resolvers.append({"ctx":ctx,"pg":pg,"cap":cap,"m":m,"keep":keep,
                                          "deadline":time.time()+a.resolve_wait,"resolve_tries":0,"token_tries":0,"retry_at":0})
                        print(f"  -> RESOLVE QUEUED {m['code']} | active={len(resolvers)}/{a.workers}", flush=True)
                except Exception as e:
                    skipped.append({"url":c["url"],"reason":"open/meta "+repr(e)})
                    print(f"  -> FILTER ERROR {c['url']}: {e!r}", flush=True)
                    ctx.close()
            else:
                # No new filter work can be scheduled now; keep browser event loop moving.
                for job in resolvers:
                    try: job["pg"].wait_for_timeout(150)
                    except Exception: pass
                time.sleep(.05)

        for job in resolvers:
            try: job["ctx"].close()
            except Exception: pass
        listctx.close()
        browser.close()

    final_accepted = accepted[:a.count] if a.count > 0 else accepted
    report = {"source":HOT,"mode":"full-site" if a.count == 0 else "target-count","accepted":final_accepted,"skipped":skipped}
    rp = out/"report.json"
    rp.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")

    print("\n=== ACCEPTED ===")
    for i,m in enumerate(final_accepted,1):
        print(i,m["code"],m["matched_large_breast_tags"],m["probe"],m["url"],"\n ",m["playlist"])
    print(f"SUCCESS: {len(final_accepted)} accepted; {len(skipped)} skipped")
    print("REPORT:",rp.resolve())
    if a.count > 0 and len(accepted) < a.count:
        raise SystemExit(2)

if __name__=="__main__":
    main()