#!/usr/bin/env python3
"""AVMates image collector. Isolated output; never modifies active AV01 catalog/streams.
Usage:
  pip install requests beautifulsoup4
  python scripts/av01_avmates_images.py --html "saved-page.html"
  python scripts/av01_avmates_images.py --catalog data/av01-catalog.json --limit 20
Only an exact movie-code match is accepted. Unreachable pages are pending, not fabricated.
"""
import argparse, json, os, re, time
from pathlib import Path
from urllib.parse import urljoin, urlparse, quote
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent.parent
CODE=re.compile(r'(?<![A-Z0-9])([A-Z]{2,10})[-_ ]?(\d{2,6})(?![A-Z0-9])',re.I)
def normalize(v):
    m=CODE.search(str(v or ''))
    return (m.group(1).upper()+'-'+m.group(2)) if m else ''
def save(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(obj,indent=2,ensure_ascii=False),encoding='utf-8')
    os.replace(tmp,path)
def image_url(src):
    if not src:return ''
    # Chrome's 'Save page as' rewrites src to local *_files paths.
    name=src.split('/')[-1].split('?')[0]
    if src.startswith('https://cdn.avmates.com/'):return src
    if '_files/' in src and re.search(r'\.(?:webp|jpe?g|png)$',name,re.I):
        return 'https://cdn.avmates.com/'+name
    return ''
def extract(html,expected=None):
    soup=BeautifulSoup(html,'html.parser')
    canonical=soup.select_one('link[rel=canonical]')
    page_url=canonical.get('href','') if canonical else ''
    page_code=normalize(urlparse(page_url).path.split('/')[-2] if page_url.endswith('/') else urlparse(page_url).path.split('/')[-1])
    if not page_code:
        title=soup.title.get_text(' ',strip=True) if soup.title else ''
        page_code=normalize(title)
    if expected and page_code!=normalize(expected):
        raise ValueError('code_mismatch: expected %s, page %s'%(expected,page_code))
    if not page_code:raise ValueError('missing_page_code')
    prefix=re.sub(r'[^a-z0-9]','',page_code.lower())
    imgs=[]
    def add(src,origin):
        u=image_url(src)
        if not u:return
        base=urlparse(u).path.rsplit('/',1)[-1].lower()
        # Match film code in image filename; excludes recommendations, ads and logos.
        if not base.startswith(prefix):return
        if u not in [i['url'] for i in imgs]:imgs.append({'url':u,'origin':origin})
    for meta in soup.select('meta[property="og:image"],meta[name="twitter:image"]'):
        add(meta.get('content'),'social_meta')
    for tag in soup.select('img'):
        add(tag.get('src'),'img')
        add(tag.get('data-src'),'img_lazy')
    # JSON-LD image may be the sole portrait source.
    for tag in soup.select('script[type="application/ld+json"]'):
        try: data=json.loads(tag.string or tag.get_text())
        except (ValueError,TypeError):continue
        def walk(x):
            if isinstance(x,dict):
                for k,v in x.items():
                    if k in ('url','contentUrl') and isinstance(v,str):add(v,'jsonld')
                    walk(v)
            elif isinstance(x,list):
                for v in x:walk(v)
        walk(data)
    # Portrait is the main poster; every other film image is a snapshot.
    portrait=[i['url'] for i in imgs if re.search(r'ps(?:[._-]|$)',urlparse(i['url']).path.rsplit('/',1)[-1],re.I)]
    if not portrait:
        # Fallback to declared dimensions on page image, not filename guess.
        for tag in soup.select('img'):
            u=image_url(tag.get('src'))
            if not u or u not in [i['url'] for i in imgs]:continue
            try:
                if int(tag.get('height','0'))>int(tag.get('width','0')):portrait.append(u);break
            except ValueError:pass
    poster=portrait[0] if portrait else ''
    return {'code':page_code,'source':'avmates','source_url':page_url,
            'poster':poster,'snapshots':[i['url'] for i in imgs if i['url']!=poster],
            'image_count':len(imgs),'status':'extracted_unverified' if poster else 'poster_missing'}

def search_page(session,code):
    # WordPress public search; do not synthesize numeric post IDs.
    api='https://avmates.com/wp-json/wp/v2/search'
    r=session.get(api,params={'search':code,'per_page':20},timeout=25)
    r.raise_for_status()
    for item in r.json():
        link=item.get('url','')
        if normalize(urlparse(link).path)==normalize(code) or normalize(link.rsplit('/',2)[-2])==normalize(code):
            return link
    return ''

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--html',help='Locally saved AVMates HTML page')
    ap.add_argument('--catalog',default='data/av01-catalog.json')
    ap.add_argument('--output',default='data/av01-avmates-images.json')
    ap.add_argument('--checkpoint',default='av01_avmates_scan/checkpoint.json')
    ap.add_argument('--limit',type=int,default=20)
    ap.add_argument('--delay',type=float,default=2)
    ap.add_argument('--reset',action='store_true')
    args=ap.parse_args()
    out=ROOT/args.output;cp=ROOT/args.checkpoint
    state={'completed':{},'pending':{}}
    if cp.exists() and not args.reset:state=json.loads(cp.read_text(encoding='utf-8'))
    if args.html:
        html=Path(args.html).read_text(encoding='utf-8')
        item=extract(html)
        state['completed'][item['code']]=item
        print('EXTRACTED',item['code'],'poster=',item['poster'],'snapshots=',len(item['snapshots']))
    else:
        catalog=json.loads((ROOT/args.catalog).read_text(encoding='utf-8'))
        movies=catalog if isinstance(catalog,list) else catalog.get('movies',[])
        session=requests.Session()
        session.headers.update({'User-Agent':'Mozilla/5.0 (compatible; AV01ImageCollector/1.0)'})
        processed=0
        for movie in movies:
            code=normalize(movie.get('code') or movie.get('dvd_id') or movie.get('title'))
            if not code:continue
            if code in state['completed']:continue
            if args.limit and processed>=args.limit:break
            processed+=1
            try:
                url=search_page(session,code)
                if not url:raise ValueError('no_exact_search_result')
                r=session.get(url,timeout=25);r.raise_for_status()
                item=extract(r.text,code)
                if not item['poster']:raise ValueError('poster_missing')
                item['av01_id']=movie.get('id')
                state['completed'][code]=item
                state['pending'].pop(code,None)
                print('OK',code,'snapshots',len(item['snapshots']),flush=True)
            except Exception as e:
                state['pending'][code]=str(e)[:200]
                print('PENDING',code,str(e)[:120],flush=True)
            save(cp,state)
            save(out,{'count':len(state['completed']),'movies':list(state['completed'].values()),'pending':state['pending']})
            time.sleep(max(0,args.delay))
    save(cp,state)
    save(out,{'count':len(state['completed']),'movies':list(state['completed'].values()),'pending':state['pending']})
if __name__=='__main__':main()
