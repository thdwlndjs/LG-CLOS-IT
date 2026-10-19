import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFittingSnapshot,selectCurrentFittingStream,type FittingSnapshot,type FittingStreamBinding} from '../src/mirrorScene';
import {FittingStreamSession,attachFittingStreamVideo} from '../src/fittingStreamSession';
import {createWardrobePackBundle,PACK_PERSON,PACK_PROFILE_ID} from '../src/wardrobePack';

function snapshot(){
 const bundle=createWardrobePackBundle();
 return buildFittingSnapshot({ownerId:PACK_PROFILE_ID,person:PACK_PERSON,outfit:bundle.outfitDraft,
  garments:bundle.garments,requestVersion:1}).snapshot!;
}
function media(videoCount=1){
 const tracks=Array.from({length:videoCount},()=>{
  const listeners=new Set<()=>void>();
  const track={kind:'video',readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';},
   addEventListener:(_type:string,listener:()=>void)=>listeners.add(listener),
   removeEventListener:(_type:string,listener:()=>void)=>listeners.delete(listener),
   end(){this.readyState='ended';for(const listener of listeners)listener();},listeners};
  return track;
 });
 const stream={get active(){return tracks.some(track=>track.readyState==='live');},getTracks:()=>tracks,getVideoTracks:()=>tracks,getAudioTracks:()=>[]};
 return{stream:stream as unknown as MediaStream,tracks};
}
const binding=(stream:MediaStream,value=snapshot(),operationId='operation-1'):FittingStreamBinding=>({stream,snapshot:value,operationId});

test('stream selection requires exact owner, person, full outfit, request version and operation',()=>{
 const source=media(),current=snapshot(),bound=binding(source.stream,current);
 assert.equal(selectCurrentFittingStream(bound,current,'operation-1'),source.stream);
 const changes:((value:FittingSnapshot)=>void)[]=[
  value=>{value.ownerId='foreign';},value=>{value.person.assetId='other-person';},value=>{value.person.assetVersion++;},
  value=>{value.outfit.draftId='other-draft';},value=>{value.outfit.revision++;},
  value=>{value.outfit.items[0].garmentId='other-garment';},value=>{value.outfit.items[0].assetVersion++;},
  value=>{value.outfit.items.pop();},value=>{value.requestVersion++;},
 ];
 for(const change of changes){const other=structuredClone(current);change(other);assert.equal(selectCurrentFittingStream(bound,other),null);}
 assert.equal(selectCurrentFittingStream(bound,current,'operation-2'),null);
 assert.equal(selectCurrentFittingStream({...bound,operationId:''},current),null);
 assert.equal(selectCurrentFittingStream(null,current),null);
 assert.equal(selectCurrentFittingStream(bound,null),null);
 assert.equal(selectCurrentFittingStream(binding(media(0).stream,current),current),null);
 source.tracks[0].end();assert.equal(selectCurrentFittingStream(bound,current),null);
});

test('accepted stream publishes a captured snapshot, replaces old tracks and removes old listeners',()=>{
 const current=snapshot(),first=media(),second=media(),published:Array<FittingStreamBinding|null>=[];
 const session=new FittingStreamSession(value=>published.push(value));
 const firstBinding=binding(first.stream,current);
 assert.equal(session.receive(firstBinding,current,true),true);
 assert.equal(published.length,1);assert.notEqual(published[0]?.snapshot,current);
 assert.equal(first.tracks[0].listeners.size,1);
 assert.equal(session.receive(firstBinding,current,true),true);assert.equal(published.length,1);
 assert.equal(session.receive(binding(second.stream,current),current,true),true);
 assert.equal(first.tracks[0].stops,1);assert.equal(first.tracks[0].listeners.size,0);
 assert.equal(second.tracks[0].stops,0);assert.equal(published.at(-1)?.stream,second.stream);
 session.clear();session.clear();
 assert.equal(second.tracks[0].stops,1);assert.equal(second.tracks[0].listeners.size,0);
 assert.equal(published.at(-1),null);assert.equal(published.filter(value=>value===null).length,1);
});

