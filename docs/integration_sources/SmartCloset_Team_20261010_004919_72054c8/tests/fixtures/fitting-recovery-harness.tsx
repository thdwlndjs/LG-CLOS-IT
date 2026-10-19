import React,{useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DemoApp} from '../../src/core/app';
import {FittingControls} from '../../src/FittingControls';
import {buildFittingSnapshot,type FittingCandidate,type FittingRequest} from '../../src/mirrorScene';
import {createWardrobePackBundle,PACK_PERSON,PACK_PROFILE_ID} from '../../src/wardrobePack';
import type {Asset} from '../../src/core/types';

const app=new DemoApp({getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
app.installLocalDemoProfile(createWardrobePackBundle());
let connected=true;
Object.defineProperty(app,'connection',{get:()=>({kind:connected?'supabase':'local'})});
const person:Asset={id:'11111111-1111-4111-8111-111111111111',version:1,source:'storage',url:'/fixture-person.mp4'};
const reference:Asset={id:'22222222-2222-4222-8222-222222222222',version:1,source:'storage',url:'/fixture-reference.png'};

function Harness(){
 const [version,setVersion]=useState(1);
 const [result,setResult]=useState<FittingCandidate|null>(null),[request,setRequest]=useState<FittingRequest|null>(null);
 const snapshot=useMemo(()=>buildFittingSnapshot({ownerId:PACK_PROFILE_ID,person:PACK_PERSON,
  outfit:app.outfitDraft()!,garments:app.garments(),requestVersion:version}).snapshot,[version]);
 return <main>
  <output data-testid="scene-result">{result?.media?.kind==='image'||result?.media?.kind==='video'?result.media.url:''}</output>
  <output data-testid="scene-request">{request?.status??'none'}</output>
  <button onClick={()=>{app.setOutfitItem('top','T07');setVersion(v=>v+1);}}>Fixture: change outfit</button>
  <button onClick={()=>{app.stopTryOn();connected=false;setVersion(v=>v+1);}}>Fixture: logout</button>
  <FittingControls app={app} sceneSnapshot={snapshot} onSceneResult={setResult} onSceneRequest={setRequest}
   retainedInputs={{ownerId:PACK_PROFILE_ID,person,reference}} onInputsChange={()=>{}}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

