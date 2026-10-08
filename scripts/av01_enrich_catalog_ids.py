#!/usr/bin/env python3
"""Enrich the existing AV01 catalog by its IDs; never replace the scanner or HLS fields."""
import argparse, json, re, time
from pathlib import Path
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

def extract(page):
    return page.evaluate("""() => {
      const text = e => (e?.textContent || '').trim();
      const links = [...document.querySelectorAll('a[href]')];
      const refs = kind => links.filter(a => new RegExp('/(?:en|vn|ja|zh(?:-cn|-tw)?)/'+kind+'/\\\\d+(?:/|$)','i').test(new URL(a.href).pathname))
        .map(a => ({name:text(a),url:a.href})).filter(x=>x.name);
      const tagrefs = refs('tag').map(x=>({...x,id:(x.url.match(/\\/tag\\/(\\d+)/)||[])[1]||''}));
      const tags=[...new Map(tagrefs.map(x=>[x.id,x])).values()];
      const ld=[...document.querySelectorAll('script[type="application/ld+json"]')].map(x=>{try{return JSON.parse(x.textContent)}catch{return null}}).filter(Boolean);
      const og = n => document.querySelector('meta[property="'+n+'"]')?.content||'';
      return {title:og('og:title'),description:og('og:description'),poster:og('og:image'),
        official_tags:tags.map(x=>x.name),official_tag_refs:tags,
        actresses:refs('actress'),maker:refs('maker')[0]||null,jsonld:ld};
    }""")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--catalog',default='data/av01-catalog.json')
    ap.add_argument('--out',default='data/av01-metadata-enriched.json')
    ap.add_argument('--checkpoint',default='data/av01-metadata-checkpoint.json')
    ap.add_argument('--limit',type=int,default=0,help='0 means every ID')
    ap.add_argument('--delay',type=float,default=1.5)
    args=ap.parse_args()
    raw=json.loads(Path(args.catalog).read_text(encoding='utf-8'))
    movies=raw if isinstance(raw,list) else raw['movies']
    cp=Path(args.checkpoint)
    done=json.loads(cp.read_text(encoding='utf-8')) if cp.exists() else {}
    count=0
    with sync_playwright() as pw:
      browser=pw.chromium.launch(headless=True)
      page=browser.new_page()
      for movie in movies:
        vid=str(movie['id'])
        if vid in done and done[vid].get('status')=='ok':continue
        if args.limit and count>=args.limit:break
        url=movie.get('page_url') or movie.get('url') or 'https://www.av01.media/en/video/'+vid
        try:
          page.goto(url,wait_until='domcontentloaded',timeout=30000)
          info={}
          for _ in range(10):
            info=extract(page)
            if info['official_tags']:break
            page.wait_for_timeout(500)
          if not info['official_tags']:raise ValueError('metadata not hydrated')
          info.pop('jsonld',None)
          done[vid]={'status':'ok','data':info}
          print(f'META OK {vid} ({sum(v.get("status")=="ok" for v in done.values())}/{len(movies)})',flush=True)
        except Exception as e:
          done[vid]={'status':'retry','error':str(e)[:180]}
          print(f'META RETRY {vid}: {e}',flush=True)
        cp.parent.mkdir(parents=True,exist_ok=True)
        cp.write_text(json.dumps(done,ensure_ascii=False,indent=2),encoding='utf-8')
        count+=1
        time.sleep(args.delay)
      browser.close()
    enriched=[]
    for movie in movies:
      item=dict(movie)
      result=done.get(str(movie['id']),{})
      if result.get('status')=='ok':
        data=result['data']
        for key in ('description','poster','official_tags','official_tag_refs','actresses','maker'):
          if data.get(key):item[key]=data[key]
      enriched.append(item)
    Path(args.out).write_text(json.dumps({'movies':enriched},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'FINISHED total={len(movies)} ok={sum(x.get("status")=="ok" for x in done.values())} pending={sum(x.get("status")!="ok" for x in done.values())}',flush=True)

if __name__=='__main__':main()