test('late or foreign incoming stream is stopped without erasing the newer current stream',()=>{
 const current=snapshot(),active=media(),late=media(),foreign=media(),published:Array<FittingStreamBinding|null>=[];
 const session=new FittingStreamSession(value=>published.push(value));
 session.receive(binding(active.stream,current,'new'),current,true);
 assert.equal(session.receive(binding(late.stream,current,'old'),current,false),false);
 const other=structuredClone(current);other.ownerId='old-owner';
 assert.equal(session.receive(binding(foreign.stream,other),current,true),false);
 assert.equal(late.tracks[0].stops,1);assert.equal(foreign.tracks[0].stops,1);
 assert.equal(active.tracks[0].stops,0);assert.equal(published.at(-1)?.stream,active.stream);
 assert.equal(published.length,1);session.clear();
});

test('account or snapshot changes and logout reconcile to empty while stopping every owned track',()=>{
 for(const next of ['owner','revision','logout']){
  const current=snapshot(),source=media(2),published:Array<FittingStreamBinding|null>=[];
  const session=new FittingStreamSession(value=>published.push(value));session.receive(binding(source.stream,current),current,true);
  const changed=structuredClone(current);if(next==='owner')changed.ownerId='different';else changed.outfit.revision++;
  assert.equal(session.reconcile(next==='logout'?null:changed),false);
  assert.ok(source.tracks.every(track=>track.stops===1&&track.listeners.size===0));
  assert.equal(published.at(-1),null);assert.equal(session.hasStream,false);
 }
});

test('natural end of the last video track clears the published stream and detaches listeners',()=>{
 const source=media(2),current=snapshot(),published:Array<FittingStreamBinding|null>=[];
 const session=new FittingStreamSession(value=>published.push(value));
 session.receive(binding(source.stream,current),current,true);
 source.tracks[0].end();assert.equal(session.hasStream,true);
 source.tracks[1].end();assert.equal(session.hasStream,false);
 assert.equal(published.at(-1),null);assert.ok(source.tracks.every(track=>track.listeners.size===0));
});

test('presentation attaches muted video and detaches without taking ownership of session tracks',async()=>{
 const source=media();let paused=0,played=0;
 const video={srcObject:null,muted:false,playsInline:false,play:async()=>{played++;},pause:()=>{paused++;}} as unknown as HTMLVideoElement;
 const detach=attachFittingStreamVideo(video,source.stream);
 assert.equal(video.srcObject,source.stream);assert.equal(video.muted,true);assert.equal(video.playsInline,true);
 await Promise.resolve();assert.equal(played,1);
 detach();assert.equal(video.srcObject,null);assert.equal(paused,1);assert.equal(source.tracks[0].stops,0);
});

test('late playback rejection and old view cleanup cannot detach or warn over a replacement stream',async()=>{
 const first=media(),second=media();let reject!:(error:Error)=>void,warnings=0,paused=0;
 const video={srcObject:null,muted:false,playsInline:false,play:()=>new Promise<void>((_resolve,no)=>{reject=no;}),pause:()=>{paused++;}} as unknown as HTMLVideoElement;
 const detachFirst=attachFittingStreamVideo(video,first.stream,()=>{warnings++;});
 video.srcObject=second.stream;detachFirst();reject(new Error('late autoplay rejection'));await Promise.resolve();
 assert.equal(video.srcObject,second.stream);assert.equal(paused,0);assert.equal(warnings,0);
});


test('an accepted stream cannot be relabeled as another operation or newer outfit snapshot',()=>{
 for(const change of ['operation','snapshot']){
  const current=snapshot(),source=media(),published:Array<FittingStreamBinding|null>=[];
  const session=new FittingStreamSession(value=>published.push(value));
  session.receive(binding(source.stream,current),current,true);
  const next=structuredClone(current);if(change==='snapshot')next.outfit.revision++;
  const nextBinding=binding(source.stream,next,change==='operation'?'other-operation':'operation-1');
  assert.equal(session.receive(nextBinding,next,true),false);
  assert.equal(source.tracks[0].stops,1);assert.equal(published.at(-1),null);assert.equal(session.hasStream,false);
 }
});

