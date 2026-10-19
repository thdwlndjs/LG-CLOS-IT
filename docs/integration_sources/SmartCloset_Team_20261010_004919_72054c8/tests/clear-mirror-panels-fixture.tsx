import {useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {DemoApp} from '../src/core/app';
import {createSeed,emptyUI} from '../src/core/seed';
import {createWardrobePackBundle} from '../src/wardrobePack';
import {MirrorHome} from '../src/MirrorHome';
import {MirrorCalendar} from '../src/MirrorCalendar';
import {MirrorProfiles} from '../src/MirrorProfiles';
import {MirrorGarmentGrid} from '../src/MirrorGarmentGrid';
import {PhotoWardrobeStage} from '../src/PhotoWardrobeStage';
import '../src/styles.css';import '../src/mirror-experience.css';import '../src/mirror-wardrobe.css';import '../src/mirror-clear.css';
const seed=createSeed(),bundle=createWardrobePackBundle(),owner=bundle.profile.id;
seed.profiles.push(bundle.profile);seed.garments.push(...bundle.garments);seed.outfits.push(...bundle.outfits);seed.ui[owner]=emptyUI();seed.ui[owner].calendarDate='2026-10-09';seed.outfitDrafts[owner]=bundle.outfitDraft;seed.activeProfileId=owner;
seed.events=[{id:'clear-fixture-plan',ownerId:owner,kind:'plan',outfitId:'LOOK02',date:'2026-10-09',value:'격리 시험 계획'}];
const app=new DemoApp(undefined,()=>seed);(window as any).clearPanelApp=app;(window as any).clearPanelOpened=null;
function Fixture(){const state=useSyncExternalStore(app.subscribe,app.getState),[section,setSection]=useState('home'),[page,setPage]=useState(0);return <PhotoWardrobeStage anchorIds={[]}><div className="mx-surface" data-mirror-ui="clear"><nav className="mx-nav" aria-label="격리 검사 메뉴">{['home','grid','calendar','profiles'].map(id=><button key={id} onClick={()=>setSection(id)}>{id}</button>)}</nav>{section==='home'?<MirrorHome app={app} onOpenOutfit={outfit=>{(window as any).clearPanelOpened=structuredClone(outfit);}}/>:section==='grid'?<section className="mx-work mx-wardrobe"><h1>상의</h1><MirrorGarmentGrid garments={app.garments().filter(g=>g.category==='top')} index={page} onIndexChange={setPage} selectedId={app.ui().selectedGarmentId??undefined} onSelect={garment=>app.selectGarment(garment.id)}/></section>:section==='calendar'?<MirrorCalendar app={app} today="2026-10-09" onReuse={outfit=>{app.loadOutfitDraft(outfit.id);(window as any).clearPanelOpened=structuredClone(outfit);}} onBrowseOutfits={()=>setSection('home')}/>:<MirrorProfiles app={app} onSelectProfile={id=>{app.setActiveProfile(id);setSection('home');}} onAccount={()=>{}}/>}<output hidden data-profile-id={state.activeProfileId}/></div></PhotoWardrobeStage>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
