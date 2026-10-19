/* Local, isolated functional wireframe. No outbound API calls or credentials. */
(()=>{'use strict';
 const D=window.FLATLAY_DATA,C=window.FlatlayCore,KEY='smartcloset.flatlay.lab.v1';
 const $=id=>document.getElementById(id), profiles=new Map(D.profiles.map(x=>[x.id,x])), catalog=new Map(D.items.map(x=>[x.id,x]));
 const labels={top:'상의',bottom:'하의',outer:'아우터',shoes:'신발',bag:'가방',hat:'모자',dress:'원피스',accessory:'액세서리'};
 const uuid=()=>globalThis.crypto?.randomUUID?.()||'local-'+Date.now()+'-'+Math.random().toString(16).slice(2);
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let damaged=false,storageAvailable=true,stored=null;
 try{const text=localStorage.getItem(KEY);if(text){stored=JSON.parse(text);if(stored.version!==1||!stored.drafts||!Array.isArray(stored.cards))throw new Error('bad state');}}
 catch(e){damaged=true;storageAvailable=false;}
 const state=stored||{version:1,activeProfile:D.profiles[0].id,drafts:{},cards:[],receipts:{}};
 if(!profiles.has(state.activeProfile))state.activeProfile=D.profiles[0].id;
 state.receipts ||= {};
 let view='studio',category='top',source='owned',renderSerial=0,pendingSave=false;
 const imageCache=new Map();
 function image(assetId){if(imageCache.has(assetId))return imageCache.get(assetId);const a=D.assets[assetId];
   const p=new Promise((resolve,reject)=>{if(!a)return reject(new Error('ASSET_MISSING'));const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('IMAGE_LOAD_FAILED'));i.src=a.path;}); imageCache.set(assetId,p);return p;}
 function feedback(message){$('feedback').textContent=message;}
 function persist(){if(!storageAvailable)return false;try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch(e){storageAvailable=false;feedback('브라우저 저장 공간을 사용할 수 없어요. 현재 카드를 PNG로 보관해 주세요.');return false;}}
 function makeDraft(p,items=null){return {id:uuid(),profileId:p.id,revision:0,title:'',variant:'natural',background:'sand',sourceCardId:null,
   itemIds:items||p.defaultCatalogIds.map(code=>D.items.find(x=>x.profileId===p.id&&x.originalCatalogId===code&&x.kind==='owned')?.id).filter(Boolean)};}
 function draft(){const p=profiles.get(state.activeProfile);if(!state.drafts[p.id])state.drafts[p.id]=makeDraft(p);return state.drafts[p.id];}
 function selected(d=draft()){const all=d.itemIds.map(id=>catalog.get(id));if(all.some(x=>!x))throw new Error('기존 카드의 일부 의류를 찾을 수 없어요. 원본은 보존됩니다.');C.assertItems(all,d.profileId);return all;}
 function mutation(fn){const d=draft();fn(d);d.revision++;persist();feedback('');render();}
 function save(){if(pendingSave)return;pendingSave=true;try{const d=draft(),items=selected(),key=`${d.profileId}|save-card|${d.id}|${d.revision}`;
   if(state.receipts[key]){feedback('이 조합은 이미 내 코디에 저장했어요.');return;}
   const snap=C.snapshot(d,items,D.assets);
   const sourceCard=state.cards.find(c=>c.id===d.sourceCardId&&c.profileId===d.profileId);
   const contentKey=s=>JSON.stringify({title:s.title,background:s.background,variant:s.layoutVariant,items:s.items.map(i=>[i.itemId,i.assetId,i.assetVersion,i.slot,i.kind]).sort((a,b)=>a[3].localeCompare(b[3]))});
   if(sourceCard&&contentKey(sourceCard)===contentKey(snap)){feedback('변경 없는 원본 코디가 이미 보관되어 있어요. 새 카드를 중복 생성하지 않았어요.');return;}
   const card={id:uuid(),createdAt:new Date().toISOString(),...snap};
   state.cards.push(card);state.receipts[key]=card.id;
   if(!persist()){state.cards.pop();delete state.receipts[key];feedback('저장이 완료되지 않았어요. PNG 내보내기로 보관할 수 있어요.');return;}
   updateHeader();feedback('내 코디에 저장했어요. 현재 조합은 계속 바꿔볼 수 있어요.');
 }catch(e){feedback(e.message==='EMPTY_OUTFIT'?'옷을 한 벌 이상 골라 주세요.':e.message);}finally{pendingSave=false;}}
 function choose(itemId){const item=catalog.get(itemId);if(!item)return;try{const all=selected();if(all.some(x=>x.id===itemId))return;
   mutation(d=>{d.itemIds=C.replaceSlot(all,item,state.activeProfile).map(x=>x.id);});}catch(e){feedback(e.message);}}
 function switchProfile(id){if(!profiles.has(id))return;persist();state.activeProfile=id;view='studio';source='owned';category='top';draft();persist();$('profile-dialog').close();feedback('');render();}
 function reuse(cardId){const card=state.cards.find(x=>x.id===cardId&&x.profileId===state.activeProfile);if(!card)return;
   const d=makeDraft(profiles.get(state.activeProfile),card.items.map(x=>x.itemId));d.title=card.titleSource==='user'?card.title:'';d.variant=card.layoutVariant;d.background=card.background;d.sourceCardId=card.id;
   state.drafts[state.activeProfile]=d;source='owned';category='top';view='studio';persist();render();feedback('원본 카드는 보존하고 새 초안에서 열었어요.');}
 function updateHeader(){const p=profiles.get(state.activeProfile);$('profile-label').textContent='마이 · '+p.name;$('profile-avatar').textContent=p.initials;
   $('saved-count').textContent=state.cards.filter(x=>x.profileId===p.id).length;$('closet-label').textContent=p.name+'의 옷';
   $('owned-count').textContent=D.items.filter(x=>x.profileId===p.id&&x.kind==='owned').length;
   $('studio-tab').classList.toggle('active',view==='studio');$('saved-tab').classList.toggle('active',view==='saved');
   $('page-title').textContent=view==='studio'?'오늘의 조합을, 한 장으로.':p.name+'의 선택이 남아 있는 곳.';}
 function textLines(ctx,text,x,y,maxWidth,lineHeight){let lines=[],line='';for(const ch of text){if(ctx.measureText(line+ch).width>maxWidth&&line){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);lines.slice(0,2).forEach((s,i)=>ctx.fillText(s,x,y+i*lineHeight));}
 async function draw(canvas,snap,guard=()=>true){const loaded=await Promise.all(snap.layout.map(l=>image(l.assetId).then(img=>({img,l}))));if(!guard())return false;
   const work=document.createElement('canvas');work.width=1080;work.height=1350;const ctx=work.getContext('2d');
   if(snap.background!=='transparent'){ctx.fillStyle=snap.background==='mist'?'#e7e9e5':'#ece6dc';ctx.fillRect(0,0,1080,1350);
     // Soft deterministic paper lighting; never redraw the clothing pixels.
     const g=ctx.createLinearGradient(0,0,1080,1350);g.addColorStop(0,'rgba(255,255,255,.35)');g.addColorStop(1,'rgba(118,114,96,.055)');ctx.fillStyle=g;ctx.fillRect(0,0,1080,1350);}
   for(const {img,l}of loaded){ctx.save();ctx.translate(l.x*1080,l.y*1350);ctx.rotate(l.rotation*Math.PI/180);ctx.shadowColor='rgba(35,31,27,0.12)';ctx.shadowBlur=16;ctx.shadowOffsetX=4;ctx.shadowOffsetY=9;ctx.drawImage(img,-l.width*1080/2,-l.height*1350/2,l.width*1080,l.height*1350);ctx.restore();}
   ctx.fillStyle='#364139';ctx.font='500 13px sans-serif';ctx.fillText('C L O S E T   /   O U T F I T',74,51);
   ctx.strokeStyle='rgba(48,62,49,.18)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(74,1200);ctx.lineTo(1006,1200);ctx.stroke();
   ctx.font='500 28px "Noto Sans CJK KR", "Malgun Gothic", sans-serif';textLines(ctx,snap.title,74,1250,930,36);
   const owned=snap.items.filter(x=>x.kind==='owned').length, external=snap.items.length-owned;
   ctx.font='400 16px "Noto Sans CJK KR", "Malgun Gothic", sans-serif';ctx.fillStyle='#61685e';ctx.fillText(`내 옷 ${owned}${external?'  ·  구매 후보 '+external:''}  /  구성형 코디카드`,74,1320);
   const out=canvas.getContext('2d');out.clearRect(0,0,1080,1350);out.drawImage(work,0,0);return true;
 }
 function drawEmpty(canvas){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1080,1350);ctx.fillStyle='#ece6dc';ctx.fillRect(0,0,1080,1350);ctx.fillStyle='#626a60';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText('오른쪽에서 옷을 골라 주세요',540,650);ctx.textAlign='left';}
 async function renderStage(){const token=++renderSerial;const d=draft();let items;try{items=selected();}catch(e){feedback(e.message);return;}
   if(!items.length){drawEmpty($('card-canvas'));return;}
   try{await draw($('card-canvas'),C.snapshot(d,items,D.assets),()=>token===renderSerial);}catch(e){if(token===renderSerial)feedback('의류 이미지를 읽지 못했어요. 선택은 보존되며 다른 옷으로 대체하지 않아요.');}}
 function renderEditor(){const d=draft(),items=selected();$('card-title').value=d.title;$('card-title').placeholder=C.autoTitle(items);
   const available=D.items.filter(i=>i.profileId===state.activeProfile&&i.kind===source),slots=['top','bottom','outer','dress','shoes','bag','hat'].filter(s=>available.some(i=>i.slot===s));
   if(!slots.includes(category))category=slots[0]||'outer';
   $('slots').innerHTML=slots.map(s=>`<button data-slot="${s}" class="${s===category?'selected':''}" aria-pressed="${s===category}">${labels[s]}<span class="count">${available.filter(i=>i.slot===s).length}</span></button>`).join('');
   document.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>{category=b.dataset.slot;renderEditor();});
   const candidates=available.filter(i=>i.slot===category);$('candidate-caption').textContent=source==='external'?'외부 상품 선택 구조를 확인하는 예시입니다. 실제 수집 상품은 아니에요.':`${labels[category]||'의류'} ${candidates.length}벌 · 누르면 해당 품목만 바뀌어요`;
   $('item-grid').innerHTML=candidates.length?candidates.map(i=>`<button class="item ${d.itemIds.includes(i.id)?'selected':''}" data-item="${i.id}" title="${escape(i.name)}" aria-label="${escape(i.name)} 선택" aria-pressed="${d.itemIds.includes(i.id)}"><img src="${D.assets[i.assetId].path}" alt="${escape(i.name)}" draggable="false"><span class="name">${escape(i.name.replace(' · 구매 후보 예시',''))}</span>${d.itemIds.includes(i.id)?'<span class="tick" aria-hidden="true">✓</span>':''}</button>`).join(''):'<p class="empty">이 분류에는 아직 옷이 없어요. 다른 분류를 선택해 주세요.</p>';
   document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>choose(b.dataset.item));
   $('current-items').innerHTML=items.map(i=>`<button data-remove="${i.id}" aria-label="${escape(i.name)} 빼기">${escape(i.name.replace(' · 구매 후보 예시',''))}${i.kind==='external'?' · 구매 후보':''} ×</button>`).join('');
   document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>mutation(d=>{d.itemIds=d.itemIds.filter(x=>x!==b.dataset.remove);}));
   document.querySelectorAll('[data-source]').forEach(b=>b.classList.toggle('selected',b.dataset.source===source));
   document.querySelectorAll('[data-variant]').forEach(b=>b.classList.toggle('selected',b.dataset.variant===d.variant));
   document.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('selected',b.dataset.bg===d.background));
 }
 async function renderSaved(){const cards=state.cards.filter(c=>c.profileId===state.activeProfile),p=state.activeProfile;
   $('saved-grid').innerHTML=cards.length?cards.slice().reverse().map(c=>`<button class="saved-item" data-card="${c.id}"><canvas id="saved-${c.id}" width="1080" height="1350" aria-label="${escape(c.title)}"></canvas><h3>${escape(c.title)}</h3><p>${c.items.length}개 품목 · 새 초안으로 다시 사용</p></button>`).join(''):'<p class="empty">아직 저장한 코디가 없어요.<br>카드 만들기에서 마음에 드는 조합을 저장해 보세요.</p>';
   document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>reuse(b.dataset.card));
   await Promise.all(cards.map(c=>draw($('saved-'+c.id),c,()=>view==='saved'&&state.activeProfile===p).catch(()=>{})));
 }
 function render(){updateHeader();$('studio-view').hidden=view!=='studio';$('saved-view').hidden=view!=='saved';if(view==='studio'){renderEditor();renderStage();}else renderSaved();}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 $('card-title').oninput=e=>{const d=draft();d.title=e.target.value;d.revision++;persist();feedback('');renderStage();};
 $('save-card').onclick=save;
 $('export-card').onclick=async()=>{try{const snap=C.snapshot(draft(),selected(),D.assets);const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;await draw(canvas,snap);canvas.toBlob(blob=>{if(!blob)return feedback('PNG를 만들지 못했어요.');download(blob,'코디카드_'+profiles.get(state.activeProfile).name+'.png');feedback('PNG를 내보냈어요. 내 코디 저장과는 별도예요.');},'image/png');}catch(e){feedback('의류를 선택한 뒤 다시 시도해 주세요.');}};
 $('download-context').onclick=()=>{const d=draft(),context={outfit:C.snapshot(d,selected(),D.assets),recommendationInput:C.makeApiContext(d,selected(),D.items,profiles.get(state.activeProfile))};download(new Blob([JSON.stringify(context,null,2)],{type:'application/json'}),'flatlay-current-context.json');};
 $('studio-tab').onclick=()=>{view='studio';render();};$('saved-tab').onclick=()=>{view='saved';render();};
 $('profile-trigger').onclick=()=>{$('profile-dialog').showModal();};$('close-profile').onclick=()=>{$('profile-dialog').close();};
 $('profile-options').innerHTML=D.profiles.map(p=>`<button class="profile-option" data-profile="${p.id}"><span class="avatar">${p.initials}</span><strong>${p.name}</strong><small>${p.purpose}</small></button>`).join('');
 document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>switchProfile(b.dataset.profile));
 document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;renderEditor();});
 document.querySelectorAll('[data-variant]').forEach(b=>b.onclick=()=>mutation(d=>{d.variant=b.dataset.variant;}));
 document.querySelectorAll('[data-bg]').forEach(b=>b.onclick=()=>mutation(d=>{d.background=b.dataset.bg;}));
 draft();persist();render();if(damaged)feedback('기존 시안 저장값을 읽지 못했어요. 원본을 덮어쓰지 않고 임시로 열었어요.');
 window.__flatlay={getState:()=>C.clone(state),getSnapshot:()=>C.snapshot(draft(),selected(),D.assets),choose,switchProfile,save,reuse,
   ready:()=>Promise.all(Object.keys(D.assets).map(id=>image(id))),storageKey:KEY};
})();
