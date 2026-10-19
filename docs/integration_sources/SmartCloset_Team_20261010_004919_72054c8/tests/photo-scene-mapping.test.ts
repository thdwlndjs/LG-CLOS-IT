import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import geometry from '../src/data/mirror-geometry.json';
import type {Garment} from '../src/core/types';
import {createWardrobePackBundle,PACK_ASSETS,PACK_METADATA,PACK_PROFILE_ID} from '../src/wardrobePack';
import {PHOTO_DEMO_PLACEMENTS,PHOTO_SCENARIO_A_GARMENT_ID,PHOTO_SCENARIO_B_OUTFIT_IDS,
  PHOTO_SCENE_SOURCE,PHOTO_TOP_CANDIDATE_IDS,PHOTO_VISUAL_ZONES,resolvePhotoLocations} from '../src/photoSceneMapping';

const bundle=()=>createWardrobePackBundle();
const resolve=(ids:string[],garments=bundle().garments,ownerId=PACK_PROFILE_ID)=>resolvePhotoLocations(garments,ownerId,ids);
const changed=(id:string,patch:Partial<Garment>)=>bundle().garments.map(row=>row.id===id?{...row,...patch}:row);

test('photo source binds the exact supplied image and leaves all 34 landmarks unbound',async()=>{
  assert.equal(geometry.led_anchors.length,34);
  assert.ok(geometry.led_anchors.every(row=>row.garment_ids.length===0&&row.mapping_status==='unbound_visual_landmark'));
  assert.equal(PHOTO_SCENE_SOURCE.sourcePixelHash,'561cc71ed7d54f90dfb4ba3edb6c3050c1ed17a41aefb8b9c9530fda7a0fe535');
  const reference=await readFile(new URL('../reference/mirror-ux-final-20261009/references/대칭형 럭셔리 스마트 드레스룸.png',import.meta.url));
  assert.equal(createHash('sha256').update(reference).digest('hex'),PHOTO_SCENE_SOURCE.sourceFileHash);
  const source=JSON.parse(await readFile(new URL('../reference/mirror-ux-final-20261009/mirror_geometry.reference.json',import.meta.url),'utf8'));
  assert.deepEqual(geometry,source);
});

test('explicit garment IDs resolve through grounded zones, never individual hanger points',()=>{
  const results=resolve(['O01','T04','T05','B01','B03','T07','B07']);
  assert.deepEqual(results.items.map(row=>row.anchorIds[0]),[
    'L1_RAIL_GROUP','L2_UPPER_GROUP','R1_SHELF_01','L2_LOWER_GROUP','R2_SHELF_04','R1_SHELF_03','R1_SHELF_04',
  ]);
  assert.deepEqual(results.unknownIds,[]);
  for(const row of results.items){
    assert.equal(row.locationSource,'demo-fixture');
    assert.equal(row.sourceAccuracy,'packaged-demo-exact');
    assert.equal(row.sourceAsset?.isSyntheticDemo,true);
    assert.equal(row.precision,'zone');
    assert.match(row.displayLabel,/시연 위치/);
    assert.equal(row.photoGarmentIdentityVerified,false);
    assert.equal(row.physicalLocationVerified,false);
    assert.equal(row.sourceLocation,'');
  }
  assert.ok(results.anchorIds.every(id=>!/^L[12]_(RAIL|UPPER|LOWER)_\d/.test(id)));
});

test('same zone deduplicates LEDs while retaining distinct names and deduplicating requested IDs',()=>{
  const result=resolve(['O01','O03','O01','T03','T04']);
  assert.deepEqual(result.anchorIds,['L1_RAIL_GROUP','L2_UPPER_GROUP']);
  assert.equal(result.items.length,4);
  assert.equal(new Set(result.items.map(row=>row.garmentName)).size,4);
});

