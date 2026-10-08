#!/usr/bin/env python3
"""AV01 metadata enrichment: resumable, GitHub publish every 20 successes, no addon deploy."""
import argparse, json, os, re, subprocess, time
from urllib.request import Request, urlopen
from urllib.parse import quote
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,path)

def extract(page):
    return page.evaluate(r"""() => {
      const text=e=>(e?.textContent||'').trim();
      const links=[...document.querySelectorAll('a[href]')];
      const refs=kind=>links.filter(a=>new RegExp('/(?:en|vn|ja|zh(?:-cn|-tw)?)/'+kind+'/[0-9]+(?:/|$)','i').test(new URL(a.href).pathname))
        .map(a=>({name:text(a),url:a.href})).filter(x=>x.name);
      const tags=refs('tag').map(x=>({...x,id:(x.url.match(/\/tag\/(\d+)/)||[])[1]||''}));
      const og=n=>document.querySelector('meta[property="'+n+'"]')?.content||'';
      return {title:og('og:title'),description:og('og:description'),poster:'',
        official_tags:[...new Set(tags.map(x=>x.name))],official_tag_refs:tags,
        actresses:[...new Map(refs('actress').map(x=>[x.url.split('/actress/')[1]?.split('/')[0]||x.url,x])).values()],maker:refs('maker')[0]||null};
    }""")

def movie_code(movie, info):
    """Extract the product ID, never treat LADA/AV-DEBUT as a movie code."""
    raw=' '.join(str(x or '') for x in (movie.get('title'),info.get('title'),movie.get('code')))
    patterns=(r'FC2[-_ ]?PPV[-_ ]?(\d{5,9})',r'(?<![A-Z0-9])([A-Z]{2,6})[-_ ]?(\d{3,6})(?![A-Z0-9])')
    for pat in patterns:
        for match in re.finditer(pat,raw,re.I):
            if pat.startswith('FC2'): return 'FC2-PPV-'+match.group(1)
            prefix=match.group(1).upper()
            if prefix not in {'LADA','AV','PPV','FC2'}:return prefix+'-'+match.group(2)
    return ''

def verify_image(url):
    """Validate image response, not just a plausible-looking filename."""
    if not url.startswith('https://'):return False
    try:
        req=Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.javlibrary.com/'})
        with urlopen(req,timeout=12) as resp:
            header=resp.read(16)
            return resp.status==200 and resp.headers.get('Content-Type','').lower().startswith('image/') and (
                header.startswith(bytes.fromhex('ffd8ff')) or header.startswith(bytes.fromhex('89504e47')) or header.startswith(b'RIFF'))
    except Exception:
        return False

def javlibrary_lookup(page,code):
    """Find an exact JAVLibrary ID, then take the poster URL from that movie page."""
    if not code:return {}
    search='https://www.javlibrary.com/en/vl_searchbyid.php?keyword='+quote(code)
    try:
        page.goto(search,wait_until='domcontentloaded',timeout=30000)
        page.wait_for_timeout(800)
        results=page.evaluate(r"""() => ({
          direct:location.search.includes('v='),
          id:document.querySelector('#video_id .text')?.textContent?.trim()||'',
          links:[...document.querySelectorAll('div.video')].map(el=>({
            id:el.querySelector('.id')?.textContent?.trim()||'',
            href:el.querySelector('a[href]')?.href||''
          }))
        })""")
        norm=lambda x:re.sub(r'[^A-Z0-9]','',x.upper())
        if results['direct']:
            if norm(results['id'])!=norm(code):return {}
        else:
            matches=[x for x in results['links'] if norm(x['id'])==norm(code)]
            if not matches:return {}
            page.goto(matches[0]['href'],wait_until='domcontentloaded',timeout=30000)
        details=page.evaluate(r"""() => {
          const t=s=>document.querySelector(s)?.textContent?.trim()||'';
          const img=document.querySelector('#video_jacket_img');
          return {code:t('#video_id .text'),title:t('#video_title'),
            poster:img?.getAttribute('src')||'',
            actresses:[...document.querySelectorAll('#video_cast .star')].map(x=>x.textContent.trim()).filter(Boolean),
            genres:[...document.querySelectorAll('#video_genres .genre')].map(x=>x.textContent.trim()).filter(Boolean),
            maker:t('#video_maker .text'),release_date:t('#video_date .text'),
            javlibrary_url:location.href};
        }""")
        if norm(details.get('code',''))!=norm(code):return {}
        from urllib.parse import urljoin
        poster=urljoin(page.url,details.get('poster') or '')
        if poster.endswith('ps.jpg'):poster=poster[:-6]+'pl.jpg'
        details['poster']=poster if verify_image(poster) else ''
        return details
    except Exception as exc:
        print(f'JAVLIBRARY RETRY {code}: {type(exc).__name__}: {exc}',flush=True)
        return {}


