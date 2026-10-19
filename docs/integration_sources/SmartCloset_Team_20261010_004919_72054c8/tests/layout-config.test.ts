import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createSeed,DEMO_PROFILE} from '../src/core/seed';
import {LAYOUT_CONFIG,MIRROR_COMPARTMENTS,MIRROR_BINDINGS,getLayoutCompartment} from '../src/layoutConfig';
import {PACK_DEMO_PLACEMENTS,PACK_PLACEMENT_GROUPS,PACK_PENDING_PLACEMENTS,createPackDisplayPlacements} from '../src/packScenePlacements';
import {STRUCTURE_GARMENT_IDS} from '../src/demoReviewSelection';
import {PACK_METADATA,PACK_PROFILE_ID,createWardrobePackBundle} from '../src/wardrobePack';
import {resolveGarmentLocation,selectMirrorScene} from '../src/mirrorScene';

function sceneContext(){
  return {ownerId:PACK_PROFILE_ID,garments:createWardrobePackBundle().garments,
    compartments:MIRROR_COMPARTMENTS,bindings:MIRROR_BINDINGS,demoLocations:PACK_DEMO_PLACEMENTS};
}

test('reference layout keeps five columns and a central mirror without a storage compartment',()=>{
  assert.deepEqual(LAYOUT_CONFIG.columns.map(c=>c.side),['left','left','center','right','right']);
  assert.deepEqual(LAYOUT_CONFIG.columns.map(c=>c.kind),['long-hanging','double-hanging','mirror','folded','folded']);
  assert.deepEqual(LAYOUT_CONFIG.columns.map(c=>c.column),[1,2,3,4,5]);
  assert.equal(LAYOUT_CONFIG.columns[2].compartmentIds.length,0);
  assert.ok(MIRROR_COMPARTMENTS.every(c=>c.column!==3));
  assert.deepEqual(LAYOUT_CONFIG.columns.map(c=>c.compartmentIds.length),[3,3,0,5,7]);
  assert.deepEqual(MIRROR_COMPARTMENTS.filter(c=>c.column===1).map(c=>c.type),['long-hanger','drawer','shelf']);
  assert.deepEqual(MIRROR_COMPARTMENTS.filter(c=>c.column===2).map(c=>c.type),['upper-hanger','lower-hanger','drawer']);
});

test('compartment IDs, rows, labels and normalized geometry are unique and nonoverlapping',()=>{
  assert.equal(new Set(MIRROR_COMPARTMENTS.map(c=>c.id)).size,MIRROR_COMPARTMENTS.length);
  assert.equal(new Set(MIRROR_COMPARTMENTS.map(c=>c.label)).size,MIRROR_COMPARTMENTS.length);
  assert.equal(new Set(MIRROR_COMPARTMENTS.map(c=>c.column+':'+c.row)).size,MIRROR_COMPARTMENTS.length);
  for(const column of LAYOUT_CONFIG.columns) {
    const cells=column.compartmentIds.map(id=>getLayoutCompartment(id)!);
    assert.ok(cells.every(Boolean));
    for(const [index,cell] of cells.entries()) {
      const {x,y,width,height}=cell.geometry;
      for(const number of [x,y,width,height])assert.ok(Number.isFinite(number)&&number>0&&number<1);
      assert.ok(x+width<=1&&y+height<=1);
      assert.ok(x>=column.geometry.x&&x+width<=column.geometry.x+column.geometry.width);
      assert.ok(cell.ledAnchor.x>=x&&cell.ledAnchor.x<=x+width);
      assert.ok(cell.ledAnchor.y>=y&&cell.ledAnchor.y<=y+height);
      if(index>0)assert.ok(cells[index-1].geometry.y+cells[index-1].geometry.height<=y);
    }
  }
});

test('all reference dimensions, shelf counts, folding and placements remain explicitly unconfirmed',()=>{
  assert.equal(LAYOUT_CONFIG.physicalStatus,'unconfirmed');
  assert.equal(LAYOUT_CONFIG.displayOnly,true);
  assert.equal(LAYOUT_CONFIG.reference.selectedFinalDesign,false);
  assert.equal(LAYOUT_CONFIG.reference.geometryUnits,'normalized-reference-image');
  assert.match(LAYOUT_CONFIG.assumptions.label,/실측 치수.*선반 수.*접은 상태.*미확정/);
  assert.ok(MIRROR_COMPARTMENTS.every(c=>c.displayOnly&&c.physicalStatus==='unconfirmed'));
  assert.equal(PACK_DEMO_PLACEMENTS.physicalStatus,'unconfirmed');
  assert.ok(Object.isFrozen(LAYOUT_CONFIG.compartments[0].geometry));
  assert.ok(Object.isFrozen(PACK_DEMO_PLACEMENTS.byGarmentId));
});

