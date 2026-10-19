import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityInput, verifiedAvailability } from '../server/availability';
import { AiService, type AiRequest } from '../server/ai';
import { AppError } from '../server/errors';
import { parseProposal, type AgentInput } from '../server/providers';
import type { DatabaseRepository } from '../server/repository';
import type { ServerConfig } from '../server/config';
import { createOutfitReviewState, confirmReviewAvailability, recommendationAvailability, reviewGarmentIdentity, type AvailabilityConfirmation } from '../src/outfitReview';
import { createSeed, DEMO_CONDITIONS } from '../src/core/seed';
import { DemoApp } from '../src/core/app';
import type { Garment, OutfitItems } from '../src/core/types';
import { HttpRemoteBackend, type RemoteBackend } from '../src/integrations/backendClient';

const OWNER='44444444-4444-4444-8444-444444444444',TOP='11111111-1111-4111-8111-111111111111',BOTTOM='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const config:ServerConfig={origin:'http://127.0.0.1:4311',port:4312,supabaseUrl:'https://fixture.invalid',publishableKey:'fixture',serverKey:'fixture',openaiKey:'fixture',decartKey:'',liveEnabled:true,aiMode:'live'};
function fixture(){
  const seed=createSeed(),garments:Garment[]=[{...seed.garments[2],ownerId:OWNER,id:TOP},{...seed.garments[3],ownerId:OWNER,id:BOTTOM},{...seed.garments[4],ownerId:'foreign',id:OTHER}];
  let writes=0,providerCalls=0,evidenceReads=0;
  const repo={user:{id:OWNER,token:'fixture'},state:async()=>({garments,events:[]}),putDraft:async()=>{writes++;},asset:async()=>({}),
    garment:async(id:string)=>{const garment=garments.find(g=>g.id===id)!;return{id,owner_id:garment.ownerId,name:garment.name,category:garment.category,attributes_json:{},location_json:{}};},
    db:{rows:async()=>{evidenceReads++;return[];}}} as unknown as DatabaseRepository;
  const service=new AiService(config,repo,async()=>{providerCalls++;throw Error('Provider calls forbidden');});
  const confirmations=garments.filter(g=>g.ownerId===OWNER).map(garment=>({garmentId:garment.id,identity:reviewGarmentIdentity(garment),status:'available' as const}));
  const request:AiRequest={action:'generateOutfits',intentKey:'fixture',availabilityConfirmations:confirmations};
  const scope=()=> (service as unknown as {agentScope(request:AiRequest):Promise<AgentInput>}).agentScope(request);
  return{garments,repo,service,confirmations,request,scope,counts:()=>({writes,providerCalls,evidenceReads})};
}
const proposal={kind:'proposal',items:[{slot:'top',garment_id:TOP},{slot:'bottom',garment_id:BOTTOM}],explanation:'Owned confirmed fixture',evidence_ids:[],unknown_fields:[]};

test('review extraction includes only explicit current owned confirmations and does not change inventory',()=>{
  const state=createSeed(),owner=state.activeProfileId,before=structuredClone(state);
  let review=createOutfitReviewState(owner);assert.deepEqual(recommendationAvailability(review,owner,state.garments),[]);
  review=confirmReviewAvailability(review,owner,state.garments,'g-knit','available');
  review=confirmReviewAvailability(review,owner,state.garments,'g-slacks','laundry');
  assert.deepEqual(recommendationAvailability(review,owner,state.garments).map(x=>[x.garmentId,x.status]),[['g-knit','available'],['g-slacks','laundry']]);
  assert.deepEqual(state,before);
  state.garments.find(g=>g.id==='g-knit')!.revision++;
  assert.deepEqual(recommendationAvailability(review,owner,state.garments).map(x=>x.garmentId),['g-slacks']);
  assert.deepEqual(recommendationAvailability(review,'other-owner',state.garments),[]);
});

