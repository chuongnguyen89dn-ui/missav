#!/usr/bin/env python3
"""Probe AVMates CDN for AV01 portrait posters and candidate snapshots. Isolated output."""
import argparse,concurrent.futures,json,os,re,time,subprocess
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
ROOT=Path(__file__).resolve().parent.parent
CODE=re.compile(r'(?<![A-Z0-9])([A-Z]{2,10})[-_ ]?(\d{2,6})(?![A-Z0-9])',re.I)
def code_of(movie):
    """Prefer original studio code; exclude AV01 site branding and LADA release label."""
    title=str(movie.get('title') or '')
    description=str(movie.get('description') or '')
    combined=title+' '+description
    fc2=re.search(r'FC2[-_ ]?PPV[-_ ]?(\d{5,9})',combined,re.I)
    if fc2:return 'FC2-PPV-'+fc2.group(1)
    for field in (title,description):
        match=re.search(r'(?<![A-Z0-9])([A-Z]{2,10})[-_ ]?(\d{2,6})(?![A-Z0-9])',field,re.I)
        if match and match.group(1).upper() not in ('AV','LADA'):
            return match.group(1).upper()+'-'+match.group(2)
    for k in ('code','dvd_id','name'):
        m=CODE.search(str(movie.get(k) or ''))
        if m and m.group(1).upper() not in ('AV','LADA'):
            return m.group(1).upper()+'-'+m.group(2)
    return None
BLOCKED=re.compile(r'FC2[-_ ]?PPV|(?:^|[^A-Z0-9])(?:HEYZO|CAWB)[-_ ]?\d+|(?:^|[^A-Z0-9])\d{2,4}GANA[-_ ]?\d+',re.I)
def excluded(movie):
    fields=('title','description','code','dvd_id','name')
    return any(BLOCKED.search(str(movie.get(k) or '')) for k in fields)
def publish(paths):
    rel=[str(p.relative_to(ROOT)).replace(chr(92),'/') for p in paths]
    subprocess.run(['git','add','--',*rel],cwd=ROOT,check=True)
    changed=subprocess.run(['git','diff','--cached','--quiet'],cwd=ROOT).returncode
    if changed==1:
        subprocess.run(['git','commit','-m','data(av01): checkpoint poster and snapshot scan'],cwd=ROOT,check=True)
        subprocess.run(['git','push','origin','HEAD:main'],cwd=ROOT,check=True)
    elif changed!=0:raise RuntimeError('git diff failed')
def save(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,path)
def verify(url,timeout):
    req=Request(url,headers={'User-Agent':'Mozilla/5.0','Range':'bytes=0-127','Accept':'image/webp,image/*'})
    try:
        with urlopen(req,timeout=timeout) as resp:
            data=resp.read(128)
            mime=resp.headers.get('Content-Type','').split(';')[0].lower()
            valid=(data[:4]==b'RIFF' and data[8:12]==b'WEBP') or data.startswith(b'\xff\xd8\xff') or data.startswith(b'\x89PNG\r\n\x1a\n')
            return bool(valid and mime.startswith('image/')),'ok' if valid and mime.startswith('image/') else 'not_image'
    except HTTPError as e:return False,'http_'+str(e.code)
    except (URLError,TimeoutError,OSError) as e:return False,type(e).__name__