test('legacy strings retain explicit display aliases while the unverified shoe cabinet is not invented',()=>{
  for(const [label,id] of [['행거 A','left-hanger-a'],['행거 B','left-hanger-b'],['행거 D','left-hanger-d'],
    ['서랍 E','left-drawer-e'],['서랍 G','left-drawer-g'],['선반 C','right-shelf-c'],['선반 F','right-shelf-f'],['선반 H','right-shelf-h']]) {
    assert.equal(MIRROR_BINDINGS.find(b=>b.locationRef===label)?.compartmentId,id);
  }
  assert.equal(MIRROR_BINDINGS.find(b=>b.locationRef==='행거 B · 오른쪽 1번째')?.compartmentId,'left-hanger-b');
  assert.equal(MIRROR_BINDINGS.find(b=>b.locationRef==='행거 I')?.compartmentId,'left-hanger-b');
  assert.ok(LAYOUT_CONFIG.legacyBindings.find(b=>b.locationRef==='행거 I')?.reason.includes('실물 위치 변경 아님'));
  assert.ok(!MIRROR_COMPARTMENTS.some(c=>c.id==='right-shoes'||c.label==='신발장'));
  assert.ok(!MIRROR_BINDINGS.some(b=>b.locationRef==='신발장'));
  assert.ok(LAYOUT_CONFIG.retiredCompartments.every(c=>c.physicalRelocation===false));
});

test('garment to compartment to LED is a single unambiguous ID chain for every selected structure garment',()=>{
  const context=sceneContext();
  for(const id of STRUCTURE_GARMENT_IDS) {
    const location=resolveGarmentLocation({...context,garmentId:id});
    assert.equal(location.status,'mapped',id);
    assert.equal(location.compartmentId,PACK_DEMO_PLACEMENTS.compartmentByGarmentId[id]);
    assert.equal(location.locationRef,getLayoutCompartment(location.compartmentId!)?.label);
    assert.match(location.message,/시연 배치.*실제 위치 미확인/);
  }
  assert.equal(PACK_DEMO_PLACEMENTS.compartmentByGarmentId.O01,'left-hanger-b');
  assert.equal(PACK_DEMO_PLACEMENTS.compartmentByGarmentId.T04,'left-hanger-a');
  assert.equal(PACK_DEMO_PLACEMENTS.compartmentByGarmentId.B01,'left-hanger-d');
  assert.equal(PACK_DEMO_PLACEMENTS.compartmentByGarmentId.T05,'right-shelf-c');
  assert.equal(PACK_DEMO_PLACEMENTS.compartmentByGarmentId.B03,'right-shelf-l');
});

test('duplicate compartments, duplicate garments, unknown IDs and nonexistent compartments are rejected',()=>{
  const base=PACK_PLACEMENT_GROUPS[0];
  assert.throws(()=>createPackDisplayPlacements([base,base]),/수납 칸 묶음이 중복/);
  assert.throws(()=>createPackDisplayPlacements([base,{...PACK_PLACEMENT_GROUPS[1],garmentIds:[base.garmentIds[0]]}]),/여러 칸에 중복/);
  assert.throws(()=>createPackDisplayPlacements([{...base,garmentIds:['missing-garment']}]),/원본 의류 ID/);
  assert.throws(()=>createPackDisplayPlacements([{...base,compartmentId:'missing-cell'}]),/수납 칸/);
});

test('shoes and accessories remain available in the original inventory but have no fabricated LED location',()=>{
  const context=sceneContext();
  for(const id of ['S03','S04','A01','A06','H01']) {
    assert.ok(context.garments.some(g=>g.id===id));
    assert.ok(PACK_PENDING_PLACEMENTS.some(p=>p.garmentId===id));
    assert.equal(PACK_DEMO_PLACEMENTS.byGarmentId[id],undefined);
    assert.equal(resolveGarmentLocation({...context,garmentId:id}).status,'unknown');
    const scene=selectMirrorScene({...context,inspectedGarmentId:id,outfit:null,locationGuide:{kind:'garment',garmentId:id}});
    assert.equal(scene.guidedCompartmentIds.length,0);
    assert.ok(scene.compartments.every(c=>!c.ledOn));
  }
});

