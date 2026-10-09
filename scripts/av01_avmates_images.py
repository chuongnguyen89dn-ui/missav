#!/usr/bin/env python3
"""AVMates image collector. Isolated output; never modifies active AV01 catalog/streams.
Usage:
  pip install playwright beautifulsoup4\n  python -m playwright install chromium
  python scripts/av01_avmates_images.py --html "saved-page.html"
  python scripts/av01_avmates_images.py --catalog data/av01-catalog.json --limit 20
Only an exact movie-code match is accepted. Unreachable pages are pending, not fabricated.
"""
import argparse, json, os, re, time
from pathlib import Path
from urllib.parse import urljoin, urlparse, quote
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

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
    code_match=CODE.search(page_code)
    letters=code_match.group(1).lower()
    number=int(code_match.group(2))
    imgs=[]
    def add(src,origin):
        u=image_url(src)
        if not u:return
        base=urlparse(u).path.rsplit('/',1)[-1].lower()
        # Match film code in image filename; excludes recommendations, ads and logos.
        m=re.match(r'^([a-z]+)0*(\\d+)',base)
        if not m or m.group(1)!=letters or int(m.group(2))!=number:return
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

def search_page(page,code):
    # Search the visible website, not the blocked wp-json API.
    page.goto('https://avmates.com/?s='+quote(code),wait_until='domcontentloaded',timeout=45000)
    page.wait_for_timeout(1200)
    if 'just a moment' in page.title().lower():
        print('Browser verification requested; complete it in Chromium.',flush=True)
        input('Press Enter after the page is accessible...')
    candidates=page.locator('a[href*="avmates.com/"]').evaluate_all(
        """els => els.map(a=>a.href).filter(Boolean)""")
    for link in candidates:
        parts=[p for p in urlparse(link).path.split('/') if p]
        if any(normalize(p)==normalize(code) for p in parts):
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
    ap.add_argument('--profile',default='av01_avmates_scan/chromium_profile')
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
        processed=0
        with sync_playwright() as pw:
            context=pw.chromium.launch_persistent_context(
                user_data_dir=str(ROOT/args.profile),headless=False,
                viewport={'width':1280,'height':900})
            page=context.new_page()
            try:
                for movie in movies:
                    code=normalize(movie.get('code') or movie.get('dvd_id') or movie.get('title'))
                    if not code:continue
                    if code in state['completed']:continue
                    if args.limit and processed>=args.limit:break
                    processed+=1
                    try:
                        url=search_page(page,code)
                        if not url:raise ValueError('no_exact_search_result')
                        page.goto(url,wait_until='domcontentloaded',timeout=45000)
                        item=extract(page.content(),code)
                        if not item['poster']:raise ValueError('poster_missing')
                        item['av01_id']=movie.get('id')
                        state['completed'][code]=item
                        state['pending'].pop(code,None)
                        print('OK',code,'snapshots',len(item['snapshots']),flush=True)
                    except Exception as ex:
                        state['pending'][code]=str(ex)[:200]
                        print('PENDING',code,str(ex)[:120],flush=True)
                    save(cp,state)
                    save(out,{'count':len(state['completed']),'movies':list(state['completed'].values()),'pending':state['pending']})
                    time.sleep(max(0,args.delay))
            finally:
                context.close()
    save(cp,state)
    save(out,{'count':len(state['completed']),'movies':list(state['completed'].values()),'pending':state['pending']})
if __name__=='__main__':main()
