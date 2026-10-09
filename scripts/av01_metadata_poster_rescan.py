#!/usr/bin/env python3
"""Fresh AV01 metadata + JavLibrary HTML poster scan, isolated from streaming.

Never constructs DMM URLs, never trusts old poster_status, and never overwrites
the active metadata. A Cloudflare challenge is a retryable failure.
Requires: pip install playwright; python -m playwright install chromium
"""
import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def norm(s): return re.sub(r'[^A-Z0-9]','',str(s or '').upper())
def atomic(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,path)
def code_of(movie):
    for raw in (movie.get('title'),movie.get('code'),movie.get('dvd_id')):
        raw=str(raw or '')
        m=re.match(r'^\\s*(FC2[-_ ]?PPV[-_ ]?\\d{5,9}|[A-Z]{2,9}[-_ ]?\\d{2,6})(?=[^A-Z0-9]|$)',raw,re.I)
        if m:return re.sub(r'[_ ]+','-',m.group(1)).upper()
    return ''
def is_blocked(page):
    return page.evaluate("""() => /just a moment|attention required/i.test(document.title)
      || !!document.querySelector('script[src*="challenge-platform"], #challenge-form')""")
def scan_javlibrary(page, code):
    url='https://www.javlibrary.com/en/vl_searchbyid.php?keyword='+quote(code)
    page.goto(url,wait_until='domcontentloaded',timeout=30000)
    if is_blocked(page):return {},'cloudflare_blocked'
    data=page.evaluate("""() => ({
      id:document.querySelector('#video_id .text')?.textContent?.trim()||'',
      results:[...document.querySelectorAll('div.video')].map(el=>({
        code:el.querySelector('.id')?.textContent?.trim()||'',
        url:el.querySelector('a[href]')?.href||''
      }))
    })""")
    if norm(data['id'])!=norm(code):
        found=next((x for x in data['results'] if norm(x['code'])==norm(code) and x['url']),None)
        if not found:return {},'no_exact_match'
        page.goto(found['url'],wait_until='domcontentloaded',timeout=30000)
        if is_blocked(page):return {},'cloudflare_blocked'
    info=page.evaluate("""() => {
      const text=s=>document.querySelector(s)?.textContent?.trim()||'';
      const img=document.querySelector('#video_jacket_img');
      const fallback=(img?.getAttribute('onerror')||'').match(/ThumbError\\(this,\\s*['"]([^'"]+)/)?.[1]||'';
      return {
        movie_code:text('#video_id .text'),
        title:text('#video_title'),
        poster:img?.getAttribute('src')||'',
        poster_fallback:fallback,
        actresses:[...document.querySelectorAll('#video_cast .star')].map(x=>x.textContent.trim()).filter(Boolean),
        genres:[...document.querySelectorAll('#video_genres .genre')].map(x=>x.textContent.trim()).filter(Boolean),
        maker:text('#video_maker .text'),
        release_date:text('#video_date .text'),
        javlibrary_url:location.href
      };
    }""")
    if norm(info['movie_code'])!=norm(code):return {},'code_mismatch'
    poster=urljoin(page.url,info['poster']) if info['poster'] else ''
    if not poster.startswith('https://'):return {},'poster_missing'
    info['poster']=poster
    info['poster_fallback']=urljoin(page.url,info['poster_fallback']) if info['poster_fallback'] else ''
    info['poster_status']='url_extracted_unverified'
    return info,'ok'
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--catalog',default='data/av01-catalog.json')
    ap.add_argument('--output',default='data/av01-metadata-rescan.json')
    ap.add_argument('--checkpoint',default='av01_metadata_rescan/checkpoint.json')
    ap.add_argument('--delay',type=float,default=2)
    ap.add_argument('--limit',type=int,default=0)
    ap.add_argument('--retry-hours',type=float,default=6)
    ap.add_argument('--reset',action='store_true',help='Explicitly discard checkpoint; never affects old metadata')
    args=ap.parse_args()
    catalog=json.loads((ROOT/args.catalog).read_text(encoding='utf-8'))
    movies=catalog if isinstance(catalog,list) else catalog.get('movies',[])
    cp=ROOT/args.checkpoint;out=ROOT/args.output
    state={'completed':{},'pending':{}}
    if cp.exists() and not args.reset:state=json.loads(cp.read_text(encoding='utf-8'))
    if args.reset:atomic(cp,state)
    done=state.setdefault('completed',{});pending=state.setdefault('pending',{})
    now=time.time();count=0
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')
        try:
            for movie in movies:
                vid=str(movie.get('id',''))
                if not vid or vid in done or pending.get(vid,{}).get('retry_after',0)>time.time():continue
                code=code_of(movie)
                if not code:
                    pending[vid]={'reason':'missing_movie_code','retry_after':time.time()+args.retry_hours*3600}
                    print('PENDING',vid,'missing_movie_code',flush=True)
                else:
                    try:
                        info,status=scan_javlibrary(page,code)
                    except Exception as e:
                        info,status={},type(e).__name__+': '+str(e)[:150]
                    if status=='ok':
                        done[vid]={'id':vid,'catalog_title':movie.get('title',''),**info}
                        pending.pop(vid,None)
                        print('OK',vid,code,info['poster'],flush=True)
                    else:
                        pending[vid]={'code':code,'reason':status,'retry_after':time.time()+args.retry_hours*3600}
                        print('PENDING',vid,code,status,flush=True)
                atomic(cp,state)
                atomic(out,{'count':len(done),'movies':list(done.values()),'pending_count':len(pending),
                            'generated_at':datetime.now(timezone.utc).isoformat()})
                count+=1
                if args.limit and count>=args.limit:break
                time.sleep(max(0,args.delay))
        finally:
            browser.close()
    print('FINISHED scanned_this_run=',count,'completed=',len(done),'pending=',len(pending),flush=True)
if __name__=='__main__':main()
