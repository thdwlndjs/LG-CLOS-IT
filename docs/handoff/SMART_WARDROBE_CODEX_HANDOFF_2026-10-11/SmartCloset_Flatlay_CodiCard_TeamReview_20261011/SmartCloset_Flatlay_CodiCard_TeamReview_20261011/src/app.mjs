import {LocalSession} from './local-session.mjs';
import {itemKey,snapshot,autoTitle,makeApiContext} from './card-core.mjs';
import {renderCard,exportCard} from './card-renderer.mjs';
const data=await (await fetch('/reference/prototype/data/demo-pack.json')).json();
for(const asset of Object.values(data.assets))asset.path='/reference/prototype/'+asset.path;
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={top:'상의',bottom:'하의',outer:'아우터',dress:'원피스',shoes:'신발',bag:'가방',hat:'모자',accessory:'액세서리'};
let session;try{session=new LocalSession({data,storage:localStorage});}catch(e){$('feedback').textContent='저장 자료를 열지 못했어요. 원본은 보존됩니다. '+e.message;throw e;}
let view='studio',source='owned',category='top',epoch=0;
const feedback=t=>{$('feedback').textContent=t;};
const active=()=>data.profiles.find(p=>p.id===session.draft().profileId);
const run=fn=>{try{fn();feedback('');render();return true;}catch(e){feedback('처리하지 못했어요: '+e.message);return false;}};
const selected=()=>session.selected();
function choose(key){run(()=>session.choose(key));}
function render(){
 const p=active(),d=session.draft(),items=selected(),stamp=++epoch;
 $('profile-trigger').textContent='마이 · '+p.name;$('closet-label').textContent=p.name+'의 조합';$('profile-note').textContent='가상 시연 프로필 · 저장은 이 브라우저에만 남아요';
 $('saved-count').textContent=session.cards().length;$('studio-view').hidden=view!=='studio';$('saved-view').hidden=view!=='saved';
 $('studio-tab').setAttribute('aria-pressed',view==='studio');$('saved-tab').setAttribute('aria-pressed',view==='saved');
 if(view==='saved'){renderSaved(stamp);return;}
 $('card-title').value=d.title;$('card-title').placeholder=autoTitle(items);
 const available=data.items.filter(i=>i.profileId===p.id&&i.kind===source);
 const slots=Object.keys(labels).filter(s=>available.some(i=>i.slot===s));if(!slots.includes(category))category=slots[0];
 $('slots').innerHTML=slots.map(s=>`<button data-slot="${s}" aria-pressed="${s===category}">${labels[s]}</button>`).join('');
 $('slots').querySelectorAll('button').forEach(b=>b.onclick=()=>{category=b.dataset.slot;render();});
 $('candidate-caption').textContent=source==='external'?'실제 수집·소유가 아닌 외부 후보 예시예요.':'누르면 해당 품목만 바뀌고 나머지는 유지돼요.';
 $('item-grid').innerHTML=available.filter(i=>i.slot===category).map(i=>{const a=data.assets[i.assetId],picked=items.some(x=>itemKey(x)===itemKey(i));return `<button class="item" data-key="${esc(itemKey(i))}" data-id="${esc(i.id)}" aria-label="${esc(i.name)} 선택" aria-pressed="${picked}">${a?`<img src="${esc(a.path)}" alt="${esc(i.name)}" draggable="false">`:'<span class="missing">사진 없음</span>'}<span>${esc(i.name)}</span>${picked?'<span class="tick" aria-hidden="true">✓</span>':''}</button>`;}).join('');
 $('item-grid').querySelectorAll('button').forEach(b=>b.onclick=()=>choose(b.dataset.key));
 $('current-items').innerHTML=items.length?items.map(i=>`<button data-key="${esc(itemKey(i))}" aria-label="${esc(i.name)} 빼기">${esc(i.name)}${i.kind==='external'?' · 외부 후보':''} ×</button>`).join(''):'<p class="note">아직 선택한 품목이 없어요.</p>';
 $('current-items').querySelectorAll('button').forEach(b=>b.onclick=()=>run(()=>session.remove(b.dataset.key)));
 document.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.source===source));
 document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===d.variant));
 $('transparent').setAttribute('aria-pressed',d.background==='transparent');
 if(!items.length){const ctx=$('card-canvas').getContext('2d');ctx.clearRect(0,0,1080,1350);ctx.fillStyle='#eae8df';ctx.fillRect(0,0,1080,1350);ctx.fillStyle='#374c3f';ctx.font='30px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillText('옷을 고르면 카드가 구성돼요',540,650);ctx.textAlign='left';return;}
 renderCard($('card-canvas'),snapshot(d,items,data.assets),data.assets,{isCurrent:()=>stamp===epoch,onDiagnostics:diagnostics=>{if(stamp===epoch&&diagnostics.length)feedback('일부 사진을 표시하지 못했어요. 선택은 보존됩니다.');}}).catch(e=>{if(stamp===epoch)feedback('카드 표시 오류: '+e.message);});
}
function renderSaved(stamp){
 const cards=session.cards();$('saved-grid').innerHTML=cards.length?cards.map(c=>`<button class="saved-card" data-card="${esc(c.id)}"><canvas width="1080" height="1350" aria-label="${esc(c.title)}"></canvas><h2>${esc(c.title)}</h2><p>${c.items.length}개 품목 · 새 초안으로 사용</p></button>`).join(''):'<p>저장한 카드가 없어요.</p>';
 $('saved-grid').querySelectorAll('button').forEach(b=>{const c=cards.find(c=>c.id===b.dataset.card);renderCard(b.querySelector('canvas'),c,data.assets,{isCurrent:()=>stamp===epoch}).catch(()=>{b.querySelector('p').textContent='사진 표시 실패 · 저장 조합은 보존';});b.onclick=()=>{if(run(()=>{session.reuse(c.id);view='studio';source='owned';category='top';}))feedback('원본을 보존한 새 초안이에요.');};});
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
$('studio-tab').onclick=()=>{view='studio';render();};$('saved-tab').onclick=()=>{view='saved';render();};
$('profile-trigger').onclick=()=>$('profile-dialog').showModal();$('close-profile').onclick=()=>$('profile-dialog').close();
$('profile-options').innerHTML=data.profiles.map(p=>`<button data-profile="${esc(p.id)}">${esc(p.name)}</button>`).join('');
$('profile-options').querySelectorAll('button').forEach(b=>b.onclick=()=>{run(()=>{session.switchProfile(b.dataset.profile);view='studio';source='owned';category='top';});$('profile-dialog').close();});
$('card-title').onchange=e=>run(()=>session.update({title:e.target.value}));
$('save-card').onclick=()=>{try{const result=session.save();render();feedback(result.created?'카드를 저장했어요.':'같은 카드가 이미 저장되어 있어요.');}catch(e){feedback(e.message==='EMPTY_OUTFIT'?'옷을 한 벌 이상 골라 주세요.':'저장 실패: '+e.message);}};
$('export-card').onclick=async()=>{const token=epoch;try{const snap=snapshot(session.draft(),selected(),data.assets);const result=await exportCard(snap,data.assets);download(result.blob,'flatlay-card.png');if(token===epoch)feedback('PNG를 내보냈어요. 카드 저장과는 별도예요.');}catch(e){if(token===epoch)feedback('PNG 내보내기 실패: '+e.message+' · 저장 카드는 보존됩니다.');}};
$('download-context').onclick=()=>{try{const d=session.draft();download(new Blob([JSON.stringify({scope:'fictional_local_demo_not_team_binding',outfit:snapshot(d,selected(),data.assets),recommendationInput:makeApiContext(d,selected(),data.items,active())},null,2)],{type:'application/json'}),'flatlay-context.json');}catch(e){feedback(e.message);}};
$('transparent').onclick=()=>run(()=>session.update({background:session.draft().background==='transparent'?'sand':'transparent'}));
document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;render();});
document.querySelectorAll('[data-variant]').forEach(b=>b.onclick=()=>run(()=>session.update({variant:b.dataset.variant})));
render();
// Read-only diagnostic snapshot; browser tests still use real click controls and native storage.
window.flatlayDiagnostics=()=>({scope:'fictional_local_demo',state:session.getState(),draft:session.draft(),cards:session.cards(),selected:session.selected(),snapshot:selected().length?snapshot(session.draft(),selected(),data.assets):null});
