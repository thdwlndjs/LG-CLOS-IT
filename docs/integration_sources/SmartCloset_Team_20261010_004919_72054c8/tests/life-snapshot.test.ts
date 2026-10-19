import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLifeSnapshot,parseLifeProfileData,lifeHistoryReadOptions,type LifeProfileData} from '../src/lifeSnapshot';
import {emptyRemoteState} from '../server/domain';
import {AiService,digest,type AiRequest} from '../server/ai';
import {AppError} from '../server/errors';
import {readConfig} from '../server/config';
import type {DatabaseRepository} from '../server/repository';
import {parseProposal,type AgentInput} from '../server/providers/agents';
import {reviewGarmentIdentity} from '../src/outfitReview';
import type {DemoState,Garment} from '../src/core/types';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',TOP='33333333-3333-4333-8333-333333333333',BOTTOM='44444444-4444-4444-8444-444444444444',EVIDENCE='55555555-5555-4555-8555-555555555555';
function garment(id:string,category:Garment['category']='top',ownerId=OWNER):Garment{return {id,ownerId,name:category,category,color:'navy',features:[],material:'',size:'',location:'',careNotes:'',provenance:{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'},revision:1,asset:null};}
function profile():LifeProfileData{return {ownerId:OWNER,namespace:'fixture-only',provenance:'scenario_fixture',revision:1,activeContextId:'rain',preferences:[{id:'preference-rain',ownerId:OWNER,kind:'explicit_preference',key:'bottom_colour',value:['navy','black'],context:'rain_forecast',sourceRef:'PREF-HW-RAIN',provenance:'scenario_fixture'}],contexts:[{id:'rain',ownerId:OWNER,asOf:'2026-10-09T07:40:00+09:00',timeZone:'Asia/Seoul',purpose:'출근',sourceRef:'CTX-HW-RAIN',provenance:'scenario_fixture',weather:{status:'available',kind:'forecast',provenance:'scenario_fixture',sourceRef:'CTX-HW-RAIN:weather',issuedAt:'2026-10-09T06:00:00+09:00',validFrom:'2026-10-09T07:00:00+09:00',validTo:'2026-10-09T10:00:00+09:00',precipitation:'rain',temperatureC:18}}]};}
function state():DemoState{const s=emptyRemoteState(OWNER,'Fixture owner');s.garments=[garment(TOP),garment(BOTTOM,'bottom')];s.lifeData={[OWNER]:profile()};s.careEvidence=[{id:EVIDENCE,ownerId:OWNER,garmentId:TOP,kind:'official_guidance',originalText:'Machine wash cool. Bleaching not specified.',sourceRef:'P01:official-product-guide',observedAt:'2026-10-08T10:00:00+09:00',asset:null}];return s;}
function scope(s:DemoState):AgentInput{return {task:'outfit',context:{life_snapshot_revision:digest(buildLifeSnapshot(s,OWNER).revisionKey)},allowedGarmentIds:[TOP,BOTTOM],allowedEvidenceIds:[EVIDENCE,'available-top','available-bottom'],garmentScope:[{garmentId:TOP,category:'top',availability:'available',availabilitySource:'user_confirmation',availabilityEvidenceId:'available-top'},{garmentId:BOTTOM,category:'bottom',availability:'available',availabilitySource:'user_confirmation',availabilityEvidenceId:'available-bottom'}]};}
const proposal={kind:'proposal',items:[{slot:'top',garment_id:TOP},{slot:'bottom',garment_id:BOTTOM}],explanation:'Fixture proposal only',evidence_ids:[],unknown_fields:[]};

test('life snapshot excludes another owner and has stable content across UI changes',()=>{
 const s=state(),initial=buildLifeSnapshot(s,OWNER);s.profiles.push({id:OTHER,name:'Private other'});s.garments.push(garment('66666666-6666-4666-8666-666666666666','top',OTHER));s.lifeData![OTHER]={...profile(),ownerId:OTHER};s.ui[OWNER].screen='calendar';
 const actual=buildLifeSnapshot(s,OWNER);assert.equal(actual.revisionKey,initial.revisionKey);assert.equal(JSON.stringify(actual).includes(OTHER),false);assert.equal(JSON.stringify(actual).includes('Private other'),false);
 assert.match(actual.weather!.summary,/예보/);assert.equal(actual.weather!.sourceLabel,'시연 날씨');assert.equal(actual.context!.ownerId,OWNER);assert.equal(actual.garments[0].history.cleanlinessConfirmed,false);
});

test('profile settings fail closed on unmapped refs, cross-owner records, duplicate IDs and invalid weather',()=>{
 assert.equal(parseLifeProfileData({profile_ref:'PHW',preferences:[],contexts:[]},OWNER),null);
 for(const change of [(p:LifeProfileData)=>p.ownerId=OTHER,(p:LifeProfileData)=>p.preferences[0].ownerId=OTHER,(p:LifeProfileData)=>p.contexts.push({...p.contexts[0]}),(p:LifeProfileData)=>p.contexts[0].weather.sourceRef=undefined,(p:LifeProfileData)=>p.contexts[0].weather.validTo='yesterday']){const p=profile();change(p);assert.equal(parseLifeProfileData(p,OWNER),null);}
 assert.equal(parseLifeProfileData(profile(),OWNER)?.contexts.length,1);
});

test('missing weather and wrong scenario date never turn requested conditions into observed weather',()=>{
 const s=state();s.lifeData![OWNER].contexts[0].weather={status:'unavailable',provenance:'unavailable'};
 const missing=buildLifeSnapshot(s,OWNER,{conditions:{weather:'rain',temperatureC:18,occasion:'work'}});assert.equal(missing.weather,null);assert.equal(missing.conditions!.provenance,'user_requested');assert.equal(missing.conditions!.weather,'rain');
 const dated=buildLifeSnapshot(state(),OWNER,{date:'2026-10-10'});assert.equal(dated.context,null);assert.equal(dated.weather,null);
 const noSelection=state();delete noSelection.lifeData![OWNER].activeContextId;assert.equal(buildLifeSnapshot(noSelection,OWNER).context,null);
});

test('weather, preference deletion, source changes, event correction and garment versions invalidate revision',()=>{
 const original=state(),initial=buildLifeSnapshot(original,OWNER).revisionKey;
 for(const change of [(s:DemoState)=>s.lifeData![OWNER].contexts[0].weather.precipitation='none',(s:DemoState)=>s.lifeData![OWNER].preferences.splice(0),(s:DemoState)=>s.careEvidence![0].originalText='Hand wash only',(s:DemoState)=>s.careEvidence!.splice(0),(s:DemoState)=>s.garments[0].revision++,(s:DemoState)=>s.events.push({id:'event-fixture',ownerId:OWNER,kind:'care',garmentId:TOP,date:'2026-10-08',value:'세탁 완료',revision:2,voided:true})]){const changed=structuredClone(original);change(changed);assert.notEqual(buildLifeSnapshot(changed,OWNER).revisionKey,initial);}
});

test('only the explicit fixture context freezes history; non-fixture readers use current time',()=>{
 const s=state();assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,profile().contexts[0].asOf);
 delete s.lifeData;const before=Date.now(),options=lifeHistoryReadOptions(s,OWNER);assert.ok(Date.parse(options.asOf)>=before);assert.equal(options.timeZone,'Asia/Seoul');
});

test('provider parser preserves slot patches, rejects missing permanent locks and schema additions',()=>{
 const s=scope(state());s.context.locked_slots={bottom:true};s.context.selected_items={top:TOP,bottom:BOTTOM};
 assert.throws(()=>parseProposal({...proposal,items:proposal.items.slice(0,1)},s));assert.equal(parseProposal(proposal,s).kind,'proposal');
 s.context.editable_slot='top';s.context.preserved_items={bottom:BOTTOM};assert.deepEqual(parseProposal({...proposal,items:proposal.items.slice(0,1)},s).items,proposal.items);
 assert.throws(()=>parseProposal({...proposal,unsupported_claim:'waterproof'},s));assert.throws(()=>parseProposal({...proposal,items:[{...proposal.items[0],source:'invented'},proposal.items[1]]},s));
});

test('server read tools withhold unreviewed official instructions and reject changed context before another read',async()=>{
 const s=state(),scoped=scope(s);let providerCalls=0;
 const repo={user:{id:OWNER},state:async()=>structuredClone(s),garment:async(id:string)=>({id,owner_id:OWNER})} as unknown as DatabaseRepository;
 const service=new AiService(readConfig({}),repo,async()=>{providerCalls++;throw Error('No provider calls permitted');});
 const tools=await service.readTools({action:'requestCareGuide',intentKey:'fixture',garmentId:TOP},scoped);
 const evidence=await tools.get_care_evidence({garment_id:TOP}) as any;
 assert.deepEqual(evidence,{status:'unavailable'});assert.equal(s.careEvidence![0].originalText,'Machine wash cool. Bleaching not specified.');assert.equal(s.careEvidence![0].sourceRef,'P01:official-product-guide');
 const outing=await tools.get_outing_context({}) as any;assert.equal(outing.profile_id,OWNER);assert.equal(outing.weather.kind,'forecast');assert.equal(outing.weather.provenance,'scenario_fixture');
 s.lifeData![OWNER].preferences=[];await assert.rejects(tools.get_wardrobe_items({}),e=>e instanceof AppError&&e.code==='stale_revision');assert.equal(providerCalls,0);
});

test('stored provider results become non-applicable when life context changes without a draft edit',async()=>{
 const s=state(),request:AiRequest={action:'generateOutfits',intentKey:'fixture',availabilityConfirmations:s.garments.map(g=>({garmentId:g.id,identity:reviewGarmentIdentity(g),status:'available'}))};
 const job={id:'77777777-7777-4777-8777-777777777777',owner_id:OWNER,adapter:'generateOutfits',status:'succeeded',mode:'live',input_snapshot_json:request,config_json:{agentScope:scope(s)},result_json:{value:proposal}};
 const repo={user:{id:OWNER},state:async()=>structuredClone(s),db:{one:async()=>({owner_id:OWNER}),rows:async()=>[job]}} as unknown as DatabaseRepository;
 s.lifeData![OWNER].contexts[0].weather.precipitation='none';
 const service=new AiService(readConfig({}),repo,async()=>{throw Error('No provider calls permitted');});const result=await service.operation('88888888-8888-4888-8888-888888888888') as any;
 assert.equal(result.result.kind,'needs_information');assert.deepEqual(result.result.items,[]);assert.deepEqual(result.result.unknown_fields,['life_snapshot_revision']);assert.equal(result.apply_status,'unavailable');assert.equal(job.result_json.value.explanation,'Fixture proposal only');
});


test('fixture read window advances only for this owners non-future confirmed actions without shifting fixture events',()=>{
 const s=state();s.lifeData![OWNER].contexts[0].asOf='2020-01-01T07:40:00+09:00';
 s.events=[{id:'actual',ownerId:OWNER,kind:'care',garmentId:TOP,date:'2020-01-02',occurredAt:'2020-01-02T12:00:00+09:00',inputSource:'user_confirmed',value:'세탁 완료'},
 {id:'future',ownerId:OWNER,kind:'wear',garmentId:TOP,date:'2099-01-01',occurredAt:'2099-01-01T12:00:00+09:00',inputSource:'user_confirmed',value:'실제 착용 확인'},
 {id:'authored',ownerId:OWNER,kind:'wear',garmentId:TOP,date:'2020-01-03',occurredAt:'2020-01-03T12:00:00+09:00',inputSource:'demo',value:'시연 착용'},
 {id:'foreign',ownerId:OTHER,kind:'wear',garmentId:TOP,date:'2020-01-04',occurredAt:'2020-01-04T12:00:00+09:00',inputSource:'user_confirmed',value:'타인 착용'}];
 assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,'2020-01-02T03:00:00.000Z');const summary=buildLifeSnapshot(s,OWNER).garments.find(g=>g.id===TOP)!.history;
 assert.equal(summary.lastWashDate,'2020-01-02');assert.equal(summary.wearCount,0);assert.deepEqual(buildLifeSnapshot(s,OWNER).events.map(e=>e.id),['actual']);assert.equal(s.events[2].occurredAt,'2020-01-03T12:00:00+09:00');
});


test('corrupt local evidence is omitted and later voided confirmations cannot advance the fixture window',()=>{
 const s=state();s.careEvidence!.push(null as any,{...s.careEvidence![0],id:'broken',originalText:42} as any);assert.equal(buildLifeSnapshot(s,OWNER).evidence.length,1);
 s.lifeData![OWNER].contexts[0].asOf='2020-01-01T07:40:00+09:00';const base={ownerId:OWNER,kind:'care' as const,garmentId:TOP,date:'2020-01-02',occurredAt:'2020-01-02T12:00:00+09:00',inputSource:'user_confirmed',value:'세탁 완료',sourceEventKey:'same'};
 s.events=[{...base,id:'earlier',revision:1},{...base,id:'correction',revision:2,voided:true}];assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,'2020-01-01T07:40:00+09:00');
});


