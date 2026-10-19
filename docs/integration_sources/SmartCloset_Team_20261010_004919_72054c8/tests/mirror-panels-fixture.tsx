import {useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {DemoApp} from '../src/core/app';
import {createSeed,emptyUI} from '../src/core/seed';
import {MirrorHome} from '../src/MirrorHome';
import {MirrorCalendar} from '../src/MirrorCalendar';
import {MirrorProfiles} from '../src/MirrorProfiles';
import {PhotoWardrobeStage} from '../src/PhotoWardrobeStage';
import '../src/styles.css';import '../src/mirror-experience.css';
const seed=createSeed(),owner=seed.activeProfileId;
seed.profiles.push({id:'second',name:'검증 사용자 B'});seed.ui.second=emptyUI();seed.ui[owner].calendarDate='2026-12-31';
seed.outfits[0].name='검증 저장 코디';
seed.events=[{id:'fixture-plan',ownerId:owner,kind:'plan',outfitId:seed.outfits[0].id,date:'2026-12-31',value:'선택 계획'},{id:'fixture-wear',ownerId:owner,kind:'wear',outfitId:seed.outfits[0].id,date:'2026-12-31',value:'실제 착용'},{id:'fixture-care',ownerId:owner,kind:'care',garmentId:'g-knit',date:'2027-01-02',value:'세탁 기록'}];
const app=new DemoApp(undefined,()=>seed);(window as unknown as {panelApp:DemoApp}).panelApp=app;
function Fixture(){const state=useSyncExternalStore(app.subscribe,app.getState),[section,setSection]=useState('home'),[opened,setOpened]=useState('');return <><PhotoWardrobeStage anchorIds={[]}><div className="mx-surface"><header className="mx-header"><strong>패널 격리 검증</strong></header><nav className="mx-nav">{['home','calendar','my'].map(id=><button key={id} onClick={()=>setSection(id)}>{id}</button>)}</nav>{section==='home'?<MirrorHome app={app} onOpenOutfit={outfit=>{app.loadOutfitDraft(outfit.id);setOpened(outfit.id);}}/>:section==='calendar'?<MirrorCalendar app={app} today="2026-12-31" onReuse={outfit=>{app.loadOutfitDraft(outfit.id);setOpened(outfit.id);}} onBrowseOutfits={()=>setOpened('browse')}/>:<MirrorProfiles app={app} onSelectProfile={id=>{app.setActiveProfile(id);setSection('home');}} onAccount={()=>setOpened('account')}/>}</div></PhotoWardrobeStage><output id="fixture-state" style={{position:'fixed',left:0,bottom:0}} data-owner={state.activeProfileId} data-date={app.ui().calendarDate} data-opened={opened} data-events={state.events.length}/></>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
