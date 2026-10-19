import test from 'node:test';
import assert from 'node:assert/strict';
import {careEvidencePresentation,careEvidenceOriginalText,careEvidenceGrounding,CARE_GROUNDING_REVISION} from '../src/careEvidence';
import type {CareEvidenceItem} from '../src/careEvidence';
import {buildLocalLifePack} from '../src/lifeData/localPack';
import {AiService,digest,type AiRequest} from '../server/ai';
import {readConfig} from '../server/config';
import {emptyRemoteState} from '../server/domain';
import {buildLifeSnapshot} from '../src/lifeSnapshot';
import type {DatabaseRepository} from '../server/repository';
import type {AgentInput} from '../server/providers/agents';
const original=buildLocalLifePack().state;
function evidence(ref:string){return structuredClone(original.careEvidence!.find(item=>item.id.endsWith(':evidence:'+ref))!);}
const publicText=(item:CareEvidenceItem)=>{const view=careEvidencePresentation(item);return [view.title,view.summary,view.verificationLabel,view.scope,view.sourceDomain,careEvidenceOriginalText(item)].join(' ');};
const forbidden=/직접 open|파싱|재대조 권고|source_notes|structured_care|_life_data|turn[0-9]|EV-S0|SRC-P0|https:\/\//;

test('P04 remains search evidence requiring original recheck; unsupported iron and bleach never become care rows',()=>{
 const item=evidence('EV-S01'),before=structuredClone(item),view=careEvidencePresentation(item);
 assert.equal(view.verificationState,'original_recheck_required');assert.equal(view.summary,'관리 정보 원문 확인이 필요해요.');assert.equal(view.sourceDomain,'www.arket.com');assert.equal(view.rows.length,0);assert.equal(view.canGroundCare,false);assert.equal(careEvidenceGrounding(item),null);
 assert.deepEqual(view.excerptRows.map(row=>row.text),['드라이클리닝 금지','40°C 이하에서 세탁','걸어서 건조']);
 assert.match(careEvidenceOriginalText(item),/검색에서 확보한 상품 안내 발췌 · 원문 재확인 전/);assert(!/다림질|표백|그늘|건조기/.test(publicText(item)));assert(!forbidden.test(publicText(item)));assert.deepEqual(item,before);assert.match(item.originalText,/source_notes/);assert.match(item.originalText,/high/);
});

test('reviewed page rows use exact linked phrases in Korean and retain demo applicability',()=>{
 const item=evidence('EV-S02'),view=careEvidencePresentation(item);
 assert.equal(view.verificationState,'reviewed_excerpt');assert.equal(view.sourceKind,'demo_product_reference');assert.equal(view.physicalLabelPhoto,false);assert.equal(view.sourceDomain,'www2.hm.com');assert.match(view.scope,/시연.*실물 적용 미확인/);
 assert.deepEqual(view.rows.map(row=>row.text),['40°C에서 기계 세탁','낮은 온도로 기계 건조','중간 온도로 다림질','드라이클리닝']);for(const row of view.rows){assert.equal(row.evidenceId,item.id);assert(view.originalExcerpt.split(';').map(value=>value.trim()).includes(row.sourcePhrase));}
 assert(!/표백|드라이클리닝만|라벨 확인 완료/.test(publicText(item)));assert(!forbidden.test(publicText(item)));
 const grounding=careEvidenceGrounding(item)!;assert.equal(grounding.source_ref,'www2.hm.com');assert.equal(grounding.original_text,view.rows.map(row=>row.sourcePhrase).join('; '));assert.equal(grounding.grounding_revision,CARE_GROUNDING_REVISION);assert(!/notes|issues|_life_data|bleach|regular|relaxed/.test(JSON.stringify(grounding)));
});

test('cool has no invented numeric temperature and line drying implies neither shade nor tumble prohibition',()=>{
 const view=careEvidencePresentation(evidence('EV-H02'));assert.equal(view.rows.length,3);const wash=view.rows.find(row=>row.key==='wash')!,dry=view.rows.find(row=>row.key==='dry')!;
 assert.equal(wash.sourcePhrase,'Machine wash cool');assert(!/\d/.test(wash.text));assert.match(wash.text,/온도 수치 미표기/);assert.equal(dry.text,'걸어서 건조');assert(!/그늘|건조기|금지/.test(dry.text));
});

test('composition-only sources and search handwash do not invent additional care conditions',()=>{
 const composition=careEvidencePresentation(evidence('EV-H03'));assert.equal(composition.rows.length,0);assert.equal(composition.canGroundCare,false);assert.match(composition.summary,/관리 조건이 없어요/);
 const hand=careEvidencePresentation(evidence('EV-S03'));assert.deepEqual(hand.excerptRows.map(row=>row.text),['손세탁']);assert.equal(hand.rows.length,0);assert.equal(hand.canGroundCare,false);
});

test('research and unsupported structured values are preserved internally but cannot affect customer or grounding projection',()=>{
 const item=evidence('EV-S02'),before=careEvidencePresentation(item),raw=JSON.parse(item.originalText);raw.notes='SECRET_INTERNAL_NOTES';raw.issues=['SECRET_INTERNAL_ISSUES'];raw.source_notes='SECRET_INTERNAL_SOURCE';raw.structured_care={wash:{temperature_c:95},bleach:{permitted:true},iron:{level:'high'}};item.originalText=JSON.stringify(raw);
 assert.deepEqual(careEvidencePresentation(item),before);assert(!/SECRET|95|bleach|high/.test(JSON.stringify(careEvidenceGrounding(item))));assert.match(item.originalText,/SECRET_INTERNAL/);
});

