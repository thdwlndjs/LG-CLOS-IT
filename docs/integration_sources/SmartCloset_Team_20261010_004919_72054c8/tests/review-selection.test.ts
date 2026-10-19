import test from 'node:test';
import assert from 'node:assert/strict';
import {createWardrobePackBundle,PACK_METADATA,PACK_READ_ONLY_ITEMS} from '../src/wardrobePack';
import {selectReviewGarments,REVIEW_GARMENT_IDS,STRUCTURE_GARMENT_IDS,selectStructureGarments,
  REVIEW_SELECTION_REASON,STRUCTURE_SELECTION_REASON} from '../src/demoReviewSelection';
import {PACK_DEMO_PLACEMENTS} from '../src/packScenePlacements';
import {getLayoutCompartment,MIRROR_COMPARTMENTS} from '../src/layoutConfig';

test('representative paths keep all preset inputs and one long coat without reducing the complete source inventory',()=>{
  const bundle=createWardrobePackBundle(),before=structuredClone(bundle.garments);
  const selected=selectReviewGarments(bundle.garments,{items:{}},null);
  assert.equal(selected.length,9);
  assert.deepEqual(new Set(selected.map(g=>g.id)),new Set(REVIEW_GARMENT_IDS));
  for(const look of bundle.outfits)for(const id of Object.values(look.items))assert.ok(selected.some(g=>g.id===id));
  assert.equal(selected.find(g=>g.id==='O01')?.category,'outer');
  assert.match(REVIEW_SELECTION_REASON,/긴 옷 봉/);
  assert.deepEqual(bundle.garments,before);
  assert.equal(bundle.garments.length,47);assert.equal(PACK_READ_ONLY_ITEMS.length,1);
});

test('current draft, inspected item and user additions remain available outside the representative nine',()=>{
  const bundle=createWardrobePackBundle(),extras=bundle.garments.filter(g=>!REVIEW_GARMENT_IDS.includes(g.id));
  const custom={...bundle.garments[0],id:'user-upload'};
  const shown=selectReviewGarments([...bundle.garments,custom],{items:{top:extras[0].id}},extras[1].id);
  for(const id of [extras[0].id,extras[1].id,custom.id])assert.ok(shown.some(g=>g.id===id));
  assert.equal(shown.length,12);
});

test('the independent structure subset covers long, upper and lower rails and eleven assumed folded shelves',()=>{
  const bundle=createWardrobePackBundle(),before=structuredClone(bundle.garments);
  const selected=selectStructureGarments(bundle.garments,{items:{}},null);
  assert.equal(selected.length,19);
  assert.equal(new Set(STRUCTURE_GARMENT_IDS).size,19);
  const cells=selected.map(g=>getLayoutCompartment(PACK_DEMO_PLACEMENTS.compartmentByGarmentId[g.id])!);
  assert.ok(cells.every(Boolean));
  assert.equal(cells.filter(c=>c.type==='long-hanger').length,2);
  assert.equal(cells.filter(c=>c.type==='upper-hanger').length,3);
  assert.equal(cells.filter(c=>c.type==='lower-hanger').length,3);
  const folded=cells.filter(c=>c.type==='shelf');
  assert.equal(folded.length,11);assert.equal(new Set(folded.map(c=>c.id)).size,11);
  for(const shelf of MIRROR_COMPARTMENTS.filter(c=>c.side==='right'&&c.type==='shelf'))assert.ok(folded.some(c=>c.id===shelf.id));
  assert.match(STRUCTURE_SELECTION_REASON,/화면 전용 선별/);
  assert.equal(PACK_METADATA.catalog.find(g=>g.garment_id==='O05')?.subcategory,'cardigan');
  assert.deepEqual(bundle.garments,before);
});

test('full inventory and source owners, IDs and unknown locations are unchanged after repeated views',()=>{
  const bundle=createWardrobePackBundle(),before=JSON.stringify(PACK_METADATA),sourceIds=bundle.garments.map(g=>g.id);
  for(let i=0;i<4;i++) {
    selectReviewGarments(bundle.garments,bundle.outfitDraft,'O08');
    const shown=selectStructureGarments(bundle.garments,{items:{outer:'O08',shoes:'S04'}},'S03');
    for(const id of ['O08','S03','S04'])assert.ok(shown.some(g=>g.id===id));
  }
  assert.deepEqual(bundle.garments.map(g=>g.id),sourceIds);
  assert.equal(bundle.garments.length,47);
  assert.ok(bundle.garments.every(g=>g.location===''&&g.provenance.location==='unconfirmed'));
  assert.ok(PACK_METADATA.garments.every(g=>g.owner_id===null&&g.location_json===null));
  assert.equal(JSON.stringify(PACK_METADATA),before);
});

