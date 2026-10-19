import {useState} from 'react';import {createRoot} from 'react-dom/client';import {HorizontalPager} from '../src/HorizontalPager';
function Fixture(){
 const [index,setIndex]=useState(0),[selected,setSelected]=useState('none'),[selections,setSelections]=useState(0),[browses,setBrowses]=useState(0),[active,setActive]=useState(false),[open,setOpen]=useState(true),[peek,setPeek]=useState(.12);
 return <main><div className="fixture-actions"><button onClick={()=>{setIndex(0);setSelected('none');setSelections(0);setBrowses(0);setOpen(true);setPeek(.12);}}>초기화</button><button onClick={()=>setOpen(v=>!v)}>{open?'닫기':'열기'}</button><button onClick={()=>setPeek(0)}>전체 폭</button><button onClick={()=>setIndex(2)}>외부 마지막장</button></div>
 <output id="fixture-state" data-index={index} data-selected={selected} data-selections={selections} data-browses={browses} data-active={active}>{index} / {selected} / {selections}</output>
 <div id="fixture-width" style={{width:285}}>{open&&<HorizontalPager peek={peek} label="시험 의류" index={index} onIndexChange={next=>{setIndex(next);setBrowses(n=>n+1);}} onInteractionChange={setActive}>{['A','B','C'].map(id=><div key={id}><button className="fixture-card" data-card={id} onClick={()=>{setSelected(id);setSelections(n=>n+1);}}>{id} 선택</button>{id==='C'&&<input aria-label="메모" defaultValue="원본 메모"/>}</div>)}</HorizontalPager>}</div>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
