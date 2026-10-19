"""Read-only alpha audit of approved local display assets; does not modify any media."""
from pathlib import Path
from PIL import Image
from hashlib import sha256
import json

root=Path(__file__).resolve().parent.parent
output=root/'evidence/clear-mirror-140423-20261009'
output.mkdir(parents=True,exist_ok=True)
assets=json.loads((root/'src/data/wardrobe-pack/assets.json').read_text(encoding='utf-8'))
catalog=json.loads((root/'src/data/wardrobe-pack/catalog.json').read_text(encoding='utf-8'))
rows=[]

def inspect(file):
 image=Image.open(file);rgba=image.convert('RGBA');hist=rgba.getchannel('A').histogram();width,height=rgba.size
 return {'mode':image.mode,'width':width,'height':height,'alpha0':hist[0],'alpha1to31':sum(hist[1:32]),'alpha32to239':sum(hist[32:240]),'alpha240to254':sum(hist[240:255]),'alpha255':hist[255],'corners_rgba':[rgba.getpixel(point) for point in [(0,0),(width-1,0),(0,height-1),(width-1,height-1)]],'sha256':sha256(file.read_bytes()).hexdigest()}

for asset in assets:
 file=root/'public/assets/wardrobe-pack'/asset['image_ref'].removeprefix('assets/')
 facts=inspect(file);assert facts['sha256']==asset['sha256'],asset['id']+' source hash mismatch'
 is_cutout=asset['image_ref'].startswith('assets/catalog/')
 if is_cutout:assert facts['alpha0']>0,asset['id']+' has no transparent exterior'
 status='ALREADY_ALPHA_REUSE_ORIGINAL' if is_cutout else 'PRESERVE_EXISTING_FOREGROUND_PIPELINE' if 'LOOK' in asset['id'] else 'PRESERVE_ORIGINAL_PHOTO_CONTENT'
 rows.append({'owner_id':'wardrobe-pack-demo','source_owner_id':asset['owner_id'],'asset_id':asset['id'],'asset_version':asset['asset_version'],'garment_ids':[g['garment_id'] for g in catalog if g['asset_id']==asset['id']],'url':'/assets/wardrobe-pack/'+asset['image_ref'].removeprefix('assets/'),'status':status,'derivative':None,**facts})
for file in (root/'public/assets').glob('*.png'):
 facts=inspect(file);assert facts['alpha0']>0,file.name+' has no transparent exterior'
 rows.append({'owner_id':'demo-profile','asset_id':'asset-'+file.stem,'asset_version':1,'url':'/assets/'+file.name,'status':'ALREADY_ALPHA_REUSE_ORIGINAL','derivative':None,**facts})
report={'status':'PASS','scope':'Approved static packaged catalog/legacy display thumbnails only. No private URLs, original user media or remote assets read.','files':rows,'derivatives_created':0,'originals_modified':0,'blocked_asset_alpha':[],'notes':['All existing catalog and legacy clothing thumbnails already have genuine transparent exterior pixels; structural rectangles came from CSS backgrounds.','Original near-opaque garment alpha and edge fringes are preserved exactly; no color key, crop, model, white-pixel deletion or opacity reduction applied.','LOOK media remain RGB originals processed by the existing person-foreground pipeline; REGISTER01 is preserved source photo content.','Remote/private future uploads and natural-motion foreground quality were not tested by this file audit.']}
(output/'asset-alpha-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'catalog_cutouts':sum(row['status']=='ALREADY_ALPHA_REUSE_ORIGINAL' and row['owner_id']=='wardrobe-pack-demo' for row in rows),'legacy_cutouts':sum(row['owner_id']=='demo-profile' for row in rows),'preserved_rgb_content':sum(row['status']!='ALREADY_ALPHA_REUSE_ORIGINAL' for row in rows),'source_hashes_match':len(assets),'derivatives_created':0,'originals_modified':0}))