test('confirmed user and preexisting demo locations take precedence over screen-only pack placement',()=>{
  const context=sceneContext(),item=context.garments.find(g=>g.id==='T04')!;
  item.location='선반 C';item.provenance.location='user';
  assert.equal(resolveGarmentLocation({...context,garmentId:'T04'}).compartmentId,'right-shelf-c');
  assert.doesNotMatch(resolveGarmentLocation({...context,garmentId:'T04'}).message,/시연 배치/);
  item.location='사용자가 확인한 별도 보관함';
  const unmapped=resolveGarmentLocation({...context,garmentId:'T04'});
  assert.equal(unmapped.status,'unmapped');assert.equal(unmapped.compartmentId,null);
  assert.equal(unmapped.locationRef,'사용자가 확인한 별도 보관함');
  item.location='행거 D';item.provenance.location='demo';
  assert.equal(resolveGarmentLocation({...context,garmentId:'T04'}).compartmentId,'left-hanger-d');
  const seed=createSeed();
  assert.equal(resolveGarmentLocation({...context,ownerId:DEMO_PROFILE,garments:seed.garments,garmentId:'g-trench'}).compartmentId,'left-hanger-b');
  assert.equal(seed.garments.find(g=>g.id==='g-trench')?.location,'행거 B · 오른쪽 1번째');
});

test('final outfit LEDs include every mapped slot and disclose shoes without changing stored records',()=>{
  const context=sceneContext(),before=structuredClone(context.garments);
  const outfit={ownerId:PACK_PROFILE_ID,draftId:'display-test',revision:1,name:'시연',topLocked:false,
    items:{top:'T04',bottom:'B01',outer:'O01',shoes:'S04'}};
  const scene=selectMirrorScene({...context,outfit,inspectedGarmentId:null,locationGuide:{kind:'outfit'}});
  assert.deepEqual(new Set(scene.guidedCompartmentIds),new Set(['left-hanger-a','left-hanger-d','left-hanger-b']));
  assert.equal(scene.locationGuides.find(g=>g.garmentId==='S04')?.status,'unknown');
  const swapped=selectMirrorScene({...context,outfit:{...outfit,items:{...outfit.items,top:'T05'}},
    inspectedGarmentId:null,locationGuide:{kind:'outfit'}});
  assert.deepEqual(new Set(swapped.guidedCompartmentIds),new Set(['right-shelf-c','left-hanger-d','left-hanger-b']));
  assert.deepEqual(context.garments,before);
  assert.ok(context.garments.every(g=>g.location===''&&g.provenance.location==='unconfirmed'));
  assert.ok(PACK_METADATA.garments.every(g=>g.owner_id===null&&g.location_json===null));
});

test('all ten source metadata JSON files remain byte-identical to the handoff before new layout work',async()=>{
  const expected:Record<string,string>={
    'assets.json':'291c75ecd9effd8d18aae850aa45e0af3205640b058ceac007b3f3844e455401',
    'catalog.json':'7856ad043ddf01247ac73f1e26a6b48adbb3ffa88daebf2cc96df915df395691',
    'demo_scenarios.json':'3b9f3e3f88f81fb633fbd9d2a9308e145f7cfe40f6db3183a9952ec9911bc6ef',
    'garments.json':'70a3c3a42a1c207029663880e776b81d24864813e3a1ca18f5202b85992a2c88',
    'manifest.json':'6f6d9119d86b8982f67616c0804926d2cbcb918f77ee31692f5ef9044a351eac',
    'outfit_items.json':'a2cee5d8746f046b3d0e02d411893732313227417e223c1689987e689377218a',
    'outfits.json':'528521e333d943781081d623049762ccc0944565b9b4a435a3623e9e117926e1',
    'person_references.json':'c57c218a2e259dcf606cca171a1210b7f743d38615cd9c682b63dcecc6f4d5f4',
    'registration_examples.json':'fcd70bf8bf4d820b8dc976cc53410075adabaaa12ff0744f010e20b7b9aae1e6',
    'saved_results.json':'094eeb5387c218d4db255adad090779d0e90805dccbd64761c1a9f6ac4c4c85e',
  };
  for(const [filename,hash] of Object.entries(expected)) {
    const bytes=await readFile(new URL('../src/data/wardrobe-pack/'+filename,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,filename);
  }
});