test('unknown shoes do not extinguish known clothes or gain an invented shoe compartment',()=>{
  const result=resolve(['T05','B03','S04','missing']);
  assert.deepEqual(result.anchorIds,['R1_SHELF_01','R2_SHELF_04']);
  assert.deepEqual(result.unknownIds,['S04','missing']);
  assert.match(result.items.find(row=>row.garmentId==='S04')!.reason,/신발 전용.*확인되지/);
  assert.deepEqual(resolve(['S03','S04']).anchorIds,[]);
});

test('owner mismatch and duplicate own IDs cannot claim a photo binding or leak the other name',()=>{
  const garments=bundle().garments;
  const mismatch=resolve(['T04'],garments,'other-owner');
  assert.deepEqual(mismatch.anchorIds,[]);
  assert.equal(mismatch.items[0].sourceAccuracy,'garment-missing');
  assert.equal(mismatch.items[0].sourceAsset,null);
  assert.equal(mismatch.items[0].garmentName,'의류 확인 필요');
  const duplicate=resolve(['T04'],[...garments,{...garments.find(row=>row.id==='T04')!}]);
  assert.equal(duplicate.items[0].sourceAccuracy,'ambiguous-id');
  assert.deepEqual(duplicate.anchorIds,[]);
});

test('user location overrides fixture, unknown and intentionally cleared locations stay unknown',()=>{
  const base=bundle().garments.find(row=>row.id==='T04')!;
  const provenance={...base.provenance,location:'user' as const};
  const known=resolve(['T04'],changed('T04',{location:'왼쪽 긴 옷 행거',provenance}));
  assert.deepEqual(known.anchorIds,['L1_RAIL_GROUP']);
  assert.equal(known.items[0].locationSource,'user-input');
  assert.equal(known.items[0].sourceLocation,'왼쪽 긴 옷 행거');
  assert.equal(known.items[0].physicalLocationVerified,false);
  for(const location of ['다른 방의 옷장','']){
    const result=resolve(['T04'],changed('T04',{location,provenance}));
    assert.deepEqual(result.anchorIds,[]);
    assert.equal(result.items[0].locationSource,'user-input');
    assert.equal(result.items[0].sourceLocation,location);
  }
});

test('existing demo record has priority and exact aliases stay explicit display correspondences',()=>{
  const base=bundle().garments.find(row=>row.id==='T05')!;
  const result=resolve(['T05'],changed('T05',{location:'행거 D',provenance:{...base.provenance,location:'demo'}}));
  assert.deepEqual(result.anchorIds,['L2_LOWER_GROUP']);
  assert.equal(result.items[0].locationSource,'existing-record');
  assert.equal(result.items[0].recordProvenance,'demo');
  assert.match(result.items[0].reason,/실물 위치는 미검증/);
  assert.deepEqual(resolve(['T05'],changed('T05',{location:'행거 D'})).anchorIds,[]);
});

test('fixture rejects mismatched asset/category and does not fall back from a real profile',()=>{
  const base=bundle().garments.find(row=>row.id==='T04')!;
  for(const patch of [
    {asset:{...base.asset!,version:2}},
    {asset:{...base.asset!,id:'another-asset'}},
    {asset:{...base.asset!,url:'/wrong-photo.png'}},
    {asset:{...base.asset!,source:'upload' as const}},
    {asset:{...base.asset!,needsReselection:true}},
    {category:'bottom' as const},
    {asset:null},
  ]){
    const result=resolve(['T04'],changed('T04',patch));
    assert.deepEqual(result.anchorIds,[]);
    assert.equal(result.items[0].sourceAccuracy,'packaged-source-mismatch');
  }
  const other={...base,ownerId:'real-owner'};
  const result=resolve(['T04'],[other],'real-owner');
  assert.deepEqual(result.anchorIds,[]);
  assert.equal(result.items[0].sourceAccuracy,'registered-asset');
});

