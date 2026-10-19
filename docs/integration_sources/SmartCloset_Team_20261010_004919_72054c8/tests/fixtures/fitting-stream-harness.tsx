import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MirrorPersonStage} from '../../src/MirrorSceneView';
import {buildFittingSnapshot,selectCurrentFittingStream,type FittingStreamBinding,type FittingSnapshot} from '../../src/mirrorScene';
import {FittingStreamSession} from '../../src/fittingStreamSession';
import {createWardrobePackBundle,PACK_PERSON,PACK_PROFILE_ID} from '../../src/wardrobePack';

const bundle=createWardrobePackBundle();
const initial=buildFittingSnapshot({ownerId:PACK_PROFILE_ID,person:PACK_PERSON,outfit:bundle.outfitDraft,
 garments:bundle.garments,requestVersion:1}).snapshot!;
const observed:MediaStream[]=[];
declare global {interface Window {streamFixture:{streams:MediaStream[]}}}
window.streamFixture={streams:observed};
function synthetic(){
 const canvas=document.createElement('canvas');canvas.width=160;canvas.height=240;
 const painter=canvas.getContext('2d')!;painter.fillStyle='#7ca3a4';painter.fillRect(0,0,160,240);
 painter.fillStyle='#fff';painter.fillRect(50,40,60,140);
 const stream=canvas.captureStream(5);observed.push(stream);return stream;
}
function Session(){
 const [current,setCurrent]=useState<FittingSnapshot>(initial),[binding,setBinding]=useState<FittingStreamBinding|null>(null),[visible,setVisible]=useState(true);
 const session=useRef(new FittingStreamSession(setBinding));
 useEffect(()=>()=>session.current.clear(),[]);
 const stream=selectCurrentFittingStream(binding,current,'synthetic-operation');
 return <section>
  <output data-testid="active-stream">{stream?.id??''}</output>
  <button onClick={()=>session.current.receive({stream:synthetic(),snapshot:current,operationId:'synthetic-operation'},current,true)}>Synthetic: start</button>
  <button onClick={()=>session.current.receive({stream:synthetic(),snapshot:initial,operationId:'old-operation'},current,false)}>Synthetic: late event</button>
  <button onClick={()=>{const next=structuredClone(current);next.ownerId='other-owner';session.current.reconcile(next);setCurrent(next);}}>Synthetic: change owner</button>
  <button onClick={()=>session.current.clear()}>Synthetic: stop</button>
  <button onClick={()=>setVisible(value=>!value)}>Synthetic: toggle mirror</button>
  {visible&&<MirrorPersonStage person={PACK_PERSON} media={stream?{kind:'stream',stream,label:'Synthetic local stream · no provider'}:null} message="Synthetic fixture only"/>}
 </section>;
}
function Harness(){const [mounted,setMounted]=useState(true);return <main><button onClick={()=>setMounted(false)}>Synthetic: unmount session</button>{mounted&&<Session/>}</main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);

