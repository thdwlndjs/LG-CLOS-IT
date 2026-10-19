import {clone,freeze,itemKey,assertItems,replaceSlot,snapshot,captureRevision,isCurrentRevision} from './card-core.mjs';
const uid=()=>globalThis.crypto?.randomUUID?.()||`local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const contentKey=card=>JSON.stringify([card.compositionKey,card.title,card.titleSource,card.layoutVariant,card.background,card.layoutVersion]);
/** Isolated browser storage, never a remote authorization or real-wear record. */
export class LocalSession {
  #data; #storage; #key; #state; #raw;
  constructor({data,storage,key='smartcloset.flatlay.integration.v1'}) {
    if(!data||!Array.isArray(data.profiles)||!data.profiles.length||!Array.isArray(data.items)||!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function') throw new Error('INVALID_SESSION_CONFIG');
    this.#data=freeze(clone(data));this.#storage=storage;this.#key=key;
    const profiles=new Set();for(const p of data.profiles){if(!p.id||profiles.has(p.id))throw new Error('INVALID_PROFILES');profiles.add(p.id);}
    const catalog=new Set();for(const i of data.items){assertItems([i],i.profileId);if(!profiles.has(i.profileId))throw new Error('PROFILE_MISMATCH');const identity=JSON.stringify([i.profileId,itemKey(i)]);if(catalog.has(identity))throw new Error('DUPLICATE_CATALOG_IDENTITY');catalog.add(identity);}
    try {this.#raw=storage.getItem(key);} catch {throw new Error('로컬 저장소를 읽을 수 없습니다. 저장을 진행하지 않았습니다.');}
    if(this.#raw!==null) {
      try {this.#state=JSON.parse(this.#raw);this.#validate(this.#state);} catch {throw new Error('기존 로컬 저장 내용이 손상되었거나 현재 자료와 맞지 않습니다. 원문을 보존하고 저장을 중단했습니다.');}
    } else { const p=data.profiles[0].id;this.#state={version:1,activeProfile:p,generation:0,sequence:0,drafts:{[p]:this.#newDraft(p)},cards:[]}; }
  }
  #newDraft(profileId) {return {id:uid(),profileId,revision:0,title:'',variant:'natural',background:'sand',sourceCardId:null,sourceCardVersion:null,itemKeys:[]};}
  #validate(state) {
    if(!state||state.version!==1||!this.#data.profiles.some(p=>p.id===state.activeProfile)||!Number.isSafeInteger(state.generation)||state.generation<0||!Number.isSafeInteger(state.sequence)||state.sequence<0||!state.drafts||!Array.isArray(state.cards))throw new Error('INVALID_STATE');
    if(!state.drafts[state.activeProfile])throw new Error('MISSING_DRAFT');
    for(const [profileId,d] of Object.entries(state.drafts)){
      if(!this.#data.profiles.some(p=>p.id===profileId)||!d||d.profileId!==profileId||typeof d.id!=='string'||!d.id||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.title!=='string'||!['natural','ordered'].includes(d.variant)||!['sand','mist','transparent'].includes(d.background)||!Array.isArray(d.itemKeys))throw new Error('INVALID_DRAFT');
      this.#selected(d);
    }
    const ids=new Set();for(const c of state.cards){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||!this.#data.profiles.some(p=>p.id===c.profileId)||!Array.isArray(c.items)||!c.items.length||!Array.isArray(c.layout)||c.layout.length!==c.items.length||typeof c.compositionKey!=='string'||typeof c.title!=='string'||!['user','items'].includes(c.titleSource))throw new Error('INVALID_CARD');
      assertItems(c.items.map(i=>({...i,id:i.itemId})),c.profileId);
      const keys=new Set(c.items.map(i=>itemKey({...i,id:i.itemId}))),depths=new Set();
      for(const l of c.layout){
        const item=c.items.find(i=>i.itemKey===l?.itemKey);
        if(!l||!item||item.itemKey!==itemKey({...item,id:item.itemId})||!keys.delete(l.itemKey)||l.itemId!==item.itemId||l.kind!==item.kind||l.slot!==item.slot||l.assetId!==item.assetId||l.assetVersion!==item.assetVersion)throw new Error('INVALID_CARD_LAYOUT');
        if(![l.x,l.y,l.width,l.height,l.rotation,l.z].every(Number.isFinite)||l.x<0||l.x>1||l.y<0||l.y>1||l.width<=0||l.width>1||l.height<=0||l.height>1||Math.abs(l.rotation)>180||!Number.isSafeInteger(l.z)||l.z<0||depths.has(l.z))throw new Error('INVALID_LAYOUT_GEOMETRY');
        depths.add(l.z);
        const a=l.rotation*Math.PI/180,w=l.width*1080,h=l.height*1350,rotatedW=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a)),rotatedH=Math.abs(h*Math.cos(a))+Math.abs(w*Math.sin(a));
        if(l.x*1080-rotatedW/2 < -1e-7||l.x*1080+rotatedW/2>1080+1e-7||l.y*1350-rotatedH/2 < -1e-7||l.y*1350+rotatedH/2>1350+1e-7)throw new Error('LAYOUT_OUT_OF_BOUNDS');
        if(!['ready','missing'].includes(l.imageState))throw new Error('INVALID_IMAGE_STATE');
        if(l.sourceRect!==null){
          const r=l.sourceRect;if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||!Number.isFinite(r.x+r.width)||!Number.isFinite(r.y+r.height))throw new Error('INVALID_SOURCE_RECT');
          const asset=this.#data.assets?.[l.assetId];if(asset&&Number.isFinite(asset.width)&&Number.isFinite(asset.height)&&(r.x+r.width>asset.width||r.y+r.height>asset.height))throw new Error('SOURCE_RECT_OUT_OF_BOUNDS');
        } else if(l.imageState==='ready')throw new Error('MISSING_SOURCE_RECT');
      }
      if(keys.size)throw new Error('INVALID_CARD_LAYOUT');
      ids.add(c.id);
    }
  }
  #selected(draft) {
    const items=draft.itemKeys.map(key=>this.#data.items.find(i=>i.profileId===draft.profileId&&itemKey(i)===key));
    if(items.some(i=>!i))throw new Error('기존 초안의 의류를 현재 목록에서 찾을 수 없습니다. 원본은 보존됩니다.');
    assertItems(items,draft.profileId);return items;
  }
  #change(action) {
    let actual;try{actual=this.#storage.getItem(this.#key);}catch{throw new Error('로컬 저장소 확인에 실패했습니다. 변경하지 않았습니다.');}
    if(actual!==this.#raw)throw new Error('다른 탭에서 내용이 바뀌었습니다. 새로고침 후 다시 시도해 주세요. 현재 탭은 덮어쓰지 않았습니다.');
    const next=clone(this.#state),result=action(next);
    if(result?.unchanged)return freeze(clone(result.value));
    next.sequence++;this.#validate(next);const serialized=JSON.stringify(next);
    try{this.#storage.setItem(this.#key,serialized);}catch{throw new Error('로컬 저장 공간에 기록하지 못했습니다. 변경 전 상태를 유지합니다.');}
    this.#state=next;this.#raw=serialized;return freeze(clone(result));
  }
  getState(){return freeze(clone(this.#state));}
  draft(){return freeze(clone(this.#state.drafts[this.#state.activeProfile]));}
  selected(){return freeze(clone(this.#selected(this.#state.drafts[this.#state.activeProfile])));}
  cards(){return freeze(clone(this.#state.cards.filter(c=>c.profileId===this.#state.activeProfile)));}
  revisionToken(){return captureRevision(this.draft(),this.#state.generation);}
  accepts(token){return isCurrentRevision(token,this.draft(),this.#state.generation);}
  choose(key){return this.#change(state=>{
    const d=state.drafts[state.activeProfile],item=this.#data.items.find(i=>i.profileId===state.activeProfile&&itemKey(i)===key);if(!item)throw new Error('현재 프로필에 허용되지 않은 의류입니다.');
    if(d.itemKeys.includes(key))return {unchanged:true,value:d};
    d.itemKeys=replaceSlot(this.#selected(d),item,d.profileId).map(itemKey);d.revision++;return d;
  });}
  remove(key){return this.#change(state=>{const d=state.drafts[state.activeProfile];if(!d.itemKeys.includes(key))return {unchanged:true,value:d};d.itemKeys=d.itemKeys.filter(k=>k!==key);d.revision++;return d;});}
  update(patch){
    if(!patch||Object.keys(patch).some(k=>!['title','variant','background'].includes(k))||('title'in patch&&typeof patch.title!=='string')||('variant'in patch&&!['natural','ordered'].includes(patch.variant))||('background'in patch&&!['sand','mist','transparent'].includes(patch.background)))throw new Error('INVALID_DRAFT_UPDATE');
    return this.#change(state=>{const d=state.drafts[state.activeProfile];if(Object.entries(patch).every(([k,v])=>d[k]===v))return {unchanged:true,value:d};Object.assign(d,clone(patch));d.revision++;return d;});
  }
  switchProfile(id){return this.#change(state=>{
    if(!this.#data.profiles.some(p=>p.id===id))throw new Error('PROFILE_MISMATCH');
    if(state.activeProfile===id)return {unchanged:true,value:state.drafts[id]};
    state.activeProfile=id;state.generation++;state.drafts[id]??=this.#newDraft(id);return state.drafts[id];
  });}
  save(){return this.#change(state=>{
    const d=state.drafts[state.activeProfile],snap=snapshot(d,this.#selected(d),this.#data.assets||{}),key=contentKey(snap);
    const existing=state.cards.find(c=>c.profileId===d.profileId&&contentKey(c)===key);
    if(existing)return {unchanged:true,value:{card:existing,created:false}};
    const card={id:uid(),version:1,createdAt:new Date().toISOString(),storageScope:'local_browser',...clone(snap)};
    state.cards.push(card);return {card,created:true};
  });}
  reuse(cardId){return this.#change(state=>{
    const card=state.cards.find(c=>c.id===cardId&&c.profileId===state.activeProfile);if(!card)throw new Error('현재 프로필의 저장 카드가 아닙니다.');
    const d=this.#newDraft(state.activeProfile);Object.assign(d,{itemKeys:card.items.map(i=>i.itemKey),title:card.titleSource==='user'?card.title:'',variant:card.layoutVariant,background:card.background,sourceCardId:card.id,sourceCardVersion:card.version});
    // A shared image is not proof of unchanged clothing. Compare the saved source
    // contract too; an unversioned catalog rename must not rewrite an auto title.
    const current=this.#selected(d);
    for(const item of current){
      const prior=card.items.find(i=>i.itemKey===itemKey(item));
      if(!prior||prior.itemId!==item.id||prior.kind!==item.kind||prior.profileId!==item.profileId||prior.slot!==item.slot||prior.sourceVersion!==(item.sourceVersion??item.version??null)||prior.name!==item.name)
        throw new Error('원본 카드의 의류 정보가 현재 목록과 다릅니다. 원본 카드와 기존 초안은 보존됩니다.');
      if(prior.assetId!==(item.assetId??null)||prior.assetVersion!==(item.assetVersion??this.#data.assets?.[item.assetId]?.version??null))
        throw new Error('원본 카드의 자산 버전을 현재 목록에서 찾을 수 없습니다. 원본 카드와 기존 초안은 보존됩니다.');
    }
    state.drafts[state.activeProfile]=d;state.generation++;return d;
  });}
}
