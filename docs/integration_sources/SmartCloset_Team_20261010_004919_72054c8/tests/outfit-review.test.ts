import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed} from '../src/core/seed';
import type {Garment} from '../src/core/types';
import {confirmReviewAvailability,createOutfitReviewState,reconcileOutfitReviewState,replacementDecision,reviewAvailability,reviewCurrentOutfit,reviewReplacementCandidates,type OutfitReviewInput,type ReviewAvailability} from '../src/outfitReview';

function setup():OutfitReviewInput{const state=createSeed();return{ownerId:state.activeProfileId,garments:state.garments,draft:state.outfitDrafts[state.activeProfileId],review:createOutfitReviewState(state.activeProfileId)};}
function confirm(input:OutfitReviewInput,id:string,status:ReviewAvailability){input.review=confirmReviewAvailability(input.review,input.ownerId,input.garments,id,status);}
const item=(input:OutfitReviewInput,id:string)=>input.garments.find(garment=>garment.id===id)!;

test('a new review leaves all availability unknown and never infers it from garment text',()=>{
  const input=setup();item(input,'g-jeans').careNotes='세탁 완료, 사용 가능';
  assert.ok(reviewCurrentOutfit(input).items.every(row=>row.status==='unknown'));
  const candidates=reviewReplacementCandidates(input,'bottom');assert.equal(candidates.length,1);
  assert.equal(candidates[0].status,'unknown');assert.equal(candidates[0].canReplace,false);
});

test('only an explicitly available owned item in the requested slot is proposed',()=>{
  const input=setup();confirm(input,'g-jeans','available');confirm(input,'g-jacket','available');
  const candidates=reviewReplacementCandidates(input,'bottom');
  assert.deepEqual(candidates.map(candidate=>candidate.garment.id),['g-jeans']);assert.equal(candidates[0].canReplace,true);
  assert.ok(candidates[0].reasons.some(reason=>reason.includes('하의')));assert.ok(candidates[0].reasons.some(reason=>reason.includes('블루')));
  assert.equal(replacementDecision(input,'top','g-jeans').allowed,false);
});

test('laundry and repair remain blocked until the user explicitly changes that confirmation',()=>{
  const input=setup();confirm(input,'g-slacks','laundry');confirm(input,'g-trench','repair');confirm(input,'g-jeans','laundry');
  const current=reviewCurrentOutfit(input).items;
  assert.equal(current.find(row=>row.slot==='bottom')?.status,'laundry');assert.ok(current.find(row=>row.slot==='bottom')!.issues.length);
  assert.equal(current.find(row=>row.slot==='outer')?.status,'repair');assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
  confirm(input,'g-jeans','available');assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,true);
  confirm(input,'g-jeans','unknown');assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);assert.equal(input.review.confirmations['g-jeans'],undefined);
});

test('revision, photo replacement, photo version and removed photo immediately invalidate old confirmation',()=>{
  const changes:((garment:Garment)=>void)[]=[garment=>{garment.revision++;},garment=>{garment.asset!.id='new-photo';},garment=>{garment.asset!.version++;},garment=>{garment.asset=null;},garment=>{garment.asset!.needsReselection=true;}];
  for(const change of changes){const input=setup();confirm(input,'g-jeans','available');change(item(input,'g-jeans'));
    assert.equal(reviewAvailability(input.review,input.ownerId,item(input,'g-jeans')),'unknown');
    assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
    input.review=reconcileOutfitReviewState(input.review,input.ownerId,input.garments);assert.equal(input.review.confirmations['g-jeans'],undefined);
  }
});

test('reconciliation removes old identities permanently even if a former version reappears',()=>{
  const input=setup(),original=structuredClone(item(input,'g-jeans'));confirm(input,'g-jeans','available');
  item(input,'g-jeans').asset!.version++;input.review=reconcileOutfitReviewState(input.review,input.ownerId,input.garments);
  input.garments=input.garments.map(garment=>garment.id===original.id?original:garment);
  assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
  confirm(input,'g-jeans','available');input.garments=input.garments.filter(garment=>garment.id!==original.id);
  input.review=reconcileOutfitReviewState(input.review,input.ownerId,input.garments);input.garments.push(original);
  assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
});

