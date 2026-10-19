/* Framework-independent reference. No DB writes, fetching or AI calls here. */
(function(root, factory) {
  const api=factory(); if(typeof module==='object' && module.exports) module.exports=api;
  else root.FlatlayCore=api;
})(typeof window!=='undefined'?window:globalThis, function(){
  'use strict';
  const ORDER=['outer','top','dress','bottom','shoes','bag','hat','accessory'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  function assertItems(items, profileId){
    const seen=new Set(), slots=new Set();
    for(const i of items){
      if(!i || i.profileId!==profileId) throw new Error('PROFILE_MISMATCH');
      if(!['owned','external'].includes(i.kind)) throw new Error('INVALID_SOURCE');
      if(seen.has(i.id)||slots.has(i.slot)) throw new Error('DUPLICATE_ITEM_OR_SLOT');
      if(!ORDER.includes(i.slot)||!i.assetId) throw new Error('INVALID_ITEM');
      seen.add(i.id);slots.add(i.slot);
    }
    if(slots.has('dress')&&(slots.has('top')||slots.has('bottom'))) throw new Error('DRESS_SLOT_CONFLICT');
    return true;
  }
  function replaceSlot(items,item,profileId){
    if(item.profileId!==profileId) throw new Error('PROFILE_MISMATCH');
    let next=items.filter(i=>i.slot!==item.slot);
    if(item.slot==='dress') next=next.filter(i=>!['top','bottom'].includes(i.slot));
    if(['top','bottom'].includes(item.slot)) next=next.filter(i=>i.slot!=='dress');
    next.push(clone(item)); assertItems(next,profileId); return next;
  }
  function fit(asset,box,angle){
    if(!asset || !(asset.width>0) || !(asset.height>0)) throw new Error('ASSET_NOT_READY');
    const a=angle*Math.PI/180, ar=asset.width/asset.height;
    let h=Math.min(box[3],box[2]/ar), w=h*ar;
    const rw=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a));
    const rh=Math.abs(h*Math.cos(a))+Math.abs(w*Math.sin(a));
    const k=Math.min(1,box[2]/rw,box[3]/rh);w*=k;h*=k;
    return {x:box[0]+box[2]/2,y:box[1]+box[3]/2,width:w,height:h,rotation:angle};
  }
  function layout(items,assets,variant='natural'){
    if(!['natural','ordered'].includes(variant)) throw new Error('INVALID_LAYOUT');
    const outer=items.some(x=>x.slot==='outer'),dress=items.some(x=>x.slot==='dress');
    // Pixel design space 1080 x 1350; flatlay presentation, not real garment measurement.
    let boxes=outer?{
      outer:[70,105,470,840],top:[565,105,405,350],bottom:[655,505,280,650],
      shoes:[80,960,340,215],bag:[420,875,230,275],hat:[420,570,190,185],accessory:[430,550,160,260]
    }:{
      top:[95,125,530,525],bottom:[700,245,285,910],shoes:[80,890,355,270],
      bag:[415,695,245,350],hat:[705,55,240,180],accessory:[415,650,195,260]
    };
    if(dress)boxes={...boxes,dress:outer?[545,80,380,870]:[110,90,540,950],
      bag:[705,150,230,310],shoes:[710,850,275,300],hat:[705,510,230,205],accessory:[720,500,190,220]};
    if(items.length===1) boxes[items[0].slot]=[150,120,780,1020];
    const angles={top:-5,outer:-3,bottom:5,shoes:-12,bag:7,hat:-8,dress:-3,accessory:5};
    return items.slice().sort((a,b)=>ORDER.indexOf(a.slot)-ORDER.indexOf(b.slot)).map((item,z)=>{
      const box=boxes[item.slot]||[760,75,220,190];
      const p=fit(assets[item.assetId],box,variant==='ordered'?0:angles[item.slot]);
      return {itemId:item.id,assetId:item.assetId,assetVersion:item.assetVersion,slot:item.slot,kind:item.kind,z,
        x:p.x/1080,y:p.y/1350,width:p.width/1080,height:p.height/1350,rotation:p.rotation};
    });
  }
  function autoTitle(items){const hero=items.find(x=>x.slot==='outer')||items.find(x=>x.slot==='dress')||items.find(x=>x.slot==='top')||items[0];
    return hero?hero.name.replace(' · 구매 후보 예시','')+' 중심 코디':'새 코디';}
  function snapshot(draft,items,assets){
    assertItems(items,draft.profileId);if(items.length===0)throw new Error('EMPTY_OUTFIT');
    return {schemaVersion:1,profileId:draft.profileId,draftId:draft.id,revision:draft.revision,
      title:draft.title.trim()||autoTitle(items),titleSource:draft.title.trim()?'user':'items',
      layoutVersion:'flatlay-v1',layoutVariant:draft.variant,background:draft.background,
      sourceCardId:draft.sourceCardId||null,
      items:items.map(x=>({itemId:x.id,assetId:x.assetId,assetVersion:x.assetVersion,slot:x.slot,kind:x.kind,name:x.name})),
      layout:layout(items,assets,draft.variant),
      provenance:{input:'fictional_demo_existing_cutouts',render:'deterministic_composition',tryOn:'not_executed'},
      createsWearEvent:false,createsPlanEvent:false};
  }
  function makeApiContext(draft,items,catalog,profile){
    assertItems(items,profile.id);
    return {schemaVersion:1,profileId:profile.id,draftId:draft.id,revision:draft.revision,
      purpose:profile.purpose,weather:{state:'unavailable'},
      selected:items.map(i=>({id:i.id,slot:i.slot,kind:i.kind,assetId:i.assetId,assetVersion:i.assetVersion})),
      allowedCandidates:catalog.filter(i=>i.profileId===profile.id).map(i=>({id:i.id,name:i.name,slot:i.slot,kind:i.kind,colors:i.colors})),
      lockedSlots:[],permission:'demo context, not an execution approval',inputProvenance:'fictional_demo'};
  }
  return {clone,assertItems,replaceSlot,layout,snapshot,autoTitle,makeApiContext,ORDER};
});