def scan(movie,max_snap,timeout,workers):
    code=code_of(movie)
    if excluded(movie):
        return {'id':movie.get('id'),'code':code,'poster':None,'snapshots':[],
                'snapshot_count':0,'source':'avmates_cdn','status':'skipped_excluded_code',
                'complete_gallery_verified':False,'errors':[]},None
    if not code:return None,'missing_movie_code'
    m=CODE.search(code); letters=m.group(1).lower();number=int(m.group(2))
    stems=list(dict.fromkeys(letters+str(number).zfill(n) for n in (5,4,3)))
    urls=[]
    for stem in stems:
        urls.append(('poster','https://cdn.avmates.com/'+stem+'ps.webp'))
        urls.append(('snapshot','https://cdn.avmates.com/'+stem+'pl_poster_800w_q70.webp'))
        for i in range(1,max_snap+1):
            urls.append(('snapshot','https://cdn.avmates.com/'+stem+'jp-'+str(i)+'.webp'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes=list(pool.map(lambda item:verify(item[1],timeout),urls))
    poster=next((url for (kind,url),(ok,_) in zip(urls,outcomes) if kind=='poster' and ok),None)
    snapshots=list(dict.fromkeys(url for (kind,url),(ok,_) in zip(urls,outcomes) if kind=='snapshot' and ok))
    errors=sorted(set(status for ok,status in outcomes if not ok and status not in ('http_404','http_410')))
    status='ok' if poster and not errors else ('partial' if poster or snapshots else 'pending')
    return {'id':movie.get('id'),'code':code,'poster':poster,'snapshots':snapshots,
            'snapshot_count':len(snapshots),'source':'avmates_cdn','status':status,
            'complete_gallery_verified':False,'max_snapshot_index':max_snap,
            'probed_urls':len(urls),'errors':errors},None
def main():
    from datetime import datetime,timezone
    p=argparse.ArgumentParser()
    p.add_argument('--catalog',default='data/av01-catalog.json')
    p.add_argument('--output',default='data/av01-avmates-cdn-images.json')
    p.add_argument('--checkpoint',default='av01_avmates_cdn/checkpoint.json')
    p.add_argument('--heartbeat',default='av01_avmates_cdn/heartbeat.json')
    p.add_argument('--limit',type=int,default=0)
    p.add_argument('--max-snap',type=int,default=30)
    p.add_argument('--workers',type=int,default=4)
    p.add_argument('--timeout',type=float,default=12)
    p.add_argument('--delay',type=float,default=1)
    p.add_argument('--reset',action='store_true')
    p.add_argument('--publish-every',type=int,default=20)
    a=p.parse_args()
    if not 1<=a.max_snap<=100 or not 1<=a.workers<=8:p.error('max-snap 1..100, workers 1..8')
    raw=json.loads((ROOT/a.catalog).read_text(encoding='utf-8'))
    source=raw if isinstance(raw,list) else raw.get('movies',[])
    movies=list({str(m['id']):m for m in source if m.get('id') is not None}.values())
    cp,out,hb=ROOT/a.checkpoint,ROOT/a.output,ROOT/a.heartbeat
    generation='avmates-full-catalog-first-id-20261009'
    state=json.loads(cp.read_text(encoding='utf-8')) if cp.exists() else {}
    if a.reset or state.get('scan_generation')!=generation:
        print('AVMATES FRESH START: first ID in GitHub catalog order',flush=True)
        state={'scan_generation':generation,'completed':{},'pending':{},'skipped':{},'published':0}
        save(cp,state)
    done=state.setdefault('completed',{})
    pending=state.setdefault('pending',{})
    skipped=state.setdefault('skipped',{})
    state.setdefault('published',0)
    valid={str(m['id']) for m in movies}
    for group in (done,pending,skipped):
        for key in list(group):
            if key not in valid:del group[key]
    # Exclusions are not successful posters and do not count toward publication batches.
    for movie in movies:
        key=str(movie['id'])
        if excluded(movie):
            done.pop(key,None);pending.pop(key,None)
            skipped[key]={'id':movie['id'],'code':code_of(movie),'status':'skipped_excluded_code'}
    state['published']=min(state['published'],len(done))
    def output():
        save(out,{'count':len(done),'movies':[done[str(m['id'])] for m in movies if str(m['id']) in done],
                  'pending':pending,'skipped':skipped})
    def heartbeat():
        save(hb,{'ts':datetime.now(timezone.utc).isoformat(),'total':len(movies),
                 'complete':len(done),'pending':len(pending),'skipped':len(skipped),
                 'published':state['published']})
    def persist():
        save(cp,state);output();heartbeat()
    def publish_ready(force=False):
        # DMM rule: publish only after 20 NEW verified successes, not 20 attempts.
        if len(done)-state['published']<a.publish_every and not force:return
        output()
        old_published=state['published']
        state['published']=len(done)
        save(cp,state);heartbeat()
        try:
            publish([out,cp,hb])
        except Exception:
            state['published']=old_published
            save(cp,state);heartbeat()
            raise
    persist()
    processed=0
    last_progress=time.time()
    while True:
        candidates=[m for m in movies if str(m['id']) not in done and
                    str(m['id']) not in skipped and
                    pending.get(str(m['id']),{}).get('retry_after',0)<=time.time()]
        if not candidates:
            if len(done)+len(skipped)==len(movies):break
            next_retry=min((v.get('retry_after',time.time()+30) for v in pending.values()
                            if isinstance(v,dict)),default=time.time()+30)
            heartbeat();time.sleep(min(30,max(1,next_retry-time.time())))
            continue
        for movie in candidates:
            if a.limit and processed>=a.limit:break
            key=str(movie['id']);code=code_of(movie)
            try:
                result,error=scan(movie,a.max_snap,a.timeout,a.workers)
                if error:raise ValueError(error)
                if result['status']=='ok':
                    done[key]=result;pending.pop(key,None)
                    last_progress=time.time()
                    print('OK',key,code,'poster=',True,'snapshots=',result['snapshot_count'],
                          'verified=',len(done),'/',len(movies),flush=True)
                else:
                    # Preserve partial results and retry with DMM exponential cooldown.
                    prior=pending.get(key,{})
                    attempts=prior.get('attempts',0)+1
                    wait=min(900,180*(2**min(attempts-1,3)))
                    pending[key]={'attempts':attempts,'retry_after':time.time()+wait,
                                  'reason':result['status'],'result':result}
                    print('RETRY',key,code,'status=',result['status'],'after=',wait,flush=True)
            except Exception as exc:
                prior=pending.get(key,{})
                attempts=prior.get('attempts',0)+1
                wait=min(900,180*(2**min(attempts-1,3)))
                pending[key]={'attempts':attempts,'retry_after':time.time()+wait,
                              'reason':str(exc)[:200]}
                print('RETRY',key,code,type(exc).__name__,'after=',wait,flush=True)
            persist()
            publish_ready()
            processed+=1
            if time.time()-last_progress>300:
                print('WATCHDOG: no verified progress for 300s; restart via CMD',flush=True)
                raise SystemExit(75)
            time.sleep(max(0,a.delay))
        if a.limit and processed>=a.limit:break
    persist()
    if not a.limit and len(done)+len(skipped)==len(movies) and len(done)>state['published']:
        publish_ready(force=True)
    print('DONE verified=',len(done),'pending=',len(pending),'skipped=',len(skipped),
          'published=',state['published'],'total_catalog=',len(movies),flush=True)
if __name__=='__main__':main()
