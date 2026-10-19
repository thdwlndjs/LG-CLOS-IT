import {useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {app} from '../src/appInstance';
import {MirrorOutfitWorkspace,createOutfitWorkspaceUI,type MirrorOutfitWorkspaceUI} from '../src/MirrorOutfitWorkspace';
import {PhotoWardrobeStage} from '../src/PhotoWardrobeStage';
import '../src/styles.css';import '../src/mirror-experience.css';import '../src/mirror-wardrobe.css';
function Fixture(){
 const state=useSyncExternalStore(app.subscribe,app.getState),owner=state.activeProfileId;
 const [view,setView]=useState<'library'|'builder'|'compare'>('library'),[calls,setCalls]=useState(0),[changes,setChanges]=useState(0);
 const memory=useRef<Record<string,MirrorOutfitWorkspaceUI>>({});
 (window as unknown as {workspaceFixture:()=>unknown}).workspaceFixture=()=>({state:app.getState(),ui:memory.current[owner],view,calls,changes});
 return <><PhotoWardrobeStage anchorIds={[]}><div className="mx-surface">
  {view==='compare'?<section className="mx-editor" style={{left:'4%',right:'4%',top:'14%',bottom:'8%',height:'auto'}}><p>격리 시험 · 공급자 실행 없는 C 표면</p><button onClick={()=>setView('builder')}>조합 편집으로 복귀</button><button onClick={()=>setView('library')}>카드 탐색으로 복귀</button></section>:<div className="mx-editor" style={{left:'4%',right:'4%',top:'14%',bottom:'8%',height:'auto'}}><MirrorOutfitWorkspace key={owner} view={view} onViewChange={setView} onBack={()=>setView('library')} uiState={memory.current[owner]??createOutfitWorkspaceUI()} onUIStateChange={value=>{memory.current[owner]=value;}} onDraftChange={()=>setChanges(value=>value+1)} onOpenLook={look=>{app.loadOutfitDraft(look.id);setCalls(value=>value+1);setView('compare');}} onRequestFitting={()=>{setCalls(value=>value+1);setView('compare');}}/></div>}
 </div></PhotoWardrobeStage><aside style={{position:'fixed',left:10,bottom:10,background:'white'}}>{state.profiles.map(profile=><button key={profile.id} onClick={()=>{app.setActiveProfile(profile.id);setView('library');}}>{profile.name}</button>)}</aside></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
