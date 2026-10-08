#!/usr/bin/env python3
"""AV01 metadata enrichment: resumable, GitHub publish every 20 successes, no addon deploy."""
import argparse, json, os, re, subprocess, time
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
      const refs=kind=>links.filter(a=>new RegExp('/(?:en|vn|ja|zh(?:-cn|-tw)?)/'+kind+'/\\d+(?:/|$)','i').test(new URL(a.href).pathname))
        .map(a=>({name:text(a),url:a.href})).filter(x=>x.name);
      const tags=refs('tag').map(x=>({...x,id:(x.url.match(/\/tag\/(\d+)/)||[])[1]||''}));
      const og=n=>document.querySelector('meta[property="'+n+'"]')?.content||'';
      return {title:og('og:title'),description:og('og:description'),poster:'',
        official_tags:[...new Set(tags.map(x=>x.name))],official_tag_refs:tags,
        actresses:[...new Map(refs('actress').map(x=>[x.url.split('/actress/')[1]?.split('/')[0]||x.url,x])).values()],maker:refs('maker')[0]||null};
    }""")

def dmm_poster(page, movie, info):
    """Only accept a DMM/FANZA image when a search result explicitly matches the movie code."""
    raw=(movie.get('code') or info.get('title') or movie.get('title') or '')
    match=re.search(r'(?<![A-Za-z0-9])([A-Za-z]{2,8})[-_ ]?(\d{2,6})(?:-lada)?(?![A-Za-z0-9])',raw,re.I)
    if not match:
        return ''
    code=(match.group(1)+'-'+match.group(2)).upper()
    try:
        page.goto('https://www.dmm.co.jp/search/=/searchstr='+quote(code)+'/',wait_until='domcontentloaded',timeout=30000)
        page.wait_for_timeout(1200)
        result=page.evaluate(r"""code => {
          const norm=s=>(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
          const want=norm(code);
          const hits=[];
          for(const a of document.querySelectorAll('a[href]')){
            const href=a.href||'';
            const title=(a.textContent||'')+' '+(a.querySelector('img')?.alt||'');
            const img=a.querySelector('img');
            if(!img || !/dmm\\.co\\.jp|digital\\.dmm\\.co\\.jp/.test(href))continue;
            if(!new RegExp('(^|[^A-Z0-9])'+code.replace('-','[-_ ]?')+'([^A-Z0-9]|$)','i').test(title))continue;
            const src=img.getAttribute('data-src')||img.currentSrc||img.src||'';
            if(!/^https:\\/\\/[^/]*pics\\.dmm\\.co\\.jp\\//i.test(src))continue;
            hits.push(src);
          }
          return hits[0]||'';
        }""",code)
        return result if result.startswith('https://') else ''
    except Exception as exc:
        print(f'POSTER DMM unavailable for {code}: {exc}',flush=True)
        return ''

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
    cp,out,hb=map(resolve,(args.checkpoint,args.out,args.heartbeat))
    state=json.loads(cp.read_text(encoding='utf-8')) if cp.exists() else {'done':{},'pending':{},'published':0}
    done=state.setdefault('done',{})
    pending=state.setdefault('pending',{})
    # Follow the current filtered catalog only; never restore excluded movies.
    valid_ids={str(m['id']) for m in movies}
    for vid in list(done):
        # A record without a verified poster is incomplete and must be rescanned.
        if vid not in valid_ids or not str(done[vid].get('poster') or '').strip():
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
                        page.goto(movie.get('url') or f'https://www.av01.media/en/video/{vid}',wait_until='domcontentloaded',timeout=30000)
                        info={}
                        for _ in range(12):
                            info=extract(page)
                            if info['official_tags']:break
                            page.wait_for_timeout(500)
                        if not info['official_tags']:raise RuntimeError('official tags not hydrated')
                        info['poster']=dmm_poster(page,movie,info)
                        done[vid]=info
                        pending.pop(vid,None)
                        last_progress=time.time()
                        print(f'META OK {vid} {len(done)}/{len(movies)}',flush=True)
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
    print(f'FINISHED total={len(movies)} ok={len(done)} pending={len(pending)} published={state["published"]}',flush=True)

if __name__=='__main__':main()
