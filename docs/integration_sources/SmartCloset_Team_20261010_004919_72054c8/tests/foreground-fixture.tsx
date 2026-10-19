import {useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {MirrorForeground,type ForegroundMedia,type ForegroundStatus} from '../src/MirrorForeground';
import {HorizontalPager} from '../src/HorizontalPager';
function Fixture(){
 const [look,setLook]=useState(1),[epoch,setEpoch]=useState(1),[status,setStatus]=useState<ForegroundStatus|null>(null),[media,setMedia]=useState<ForegroundMedia>({kind:'image',url:'/assets/wardrobe-pack/demo/LOOK01_sweats.png',label:'기존 준비 이미지'}),[index,setIndex]=useState(0),[clicks,setClicks]=useState(0),[open,setOpen]=useState(true);
 const change=(n:number)=>{setLook(n);setMedia({kind:'image',url:`/assets/wardrobe-pack/demo/LOOK0${n}_${n===1?'sweats':n===2?'knit_denim':'knit_slacks'}.png`,label:'기존 준비 이미지'});};
 useEffect(()=>()=>{if(media.kind==='stream')media.stream.getTracks().forEach(track=>track.stop());},[media]);
 async function video(saved:boolean){
  const image=new Image();image.src='/assets/wardrobe-pack/demo/LOOK01_sweats.png';await image.decode();
  const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;const c=source.getContext('2d')!;c.drawImage(image,0,0);const stream=source.captureStream(15);
  // Pipeline fixture uses already approved static RGB only, never a generated person or camera.
  const interval=setInterval(()=>c.drawImage(image,0,0),65);setTimeout(()=>clearInterval(interval),15000);
  if(!saved){setMedia({kind:'stream',stream,label:'기존 정지 이미지의 캔버스 스트림 · fixture'});return;}
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks:BlobPart[]=[];recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));stream.getTracks().forEach(t=>t.stop());setMedia({kind:'video',url,label:'기존 정지 이미지의 저장영상 · fixture'});};recorder.start();setTimeout(()=>recorder.stop(),1700);
 }
 return <><div><button onClick={()=>change(1)}>밝은 옷</button><button onClick={()=>change(2)}>어두운 하의</button><button onClick={()=>change(3)}>어두운 옷</button><button onClick={()=>setEpoch(n=>n+1)}>프로필 전환</button><button onClick={()=>void video(false)}>스트림 fixture</button><button onClick={()=>void video(true)}>저장영상 fixture</button><button onClick={()=>{if(media.kind==='stream')media.stream.getTracks().forEach(t=>t.stop());}}>시험 스트림 종료</button><button onClick={()=>setOpen(v=>!v)}>표시 전환</button></div><output id="status">{JSON.stringify(status)}</output><div className="stage">{open&&<MirrorForeground contextKey={`profile${epoch}:look${look}:${media.kind}`} media={media} onStatus={setStatus}/>}</div><div className="interaction"><HorizontalPager label="동시 탐색" index={index} onIndexChange={setIndex}>{['A','B','C'].map(id=><button key={id} onClick={()=>setClicks(n=>n+1)} style={{height:150,width:'100%'}}>{id} 선택</button>)}</HorizontalPager><output id="interaction" data-page={index} data-clicks={clicks}>{index}/{clicks}</output></div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
