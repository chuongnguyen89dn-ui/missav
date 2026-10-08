#!/usr/bin/env python3
"""Remove amateur-tagged AV01 IDs from main catalog and enrichment datasets."""
import json,re
from pathlib import Path
PAT=re.compile(r'^(?:amateur|nghiệp\s*dư|素人)$',re.I)
root=Path(__file__).resolve().parent.parent
catalog=root/'data/av01-catalog.json'
obj=json.loads(catalog.read_text(encoding='utf-8'))
movies=obj if isinstance(obj,list) else obj['movies']
def tagged(m):
    tags=m.get('official_tags') or m.get('tags') or []
    return any(PAT.fullmatch(str(t if isinstance(t,str) else t.get('name','')).strip()) for t in tags)
removed={str(m['id']) for m in movies if tagged(m)}
remaining=[m for m in movies if str(m['id']) not in removed]
assert len(movies)>=2000 and len(removed)>0, 'Unexpected catalog size or no matching IDs: abort'
if isinstance(obj,list):obj=remaining
else:
    obj['movies']=remaining
    obj['count']=len(remaining)
catalog.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ('data/av01-metadata-enriched.json','data/av01-addon-test20.json'):
    p=root/name
    if not p.exists():continue
    x=json.loads(p.read_text(encoding='utf-8'))
    if isinstance(x,list):x=[m for m in x if str(m.get('id')) not in removed]
    elif isinstance(x,dict) and isinstance(x.get('movies'),list):
        x['movies']=[m for m in x['movies'] if str(m.get('id')) not in removed]
        if 'count' in x:x['count']=len(x['movies'])
    p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'BEFORE={len(movies)} REMOVED={len(removed)} AFTER={len(remaining)}')
assert not any(tagged(m) for m in remaining)