test('all mapping keys/aliases are unique and reference real photo anchors and source clothes',()=>{
  assert.equal(new Set(PHOTO_VISUAL_ZONES.map(row=>row.id)).size,PHOTO_VISUAL_ZONES.length);
  const aliases=PHOTO_VISUAL_ZONES.flatMap(row=>row.locationAliases);
  assert.equal(new Set(aliases).size,aliases.length);
  assert.equal(new Set(PHOTO_DEMO_PLACEMENTS.map(row=>row.garmentId)).size,PHOTO_DEMO_PLACEMENTS.length);
  for(const fixture of PHOTO_DEMO_PLACEMENTS){
    assert.ok(bundle().garments.find(row=>row.id===fixture.garmentId));
    assert.ok(PHOTO_VISUAL_ZONES.find(row=>row.id===fixture.visualZoneId));
  }
  for(const zone of PHOTO_VISUAL_ZONES)for(const id of zone.anchorIds)
    assert.ok(geometry.led_anchors.find(row=>row.anchor_id===id));
});

test('mapping is independent of array order, names and color and never mutates source records',()=>{
  const garments=bundle().garments;
  const original=JSON.stringify({garments,geometry,metadata:PACK_METADATA});
  const ids=['T04','T05','B03','S04','O01'];
  const first=resolve(ids,garments);
  const shuffled=[...garments].reverse().map(row=>({...row,name:'이름 변경',color:'#123456'}));
  const second=resolve([...ids].reverse(),shuffled);
  assert.deepEqual(first.anchorIds,second.anchorIds);
  assert.equal(JSON.stringify({garments,geometry,metadata:PACK_METADATA}),original);
  assert.equal(garments.length,47);
  assert.ok(PACK_METADATA.garments.every(row=>row.location_json===null&&row.owner_id===null));
});

test('A is an existing coat, B includes existing exact looks and three real top assets',async()=>{
  const garments=bundle().garments;
  assert.equal(garments.find(row=>row.id===PHOTO_SCENARIO_A_GARMENT_ID)?.category,'outer');
  assert.ok(PHOTO_SCENARIO_B_OUTFIT_IDS.length>=2);
  assert.ok(PHOTO_TOP_CANDIDATE_IDS.length>=3);
  assert.ok(PHOTO_TOP_CANDIDATE_IDS.every(id=>garments.find(row=>row.id===id)?.category==='top'));
  const sourceIds=new Set<string>([PHOTO_SCENARIO_A_GARMENT_ID,...PHOTO_TOP_CANDIDATE_IDS]);
  const assetIds=new Set<string>();
  for(const id of PHOTO_SCENARIO_B_OUTFIT_IDS){
    const outfit=PACK_METADATA.outfits.find(row=>row.id===id)!;
    assert.ok(outfit);
    assert.equal(outfit.snapshot_json.person_ref,'DEMO_PERSON01');
    const result=PACK_METADATA.savedResults.find(row=>row.outfit_id===id)!;
    assert.equal(result.match_policy,'exact_person_and_full_snapshot_and_asset_versions');
    assert.equal(result.provider_execution_verified,false);
    assetIds.add(result.result_asset_id);
    for(const item of outfit.snapshot_json.items){sourceIds.add(item.garment_id);assetIds.add(item.asset_id);}
  }
  for(const id of sourceIds)assetIds.add(garments.find(row=>row.id===id)!.asset!.id);
  for(const id of assetIds){
    const asset=PACK_ASSETS.find(row=>row.id===id)!;
    const bytes=await readFile(new URL('../public/assets/wardrobe-pack/'+asset.image_ref.slice('assets/'.length),import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,id);
  }
});

test('source evidence explicitly blocks verified-label A and does not fabricate a person or care rule',()=>{
  assert.equal(PACK_METADATA.garments.length,48);
  assert.ok(PACK_METADATA.garments.every(row=>!row.attributes_json.care_label_verified
    &&row.attributes_json.care_instructions===null&&row.attributes_json.care_evidence_state==='unknown'));
  assert.deepEqual([...new Set(PACK_ASSETS.map(row=>row.role))].sort(),['catalog_cutout','outfit_still','registration_example']);
  assert.equal(PACK_METADATA.people.length,1);
  assert.equal(PACK_METADATA.people[0].is_synthetic_person,true);
  assert.equal(PACK_METADATA.people[0].reference_asset_id,'asset_LOOK01_v1');
});


