#!/usr/bin/env python3
"""Probe AVMates CDN for AV01 portrait posters and candidate snapshots. Isolated output."""
import argparse,concurrent.futures,json,os,re,time
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
    if code and code.startswith('FC2-PPV-'):
        return {'id':movie.get('id'),'code':code,'poster':None,'snapshots':[],
                'snapshot_count':0,'source':'avmates_cdn','status':'skipped_fc2_amateur',
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
    p=argparse.ArgumentParser()
    p.add_argument('--catalog',default='data/av01-catalog.json')
    p.add_argument('--output',default='data/av01-avmates-cdn-images.json')
    p.add_argument('--checkpoint',default='av01_avmates_cdn/checkpoint.json')
    p.add_argument('--limit',type=int,default=20)
    p.add_argument('--max-snap',type=int,default=30)
    p.add_argument('--workers',type=int,default=4)
    p.add_argument('--timeout',type=float,default=12)
    p.add_argument('--delay',type=float,default=1)
    p.add_argument('--reset',action='store_true')
    a=p.parse_args()
    if not 1<=a.max_snap<=100 or not 1<=a.workers<=8:p.error('max-snap 1..100, workers 1..8')
    raw=json.loads((ROOT/a.catalog).read_text(encoding='utf-8'))
    movies=raw if isinstance(raw,list) else raw.get('movies',[])
    cp,out=ROOT/a.checkpoint,ROOT/a.output
    state={'completed':{},'pending':{},'skipped':{}}
    if cp.exists() and not a.reset:state=json.loads(cp.read_text(encoding='utf-8'))
    state.setdefault('skipped',{})
    for movie in (movies[:a.limit] if a.limit else movies):
        code=code_of(movie);key=str(movie.get('id') or code or '')
        if key in state['completed'] or key in state['skipped']:continue
        result,error=scan(movie,a.max_snap,a.timeout,a.workers)
        if error:
            state['pending'][key]=error
            print('PENDING',key,error,flush=True)
        else:
            if result['status']=='skipped_fc2_amateur':
                state['skipped'][key]=result
                state['pending'].pop(key,None)
            elif result['status']=='ok':
                state['completed'][key]=result
                state['pending'].pop(key,None)
            else:state['pending'][key]=result
            print(result['status'].upper(),code,'poster=',bool(result['poster']),
                  'snapshots=',result['snapshot_count'],'errors=',result['errors'],flush=True)
        save(cp,state)
        save(out,{'count':len(state['completed']),'movies':list(state['completed'].values()),'pending':state['pending'],'skipped':state['skipped']})
        time.sleep(max(0,a.delay))
    print('DONE verified=',len(state['completed']),'pending=',len(state['pending']),'skipped=',len(state['skipped']))
if __name__=='__main__':main()