test('wrong source, product, excerpt, retrieval or local canonical identity cannot acquire reviewed status',()=>{
 for(const mutate of [(item:CareEvidenceItem,raw:any)=>raw._life_data.product_ref='P04',(item:CareEvidenceItem,raw:any)=>raw.short_excerpt+='; Bleach freely',(item:CareEvidenceItem,raw:any)=>raw.retrieval_level='official_search_snapshot',(item:CareEvidenceItem)=>item.sourceRef='https://example.invalid/other',(item:CareEvidenceItem)=>item.garmentId='local:scprep-20261009-v1:garment:S01',(item:CareEvidenceItem)=>item.ownerId='local:scprep-20261009-v1:profile:PHW']){
  const item=evidence('EV-S02'),raw=JSON.parse(item.originalText);mutate(item,raw);item.originalText=JSON.stringify(raw);const view=careEvidencePresentation(item);assert.equal(view.verificationState,'unreviewed_source');assert.equal(view.rows.length,0);assert.equal(careEvidenceGrounding(item),null);assert(!forbidden.test(publicText(item)));
 }
});

test('plain recorded label and observations preserve their source without upgrading a text record to a photo',()=>{
 const item={...evidence('EV-S02'),kind:'label' as const,originalText:'직접 기록한 라벨 원문',sourceRef:'내부 확인번호',asset:null};const view=careEvidencePresentation(item);assert.equal(view.originalExcerpt,item.originalText);assert.equal(view.physicalLabelPhoto,false);assert.equal(view.sourceDomain,null);assert.equal(careEvidenceGrounding(item)?.original_text,item.originalText);assert(!careEvidenceOriginalText(item).includes('내부 확인번호'));
 const unreviewed={...item,kind:'official_guidance' as const};assert.equal(careEvidenceGrounding(unreviewed),null);assert.equal(careEvidencePresentation(unreviewed).originalExcerpt,item.originalText);
});

const OWNER='11111111-1111-4111-8111-111111111111',GARMENT='22222222-2222-4222-8222-222222222222',EVIDENCE='33333333-3333-4333-8333-333333333333',OP='44444444-4444-4444-8444-444444444444';
function serverFixture(ref:string){
 const state=emptyRemoteState(OWNER,'Isolated care fixture');state.garments=[{...original.garments[0],id:GARMENT,ownerId:OWNER}];state.careEvidence=[{...evidence(ref),id:EVIDENCE,ownerId:OWNER,garmentId:GARMENT}];let providerCalls=0;
 const repo={user:{id:OWNER},state:async()=>structuredClone(state),garment:async()=>({id:GARMENT,owner_id:OWNER})} as unknown as DatabaseRepository;
 const service=new AiService(readConfig({}),repo,async()=>{providerCalls++;throw Error('Actual provider calls forbidden');});return{state,repo,service,providerCalls:()=>providerCalls};
}
test('actual AI read-tool DTO exposes only reviewed care rows and excludes search snapshots without provider calls',async()=>{
 for(const ref of ['EV-S02','EV-S01']){const f=serverFixture(ref),scope:AgentInput={task:'care',context:{},allowedGarmentIds:[GARMENT],allowedEvidenceIds:[EVIDENCE]};const tools=await f.service.readTools({action:'requestCareGuide',intentKey:'fixture',garmentId:GARMENT},scope);const result=await tools.get_care_evidence({garment_id:GARMENT}) as any;
  if(ref==='EV-S01')assert.deepEqual(result,{status:'unavailable'});else{assert.equal(result.status,'available');assert.equal(result.evidence[0].care_rows.length,4);assert(!/notes|issues|_life_data|structured_care|regular|relaxed/.test(JSON.stringify(result)));}
  const actualScope=await(f.service as unknown as {agentScope(request:AiRequest):Promise<AgentInput>}).agentScope({action:'requestCareGuide',intentKey:'fixture',garmentId:GARMENT});assert.deepEqual(actualScope.allowedEvidenceIds,ref==='EV-S01'?[]:[EVIDENCE]);assert.equal(actualScope.context.care_grounding_revision,CARE_GROUNDING_REVISION);assert.equal(f.providerCalls(),0);
 }
});
test('a saved care result with the previous grounding policy is not presented as a current applicable answer',async()=>{
 const f=serverFixture('EV-S02'),request:AiRequest={action:'requestCareGuide',intentKey:'fixture',garmentId:GARMENT};const value={kind:'proposal',items:[],explanation:'Historical answer',evidence_ids:[EVIDENCE],unknown_fields:[]};const job={owner_id:OWNER,adapter:request.action,status:'succeeded',mode:'live',input_snapshot_json:request,config_json:{agentScope:{context:{life_snapshot_revision:digest(buildLifeSnapshot(f.state,OWNER).revisionKey)}}},result_json:{value}};
 (f.repo as any).db={one:async()=>({owner_id:OWNER}),rows:async()=>[job]};const before=structuredClone(job),result=await f.service.operation(OP) as any;assert.equal(result.result.kind,'needs_information');assert.deepEqual(result.result.unknown_fields,['care_grounding_revision']);assert.deepEqual(job,before);assert.equal(f.providerCalls(),0);
});
