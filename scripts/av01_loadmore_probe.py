#!/usr/bin/env python3
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HOT = "https://www.av01.media/vn/videos/hottest"
OUT = Path("av01-loadmore-probe.json")

def video_ids(page):
    hrefs = page.locator('a[href*="/video/"]').evaluate_all("els=>els.map(e=>e.href)")
    out=[]
    for u in hrefs:
        m=re.search(r"/video/(\d+)(?:/|$)",u)
        if m and m.group(1) not in out: out.append(m.group(1))
    return out

with sync_playwright() as p:
    browser=p.chromium.launch(headless=False)
    ctx=browser.new_context(viewport={"width":1280,"height":900})
    page=ctx.new_page()
    events=[]

    def req(r):
        if r.resource_type in ("xhr","fetch"):
            events.append({"kind":"request","method":r.method,"url":r.url,"post_data":r.post_data})
            print("[REQ]",r.method,r.url,flush=True)
            if r.post_data: print("      BODY:",r.post_data[:1000],flush=True)

    def resp(r):
        try:
            if r.request.resource_type in ("xhr","fetch"):
                events.append({"kind":"response","status":r.status,"url":r.url})
                print("[RES]",r.status,r.url,flush=True)
        except Exception: pass

    page.on("request",req)
    page.on("response",resp)
    print("Opening:",HOT,flush=True)
    page.goto(HOT,wait_until="domcontentloaded",timeout=60000)
    page.wait_for_timeout(2500)
    before=video_ids(page)
    print(f"\nREADY: {len(before)} video IDs visible.",flush=True)
    print(">>> CLICK LOAD MORE ON THE BROWSER WINDOW ONCE. DO NOT CLOSE IT. <<<",flush=True)

    deadline=time.time()+180
    after=before
    while time.time()<deadline:
        page.wait_for_timeout(500)
        after=video_ids(page)
        if len(after)>len(before):
            print(f"\nDETECTED: {len(before)} -> {len(after)} videos",flush=True)
            break

    OUT.write_text(json.dumps({"source":HOT,"before":before,"after":after,"events":events},ensure_ascii=False,indent=2),encoding="utf-8")
    print("SAVED:",OUT.resolve(),flush=True)
    if len(after)<=len(before):
        print("NO GROWTH DETECTED within 180s.",flush=True)
    else:
        print("DONE. You can close the browser.",flush=True)
    browser.close()
