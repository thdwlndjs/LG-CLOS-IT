import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REVIEWED_VISUAL_BINDINGS,PENDING_VISUAL_BINDINGS} from '../src/lifeData/reviewedVisualBindings';
import sourceGarments from '../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/garments.json';
import catalog from '../src/data/wardrobe-pack/catalog.json';
import assets from '../src/data/wardrobe-pack/assets.json';
import {PHOTO_DEMO_PLACEMENTS,PHOTO_VISUAL_ZONES,PHOTO_SCENE_SOURCE} from '../src/photoSceneMapping';
import {PACK_PLACEMENT_GROUPS} from '../src/packScenePlacements';
import {getLayoutCompartment} from '../src/layoutConfig';

test('explicit visual decisions cover each local garment once and preserve source identity and owner scope',()=>{
 const rows=[...REVIEWED_VISUAL_BINDINGS,...PENDING_VISUAL_BINDINGS];assert.equal(rows.length,32);assert.equal(new Set(rows.map(row=>row.currentCanonicalGarmentId)).size,32);
 for(const row of rows){const source=sourceGarments.find(g=>g.ref===row.sourceGarmentRef&&g.owner_ref===row.sourceProfileRef)!;assert(source);assert.equal(row.sourceDataset,'scprep-20261009-v1');assert.equal(row.currentLocalProfileId,`local:${row.sourceDataset}:profile:${source.owner_ref}`);assert.equal(row.currentCanonicalGarmentId,`local:${row.sourceDataset}:garment:${source.ref}`);assert.equal(row.expectedName,source.name);assert.equal(row.expectedColor,source.colour);assert.equal(row.expectedCategory,source.category);assert.equal(row.sourceProductRef,source.product_ref);}
 assert.equal(REVIEWED_VISUAL_BINDINGS.length,15);assert.equal(PENDING_VISUAL_BINDINGS.length,17);
});
test('bound display files are exact locally inspected generated PNGs with unchanged manifest hashes and alpha channels',()=>{
 for(const row of REVIEWED_VISUAL_BINDINGS){
  const original=catalog.find(g=>g.garment_id===row.legacyCatalogRef)!;const asset=assets.find(a=>a.id===original.asset_id)!;
  assert.equal(asset.provenance.kind,'generated_demo');assert.equal(asset.provenance.is_real_product_photo,false);assert.equal(row.asset.id,asset.id);assert.equal(row.asset.version,asset.asset_version);
  assert.equal(row.asset.displayUrl,`/assets/wardrobe-pack/catalog/${row.legacyCatalogRef}.png`);assert.equal(row.asset.sha256,original.sha256);assert.equal(row.asset.sha256,asset.sha256);assert.equal(row.asset.displaySha256,row.asset.sha256);
  const bytes=readFileSync(new URL('../public'+row.asset.displayUrl,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),row.asset.displaySha256);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1254);assert.equal(bytes.readUInt32BE(20),1254);assert.equal(bytes[25],6);
  assert.equal(row.imageBindingKind,'explicit_example_image');assert.equal(row.productIdentity,row.sourceProductRef?'demo_product':'not_verified');assert.equal(row.careApplicability,row.sourceProductRef?'demo_product_reference':'insufficient_evidence');
 }
});
test('every scene uses an existing photo fixture or an exact existing compartment label alias',()=>{
 assert.equal(REVIEWED_VISUAL_BINDINGS.filter(r=>r.scene).length,11);
 for(const row of REVIEWED_VISUAL_BINDINGS){
  if(!row.scene){assert(['S15','S16','H15','H16'].includes(row.sourceGarmentRef));continue;}
  const scene=row.scene;assert.equal(scene.physicalLocationVerified,false);assert.equal(scene.version,PHOTO_SCENE_SOURCE.sceneAssetVersion);
  const zone=PHOTO_VISUAL_ZONES.find(z=>z.id===scene.visualZoneId)!;assert(zone);assert.deepEqual(scene.ledAnchorIds,zone.anchorIds);
  if(scene.source==='PHOTO_DEMO_PLACEMENTS'){const fixture=PHOTO_DEMO_PLACEMENTS.find(p=>p.garmentId===row.legacyCatalogRef)!;assert(fixture);assert.equal(fixture.visualZoneId,scene.visualZoneId);assert.equal(scene.slotId,scene.visualZoneId);}
  else {const group=PACK_PLACEMENT_GROUPS.find(p=>p.garmentIds.includes(row.legacyCatalogRef))!;assert(group);assert.equal(scene.slotId,group.compartmentId);const compartment=getLayoutCompartment(group.compartmentId)!;assert(zone.locationAliases.includes(compartment.label));assert.equal(row.legacyCatalogRef,'O02');}
 }
});
test('ambiguous raw S01 and H01 codes cannot link a shirt to footwear or a hat',()=>{
 assert(!REVIEWED_VISUAL_BINDINGS.some(row=>row.sourceGarmentRef==='S01'));
 const shirt=REVIEWED_VISUAL_BINDINGS.find(row=>row.sourceGarmentRef==='H01')!;assert.equal(shirt.legacyCatalogRef,'T01');assert.equal(catalog.find(r=>r.garment_id===shirt.legacyCatalogRef)!.category,'top');
 const footwear=REVIEWED_VISUAL_BINDINGS.find(row=>row.sourceGarmentRef==='S15')!;assert.equal(footwear.legacyCatalogRef,'S01');assert.equal(footwear.scene,null);
 const sameFile=REVIEWED_VISUAL_BINDINGS.filter(row=>row.legacyCatalogRef==='T01');assert.equal(sameFile.length,2);assert.notEqual(sameFile[0].currentLocalProfileId,sameFile[1].currentLocalProfileId);assert.notEqual(sameFile[0].currentCanonicalGarmentId,sameFile[1].currentCanonicalGarmentId);
});
test('color, clothing kind and silhouette conflicts remain explicit individual pending decisions',()=>{
 for(const ref of ['S01','S03','S05','S07','S08','S10','S14','H03','H04','H06','H08','H12','H14']){const pending=PENDING_VISUAL_BINDINGS.find(row=>row.sourceGarmentRef===ref)!;assert(pending);assert(pending.reason.length>25);assert(pending.remainingReview);assert.equal(pending.imageBindingKind,'pending');assert(!REVIEWED_VISUAL_BINDINGS.some(row=>row.currentCanonicalGarmentId===pending.currentCanonicalGarmentId));}
 assert.match(PENDING_VISUAL_BINDINGS.find(r=>r.sourceGarmentRef==='S01')!.reason,/아이보리.*린넨.*포플린/);
 assert(Object.isFrozen(REVIEWED_VISUAL_BINDINGS));assert(Object.isFrozen(REVIEWED_VISUAL_BINDINGS[0].asset));assert(Object.isFrozen(PENDING_VISUAL_BINDINGS));
});
