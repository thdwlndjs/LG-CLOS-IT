/** Pure card contracts. No fetch, provider calls, ownership updates or event writes. */
export const ORDER = Object.freeze(['outer','top','dress','bottom','shoes','bag','hat','accessory']);
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export function freeze(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
export function itemKey(item) { return JSON.stringify([item.kind, item.id ?? item.itemId]); }
export function assertItems(items, profileId) {
  if (!Array.isArray(items) || typeof profileId !== 'string' || !profileId) throw new Error('INVALID_PROFILE_OR_ITEMS');
  const keys=new Set(), slots=new Set();
  for (const i of items) {
    if (!i || i.profileId!==profileId) throw new Error('PROFILE_MISMATCH');
    if (!['owned','external'].includes(i.kind)) throw new Error('INVALID_SOURCE');
    if (typeof i.id!=='string' || !i.id || !ORDER.includes(i.slot) || typeof i.name!=='string' || !i.name.trim()) throw new Error('INVALID_ITEM');
    if (i.assetId!=null && (typeof i.assetId!=='string' || !i.assetId)) throw new Error('INVALID_ASSET_ID');
    const key=itemKey(i);
    if(keys.has(key)||slots.has(i.slot)) throw new Error('DUPLICATE_ITEM_OR_SLOT');
    keys.add(key); slots.add(i.slot);
  }
  if(slots.has('dress')&&(slots.has('top')||slots.has('bottom'))) throw new Error('DRESS_SLOT_CONFLICT');
  return true;
}
export function replaceSlot(items,item,profileId) {
  assertItems(items,profileId); assertItems([item],profileId);
  let next=items.filter(i=>i.slot!==item.slot);
  if(item.slot==='dress') next=next.filter(i=>!['top','bottom'].includes(i.slot));
  if(['top','bottom'].includes(item.slot)) next=next.filter(i=>i.slot!=='dress');
  next.push(clone(item)); assertItems(next,profileId); return next;
}
const sorted = items => [...items].sort((a,b)=>ORDER.indexOf(a.slot)-ORDER.indexOf(b.slot));
function bounds(asset) {
  if(!asset || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width<=0 || asset.height<=0) return null;
  let rect={x:0,y:0,width:asset.width,height:asset.height};
  const b=asset.alphaBounds;
  if(b) {
    rect=Array.isArray(b)?{x:b[0],y:b[1],width:b[2],height:b[3]}:{x:b.x,y:b.y,width:b.width,height:b.height};
    if(b.normalized) rect={x:rect.x*asset.width,y:rect.y*asset.height,width:rect.width*asset.width,height:rect.height*asset.height};
    if(Object.values(rect).some(v=>!Number.isFinite(v)) || rect.x<0 || rect.y<0 || rect.width<=0 || rect.height<=0 || rect.x+rect.width>asset.width || rect.y+rect.height>asset.height) throw new Error('INVALID_ALPHA_BOUNDS');
  }
  return rect;
}
function fit(rect,box,angle) {
  const ar=rect.width/rect.height, a=angle*Math.PI/180;
  let h=Math.min(box[3],box[2]/ar),w=h*ar;
  const rotatedW=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a));
  const rotatedH=Math.abs(h*Math.cos(a))+Math.abs(w*Math.sin(a));
  const scale=Math.min(1,box[2]/rotatedW,box[3]/rotatedH); w*=scale; h*=scale;
  return {x:(box[0]+box[2]/2)/1080,y:(box[1]+box[3]/2)/1350,width:w/1080,height:h/1350,rotation:angle};
}
export function layout(items,assets={},variant='natural') {
  if(!['natural','ordered'].includes(variant)) throw new Error('INVALID_LAYOUT');
  if(!items.length) return [];
  assertItems(items,items[0].profileId);
  const has=s=>items.some(i=>i.slot===s), outer=has('outer'),dress=has('dress');
  // Preserve the supplied prototype's asymmetric composition for ordinary cards.
  let boxes=outer?{
    outer:[70,105,470,840],top:[565,105,405,350],bottom:[655,505,280,650],
    shoes:[80,960,340,215],bag:[420,875,230,275],hat:[420,570,190,185],accessory:[430,550,160,260]
  }:{
    top:[95,125,530,525],bottom:[700,245,285,910],shoes:[80,890,355,270],
    bag:[415,695,245,350],hat:[705,55,240,180],accessory:[415,650,195,260]
  };
  if(dress)boxes={...boxes,dress:outer?[545,80,380,870]:[110,90,540,950],
    bag:[705,150,230,310],shoes:[710,850,275,300],hat:[705,510,230,205],accessory:[720,500,190,220]};
  // Without a hat, its upper-right area can hold an accessory instead of covering the bag.
  if(!outer&&!dress&&has('bag')&&has('accessory')&&!has('hat'))boxes.accessory=boxes.hat;
  const dense=items.length>6||(has('hat')&&has('accessory'));
  if(dense){
    const accessories=sorted(items).filter(i=>['shoes','bag','hat','accessory'].includes(i.slot));
    const mainHeight=790;
    boxes=outer?{
      outer:[55,90,395,mainHeight],top:[495,110,295,430],bottom:[830,110,195,mainHeight-10],dress:[520,100,480,mainHeight]
    }:{top:[95,130,495,560],bottom:[670,110,305,mainHeight],dress:[200,90,680,mainHeight]};
    const width=970/accessories.length;
    accessories.forEach((i,n)=>{boxes[i.slot]=[55+n*width,940,width-22,250];});
  }
  if(items.length===1)boxes[items[0].slot]=[150,120,780,1020];
  const angles={top:-5,outer:-3,bottom:5,shoes:-12,bag:7,hat:-8,dress:-3,accessory:5};
  return sorted(items).map((item,z)=>{
    const asset=assets[item.assetId], rect=bounds(asset), imageState=rect?'ready':'missing';
    const fallback={x:0,y:0,width:1,height:item.slot==='bottom'||item.slot==='dress'?2:1};
    return {itemKey:itemKey(item),itemId:item.id,assetId:item.assetId??null,assetVersion:item.assetVersion??asset?.version??null,slot:item.slot,kind:item.kind,z,imageState,
      sourceRect:rect,alphaBoundsApplied:Boolean(rect&&asset?.alphaBounds),...fit(rect||fallback,boxes[item.slot],variant==='ordered'?0:angles[item.slot])};
  });
}
export function autoTitle(items) {
  const hero=sorted(items).find(i=>['outer','dress','top'].includes(i.slot))||sorted(items)[0];
  return hero?`${hero.name.replace(' · 구매 후보 예시','')} 중심 코디`:'새 코디';
}
export function captureRevision(draft,generation=0) { return freeze({profileId:draft.profileId,draftId:draft.id,revision:draft.revision,generation}); }
export function isCurrentRevision(token,draft,generation=0) { return Boolean(token&&token.profileId===draft.profileId&&token.draftId===draft.id&&token.revision===draft.revision&&token.generation===generation); }
export function snapshot(draft,items,assets={}) {
  assertItems(items,draft.profileId); if(!items.length) throw new Error('EMPTY_OUTFIT');
  const title=typeof draft.title==='string'?draft.title.trim():'';
  const entries=sorted(items).map(i=>({itemKey:itemKey(i),itemId:i.id,profileId:i.profileId,kind:i.kind,slot:i.slot,name:i.name,sourceVersion:i.sourceVersion??i.version??null,assetId:i.assetId??null,assetVersion:i.assetVersion??assets[i.assetId]?.version??null}));
  // Stable serialized identity, deliberately not called a cryptographic hash.
  const compositionKey=JSON.stringify([draft.profileId,entries.map(i=>[i.kind,i.itemId,i.slot,i.sourceVersion,i.assetId,i.assetVersion])]);
  return freeze({schemaVersion:1,profileId:draft.profileId,draftId:draft.id,revision:draft.revision,title:title||autoTitle(items),titleSource:title?'user':'items',
    layoutVersion:'flatlay-integration-v1',layoutVariant:draft.variant||'natural',background:draft.background||'sand',sourceCardId:draft.sourceCardId||null,sourceCardVersion:draft.sourceCardVersion??null,
    compositionKey,items:entries,layout:layout(items,assets,draft.variant||'natural'),createsWearEvent:false,createsPlanEvent:false});
}
export function makeApiContext(draft,items,catalog,profile,{lockedSlots=[],generation=0}={}) {
  if(draft.profileId!==profile.id) throw new Error('PROFILE_MISMATCH'); assertItems(items,profile.id);
  for(const slot of lockedSlots) if(!ORDER.includes(slot)||!items.some(i=>i.slot===slot)) throw new Error('INVALID_LOCK');
  const entry=i=>({key:itemKey(i),id:i.id,slot:i.slot,kind:i.kind,assetId:i.assetId??null,assetVersion:i.assetVersion??null,colors:clone(i.colors||[])});
  return freeze({schemaVersion:1,profileId:profile.id,draftId:draft.id,revision:draft.revision,generation,purpose:profile.purpose??null,weather:{state:'unavailable'},
    selected:sorted(items).map(entry),allowedCandidates:catalog.filter(i=>i.profileId===profile.id).map(i=>({...entry(i),name:i.name})),lockedSlots:[...new Set(lockedSlots)],executionApproval:false});
}
/** Validate an adapter-normalized proposal; applying it remains an explicit host action. */
export function validateProposal(context,proposal,currentToken) {
  if(!currentToken||context.profileId!==currentToken.profileId||context.draftId!==currentToken.draftId||context.revision!==currentToken.revision||context.generation!==currentToken.generation) throw new Error('STALE_PROPOSAL');
  if(!proposal||proposal.profileId!==context.profileId||proposal.draftId!==context.draftId||proposal.revision!==context.revision||!Array.isArray(proposal.itemKeys)||!proposal.itemKeys.length) throw new Error('INVALID_PROPOSAL');
  const allowed=new Map(context.allowedCandidates.map(i=>[i.key,i])),seen=new Set(),slots=new Set(),result=[];
  for(const key of proposal.itemKeys) { const i=allowed.get(key); if(!i) throw new Error('UNKNOWN_CANDIDATE'); if(seen.has(key)||slots.has(i.slot)) throw new Error('DUPLICATE_ITEM_OR_SLOT'); seen.add(key);slots.add(i.slot);result.push(i); }
  if(slots.has('dress')&&(slots.has('top')||slots.has('bottom'))) throw new Error('DRESS_SLOT_CONFLICT');
  for(const slot of context.lockedSlots) { const selected=context.selected.find(i=>i.slot===slot); if(!selected||!seen.has(selected.key)) throw new Error('LOCK_CHANGED'); }
  return freeze(clone(result));
}