test('today selection advances only by its recorded timestamp, never by a future scheduled date',()=>{
 const s=state();s.lifeData![OWNER].contexts[0].asOf='2020-01-01T07:40:00+09:00';s.events=[{id:'plan',ownerId:OWNER,kind:'plan',garmentId:TOP,date:'2020-02-01',occurredAt:'2020-01-02T12:00:00+09:00',scheduledAt:'2020-02-01T09:00:00+09:00',inputSource:'user_confirmed',value:'코디 계획'}];
 assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,'2020-01-02T03:00:00.000Z');assert.deepEqual(buildLifeSnapshot(s,OWNER).events.map(e=>e.id),['plan']);
});

test('laundry review and missing drying block provider selections even with current availability confirmation',async()=>{
 for(const lifeKind of ['wash_completed','user_observation']){
  const s=state();s.events=[{id:'care-block',ownerId:OWNER,kind:'care',garmentId:TOP,date:'2026-10-08',occurredAt:'2026-10-08T12:00:00+09:00',inputSource:'demo',lifeKind,value:'시연 관리',details:lifeKind==='user_observation'?{laundry_review_requested:true}:{}}];
  const repo={user:{id:OWNER},state:async()=>structuredClone(s),garment:async(id:string)=>({id,owner_id:OWNER})} as unknown as DatabaseRepository;
  const service=new AiService(readConfig({}),repo,async()=>{throw Error('No provider calls permitted');});
  const request:AiRequest={action:'generateOutfits',intentKey:'fixture',availabilityConfirmations:s.garments.map(g=>({garmentId:g.id,identity:reviewGarmentIdentity(g),status:'available'}))};
  const current=await (service as unknown as {agentScope(r:AiRequest):Promise<AgentInput>}).agentScope(request);
  assert.ok(current.garmentScope!.find(g=>g.garmentId===TOP)!.lifeBlock);const result=parseProposal(proposal,current);assert.equal(result.kind,'needs_information');assert.ok(result.unknown_fields.some(f=>f.startsWith('life_availability:'+TOP)));
  const handlers=await service.readTools(request,current),items=await handlers.get_wardrobe_items({}) as any[];assert.notEqual(items.find(g=>g.id===TOP).availability,'available');assert.equal(items.find(g=>g.id===TOP).availability_source,'life_history');
 }
});


test('legacy date precision is never treated as a real noon observation or plan recording timestamp',()=>{
 const s=state();s.lifeData![OWNER].contexts[0].asOf='2020-01-01T07:40:00+09:00';s.events=[{id:'legacy',ownerId:OWNER,kind:'care',garmentId:TOP,date:'2020-01-01',occurredAt:'2020-01-01T12:00:00+09:00',timePrecision:'date',inputSource:'user_confirmed',value:'세탁 완료'}];
 assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,'2020-01-01T07:40:00+09:00');assert.equal(buildLifeSnapshot(s,OWNER).garments.find(g=>g.id===TOP)!.history.lastWashAt,null);
 s.events[0].kind='plan';s.events[0].occurredAt='2099-01-01T12:00:00+09:00';s.events[0].date='2099-01-01';assert.equal(lifeHistoryReadOptions(s,OWNER).asOf,'2020-01-01T07:40:00+09:00');
 s.events[0].kind='care';s.events[0].occurredAt='2020-01-02T12:00:00+09:00';s.events[0].date='2020-01-02';const before=Date.now();assert.ok(Date.parse(lifeHistoryReadOptions(s,OWNER).asOf)>=before);
});
