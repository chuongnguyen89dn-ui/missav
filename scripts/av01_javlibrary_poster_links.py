#!/usr/bin/env python3
"""Extract JavLibrary poster URLs into AV01 metadata without downloading images.

Use --html-dir for HTML captured from an authorized browser session.
Live lookup is best-effort and reports Cloudflare challenges as blocked.
Never synthesizes DMM paths, never overwrites a poster without a code match.
"""
import argparse
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent

def norm(s):
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())

def code_from_movie(m):
    title = str(m.get('catalog_title') or m.get('title') or '')
    lead = re.match(r'^\\s*(FC2[-_ ]?PPV[-_ ]?\\d{5,9}|[A-Za-z]{2,9}[-_ ]?\\d{2,6})(?=[^A-Za-z0-9]|$)', title)
    if lead:
        return re.sub(r'[_ ]+', '-', lead.group(1)).upper()
    return str(m.get('movie_code') or m.get('dvd_id') or m.get('code') or '').upper()

class MovieHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.poster = ''
        self.fallback = ''
        self.code = ''
        self.in_code = False
        self.in_code_text = False
        self.in_video_id = False
        self.video_id_depth = 0
        self.link = ''
        self.in_result = False
        self.result_depth = 0
        self.result_code = ''
        self.results = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get('class','').split()
        if a.get('id') == 'video_id':
            self.in_video_id = True
            self.video_id_depth = 1
        elif self.in_video_id:
            self.video_id_depth += 1
        if self.in_video_id and 'text' in cls:
            self.in_code_text = True
        if tag == 'img' and a.get('id') == 'video_jacket_img':
            self.poster = html.unescape(a.get('src',''))
            match = re.search(r"ThumbError\\(this,\\s*['\\\"]([^'\\\"]+)", a.get('onerror',''))
            self.fallback = html.unescape(match.group(1)) if match else ''
        if tag == 'div' and 'video' in cls:
            self.in_result = True
            self.result_depth = 1
            self.link = ''
            self.result_code = ''
        elif self.in_result and tag == 'div':
            self.result_depth += 1
        if self.in_result and tag == 'a' and a.get('href'):
            self.link = a['href']
        if self.in_result and 'id' in cls:
            self.in_code = True
    def handle_data(self, data):
        if self.in_code_text:
            self.code += data
        if self.in_code:
            self.result_code += data
    def handle_endtag(self, tag):
        if self.in_code_text and tag in ('span','div'):
            self.in_code_text = False
        if self.in_code and tag in ('div','span'):
            self.in_code = False
        if self.in_video_id:
            self.video_id_depth -= 1
            if self.video_id_depth <= 0:
                self.in_video_id = False
        if self.in_result and tag == 'div':
            self.result_depth -= 1
            if self.result_depth <= 0:
                if self.link:
                    self.results.append((self.result_code.strip(), self.link))
                self.in_result = False

def parse(s):
    p = MovieHTML()
    p.feed(s)
    return p

def fetch(url):
    req = Request(url, headers={'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'})
    with urlopen(req, timeout=25) as response:
        return response.read().decode('utf-8','replace'), response.url

def blocked(s):
    return 'Just a moment...' in s or 'challenge-platform' in s or 'cf_chl_opt' in s

def get_detail(code, html_dir):
    if html_dir:
        file = html_dir / (norm(code)+'.html')
        if not file.exists():
            return None, 'no_saved_html', ''
        return file.read_text(encoding='utf-8'), 'saved_html', 'https://www.javlibrary.com/'
    try:
        search, url = fetch('https://www.javlibrary.com/en/vl_searchbyid.php?keyword='+quote(code))
        if blocked(search):
            return None, 'cloudflare_blocked', ''
        p = parse(search)
        if p.poster and norm(p.code)==norm(code):
            return search, 'ok', url
        match = next((href for c,href in p.results if norm(c)==norm(code)), None)
        if not match:
            return None, 'no_exact_match', ''
        detail, detail_url = fetch(urljoin(url,match))
        if blocked(detail):
            return None, 'cloudflare_blocked', ''
        return detail, 'ok', detail_url
    except Exception as exc:
        return None, type(exc).__name__+': '+str(exc)[:120], ''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--catalog',default='data/av01-catalog.json')
    ap.add_argument('--metadata',default='data/av01-metadata-enriched.json')
    ap.add_argument('--out',default='data/av01-poster-links-pending.json')
    ap.add_argument('--html-dir',type=Path,help='Optional saved HTML files named NORMALIZEDCODE.html')
    ap.add_argument('--limit',type=int,default=0)
    args = ap.parse_args()
    catalog = json.loads((ROOT/args.catalog).read_text(encoding='utf-8'))
    movies = catalog if isinstance(catalog,list) else catalog['movies']
    md = json.loads((ROOT/args.metadata).read_text(encoding='utf-8'))
    existing = {str(x['id']):x for x in md.get('movies',[])}
    found, failures = [], []
    for movie in movies:
        vid = str(movie['id'])
        entry = existing.get(vid,{})
        code = code_from_movie({**movie,**entry})
        if not code:
            failures.append({'id':vid,'reason':'no_code'})
            continue
        source,status,base = get_detail(code,args.html_dir)
        if source is None:
            failures.append({'id':vid,'code':code,'reason':status})
        else:
            p = parse(source)
            if norm(p.code)!=norm(code):
                failures.append({'id':vid,'code':code,'found_code':p.code.strip(),'reason':'code_mismatch'})
            elif not p.poster:
                failures.append({'id':vid,'code':code,'reason':'no_poster'})
            else:
                poster = urljoin(base,p.poster)
                if not poster.startswith('https://'):
                    failures.append({'id':vid,'code':code,'reason':'invalid_url'})
                else:
                    found.append({'id':vid,'movie_code':code,'poster':poster,
                                  'poster_fallback':urljoin(base,p.fallback) if p.fallback else '',
                                  'poster_source':'javlibrary_html','status':'url_extracted_unverified'})
                    print('FOUND',vid,code,poster,flush=True)
        if args.limit and len(found)+len(failures)>=args.limit:
            break
    out=ROOT/args.out
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'found':found,'failed':failures,'summary':{'found':len(found),'failed':len(failures)}},ensure_ascii=False,indent=2),encoding='utf-8')
    print('FINISHED',len(found),'found',len(failures),'failed','output',out,flush=True)

if __name__=='__main__':
    main()
