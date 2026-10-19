import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEntries,mirrorCalendarCells,mirrorHomeWeather,permittedMirrorProfiles} from '../src/mirrorPanelData';
import {createSeed,emptyUI} from '../src/core/seed';
import {DemoApp} from '../src/core/app';
import type {DemoState} from '../src/core/types';

function fixture():DemoState{const state=createSeed();state.profiles.push({id:'second',name:'다른 테스트 프로필'});state.ui.second=emptyUI();return state;}
test('mirror month has seven columns, correct weekday blanks and up to six weeks',()=>{
 const leap=mirrorCalendarCells('2028-02-12');assert.equal(leap.length,35);assert.equal(leap.filter(Boolean).length,29);assert.equal(leap[2],'2028-02-01');assert.equal(leap.at(-5),'2028-02-29');
 const six=mirrorCalendarCells('2026-08-01');assert.equal(six.length,42);assert.equal(six[6],'2026-08-01');assert.equal(six[36],'2026-08-31');
 const short=mirrorCalendarCells('2026-02-01');assert.equal(short.length,28);assert.equal(short[0],'2026-02-01');assert.equal(short.at(-1),'2026-02-28');
});
test('date entries are scoped by owner and record date, keeping multiple record meanings',()=>{
 const state=fixture(),owner=state.activeProfileId;state.events=[{id:'plan',ownerId:owner,kind:'plan',outfitId:'outfit-prepared',date:'2026-12-31',value:'계획'},{id:'wear',ownerId:owner,kind:'wear',outfitId:'outfit-prepared',date:'2026-12-31',value:'착용'},{id:'care',ownerId:owner,kind:'care',garmentId:'g-knit',date:'2026-12-31',value:'세탁'},{id:'other',ownerId:'second',kind:'plan',outfitId:'outfit-prepared',date:'2026-12-31',value:'다른 사용자'}];
 const entries=calendarEntries(owner,'2026-12-31',state.events,state.outfits);assert.deepEqual(entries.map(entry=>entry.event.id),['plan','wear','care']);assert.equal(entries[2].outfit,undefined);assert.equal(calendarEntries(owner,'2027-01-01',state.events,state.outfits).length,0);
});
test('remote profile selector never grants a second owner from a frontend list',()=>{
 const state=fixture();assert.equal(permittedMirrorProfiles(state,'local').length,2);assert.deepEqual(permittedMirrorProfiles(state,'supabase').map(profile=>profile.id),[state.activeProfileId]);
});
test('weather facts require matching profile, application date and source',()=>{
 const fact={profileId:'one',date:'2026-10-09',summary:'흐림',source:'기존 사용자 입력'};assert.deepEqual(mirrorHomeWeather(fact,'one','2026-10-09'),fact);assert.equal(mirrorHomeWeather(fact,'two','2026-10-09'),null);assert.equal(mirrorHomeWeather(fact,'one','2026-10-10'),null);assert.equal(mirrorHomeWeather({...fact,source:''},'one','2026-10-09'),null);assert.equal(mirrorHomeWeather(undefined,'one','2026-10-09'),null);
});
test('calendar reuse preserves immutable source and creates no plan, wear or receipt',()=>{
 const app=new DemoApp(undefined,fixture),before=structuredClone(app.getState()),source=app.outfits()[0];app.setCalendarDate('2026-12-31');app.loadOutfitDraft(source.id);
 assert.deepEqual(app.outfits(),before.outfits);assert.deepEqual(app.events(),[]);assert.deepEqual(app.receipts(),[]);assert.equal(app.outfitDraft()?.sourceOutfitId,source.id);
});
test('profile round trip preserves each owner draft, filters and selected calendar date',()=>{
 const app=new DemoApp(undefined,fixture),owner=app.getState().activeProfileId;app.editOutfitName('원 사용자 변경');app.setCalendarDate('2027-01-04');app.setSearchFilters({query:'그레이',category:'top'});const original=structuredClone(app.outfitDraft());app.setActiveProfile('second');app.editOutfitName('다른 사용자 초안');app.setCalendarDate('2028-02-29');app.setActiveProfile(owner);
 assert.deepEqual(app.outfitDraft(),original);assert.equal(app.ui().query,'그레이');assert.equal(app.ui().calendarDate,'2027-01-04');assert.equal(app.getState().outfitDrafts.second.name,'다른 사용자 초안');assert.equal(app.getState().ui.second.calendarDate,'2028-02-29');
});
