import json, hashlib
from pathlib import Path
from PIL import Image
p=Path(__file__).resolve().parent
s=json.loads((p/'lighting.json').read_text(encoding='utf-8'))
b=Image.open(p/s['base']).convert('RGB')
for name in ['baseline.png','auto-off.png','unknown-location.png']:
 assert Image.open(p/name).convert('RGB').tobytes()==b.tobytes(), name
checks=[]
for v in s['variants']:
 a=Image.open(p/(v['id']+'-selected.png')).convert('RGB')
 mask=Image.open(p/(v['id']+'-silhouette-mask.png')).convert('RGBA') if v.get('cloth_path') else None
 bounds=v.get('sector_bounds',v['bounds']); x,y,w,h=bounds
 changed=outside=0
 for py in range(b.height):
  for px in range(b.width):
   if a.getpixel((px,py))!=b.getpixel((px,py)):
    changed+=1
    allowed=mask.getpixel((px,py))[3]>0 if mask else x<=px<x+w and y<=py<y+h
    if not allowed: outside+=1
 assert changed>0 and outside==0, (v['id'],changed,outside)
 checks.append(dict(selected=v['id'],changed_pixels=changed,outside_selected_mask=outside))
result=dict(status='PASS',render_mode=s['render_mode'],checks=checks,off_base_sha256=hashlib.sha256((p/s['base']).read_bytes()).hexdigest(),auto_off_and_unknown_restore_off_base_exactly=True,limitation='Image replacement checks, not hardware verification or exact geometry guarantee.')
(p/'integrity.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
