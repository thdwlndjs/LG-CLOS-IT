// Explicit local fixture evidence exporter. Never imported by the app/server and no network calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {asRole,createTestDatabase,OWNER,OTHER} from './db-harness';
import {applyIsolatedFixture,buildIsolatedLifeFixture,readFixtureImportRecords} from './life-data-import-fixture';
import {planLifeDataImport} from '../src/lifeData/importPlan';
import {eventFrom,garmentFrom,outfitFrom,externalItemFrom} from '../server/domain';
import {parseLifeProfileData} from '../src/lifeSnapshot';
import type {JsonObject} from '../src/lifeData/types';
const directory=resolve('evidence/life-data-connection-20261009');await mkdir(directory,{recursive:true});
const write=(name:string,value:unknown)=>writeFile(resolve(directory,name),JSON.stringify(value,null,2)+'\n','utf8');
const f=await buildIsolatedLifeFixture(),db=await createTestDatabase();
const count=async()=>Object.fromEntries(await Promise.all(['garments','assets','outfits','activity_events','evidence_items','external_items','access_grants','budget_ledger'].map(async name=>[name,(await db.query<{count:number}>(`select count(*)::int as count from public.sc_${name}`)).rows[0].count])));
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
try{
 const before=await count(),applied=await applyIsolatedFixture(db,f.plan),after=await count();
 // Profile settings are populated by this isolated fixture only; no production settings mutation RPC exists.
 for(const p of f.state.profiles)await db.query('update public.sc_profiles set display_name=$1,settings=$2 where id=$3',[p.name,JSON.stringify({lifeData:f.state.lifeData![p.id]}),p.id]);
 const rows=async(table:string)=>(await db.query<JsonObject>(`select * from public.${table}`)).rows.map(json);
 const [garments,outfits,events,links,external,profiles]=await Promise.all(['sc_garments','sc_outfits','sc_activity_events','sc_event_garments','sc_external_items','sc_profiles'].map(rows));
 f.state.garments=garments.map(g=>garmentFrom(g,[]));f.state.outfits=outfits.map(outfitFrom);f.state.events=events.map(e=>eventFrom(e,links.filter(l=>l.event_id===e.id).map(l=>String(l.garment_id))));f.state.externalItems=external.map(e=>externalItemFrom(e,[]));
 f.state.lifeData=Object.fromEntries(profiles.filter(p=>f.state.profiles.some(x=>x.id===p.id)).map(p=>{const parsed=parseLifeProfileData((p.settings as JsonObject).lifeData,String(p.id));assert.ok(parsed);return[String(p.id),parsed];}));
 const records=await readFixtureImportRecords(db,f.plan,applied.receipts),repeatPlan=planLifeDataImport({...f,existing:{...f.existing,imports:records}}),repeat=await applyIsolatedFixture(db,repeatPlan);assert.equal(repeat.createdEntities,0);assert.equal(repeat.insertedRows,0);assert.deepEqual(await count(),after);
 await asRole(db,'authenticated',OWNER);const su=(await rows('sc_garments')).length,otherAsSu=(await db.query('select * from public.sc_garments where owner_id=$1',[OTHER])).rows.length;await asRole(db,'authenticated',OTHER);const hw=(await rows('sc_garments')).length;assert.equal(su,15);assert.equal(hw,16);assert.equal(otherAsSu,0);await asRole(db,'postgres');
 await write('isolated-fixture.json',f.state);
 await write('isolated-bindings.json',f.bindings);
 await write('isolated-import-plan.json',f.plan);
 await write('isolated-sql-results.json',{classification:'PASS_FIXTURE',target:'PGlite memory using existing seven SQL sources',productionWrites:0,providerCalls:0,before,after,firstApply:{createdEntities:applied.createdEntities,insertedRows:applied.insertedRows},repeat:{createdEntities:repeat.createdEntities,insertedRows:repeat.insertedRows},rls:{sujinVisible:su,hwijaeVisible:hw,otherOwnerVisibleAsSujin:otherAsSu},receipts:records.map(r=>({key:r.key,runtimeId:r.runtimeId,ownerId:r.ownerId,sourceHash:r.sourceHash,rowUnchanged:r.appliedRowHash===r.currentRowHash})),limitations:['Metadata-only garments are isolated fixtures, not production assets','S14 dress and LS07 plus two dependent events deferred; no top-slot substitution','38 asset requests unresolved; no LED binding','Settings fixture loaded explicitly; real settings write RPC is not implemented','Historical fixture insert is one SQL transaction; not a chain of REST calls or a production RPC adapter']});
 const dry=planLifeDataImport({pack:f.pack,bindings:{namespace:f.pack.manifest.namespace,profiles:{},garments:{},externalItems:{}},target:{environment:'unknown',projectId:null,schemaVersions:[]}});await write('import-dry-run-unknown.json',dry);
 console.log(JSON.stringify({isolatedFile:resolve(directory,'isolated-fixture.json'),before,after,repeatCreated:repeat.createdEntities,dryRunCounts:dry.counts},null,2));
}finally{await db.close();}
