import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEntries,calendarEventGarments} from '../src/mirrorPanelData';
import {createSeed} from '../src/core/seed';
import {buildLocalLifePack,LOCAL_LIFE_PROFILE_IDS} from '../src/lifeData/localPack';
import type {DemoEvent} from '../src/core/types';
const state=createSeed(),owner=state.activeProfileId;
const event:DemoEvent={id:'care-event',ownerId:owner,kind:'care',garmentId:'g-knit',date:'2026-10-04',value:'세탁 완료'};

test('calendar garment links retain legacy singular care and movement without producing an outfit',()=>{
 const before=structuredClone(event);assert.deepEqual(calendarEventGarments(owner,event,state.garments).map(g=>g.id),['g-knit']);assert.deepEqual(calendarEventGarments(owner,{...event,kind:'movement'},state.garments).map(g=>g.id),['g-knit']);assert.deepEqual(event,before);assert.equal(calendarEntries(owner,event.date,[event],state.outfits)[0].outfit,undefined);
});
test('calendar multi-garment care preserves reference order and counts each linked garment once',()=>{
 const multi={...event,garmentId:undefined,garmentIds:['g-slacks','g-knit','g-slacks']};const before=structuredClone(multi);assert.deepEqual(calendarEventGarments(owner,multi,state.garments).map(g=>g.id),['g-slacks','g-knit']);assert.deepEqual(multi,before);
});
test('calendar links reject foreign owners, missing identities and conflicting explicit links',()=>{
 const foreign={...state.garments[0],id:'foreign',ownerId:'another-owner'},inventory=[...state.garments,foreign];
 assert.deepEqual(calendarEventGarments('another-owner',event,inventory),[]);
 for(const ids of [['g-knit','foreign'],['g-knit','missing'],[]])assert.deepEqual(calendarEventGarments(owner,{...event,garmentIds:ids},inventory),[]);
 assert.deepEqual(calendarEventGarments(owner,{...event,garmentIds:['g-slacks']},inventory),[]);
 assert.deepEqual(calendarEventGarments(owner,event,[...inventory,{...state.garments.find(g=>g.id==='g-knit')!}]),[]);
 assert.deepEqual(calendarEventGarments(owner,{...event,kind:'plan'},inventory),[]);
});
test('October 4 Sujin wash and dry events expose their exact original garment list',()=>{
 const{state}=buildLocalLifePack(),owner=LOCAL_LIFE_PROFILE_IDS.PSU,entries=calendarEntries(owner,'2026-10-04',state.events,state.outfits).filter(entry=>entry.event.kind==='care');assert(entries.length>0);
 const before=structuredClone(state);
 for(const{event,outfit}of entries){assert.equal(outfit,undefined);const linked=calendarEventGarments(owner,event,state.garments);assert(linked.length>1);assert.deepEqual(linked.map(g=>g.id),event.garmentIds);assert(linked.every(g=>g.ownerId===owner));}
 assert.deepEqual(state,before);
});
