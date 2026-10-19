import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApp} from '../src/core/app';
import {PreparedMockRunner} from '../src/core/mock';
import type {ActionOptions,CareGuide,Garment} from '../src/core/types';
import type {RemoteBackend} from '../src/integrations/backendClient';
import {buildLocalLifePack,localLifeId,LOCAL_LIFE_PROFILE_IDS} from '../src/lifeData/localPack';
import {buildLifeSnapshot} from '../src/lifeSnapshot';
import {localLifeCareGuide} from '../src/localLifeCareGuide';
const fast={delayMs:0},id=localLifeId;
function seed(){const s=buildLocalLifePack().state;s.activeProfileId=LOCAL_LIFE_PROFILE_IDS.PSU;return s;}
class LocalOnlyRunner extends PreparedMockRunner {
 calls:ActionOptions[]=[];
 override async simulate(options:ActionOptions={}){this.calls.push(options);await super.simulate(options);}
 override async careGuide(_garment:Garment):Promise<CareGuide>{throw Error('Imported sources must not enter the legacy runner');}
}
const forbidden=/source_notes|structured_care|_life_data|직접 open|파싱|재대조 권고|https:\/\//;
test('local care helper summarizes reviewed Korean rows and actual stored history without modifying any evidence or recording care',async()=>{
 const runner=new LocalOnlyRunner(),app=new DemoApp(undefined,seed,runner),before=structuredClone(app.getState()),result=await app.requestCareGuide(id('garment','S02'),fast);
 assert.equal(result.status,'success');if(result.status!=='success')throw Error('Expected summary');
 assert.equal(result.data.source,'local-evidence-summary');assert.equal(result.data.title,'저장된 근거 요약 · 로컬');assert.equal(result.data.actualCareRecorded,false);
 for(const phrase of ['40°C에서 기계 세탁','낮은 온도로 기계 건조','중간 온도로 다림질','드라이클리닝','시연에 설정한 상품 참고 · 실물 적용 미확인','www2.hm.com','시연 생활 기록 · 실제 사용자 이력 아님'])assert(result.data.advice.includes(phrase));
 const h=buildLifeSnapshot(before,before.activeProfileId).garments.find(g=>g.id===id('garment','S02'))!.history;
 assert(result.data.advice.includes('전체 기록된 착용 '+h.wearDays+'일 · '+h.wearCount+'회'));assert(!forbidden.test(result.data.advice));assert(!/소재와 세탁 라벨 정보가 없습니다|null/.test(result.data.advice));assert(result.data.advice.includes('\n'));
 assert.deepEqual(runner.calls,[fast]);assert.equal(app.ui().operations.careGuide.status,'success');assert.deepEqual(app.getState().careEvidence,before.careEvidence);assert.deepEqual(app.getState().events,before.events);assert.deepEqual(app.getState().outfits,before.outfits);
});
test('direct local requests cannot turn P04 search snapshots into a care guide',async()=>{
 const app=new DemoApp(undefined,seed,new LocalOnlyRunner()),before=structuredClone(app.events()),result=await app.requestCareGuide(id('garment','S01'),fast);
 assert.equal(result.status,'success');if(result.status!=='success')throw Error('Expected unavailable evidence explanation');assert.equal(result.data.source,'unconfirmed');assert.match(result.data.advice,/원문 확인이 필요/);assert(!/40|다림질|표백|세탁 금지|드라이클리닝/.test(result.data.advice));assert.equal(app.ui().operations.careGuide.status,'no-result');assert.deepEqual(app.events(),before);
});
test('local helper rejects foreign garment history and does not borrow another profile evidence',()=>{
 const s=seed(),g=s.garments.find(g=>g.id===id('garment','S02'))!,foreign=buildLifeSnapshot(s,LOCAL_LIFE_PROFILE_IDS.PHW);assert.equal(localLifeCareGuide(g,foreign).source,'unconfirmed');
 const life=buildLifeSnapshot(s,g.ownerId);life.evidence=life.evidence.map(item=>({...item,ownerId:LOCAL_LIFE_PROFILE_IDS.PHW}));assert.equal(localLifeCareGuide(g,life).source,'unconfirmed');
});
test('local care summary preserves runner failure options and does not create an action',async()=>{
 const app=new DemoApp(undefined,seed,new LocalOnlyRunner()),before=structuredClone(app.events());await assert.rejects(app.requestCareGuide(id('garment','S02'),{delayMs:0,fail:true}),(error:any)=>error.code==='MOCK_FAILURE');assert.equal(app.ui().operations.careGuide.status,'error');assert.deepEqual(app.events(),before);
});
class HoldSimulation extends LocalOnlyRunner {
 startedResolve!:()=>void;release!:()=>void;started=new Promise<void>(r=>{this.startedResolve=r;});held=new Promise<void>(r=>{this.release=r;});
 override async simulate(){this.startedResolve();await this.held;}
}
test('a delayed local care summary stays stale after profile, source or history changes',async()=>{
 for(const change of ['profile','source','history']){
  const runner=new HoldSimulation(),app=new DemoApp(undefined,seed,runner),pending=app.requestCareGuide(id('garment','S02'));await runner.started;
  if(change==='profile')app.setActiveProfile(LOCAL_LIFE_PROFILE_IDS.PHW);
  else app.repository.commit(s=>{if(change==='source')s.careEvidence!.find(e=>e.garmentId===id('garment','S02'))!.originalText='Changed unreviewed source';else s.events.find(e=>e.ownerId===LOCAL_LIFE_PROFILE_IDS.PSU)!.value='Updated history';});
  runner.release();assert.equal((await pending).status,'stale');
 }
});
test('remote care branch keeps its existing backend contract even for life-profile-shaped state',async()=>{
 const runner=new LocalOnlyRunner(),app=new DemoApp(undefined,seed,runner),guide:CareGuide={garmentId:id('garment','S02'),title:'Injected remote fixture',advice:'Injected remote result',source:'provider',actualCareRecorded:false};let calls=0;
 const remote={mode:'mock',state:async()=>seed(),care:async(garmentId:string)=>{assert.equal(garmentId,guide.garmentId);calls++;return guide;}} as unknown as RemoteBackend;
 await app.configureRemote(remote);const result=await app.requestCareGuide(guide.garmentId,fast);assert.deepEqual(result,{status:'success',data:guide});assert.equal(calls,1);assert.deepEqual(runner.calls,[]);
});