test('availability wire parser rejects forged metadata, duplicate IDs, unknown status and oversized claims',()=>{
  const {confirmations}=fixture();assert.deepEqual(availabilityInput(confirmations),confirmations);
  for(const raw of [null,{},[confirmations[0],confirmations[0]],[{...confirmations[0],status:'unknown'}],[{...confirmations[0],evidenceId:'forged'}],[{...confirmations[0],garmentId:'not-uuid'}],Array(101).fill(confirmations[0])]){
    assert.throws(()=>availabilityInput(raw),(error:unknown)=>error instanceof AppError&&error.code==='invalid_input');
  }
});

test('server verifies exact garment revision, category and asset identity before authorizing availability evidence',()=>{
  for(const change of ['revision','category','asset-id','asset-version','asset-removed'] as const){
    const {garments,confirmations}=fixture();assert.equal(verifiedAvailability(OWNER,garments,confirmations).size,2);
    if(change==='revision')garments[0].revision++;
    if(change==='category')garments[0].category='outer';
    if(change==='asset-id')garments[0].asset!.id='changed';
    if(change==='asset-version')garments[0].asset!.version++;
    if(change==='asset-removed')garments[0].asset=null;
    const verified=verifiedAvailability(OWNER,garments,confirmations);assert.equal(verified.has(TOP),false);assert.equal(verified.has(BOTTOM),true);
  }
});

test('valid request confirmations reach both Agent scope and read tools without wardrobe writes or provider calls',async()=>{
  const f=fixture(),scope=await f.scope();assert.equal(parseProposal(proposal,scope).kind,'proposal');
  assert.ok(scope.garmentScope!.every(g=>g.availability==='available'&&g.availabilitySource==='user_confirmation'&&scope.allowedEvidenceIds.includes(g.availabilityEvidenceId!)));
  assert.equal(scope.allowedGarmentIds.includes(OTHER),false);
  const tools=await f.service.readTools(f.request,scope),items=await tools.get_wardrobe_items({}) as Array<Record<string,unknown>>;
  assert.deepEqual(items.map(item=>item.availability),['available','available']);assert.ok(items.every(item=>item.availability_source==='user_confirmation'));
  const context=await tools.get_garment_context({garment_id:TOP}) as Record<string,unknown>;assert.equal(context.availability,'available');
  f.garments[0].revision++;
  await assert.rejects(tools.get_garment_context({garment_id:TOP}),(error:unknown)=>error instanceof AppError&&error.code==='stale_revision');
  const refreshed=await f.service.readTools(f.request,await f.scope());const changed=await refreshed.get_garment_context({garment_id:TOP}) as Record<string,unknown>;assert.equal(changed.availability,'unknown');
  assert.equal(parseProposal(proposal,await f.scope()).kind,'needs_information');
  assert.equal(f.counts().writes,0);assert.equal(f.counts().providerCalls,0);
});

test('explicit laundry, repair and omitted confirmations cannot be recommended',async()=>{
  for(const status of ['laundry','repair'] as const){const f=fixture();f.request.availabilityConfirmations![1].status=status;const result=parseProposal(proposal,await f.scope());assert.equal(result.kind,'needs_information');assert.deepEqual(result.items,[]);}
  const f=fixture();f.request.availabilityConfirmations=[];assert.equal(parseProposal(proposal,await f.scope()).kind,'needs_information');
});

test('foreign and nonexistent claims are rejected before saving the draft and runtime spend gate remains enforced',async()=>{
  for(const foreign of [OTHER,'77777777-7777-4777-8777-777777777777']){
    const f=fixture();f.request.draft={draftId:TOP,ownerId:OWNER,revision:1,name:'Preserve draft',items:{top:TOP,bottom:BOTTOM},topLocked:false};
    f.request.availabilityConfirmations=[{garmentId:foreign,identity:'forged',status:'available'}];
    await assert.rejects(f.service.execute(f.request,'live'),(error:unknown)=>error instanceof AppError&&error.code==='unauthorized_target');
    assert.deepEqual(f.counts(),{writes:0,providerCalls:0,evidenceReads:0});
  }
  const f=fixture();await assert.rejects(f.service.execute(f.request,'live'),(error:unknown)=>error instanceof AppError&&error.code==='approval_required');
  assert.deepEqual(f.counts(),{writes:0,providerCalls:0,evidenceReads:0});
});

