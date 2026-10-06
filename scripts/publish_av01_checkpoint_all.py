#!/usr/bin/env python3
import json, subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
STATE=ROOT/"av01_hottest_full"/"checkpoint.json"
CAT=ROOT/"data"/"av01-catalog.json"

st=json.loads(STATE.read_text(encoding="utf-8"))
movies=[]
for src in st.get("accepted",[]):
    m=dict(src)
    vid=str(m.get("id") or "")
    if vid:
        m["poster"]=f"https://www.av01.media/media/videos/tmb/{vid}/1.jpg"
    for k in ("poster_file","playlist","metadata_file","extra_metadata","jsonld"):
        m.pop(k,None)
    movies.append(m)

payload={
    "updated_at":datetime.now(timezone.utc).isoformat(),
    "source":st.get("source"),
    "run_id":st.get("run_id"),
    "clean_run":True,
    "count":len(movies),
    "movies":movies,
}
CAT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

# Keep checkpoint in sync: everything currently accepted is now published.
st["published_count"]=len(movies)
tmp=STATE.with_suffix(".tmp")
tmp.write_text(json.dumps(st,ensure_ascii=False,indent=2),encoding="utf-8")
tmp.replace(STATE)

subprocess.run(["git","add","--","data/av01-catalog.json"],cwd=ROOT,check=True)
changed=subprocess.run(["git","diff","--cached","--quiet"],cwd=ROOT).returncode!=0
if changed:
    subprocess.run(["git","commit","-m",f"data(av01): publish checkpoint through {len(movies)} movies"],cwd=ROOT,check=True)
    subprocess.run(["git","push","origin","main"],cwd=ROOT,check=True)
print(f"PUBLISHED={len(movies)}")
