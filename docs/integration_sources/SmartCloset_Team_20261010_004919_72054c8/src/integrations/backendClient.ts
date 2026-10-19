import type {Asset,CareGuide,DemoEvent,DemoState,Garment,Outfit,OutfitConditions,OutfitDraft,OutfitItems,RegistrationDraft,SaveResult,Slot} from '../core/types';
import type {AvailabilityConfirmation} from '../outfitReview';
export type BackendMode='mock'|'saved_result'|'live';
export interface BackendDiagnostic {stage:'auth'|'database';upstream_status?:number;upstream_code?:string;}
export class BackendError extends Error{constructor(public code:string,message:string,public status?:number,public diagnostic?:BackendDiagnostic){super(message);}}
const expiredListeners=new Set<()=>void>();
let sessionEpoch=0;
export function onBackendSessionExpired(listener:()=>void){expiredListeners.add(listener);return()=>{expiredListeners.delete(listener);};}
export interface RemoteBackend{
 mode:BackendMode;state():Promise<DemoState>;putDraft(draft:RegistrationDraft|OutfitDraft):Promise<void>;discardDraft(draft:RegistrationDraft|OutfitDraft):Promise<void>;
 saveGarment(draft:RegistrationDraft,intent:string):Promise<SaveResult<Garment>>;saveOutfit(draft:OutfitDraft,intent:string):Promise<SaveResult<Outfit>>;
 recordEvent(kind:DemoEvent['kind'],target:string,value:string,date:string,intent:string):Promise<SaveResult<DemoEvent>>;
 analyze(draft:RegistrationDraft):Promise<Partial<RegistrationDraft>|null>;recommend(draft:OutfitDraft,conditions:OutfitConditions,reference?:string,availabilityConfirmations?:AvailabilityConfirmation[],editableSlot?:Slot):Promise<OutfitItems|null>;
 care(garmentId:string):Promise<CareGuide>;tryOn(draft:OutfitDraft,referenceAssetId?:string,personAssetId?:string,fittingMode?:'batch'|'realtime'):Promise<Record<string,unknown>>;
}
export class HttpRemoteBackend implements RemoteBackend{
 mode:BackendMode='mock';private sessionOwner?:string;private bindingVersion=0;constructor(private transport:typeof fetch=(...args)=>globalThis.fetch(...args)){}
 bindSession(ownerId?:string){if(this.sessionOwner!==ownerId){this.sessionOwner=ownerId;this.bindingVersion++;sessionEpoch++;this.mode='mock';}}
 async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const requestEpoch=sessionEpoch;
  let res:Response;try{res=await this.transport(path,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new BackendError('backend_unavailable','앱 서버에 연결할 수 없습니다. 서버 실행과 네트워크를 확인해 주세요.');}
  let value:any;try{value=await res.json();}catch{throw new BackendError('backend_unavailable','앱 서버의 응답을 확인할 수 없습니다.',res.status);}
  if(!res.ok){const error=new BackendError(value.error?.code??'database_unavailable',value.error?.message??'서버 응답을 확인할 수 없습니다.',res.status,value.error?.diagnostic);if(requestEpoch===sessionEpoch&&['unauthorized','session_expired'].includes(error.code)&&(path!=='/api/session'||method==='GET'))for(const listener of expiredListeners)listener();throw error;}return value as T;
 }
 config(){return this.request<{project_ref:string;database_configured:boolean;ai_mode:BackendMode;live_enabled:boolean;key_present:Record<string,boolean>}>('/api/config');}
 authStatus(){return this.request<{project_ref:string;email_password_enabled:boolean|null;email_confirmation_required:boolean|null}>('/api/auth-status');}
 signup(email:string,password:string){return this.request<{accepted:true;confirmation_required:true}>('/api/signup','POST',{email,password});}
 resendConfirmation(email:string){return this.request<{accepted:true;confirmation_required:true}>('/api/signup/resend','POST',{email});}
 async login(email:string,password:string){sessionEpoch++;return this.request<{authenticated:true;user_id:string}>('/api/session','POST',{email,password});}logout(){sessionEpoch++;this.bindSession();return this.request<{authenticated:false;revocation:'confirmed'|'unconfirmed'|'not_needed'}>('/api/session','DELETE');}session(){return this.request<{authenticated:boolean;user_id:string}>('/api/session');}
 async state(){const owner=this.sessionOwner,version=this.bindingVersion;const state=await this.request<DemoState>('/api/state');if(version!==this.bindingVersion)throw new BackendError('session_expired','이전 로그인에서 요청한 화면은 적용하지 않았어요.');if(owner&&state.activeProfileId!==owner){for(const listener of expiredListeners)listener();throw new BackendError('session_expired','로그인 계정이 변경됐어요. 현재 계정을 다시 확인해 주세요.');}return state;}
 async putDraft(draft:RegistrationDraft|OutfitDraft){await this.request(`/api/drafts/${draft.draftId}`,'PUT',{kind:'category'in draft?'registration':'outfit',draft});}
 async discardDraft(draft:RegistrationDraft|OutfitDraft){await this.request(`/api/drafts/${draft.draftId}/discard`,'POST',{revision:draft.revision});}
 saveGarment(draft:RegistrationDraft,intent:string){return this.request<SaveResult<Garment>>('/api/garments','POST',{intent_key:intent,draft});}
 saveOutfit(draft:OutfitDraft,intent:string){return this.request<SaveResult<Outfit>>('/api/outfits','POST',{intent_key:intent,draft});}
 recordEvent(kind:DemoEvent['kind'],target:string,value:string,date:string,intent:string){const path=kind==='care'?`/api/garments/${target}/care-events`:kind==='movement'?`/api/garments/${target}/movement-events`:kind==='plan'?'/api/outfit-plans':'/api/wear-events';return this.request<SaveResult<DemoEvent>>(path,'POST',{intent_key:intent,client_event_id:intent,target_id:target,value,date,input_source:'user_confirmed'});}
 private async action(path:string,body:Record<string,unknown>){return this.request<{operation_id?:string;processing_status:string;mode:BackendMode;result:any;message?:string}>(path,'POST',{...body,intent_key:crypto.randomUUID(),mode:this.mode});}
 async analyze(draft:RegistrationDraft){const r=await this.action(`/api/registrations/${draft.draftId}/analyze`,{draft});if(!r.result)return null;const result=r.result.value??r.result;if(r.mode==='mock')return result as Partial<RegistrationDraft>;const o=result.observations;return o?Object.fromEntries(Object.entries(o).filter(([,v])=>v!==null)):null;}
 async recommend(draft:OutfitDraft,conditions:OutfitConditions,reference?:string,availabilityConfirmations?:AvailabilityConfirmation[],editableSlot?:Slot){const r=await this.action(reference?'/api/styles/adapt':'/api/outfits/recommend',{draft,conditions,...(reference?{reference_asset_id:reference}:{}),...(availabilityConfirmations!==undefined?{availability_confirmations:availabilityConfirmations}:{}),...(editableSlot?{editable_slot:editableSlot}:{})});if(!r.result)return null;const v=r.result.value??r.result;if(r.mode==='mock')return v as OutfitItems;if(v.kind!=='proposal')return null;return Object.fromEntries(v.items.map((i:{slot:string;garment_id:string})=>[i.slot,i.garment_id])) as OutfitItems;}
 async care(garmentId:string):Promise<CareGuide>{const r=await this.action(`/api/garments/${garmentId}/care-guide`,{});if(r.mode==='mock'&&r.result)return r.result;const v=r.result?.value??r.result;return{garmentId,title:v?.kind==='proposal'?'근거에 따른 케어 제안':'근거를 더 확인해 주세요',advice:v?.explanation??r.message??'이 입력에 일치하는 결과가 없습니다.',source:v?.kind==='proposal'?'provider':'unconfirmed',actualCareRecorded:false} as CareGuide;}
 tryOn(draft:OutfitDraft,referenceAssetId?:string,personAssetId?:string,fittingMode:'batch'|'realtime'='batch'){return this.action('/api/try-on',{draft,fitting_mode:fittingMode,...(referenceAssetId?{reference_asset_id:referenceAssetId}:{}),...(personAssetId?{person_asset_id:personAssetId}:{})});}
 async upload(file:File,kind='garment',allowedProviders:string[]=[]):Promise<Asset>{const data=await file.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');const row=await this.request<{id:string;version:number}>('/api/assets/prepare','POST',{asset_id:crypto.randomUUID(),kind,mime_type:file.type,byte_size:file.size,sha256:hash,allowed_providers:allowedProviders});const result=await this.transport(`/api/assets/${row.id}/content`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});if(!result.ok){const e=await result.json();throw new BackendError(e.error?.code??'database_unavailable',e.error?.message??'업로드 실패');}await this.request(`/api/assets/${row.id}/finalize`,'POST',{});return{id:row.id,version:row.version,source:'storage',url:`/api/assets/${row.id}/content`} as Asset;}
}
