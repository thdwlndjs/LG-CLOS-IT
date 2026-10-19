/** Test-only fixture: no network, credentials, files uploaded, or production installation. */
import {readLifeDataPack} from '../src/lifeData/readPack';
import {currentSchemaVersions,importKey,payloadHash,projectionHash,planLifeDataImport,stableRuntimeId} from '../src/lifeData/importPlan';
import type {DatabaseSnapshot,ExistingImportRecord,ImportPlan,JsonObject,LifeDataPack,PlanItem,RuntimeBindings} from '../src/lifeData/types';
import {emptyUI} from '../src/core/seed';
import type {DemoState} from '../src/core/types';
import {eventFrom,externalItemFrom,garmentFrom,outfitFrom} from '../server/domain';
import {parseLifeProfileData,type LifeProfileData} from '../src/lifeSnapshot';
import type {CareEvidenceItem} from '../src/careEvidence';
import type {PGlite} from '@electric-sql/pglite';
import {OWNER,OTHER} from './db-harness';
export const LIFE_PACK_DIRECTORY='reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1';
export async function buildIsolatedLifeFixture(){
 const pack=await readLifeDataPack(LIFE_PACK_DIRECTORY),namespace=pack.manifest.namespace;
 const bindings:RuntimeBindings={namespace,profiles:{PSU:{profileId:OWNER,authSubject:OWNER,reviewed:true},PHW:{profileId:OTHER,authSubject:OTHER,reviewed:true}},garments:{},externalItems:{},evidence:{}};
 for(const g of pack.garments)bindings.garments[g.ref]={id:stableRuntimeId(importKey(namespace,'garment',g.ref)),ownerId:bindings.profiles[g.owner_ref].profileId,reviewed:true,action:'create_fixture',asset:null};
 for(const e of pack.external_items)bindings.externalItems[e.ref]={id:stableRuntimeId(importKey(namespace,'external',e.ref)),ownerId:bindings.profiles[e.owner_ref].profileId,reviewed:true,action:'create_fixture',asset:null};
 for(const e of pack.evidence_bindings)bindings.evidence![e.ref]={reviewed:true,garmentId:bindings.garments[e.garment_ref].id,sourceRef:e.source_ref};
 const existing:DatabaseSnapshot={profiles:[{id:OWNER},{id:OTHER}],garments:[],externalItems:[],imports:[]};
 const target={environment:'isolated' as const,projectId:'pglite:memory',schemaVersions:currentSchemaVersions,allowAssetlessFixture:true};
 const plan=planLifeDataImport({pack,bindings,target,existing});
 return {pack,bindings,target,existing,plan,state:stateFromFixturePlan(pack,bindings,plan)};
}
export function fixtureProfileData(pack:LifeDataPack,bindings:RuntimeBindings,plan:ImportPlan):Record<string,LifeProfileData>{
 const output:Record<string,LifeProfileData>={};
 for(const profile of pack.profiles){
  const ownerId=bindings.profiles[profile.ref].profileId;
  const preferences=pack.preferences.filter(p=>p.profile_ref===profile.ref).map(p=>({id:p.ref,ownerId,kind:p.kind,sourceRef:p.ref,provenance:'scenario_fixture',...(p.kind==='explicit_preference'?{key:p.key,value:p.value}:{outfitId:plan.items.find(i=>i.entity==='outfit'&&i.ref===p.outfit_ref)?.runtimeId}),...(p.context?{context:p.context}:{})}));
  const contexts=pack.contexts.filter(c=>c.profile_ref===profile.ref).map(c=>({id:c.ref,ownerId,asOf:c.as_of,timeZone:c.timezone,purpose:c.purpose,sourceRef:c.ref,provenance:'scenario_fixture',weather:{status:c.weather.status,provenance:'scenario_fixture',...(c.weather.status==='available'?{kind:c.weather.kind,sourceRef:c.ref,issuedAt:c.weather.issued_at,validFrom:c.weather.valid_from,validTo:c.weather.valid_to,precipitation:c.weather.precipitation,temperatureC:c.weather.temperature_c}:{})}}));
  // This frozen context is selected only by the isolated fixture, never by production startup.
  const activeContextId=profile.ref==='PHW'?'CTX-HW-RAIN':'CTX-SU-CARE';
  const value=parseLifeProfileData({ownerId,namespace:pack.manifest.namespace,provenance:'scenario_fixture',revision:1,preferences,contexts,...(contexts.some(c=>c.id===activeContextId)?{activeContextId}:{})},ownerId);
  if(!value)throw new Error(`invalid isolated lifeData contract: ${profile.ref}`);output[ownerId]=value;
 }
 return output;
}
export function stateFromFixturePlan(pack:LifeDataPack,bindings:RuntimeBindings,plan:ImportPlan):DemoState{
 const included=plan.items.filter(i=>['CREATE','UNCHANGED'].includes(i.status)&&i.row),rows=(table:string)=>included.filter(i=>i.table===table).map(i=>i.row!);
 const profiles=pack.profiles.map(p=>({id:bindings.profiles[p.ref].profileId,name:`${p.display_name} · 생활 시연`})),events=rows('sc_activity_events');
 const careEvidence:CareEvidenceItem[]=rows('sc_evidence_items').map(e=>({id:String(e.id),ownerId:String(e.owner_id),garmentId:String(e.garment_id),kind:'official_guidance',originalText:String(e.original_text),sourceRef:String(e.source_ref),observedAt:String(e.observed_at),asset:null}));
 const ui=Object.fromEntries(profiles.map(p=>[p.id,{...emptyUI(),calendarDate:'2026-10-09'}]));
 const state:DemoState={schemaVersion:1,activeProfileId:profiles[0].id,profiles,garments:rows('sc_garments').map(row=>garmentFrom(row,[])),externalItems:rows('sc_external_items').map(row=>externalItemFrom(row,[])),outfits:rows('sc_outfits').map(outfitFrom),events:events.map(row=>eventFrom(row,included.find(i=>i.runtimeId===row.id)?.relatedRows?.map(x=>String(x.row.garment_id)))),registrationDrafts:{},outfitDrafts:{},ui,receipts:[],intents:{},revisionReceipts:{},lifeData:fixtureProfileData(pack,bindings,plan),careEvidence};
 for(const profile of profiles)ui[profile.id].searchResultIds=state.garments.filter(g=>g.ownerId===profile.id).map(g=>g.id);
 return state;
}
const allowedTables=new Set(['sc_garments','sc_external_items','sc_evidence_items','sc_outfits','sc_outfit_items','sc_activity_events','sc_event_garments']);
/** A real SQL transaction in a transient existing-schema test DB; NOT a production import adapter. */
export async function applyIsolatedFixture(db:PGlite,plan:ImportPlan,options:{failAfterRows?:number}={}){
 if(plan.target.environment!=='isolated'||plan.target.projectId!=='pglite:memory'||!plan.target.allowAssetlessFixture||!plan.valid||plan.applyBlockers.includes('schema_version_unverified')||plan.items.some(i=>i.status==='CONFLICT'))throw new Error('isolated_fixture_contract_required');
 const created=plan.items.filter(i=>i.status==='CREATE'),receipts:ExistingImportRecord[]=[];let rowCount=0;
 await db.transaction(async tx=>{
  // Called only by tests with a newly allocated in-memory fixture. No RLS is disabled.
  for(const item of created){if(!item.row||!item.table||!allowedTables.has(item.table))throw new Error('unsupported_fixture_table');
   for(const {table,row}of[{table:item.table,row:item.row},...(item.relatedRows??[])]){
    if(!allowedTables.has(table)||Object.keys(row).some(k=>!/^[a-z_]+$/.test(k)))throw new Error('invalid_fixture_sql_identifier');
    const keys=Object.keys(row),values=keys.map(key=>row[key]!==null&&typeof row[key]==='object'?JSON.stringify(row[key]):row[key]);
    await tx.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_,i)=>`$${i+1}`).join(',')})`,values);rowCount++;
    if(options.failAfterRows===rowCount)throw new Error('injected_partial_failure');
   }
   const rowHash=projectionHash(item.row,item.relatedRows);receipts.push({key:item.key,runtimeId:item.runtimeId!,ownerId:item.ownerId,sourceHash:item.sourceHash,appliedRowHash:rowHash,currentRowHash:rowHash});
  }
 });
 return {createdEntities:created.length,insertedRows:rowCount,receipts};
}
export async function readFixtureImportRecords(db:PGlite,plan:ImportPlan,receipts:ExistingImportRecord[]){
 const output:ExistingImportRecord[]=[];for(const receipt of receipts){const item=plan.items.find(i=>i.key===receipt.key)!;if(!item.row||!item.table||!allowedTables.has(item.table))throw Error('invalid_fixture_receipt');
  const read=async(table:string,expected:JsonObject)=>{const keys=Object.keys(expected);if(keys.some(k=>!/^[a-z_]+$/.test(k))||!allowedTables.has(table))throw Error('invalid_fixture_sql_identifier');const identifiers=table==='sc_outfit_items'?['outfit_id','slot']:table==='sc_event_garments'?['event_id','garment_id']:['id'];return(await db.query<JsonObject>(`select ${keys.join(',')} from public.${table} where ${identifiers.map((k,i)=>`${k}=$${i+1}`).join(' and ')}`,identifiers.map(k=>expected[k]))).rows[0];};
  const row=await read(item.table,item.row);if(!row){output.push({...receipt,deleted:true});continue;}
  const normalize=(value:JsonObject,expected:JsonObject)=>Object.fromEntries(Object.entries(value).map(([key,v])=>[key,typeof expected[key]==='string'&&/(_at)$/.test(key)&&v?new Date(String(v)).toISOString():v]));
  // PG timestamptz output normalizes offsets; both sides hash the same instant.
  const relatedRows=[];for(const r of item.relatedRows??[]){const actual=await read(r.table,r.row);relatedRows.push({table:r.table,row:actual?normalize(actual,r.row):null});}
  const expectedHash=payloadHash({row:normalize(item.row,item.row),relatedRows:(item.relatedRows??[]).map(r=>({table:r.table,row:normalize(r.row,r.row)}))});
  output.push({...receipt,appliedRowHash:expectedHash,currentRowHash:payloadHash({row:normalize(row,item.row),relatedRows})});
 }return output;
}