test('account change clears the review and cannot restore an earlier account confirmation',()=>{
  const input=setup();confirm(input,'g-jeans','available');const oldOwner=input.ownerId;
  input.ownerId='another-owner';input.draft={...input.draft,ownerId:input.ownerId};input.garments=input.garments.map(garment=>({...garment,ownerId:input.ownerId}));
  assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
  input.review=reconcileOutfitReviewState(input.review,input.ownerId,input.garments);assert.deepEqual(input.review.confirmations,{});
  input.review=reconcileOutfitReviewState(input.review,oldOwner,setup().garments);assert.deepEqual(input.review.confirmations,{});
});

test('foreign ownership, absent items, duplicate IDs and invalid asset versions fail closed',()=>{
  const foreign=setup();item(foreign,'g-jeans').ownerId='other-owner';confirm(foreign,'g-jeans','available');assert.deepEqual(reviewReplacementCandidates(foreign,'bottom'),[]);
  const missing=setup();missing.draft.items.bottom='no-such-id';assert.equal(reviewCurrentOutfit(missing).items.find(row=>row.slot==='bottom')?.garment,null);
  const duplicate=setup();confirm(duplicate,'g-jeans','available');duplicate.garments.push(structuredClone(item(duplicate,'g-jeans')));assert.deepEqual(reviewReplacementCandidates(duplicate,'bottom'),[]);assert.equal(replacementDecision(duplicate,'bottom','g-jeans').allowed,false);
  const invalid=setup();item(invalid,'g-jeans').asset!.version=0;confirm(invalid,'g-jeans','available');assert.deepEqual(reviewReplacementCandidates(invalid,'bottom'),[]);
  const wrongDraft=setup();wrongDraft.draft.ownerId='other-owner';assert.deepEqual(reviewCurrentOutfit(wrongDraft).items,[]);assert.ok(reviewCurrentOutfit(wrongDraft).issues.length);assert.deepEqual(reviewReplacementCandidates(wrongDraft,'bottom'),[]);
});

test('an item in the wrong or repeated slot cannot acquire a valid current confirmation',()=>{
  const input=setup();confirm(input,'g-knit','available');input.draft.items.bottom='g-knit';
  const current=reviewCurrentOutfit(input).items;assert.equal(current.find(row=>row.slot==='top')?.garment,null);assert.equal(current.find(row=>row.slot==='bottom')?.garment,null);
  assert.ok(current.find(row=>row.slot==='bottom')!.issues.length);assert.equal(replacementDecision(input,'bottom','g-knit').allowed,false);
  input.draft.items.outer='g-jeans';confirm(input,'g-jeans','available');assert.equal(reviewReplacementCandidates(input,'bottom').some(candidate=>candidate.garment.id==='g-jeans'),false);assert.equal(replacementDecision(input,'bottom','g-jeans').allowed,false);
});

test('top lock blocks even an available top and unlock does not alter availability',()=>{
  const input=setup(),alternate={...structuredClone(item(input,'g-knit')),id:'alternate-top'};input.garments.push(alternate);confirm(input,alternate.id,'available');
  input.draft.topLocked=true;assert.equal(replacementDecision(input,'top',alternate.id).allowed,false);assert.equal(reviewReplacementCandidates(input,'top')[0].canReplace,false);
  input.draft.topLocked=false;assert.equal(replacementDecision(input,'top',alternate.id).allowed,true);
});

test('missing required slots are reported and manual garments need no invented photo version',()=>{
  const input=setup();delete input.draft.items.top;delete input.draft.items.bottom;item(input,'g-jeans').asset=null;
  const current=reviewCurrentOutfit(input).items;assert.equal(current.find(row=>row.slot==='top')?.garmentId,null);assert.equal(current.find(row=>row.slot==='bottom')?.garmentId,null);
  confirm(input,'g-jeans','available');const candidate=reviewReplacementCandidates(input,'bottom').find(row=>row.garment.id==='g-jeans')!;
  assert.equal(candidate.canReplace,true);assert.equal(candidate.garment.asset,null);
});

test('reviewing and changing confirmations never mutates garment, draft or prior review data',()=>{
  const input=setup(),before=structuredClone(input);const next=confirmReviewAvailability(input.review,input.ownerId,input.garments,'g-jeans','available');
  assert.notEqual(next,input.review);assert.deepEqual(input,before);
  const confirmed={...input,review:next},snapshot=structuredClone(confirmed);reviewCurrentOutfit(confirmed);reviewReplacementCandidates(confirmed,'bottom');replacementDecision(confirmed,'bottom','g-jeans');
  assert.deepEqual(confirmed,snapshot);assert.equal(reconcileOutfitReviewState(next,input.ownerId,input.garments),next);
});