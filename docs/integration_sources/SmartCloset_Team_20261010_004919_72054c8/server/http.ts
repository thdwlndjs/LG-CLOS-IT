import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {AppError,integer,only,record,text,uuid} from './errors';
import {publicConfig,type ServerConfig,type AiMode} from './config';
import {BrowserSessions,SupabaseGateway,type FetchPort,type UserContext} from './supabase';
import {DatabaseRepository} from './repository';
import {readCareEvidence} from './careEvidence';
import {AiService,type AiRequest} from './ai';
import {availabilityInput} from './availability';
import {eventInput,garmentFrom,outfitInput,registrationInput,randomUUID} from './domain';
import type {ProviderFetch} from './providers';
const safeMethods=new Set(['GET','HEAD']);
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
async function body(req:IncomingMessage,max=65536){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>max)throw new AppError('invalid_input',413);chunks.push(b);}return Buffer.concat(chunks);}
async function payload(req:IncomingMessage){if(!(req.headers['content-type']??'').startsWith('application/json'))throw new AppError('invalid_input',415);let parsed;try{parsed=JSON.parse((await body(req)).toString('utf8'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('invalid_input');}return record(parsed);}
function sessionId(req:IncomingMessage){const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sc_session='));const id=cookie?.slice(11)??'';return/^[A-Za-z0-9_-]{43}$/.test(id)?id:'';}
const sessionCookie=(id='',maxAge=0)=>`sc_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${Math.floor(maxAge)}`;
function mode(v:unknown,config:ServerConfig):AiMode{if(v===undefined)return config.aiMode;if(!['mock','saved_result','live'].includes(String(v)))throw new AppError('invalid_input');return v as AiMode;}
export function createApiServer(config:ServerConfig,deps:{databaseFetch?:FetchPort;providerFetch?:ProviderFetch}={}){
 const gateway=new SupabaseGateway(config,deps.databaseFetch),sessions=new BrowserSessions(gateway);const buckets=new Map<string,{start:number,count:number}>();
 return createServer(async(req,res)=>{
  try{
   res.setHeader('Referrer-Policy','no-referrer');const url=new URL(req.url??'/',config.origin);const method=req.method??'GET',path=url.pathname;
   if(url.origin!==config.origin||!path.startsWith('/api/'))throw new AppError('invalid_input',404);
   const host=req.headers.host??'';if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw new AppError('unauthorized_target',403);
   if(!safeMethods.has(method)&&req.headers.origin!==config.origin)throw new AppError('unauthorized_target',403);
   if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('unauthorized_target',403);
   const emailRequest=method==='POST'&&['/api/signup','/api/signup/resend'].includes(path);const key=req.socket.remoteAddress??'local',now=Date.now(),limit=emailRequest?3:path==='/api/session'&&method==='POST'?15:240;const rateKey=key+':'+(emailRequest?'email':limit===15?'auth':'api');let rate=buckets.get(rateKey);if(!rate||now-rate.start>60000){rate={start:now,count:0};buckets.set(rateKey,rate);}if(++rate.count>limit)throw new AppError(emailRequest?'email_rate_limited':'rate_limited',429);
   if(path==='/api/config'&&method==='GET'){json(res,200,publicConfig(config));return;}
   if(path==='/api/auth-status'&&method==='GET'){json(res,200,{project_ref:publicConfig(config).project_ref,...await gateway.authSettings()});return;}
   if(emailRequest){
    // Signup must not replace, log out, or bind a currently authenticated browser session.
    if(req.headers.authorization)throw new AppError('signup_signed_in',409);
    let signedIn=false;const existing=sessionId(req);if(existing)try{await sessions.resolve(existing);signedIn=true;}catch(e){if(!(e instanceof AppError&&['unauthorized','session_expired'].includes(e.code)))throw e;}
    if(signedIn)throw new AppError('signup_signed_in',409);
    const p=await payload(req);only(p,path==='/api/signup'?['email','password']:['email']);
    const result=path==='/api/signup'?await gateway.signup(text(p.email,320),text(p.password,512)):await gateway.resendConfirmation(text(p.email,320));json(res,200,result);return;
   }
   if(path==='/api/session'&&method==='POST'){const p=await payload(req);only(p,['email','password']);const result=await sessions.open(text(p.email,320),text(p.password,512));await sessions.close(sessionId(req));res.setHeader('Set-Cookie',sessionCookie(result.id,result.maxAge));json(res,200,{authenticated:true,user_id:result.userId});return;}
   if(path==='/api/session'&&method==='DELETE'){res.setHeader('Set-Cookie',sessionCookie());const revocation=await sessions.close(sessionId(req));json(res,200,{authenticated:false,revocation});return;}
   const header=req.headers.authorization;const user=header?.startsWith('Bearer ')?await gateway.authenticate(header.slice(7)):await sessions.resolve(sessionId(req));const repo=new DatabaseRepository(gateway,user),ai=new AiService(config,repo,deps.providerFetch);
   if(path==='/api/session'&&method==='GET'){json(res,200,{authenticated:true,user_id:user.id});return;}
   if(path==='/api/try-on/preflight'&&method==='POST'){
    const p=await payload(req);only(p,['draft','snapshot','person_asset_id','person_asset_version','reference_asset_id','reference_asset_version','fitting_mode']);
    if(!['batch','realtime'].includes(String(p.fitting_mode)))throw new AppError('invalid_input');
    json(res,200,await ai.preflightFitting({draft:outfitInput(p.draft,user.id),snapshot:record(p.snapshot) as unknown as import('../src/mirrorScene').FittingSnapshot,
      personAssetId:uuid(p.person_asset_id),personAssetVersion:integer(p.person_asset_version),referenceAssetId:uuid(p.reference_asset_id),referenceAssetVersion:integer(p.reference_asset_version),fittingMode:p.fitting_mode as 'batch'|'realtime'}));return;
   }
   if(path==='/api/state'&&method==='GET'){json(res,200,await repo.state());return;}
   if((path==='/api/styles/analyze-reference'||path==='/api/labels/analyze')&&method==='POST'){const p=await payload(req);only(p,['reference_asset_id','intent_key','mode']);json(res,200,await ai.execute({action:path==='/api/labels/analyze'?'analyzeRegistration':'analyzeStyleReference',referenceAssetId:uuid(p.reference_asset_id),intentKey:text(p.intent_key)},mode(p.mode,config)));return;}
   if(path==='/api/garments'&&method==='GET'){const q=url.searchParams.get('q')??'',category=url.searchParams.get('category')??'all';if(q.length>200)throw new AppError('invalid_input');const state=await repo.state();json(res,200,{garments:state.garments.filter(g=>(category==='all'||g.category===category)&&[g.name,g.color,g.location,...g.features].join(' ').toLowerCase().includes(q.toLowerCase()))});return;}
   let m:RegExpMatchArray|null;
   if((m=path.match(/^\/api\/garments\/([^/]+)\/evidence$/))&&method==='GET'){json(res,200,await readCareEvidence(repo,uuid(m[1])));return;}
   if((m=path.match(/^\/api\/garments\/([^/]+)$/))&&method==='GET'){const g=await repo.garment(uuid(m[1]));const assets=g.asset_id?await gateway.rows(user,'sc_assets',`id=eq.${g.asset_id}&select=*`):[];json(res,200,{garment:garmentFrom(g,assets)});return;}
   if(path==='/api/registrations'&&method==='POST'){const p=await payload(req);only(p,['draft']);const d=registrationInput(p.draft,user.id);json(res,201,await repo.putDraft(d));return;}
   if((m=path.match(/^\/api\/drafts\/([^/]+)$/))&&method==='PUT'){const p=await payload(req);only(p,['kind','draft']);const d=p.kind==='registration'?registrationInput(p.draft,user.id):p.kind==='outfit'?outfitInput(p.draft,user.id):null;if(!d||d.draftId!==uuid(m[1]))throw new AppError('invalid_input');json(res,200,await repo.putDraft(d));return;}
   if((m=path.match(/^\/api\/drafts\/([^/]+)\/discard$/))&&method==='POST'){const p=await payload(req);only(p,['revision']);json(res,200,await repo.discardDraft(uuid(m[1]),integer(p.revision)));return;}
   if(path==='/api/garments'&&method==='POST'){const p=await payload(req);only(p,['intent_key','draft']);json(res,200,await repo.save('saveGarment',registrationInput(p.draft,user.id),text(p.intent_key)));return;}
   if(path==='/api/outfits'&&method==='POST'){const p=await payload(req);only(p,['intent_key','draft']);json(res,200,await repo.save('saveOutfit',outfitInput(p.draft,user.id),text(p.intent_key)));return;}
   if((m=path.match(/^\/api\/outfits\/([^/]+)\/items$/))&&method==='PATCH'){const p=await payload(req);only(p,['draft','slot','garment_id']);const d=outfitInput(p.draft,user.id);if(d.draftId!==uuid(m[1]))throw new AppError('invalid_input');const slot=text(p.slot,20),id=uuid(p.garment_id),g=await repo.garment(id);if(g.owner_id!==user.id||g.category!==slot||slot==='top'&&d.topLocked&&d.items.top!==id)throw new AppError('conflict',409);d.items[slot as keyof typeof d.items]=id;d.revision++;json(res,200,{draft:d,persisted:await repo.putDraft(d)});return;}
   const eventRoutes:Record<string,string>={'/api/outfit-plans':'planOutfit','/api/wear-events':'recordWear'};
   if(method==='POST'&&(eventRoutes[path]||(m=path.match(/^\/api\/garments\/([^/]+)\/(care-events|movement-events)$/)))){const p=await payload(req);const input=eventInput(p);if(m&&uuid(m[1])!==input.targetId)throw new AppError('invalid_input');json(res,200,await repo.event(eventRoutes[path]??(m![2]==='care-events'?'recordActualCare':'recordMovementConfirmed'),input));return;}
   if(path==='/api/assets/prepare'&&method==='POST'){const p=await payload(req);only(p,['asset_id','kind','mime_type','byte_size','sha256','allowed_providers','parent_asset_id']);const providers=p.allowed_providers??[];if(!Array.isArray(providers)||providers.some(x=>!['openai','decart'].includes(String(x)))||!/^[a-f0-9]{64}$/.test(String(p.sha256)))throw new AppError('invalid_input');json(res,201,await gateway.rpc(user,'sc_prepare_asset',{p_asset_id:p.asset_id?uuid(p.asset_id):randomUUID(),p_kind:text(p.kind,30),p_mime_type:text(p.mime_type,50),p_byte_size:integer(p.byte_size,1,100*1024*1024),p_sha256:p.sha256,p_allowed_providers:providers,p_parent_asset_id:p.parent_asset_id?uuid(p.parent_asset_id):null}));return;}
   if((m=path.match(/^\/api\/assets\/([^/]+)\/content$/))&&method==='PUT'){json(res,200,await repo.upload(uuid(m[1]),await body(req,100*1024*1024),(req.headers['content-type']??'').split(';')[0]));return;}
   if((m=path.match(/^\/api\/assets\/([^/]+)\/finalize$/))&&method==='POST'){const p=await payload(req);only(p,[]);json(res,200,await repo.finalize(uuid(m[1])));return;}
   if((m=path.match(/^\/api\/assets\/([^/]+)\/content$/))&&method==='GET'){await repo.asset(uuid(m[1]));const data=await repo.bytes(m[1]);res.writeHead(200,{'Content-Type':String(data.asset.mime_type),'Content-Length':data.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data.bytes);return;}
   if((m=path.match(/^\/api\/operations\/([^/]+)\/receipt$/))&&method==='GET'){await gateway.one(user,'sc_operations',uuid(m[1]));const rows=await gateway.rows(user,'sc_operation_receipts',`operation_id=eq.${m[1]}&select=*`);if(!rows[0])throw new AppError('result_unavailable',404);json(res,200,rows[0]);return;}
   if((m=path.match(/^\/api\/operations\/([^/]+)$/))&&method==='GET'){json(res,200,await ai.operation(uuid(m[1])));return;}
   if((m=path.match(/^\/api\/operations\/([^/]+)\/recover$/))&&method==='POST'){const p=await payload(req);only(p,[]);json(res,200,await ai.recoverAgent(uuid(m[1])));return;}
   if(path==='/api/evidence-items'&&method==='POST'){const p=await payload(req);only(p,['id','garment_id','asset_id','evidence_kind','original_text','observed_at','source_ref']);if(!['label','official_guidance','user_observation'].includes(String(p.evidence_kind))||!Number.isFinite(Date.parse(String(p.observed_at))))throw new AppError('invalid_input');json(res,201,await gateway.rpc(user,'sc_put_evidence',{p_evidence:{id:p.id?uuid(p.id):randomUUID(),garment_id:p.garment_id?uuid(p.garment_id):null,asset_id:p.asset_id?uuid(p.asset_id):null,evidence_kind:p.evidence_kind,original_text:text(p.original_text,20000),observed_at:p.observed_at,source_ref:p.source_ref?text(p.source_ref,1000):null}}));return;}
   if(path==='/api/external-items'&&method==='POST'){const p=await payload(req);only(p,['id','asset_id','source_label','source_url']);if(p.source_url&&(typeof p.source_url!=='string'||!p.source_url.startsWith('https://')||p.source_url.length>2000))throw new AppError('invalid_input');json(res,201,await gateway.rpc(user,'sc_put_external_item',{p_item:{id:p.id?uuid(p.id):randomUUID(),asset_id:p.asset_id?uuid(p.asset_id):null,source_label:text(p.source_label,200),source_url:p.source_url??null}}));return;}
   if((m=path.match(/^\/api\/garments\/([^/]+)\/care-guide$/))&&method==='GET'){await repo.garment(uuid(m[1]));const jobs=await gateway.rows(user,'sc_ai_jobs',`owner_id=eq.${user.id}&status=eq.succeeded&adapter=eq.requestCareGuide&select=*&limit=100`);const saved=jobs.filter(j=>record(j.input_snapshot_json).garmentId===m![1]);json(res,200,{guides:saved.map(j=>({job_id:j.id,result:j.result_json,source:j.mode}))});return;}
   if(method==='POST'&&(path==='/api/outfits/recommend'||path==='/api/styles/adapt'||path==='/api/try-on'||(m=path.match(/^\/api\/registrations\/([^/]+)\/(analyze|evaluate-photo)$/))||(m=path.match(/^\/api\/garments\/([^/]+)\/care-guide$/)))){
    const p=await payload(req);only(p,['intent_key','draft','conditions','mode','reference_asset_id','person_asset_id','fitting_mode','availability_confirmations','editable_slot']);const request:AiRequest={action:path==='/api/outfits/recommend'?'generateOutfits':path==='/api/styles/adapt'?'adaptStyleToWardrobe':path==='/api/try-on'?'startTryOn':path.includes('/registrations/')?(m![2]==='evaluate-photo'?'evaluatePhoto':'analyzeRegistration'):'requestCareGuide',intentKey:text(p.intent_key)};
    if(p.draft){request.draft=request.action==='analyzeRegistration'||request.action==='evaluatePhoto'?registrationInput(p.draft,user.id):outfitInput(p.draft,user.id);if(path.includes('/registrations/')&&request.draft.draftId!==uuid(m![1]))throw new AppError('invalid_input');}
    if(request.action==='analyzeRegistration'||request.action==='evaluatePhoto'||request.action==='generateOutfits'||request.action==='adaptStyleToWardrobe'){if(!request.draft)throw new AppError('invalid_input');}
    if(request.action==='requestCareGuide')request.garmentId=uuid(m![1]);
    if(p.editable_slot!==undefined){if(!['generateOutfits','adaptStyleToWardrobe'].includes(request.action)||!['top','bottom','outer','bag','shoes','hat','accessory'].includes(String(p.editable_slot)))throw new AppError('invalid_input');request.editableSlot=p.editable_slot as NonNullable<AiRequest['editableSlot']>;}
    if(p.availability_confirmations!==undefined){if(!['generateOutfits','adaptStyleToWardrobe'].includes(request.action))throw new AppError('invalid_input');request.availabilityConfirmations=availabilityInput(p.availability_confirmations);}
    if(p.conditions){const c=record(p.conditions);only(c,['weather','temperatureC','occasion']);if(typeof c.temperatureC!=='number'||!Number.isFinite(c.temperatureC)||c.temperatureC< -70||c.temperatureC>70)throw new AppError('invalid_input');text(c.weather,100);text(c.occasion,300);request.conditions=c;}
    if(p.reference_asset_id)request.referenceAssetId=uuid(p.reference_asset_id);if(p.person_asset_id)request.personAssetId=uuid(p.person_asset_id);if(p.fitting_mode){if(!['batch','realtime'].includes(String(p.fitting_mode)))throw new AppError('invalid_input');request.fittingMode=p.fitting_mode as 'batch'|'realtime';}
    json(res,200,await ai.execute(request,mode(p.mode,config)));return;
   }
   if((m=path.match(/^\/api\/try-on\/([^/]+)\/(status|result|token|stop|look)$/))){const id=uuid(m[1]),op=m[2];if(op==='status'&&method==='GET'){json(res,200,await ai.batchStatus(id));return;}if(op==='result'&&method==='GET'){const result=await ai.batchContent(id);res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(await result.arrayBuffer()));return;}if(op==='token'&&method==='POST'){const p=await payload(req);only(p,[]);json(res,200,await ai.token(id));return;}if(op==='stop'&&method==='POST'){const p=await payload(req);only(p,[]);json(res,200,await ai.stop(id));return;}if(op==='look'&&method==='PATCH'){const p=await payload(req);only(p,['draft','reference_asset_id']);const d=outfitInput(p.draft,user.id);json(res,200,await ai.prepareLook(id,d,uuid(p.reference_asset_id)));return;}}
   if(path==='/api/resource-grants'&&method==='POST'){const p=await payload(req);only(p,['resource_kind','resource_id','grantee_id','can_read','can_write','expires_at']);if(typeof p.can_read!=='boolean'||typeof p.can_write!=='boolean')throw new AppError('invalid_input');json(res,200,await gateway.rpc(user,'sc_set_resource_grant',{p_resource_kind:text(p.resource_kind,30),p_resource_id:uuid(p.resource_id),p_grantee_id:uuid(p.grantee_id),p_can_read:p.can_read,p_can_write:p.can_write,p_expires_at:p.expires_at??null}));return;}
   throw new AppError('invalid_input',404);
  }catch(e){const error=e instanceof AppError?e:new AppError('provider_failed',500);if(!res.headersSent)json(res,error.status,{error:{code:error.code,message:error.message,...(error.diagnostic?{diagnostic:error.diagnostic}:{})}});else res.end();}
 });
}