test('historical request confirmation is not reused as a fresh review, while an explicit current review can validate a saved proposal',async()=>{
  const f=fixture();const job={adapter:'generateOutfits',input_snapshot_json:structuredClone(f.request)};
  const review=(f.service as unknown as {reviewAgentResult(job:unknown,value:unknown,request?:AiRequest):Promise<{result:{kind:string}}>}).reviewAgentResult.bind(f.service);
  assert.equal((await review(job,proposal)).result.kind,'needs_information');
  assert.equal((await review(job,proposal,f.request)).result.kind,'proposal');
  assert.deepEqual(job.input_snapshot_json,f.request);assert.equal(f.counts().writes,0);
});

test('HTTP recommendation transport includes review evidence only when supplied, preserving existing request compatibility',async()=>{
  const f=fixture(),bodies:Array<Record<string,unknown>>=[];
  const remote=new HttpRemoteBackend(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({mode:'mock',result:null});});
  const draft=createSeed().outfitDrafts['demo-profile'];
  await remote.recommend(draft,DEMO_CONDITIONS,undefined,f.confirmations);
  assert.deepEqual(bodies[0].availability_confirmations,f.confirmations);
  await remote.recommend(draft,DEMO_CONDITIONS);assert.equal('availability_confirmations' in bodies[1],false);
});

test('core recommendation uses the shared confirmations and invalidation keeps a late response out of the draft',async()=>{
  const state=createSeed(),owner=state.activeProfileId,app=new DemoApp();let resolve!:(items:OutfitItems)=>void,received:AvailabilityConfirmation[]|undefined;
  let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
  const remote:RemoteBackend={mode:'mock',state:async()=>structuredClone(state),putDraft:async()=>{},discardDraft:async()=>{},saveGarment:async()=>{throw Error('unused');},saveOutfit:async()=>{throw Error('unused');},recordEvent:async()=>{throw Error('unused');},analyze:async()=>null,
    recommend:async(_draft,_conditions,_reference,confirmations)=>{received=confirmations;started();return new Promise<OutfitItems>(r=>{resolve=r;});},care:async()=>{throw Error('unused');},tryOn:async()=>({})};
  await app.configureRemote(remote);let review=createOutfitReviewState(owner);for(const garment of state.garments)review=confirmReviewAvailability(review,owner,state.garments,garment.id,'available');
  const confirmations=recommendationAvailability(review,owner,state.garments),before=structuredClone(app.outfitDraft());
  const pending=app.generateOutfits(DEMO_CONDITIONS,{delayMs:0},confirmations);await ready;
  assert.deepEqual(received,confirmations);app.invalidateOutfitRecommendation();resolve({top:'g-knit',bottom:'g-jeans'});
  assert.equal((await pending).status,'stale');assert.deepEqual(app.outfitDraft(),before);assert.equal(app.events().length,0);
});

test('core rejects a provider selection outside the shared available review without changing the draft',async()=>{
  const state=createSeed(),app=new DemoApp(),owner=state.activeProfileId;
  const remote:RemoteBackend={mode:'mock',state:async()=>structuredClone(state),putDraft:async()=>{},discardDraft:async()=>{},saveGarment:async()=>{throw Error('unused');},saveOutfit:async()=>{throw Error('unused');},recordEvent:async()=>{throw Error('unused');},analyze:async()=>null,recommend:async()=>({top:'g-knit',bottom:'g-jeans'}),care:async()=>{throw Error('unused');},tryOn:async()=>({})};
  await app.configureRemote(remote);const review=confirmReviewAvailability(createOutfitReviewState(owner),owner,state.garments,'g-knit','available'),before=structuredClone(app.outfitDraft());
  assert.equal((await app.generateOutfits(DEMO_CONDITIONS,{delayMs:0},recommendationAvailability(review,owner,state.garments))).status,'no-result');
  assert.deepEqual(app.outfitDraft(),before);assert.equal(app.events().length,0);
});