def git_publish(path, batch):
    rel=str(path.relative_to(ROOT))
    subprocess.run(['git','add','--',rel],cwd=ROOT,check=True)
    staged=subprocess.run(['git','diff','--cached','--quiet','--',rel],cwd=ROOT)
    if staged.returncode==0:return
    if staged.returncode!=1:raise RuntimeError('git diff failed')
    subprocess.run(['git','commit','-m',f'data(av01): publish metadata batch through {batch} IDs','--',rel],cwd=ROOT,check=True)
    subprocess.run(['git','push','origin','HEAD:main'],cwd=ROOT,check=True)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--catalog',default='data/av01-catalog.json')
    ap.add_argument('--out',default='data/av01-metadata-enriched.json')
    ap.add_argument('--checkpoint',default='av01_metadata_full/checkpoint.json')
    ap.add_argument('--heartbeat',default='av01_metadata_full/heartbeat.json')
    ap.add_argument('--limit',type=int,default=0)
    ap.add_argument('--delay',type=float,default=1.5)
    ap.add_argument('--publish',action='store_true',help='Commit/push every 20 newly completed IDs; never deploy')
    args=ap.parse_args()
    resolve=lambda x:(ROOT/x).resolve()
    catalog=json.loads(resolve(args.catalog).read_text(encoding='utf-8'))
    movies=catalog if isinstance(catalog,list) else catalog['movies']
    movies=list({str(m['id']):m for m in movies if m.get('id') is not None}.values())
    print(f'AV01 METADATA catalog IDs: {len(movies)}',flush=True)
    cp,out,hb=map(resolve,(args.checkpoint,args.out,args.heartbeat))
    state=json.loads(cp.read_text(encoding='utf-8')) if cp.exists() else {'done':{},'pending':{},'published':0}
    # One-time fresh scan: discard results from the previously unsuccessful run.
    # Persist the generation marker immediately so watchdog restarts resume progress.
    generation='av01-metadata-fresh-20261008'
    if state.get('scan_generation') != generation:
        print('AV01 METADATA: resetting previous unsuccessful checkpoint; starting at ID 1',flush=True)
        state={'scan_generation':generation,'done':{},'pending':{},'published':0}
        atomic(cp,state)
    done=state.setdefault('done',{})
    pending=state.setdefault('pending',{})
    # Follow the current filtered catalog only; never restore excluded movies.
    valid_ids={str(m['id']) for m in movies}
    for vid in list(done):
        # Metadata remains complete even when DMM has no verified poster.
        if vid not in valid_ids:
            del done[vid]
    for vid in list(pending):
        if vid not in valid_ids: del pending[vid]
    state['published']=min(state.get('published',0),len(done))
    processed=0
    last_progress=time.time()
    def save():
        atomic(cp,state)
    def output():
        # Metadata-only layer: never rewrite the HLS/catalog source.
        atomic(out,{'count':len(done),'movies':[{'id':vid,**data} for vid,data in done.items()]})
    def status():
        atomic(hb,{'ts':datetime.now(timezone.utc).isoformat(),'total':len(movies),
                   'complete':len(done),'pending':len(pending),'published':state['published']})
    def publish_ready():
        # Batch watermark is advanced only after successful git push.
        if len(done)-state['published']<20:return
        output()
        if args.publish:
            git_publish(out,(len(done)//20)*20)
            state['published']=(len(done)//20)*20
            save()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page()
        try:
            while True:
                candidates=[m for m in movies if str(m['id']) not in done and
                    pending.get(str(m['id']),{}).get('retry_after',0)<=time.time()]
                if not candidates:
                    if len(done)==len(movies):break
                    next_retry=min((x['retry_after'] for x in pending.values()),default=time.time()+30)
                    sleep=min(max(1,next_retry-time.time()),30)
                    status();time.sleep(sleep)
                    continue
                for movie in candidates:
                    vid=str(movie['id'])
                    if args.limit and processed>=args.limit:break
                    try:
                        code=movie_code(movie,{})
                        if not code:
                            raise RuntimeError('movie code missing in catalog title')
                        info={'movie_code':code,'poster':'','poster_status':'not_found'}
                        lib=javlibrary_lookup(page,code)
                        if not lib.get('poster'):
                            raise RuntimeError('JAVLibrary exact match/verified poster unavailable')
                        info.update({'poster':lib['poster'],'poster_status':'verified_javlibrary',
                                     'javlibrary_url':lib['javlibrary_url'],
                                     'javlibrary_metadata':{k:v for k,v in lib.items() if k not in ('poster','javlibrary_url')}})
                        # Poster is independent of AV01 tags. AV01 is optional enrichment.
                        try:
                            page.goto(movie.get('url') or f'https://www.av01.media/en/video/{vid}',wait_until='domcontentloaded',timeout=15000)
                            av=extract(page)
                            info.update({k:v for k,v in av.items() if k!='poster'})
                            info['av01_tags_status']='ok' if av.get('official_tags') else 'missing'
                        except Exception as exc:
                            info['av01_tags_status']='unavailable'
                            print(f'AV01 OPTIONAL {vid}: {type(exc).__name__}',flush=True)
                        done[vid]=info
                        pending.pop(vid,None)
                        last_progress=time.time()
                        print(f'META OK {vid} {len(done)}/{len(movies)} poster={info["poster_status"]}',flush=True)
                    except Exception as e:
                        prior=pending.get(vid,{})
                        attempts=prior.get('attempts',0)+1
                        delay=min(900,180*(2**min(attempts-1,3)))
                        pending[vid]={'attempts':attempts,'retry_after':time.time()+delay,'reason':str(e)[:200]}
                        print(f'META RETRY {vid} after {delay}s: {e}',flush=True)
                    save();status();publish_ready()
                    processed+=1
                    if time.time()-last_progress>300:
                        print('WATCHDOG no successful progress in 300s; restart via launcher',flush=True)
                        raise SystemExit(75)
                    time.sleep(args.delay)
                if args.limit and processed>=args.limit:break
        finally:
            output();save();status();browser.close()
    # Publish the last partial batch too, after the full catalog has completed.
    if args.publish and not args.limit and len(done)==len(movies) and len(done)>state['published']:
        git_publish(out,len(done))
        state['published']=len(done)
        save();status()
    print(f'FINISHED total={len(movies)} ok={len(done)} pending={len(pending)} published={state["published"]}',flush=True)

if __name__=='__main__':main()
