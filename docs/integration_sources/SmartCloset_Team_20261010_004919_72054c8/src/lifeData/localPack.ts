/** Browser-only adapter for the reviewed local demonstration pack. No Auth IDs, I/O or remote writes. */
import manifest from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/manifest.json';
import profiles from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/profiles.json';
import garments from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/garments.json';
import products from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/products.json';
import external_items from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/external_items.json';
import outfits from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/outfits.json';
import activity_events from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/activity_events.json';
import evidence_bindings from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/evidence_bindings.json';
import preferences from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/preferences.json';
import contexts from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/contexts.json';
import asset_intake from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/asset_intake.json';
import sources from '../../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/sources/product_sources.json';
import {emptyUI} from '../core/seed';
import type {Category,DemoEvent,DemoState,ExternalOutfitItems,OutfitItems} from '../core/types';
import {lifeDate,lifeTimestamp} from '../lifeHistory';
import {lifeContextDate,parseLifeProfileData} from '../lifeSnapshot';
import type {LifeDataPack,PackEntity} from './types';

export const LOCAL_LIFE_NAMESPACE=manifest.namespace;
export const LOCAL_LIFE_PACK_VERSION=manifest.version;
/** These deliberately non-UUID identifiers can never be mistaken for Supabase Auth subjects. */
export function localLifeId(entity:string,ref:string,namespace=LOCAL_LIFE_NAMESPACE){return `local:${namespace}:${entity}:${ref}`;}
export const LOCAL_LIFE_PROFILE_IDS={PSU:localLifeId('profile','PSU'),PHW:localLifeId('profile','PHW')} as const;
export interface LocalPackDeferred {entity:string;ref:string;reason:string;source:unknown}
export interface LocalPackReport {namespace:string;version:string;sourceFingerprint:string;counts:Record<string,number>;deferred:LocalPackDeferred[]}
export interface LocalLifePack {state:DemoState;report:LocalPackReport}
const bundled={manifest,profiles,garments,products,external_items,outfits,activity_events,evidence_bindings,preferences,contexts,asset_intake,sources} as LifeDataPack;
const slots:readonly string[]=['top','bottom','outer','dress','bag','shoes','hat','accessory'];
const eventKinds:Record<string,DemoEvent['kind']>={movement_confirmed:'movement',wear_confirmed:'wear',wash_completed:'care',dry_completed:'care',iron_completed:'care',air_completed:'care',professional_cleaning_completed:'care',outfit_planned:'plan',user_observation:'care'};
const eventLabels:Record<string,string>={movement_confirmed:'위치 확인 · 시연 기록',wear_confirmed:'실제 착용 · 시연 기록',wash_completed:'세탁 완료 · 시연 기록',dry_completed:'건조 완료 · 시연 기록',iron_completed:'다림질 완료 · 시연 기록',air_completed:'환기 완료 · 시연 기록',professional_cleaning_completed:'전문 관리 완료 · 시연 기록',outfit_planned:'코디 계획 · 시연 기록',user_observation:'사용자 관찰 · 시연 기록'};
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`:JSON.stringify(value)??'null';
/** Content-change checksum only, not a signature, credential or security decision. */
export function localLifeFingerprint(value:unknown):string {
 let a=0x811c9dc5,b=0x9e3779b9;const text=canonical(value);
 for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b^code,0x85ebca6b);}
 return `fnv-pair:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}:${text.length}`;
}
/** A clone supports isolated validation without allowing callers to edit the bundled source. */
export function readBundledLocalLifePack():LifeDataPack{return structuredClone(bundled);}
const officialUrl=(value:unknown)=>{try{const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^(?:(?:www2?\.)?(?:hm|cos|arket|maxmara)\.com|us\.maxmara\.com)$/.test(url.hostname);}catch{return false;}};

/** Returns a new state for the separate local store; it never reseeds or replaces existing data. */
export function buildLocalLifePack(pack:LifeDataPack=bundled):LocalLifePack {
 const namespace=pack.manifest.namespace;
 if(!/^[-a-z0-9]{1,60}$/.test(namespace))throw Error('invalid_local_pack_namespace');
 const report:LocalPackReport={namespace,version:pack.manifest.version,sourceFingerprint:localLifeFingerprint(pack),counts:{},deferred:[]};
 const defer=(entity:string,row:PackEntity,reason:string)=>report.deferred.push({entity,ref:row.ref,reason,source:structuredClone(row)});
 const unique=<T extends PackEntity>(entity:string,rows:readonly T[]):T[]=>rows.filter(row=>{const count=rows.filter(other=>other.ref===row.ref).length;if(!/^[-A-Za-z0-9_:]{1,150}$/.test(row.ref)||count!==1){defer(entity,row,count!==1?'duplicate_source_ref':'invalid_source_ref');return false;}return true;});
 const id=(entity:string,ref:string)=>localLifeId(entity,ref,namespace);
 const profileRows=unique('profile',pack.profiles).filter(p=>{if(p.profile_kind!=='fictional_demo'||p.auth_user_id!==null||p.allowed_profile_refs.length!==1||p.allowed_profile_refs[0]!==p.ref){defer('profile',p,'local_demo_profile_scope_required');return false;}return true;});
 const profileMap=new Map(profileRows.map(p=>[p.ref,id('profile',p.ref)]));
 const state:DemoState={schemaVersion:1,activeProfileId:profileMap.values().next().value??'',profiles:profileRows.map(p=>({id:id('profile',p.ref),name:p.display_name})),garments:[],outfits:[],externalItems:[],events:[],registrationDrafts:{},outfitDrafts:{},ui:{},receipts:[],intents:{},revisionReceipts:{},lifeData:{},careEvidence:[]};
 const productMap=new Map(unique('product',pack.products).map(p=>[p.ref,p]));
 const sourceMap=new Map(unique('source',pack.sources).map(s=>[s.ref,s]));
 const garmentRows=new Map<string,LifeDataPack['garments'][number]>();
 for(const row of unique('garment',pack.garments)){
  const ownerId=profileMap.get(row.owner_ref);
  const reason=!ownerId?'profile_unresolved':!slots.includes(row.category)?'unsupported_category:'+row.category:row.product_ref&&!productMap.has(row.product_ref)?'product_unresolved':null;
  if(reason){defer('garment',row,reason);continue;}
  state.garments.push({id:id('garment',row.ref),ownerId:ownerId!,name:row.name,category:row.category as Category,color:row.colour,features:[row.ref],material:row.material??'',size:row.size??'',location:'',asset:null,careNotes:'',revision:1,provenance:{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'}});
  garmentRows.set(row.ref,row);
 }
 const externalRows=new Map<string,LifeDataPack['external_items'][number]>();
 for(const row of unique('external',pack.external_items)){
  const ownerId=profileMap.get(row.owner_ref),product=productMap.get(row.product_ref),source=sourceMap.get(row.source_ref);
  if(!ownerId||!product||!source||source.product_ref!==product.ref||product.source_ref!==source.ref||source.url!==row.source_url||!officialUrl(row.source_url)||row.ownership!=='external_candidate'||row.led_anchor_ref!==null){defer('external',row,'external_reference_or_ownership_invalid');continue;}
  state.externalItems!.push({id:id('external',row.ref),ownerId,name:product.display_name_ko,asset:null,sourceLabel:String(source.publisher??product.display_name_ko),sourceUrl:source.url,...(slots.includes(product.category)?{category:product.category as Category}:{})});
  externalRows.set(row.ref,row);
 }
 const outfitRows=new Map<string,LifeDataPack['outfits'][number]>();
 for(const row of unique('outfit',pack.outfits)){
  const ownerId=profileMap.get(row.owner_ref),items:OutfitItems={},externalItems:ExternalOutfitItems={},used=new Set<string>();let reason=!ownerId?'profile_unresolved':'';
  for(const item of row.items){
   const source=item.kind==='owned'?garmentRows.get(item.ref):item.kind==='external'?externalRows.get(item.ref):undefined;
   if(!slots.includes(item.slot)||used.has(item.slot)||!source||source.owner_ref!==row.owner_ref||(item.kind==='owned'&&garmentRows.get(item.ref)?.category!==item.slot)){reason='outfit_reference_unresolved:'+item.ref;break;}
   used.add(item.slot);const slot=item.slot as Category;
   if(item.kind==='owned')items[slot]=id('garment',item.ref);
   else{const external=state.externalItems!.find(e=>e.id===id('external',item.ref))!;externalItems[slot]={externalItemId:external.id,assetId:null,assetVersion:null,name:external.name,sourceLabel:external.sourceLabel,sourceUrl:external.sourceUrl};}
  }
  if(reason||lifeTimestamp(row.created_at)===null){defer('outfit',row,reason||'invalid_created_at');continue;}
  state.outfits.push({id:id('outfit',row.ref),ownerId:ownerId!,name:row.title,items,externalItems,revision:1,assetVersions:Object.fromEntries(Object.values(items).map(value=>[value,0])),assetIds:Object.fromEntries(Object.values(items).map(value=>[value,null])),nameOrigin:'legacy',purpose:'card'});
  outfitRows.set(row.ref,row);
 }
 for(const row of unique('event',pack.activity_events)){
  const ownerId=profileMap.get(row.owner_ref),kind=eventKinds[row.kind],garmentIds=row.garment_refs.map(ref=>id('garment',ref));
  let reason=!ownerId?'profile_unresolved':!kind?'unsupported_event_kind':row.input_source!=='scenario_fixture'?'invalid_event_provenance':lifeTimestamp(row.occurred_at)===null?'invalid_occurred_at':row.source_event_key!==`${namespace}:${row.ref}`||pack.activity_events.filter(e=>e.source_event_key===row.source_event_key).length!==1?'source_event_key_conflict':'';
  if(row.garment_refs.some(ref=>garmentRows.get(ref)?.owner_ref!==row.owner_ref)||row.outfit_ref&&outfitRows.get(row.outfit_ref)?.owner_ref!==row.owner_ref)reason='event_reference_unresolved';
  const scheduledAt=kind==='plan'&&typeof row.details.scheduled_at==='string'?row.details.scheduled_at:undefined;
  if(kind==='plan'&&lifeTimestamp(scheduledAt)===null)reason='scheduled_at_required';
  if(reason){defer('event',row,reason);continue;}
  state.events.push({id:id('event',row.source_event_key),ownerId:ownerId!,kind,value:eventLabels[row.kind],date:lifeDate(scheduledAt??row.occurred_at)!,occurredAt:row.occurred_at,timePrecision:'instant',...(scheduledAt?{scheduledAt}:{}),...(row.outfit_ref?{outfitId:id('outfit',row.outfit_ref)}:{}),...(garmentIds.length===1?{garmentId:garmentIds[0]}:{}),garmentIds,inputSource:'demo',sourceEventKey:row.source_event_key,sourceRef:row.ref,revision:1,voided:false,lifeKind:row.kind,details:{...structuredClone(row.details),_life_data:{namespace,source_ref:row.ref,provenance:'synthetic_life_event'}}});
 }
 for(const row of unique('evidence',pack.evidence_bindings)){
  const ownerId=profileMap.get(row.owner_ref),garment=garmentRows.get(row.garment_ref),product=productMap.get(row.product_ref),source=sourceMap.get(row.source_ref);
  if(!ownerId||!garment||garment.owner_ref!==row.owner_ref||garment.product_ref!==row.product_ref||!product||!source||product.source_ref!==source.ref||source.product_ref!==product.ref||row.evidence_kind!=='official_product_page'||!officialUrl(source.url)||lifeTimestamp(`${source.retrieved_date}T00:00:00+09:00`)===null){defer('evidence',row,'demo_product_source_binding_unresolved');continue;}
  state.careEvidence!.push({id:id('evidence',row.ref),ownerId,garmentId:id('garment',row.garment_ref),kind:'official_guidance',sourceRef:source.url,observedAt:`${source.retrieved_date}T00:00:00+09:00`,asset:null,originalText:JSON.stringify({display_source_label:'공식 상품 관리 안내',structured_care:row.structured_care,composition:product.composition??null,issues:product.issues??[],retrieval_level:source.retrieval_level,short_excerpt:source.short_excerpt,source_notes:source.notes??null,physical_label_verified:false,physical_item_match_verified:false,demo_product_binding_verified:true,_life_data:{namespace,source_ref:row.ref,product_ref:product.ref,official_source_ref:source.ref,provenance:'source_derived_evidence_binding'}})});
 }
 const preferenceRows=unique('preference',pack.preferences).filter(row=>{if(profileMap.has(row.profile_ref))return true;defer('preference',row,'profile_unresolved');return false;}),contextRows=unique('context',pack.contexts).filter(row=>{if(profileMap.has(row.profile_ref))return true;defer('context',row,'profile_unresolved');return false;});
 for(const profile of profileRows){
  const ownerId=id('profile',profile.ref),preferences=[] as unknown[],contexts=[] as unknown[];
  for(const p of preferenceRows.filter(p=>p.profile_ref===profile.ref)){
   if(p.kind==='like'&&outfitRows.get(String(p.outfit_ref))?.owner_ref!==profile.ref){defer('preference',p,'liked_outfit_unresolved');continue;}
   const candidate={id:id('preference',p.ref),ownerId,kind:p.kind,sourceRef:p.ref,provenance:'scenario_fixture',...(p.kind==='explicit_preference'?{key:p.key,value:p.value}:{outfitId:id('outfit',String(p.outfit_ref))}),...(p.context?{context:p.context}:{})};
   if(parseLifeProfileData({ownerId,namespace,provenance:'scenario_fixture',revision:1,preferences:[candidate],contexts:[]},ownerId))preferences.push(candidate);else defer('preference',p,'invalid_preference_read_contract');
  }
  for(const c of contextRows.filter(c=>c.profile_ref===profile.ref)){
   const candidate={id:id('context',c.ref),ownerId,asOf:c.as_of,timeZone:c.timezone,purpose:c.purpose,sourceRef:c.ref,provenance:'scenario_fixture',weather:{status:c.weather.status,provenance:'scenario_fixture',...(c.weather.status==='available'?{kind:c.weather.kind,sourceRef:c.ref,issuedAt:c.weather.issued_at,validFrom:c.weather.valid_from,validTo:c.weather.valid_to,precipitation:c.weather.precipitation,temperatureC:c.weather.temperature_c}:{})}};
   if(parseLifeProfileData({ownerId,namespace,provenance:'scenario_fixture',revision:1,preferences:[],contexts:[candidate]},ownerId))contexts.push(candidate);else defer('context',c,'invalid_context_read_contract');
  }
  const activeContextId=id('context',profile.ref==='PHW'?'CTX-HW-RAIN':'CTX-SU-CARE');
  const data=parseLifeProfileData({ownerId,namespace,provenance:'scenario_fixture',revision:1,preferences,contexts,...(contexts.some(c=>(c as {id:string}).id===activeContextId)?{activeContextId}:{})},ownerId);
  if(data)state.lifeData![ownerId]=data;else{for(const row of [...preferenceRows,...contextRows].filter(row=>row.profile_ref===profile.ref))defer('profile_data',row,'invalid_profile_read_contract');}
  const active=data?.contexts.find(c=>c.id===data.activeContextId);
  state.ui[ownerId]={...emptyUI(),calendarDate:active?lifeContextDate(active):pack.manifest.created_date as string,searchResultIds:state.garments.filter(g=>g.ownerId===ownerId).map(g=>g.id)};
 }
 report.counts={profiles:state.profiles.length,garments:state.garments.length,outfits:state.outfits.length,events:state.events.length,externalItems:state.externalItems!.length,careEvidence:state.careEvidence!.length,preferences:Object.values(state.lifeData!).reduce((sum,d)=>sum+d.preferences.length,0),contexts:Object.values(state.lifeData!).reduce((sum,d)=>sum+d.contexts.length,0),deferred:report.deferred.length};
 return {state,report};
}



