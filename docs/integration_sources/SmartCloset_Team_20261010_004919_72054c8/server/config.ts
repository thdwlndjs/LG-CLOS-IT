import { AppError } from './errors';
export const PROJECT_REF='slxgcgtnxkchxywgsmuk';
export type AiMode='mock'|'saved_result'|'live';
export interface ServerConfig { origin:string; port:number; supabaseUrl:string; publishableKey:string; serverKey:string; openaiKey:string; decartKey:string; liveEnabled:boolean; aiMode:AiMode; }
export function readConfig(env:Record<string,string|undefined>):ServerConfig{
  const supabaseUrl=(env.SUPABASE_URL?.trim()||`https://${PROJECT_REF}.supabase.co`).replace(/\/$/,'');
  if(supabaseUrl && supabaseUrl!==`https://${PROJECT_REF}.supabase.co`)throw new AppError('configuration_required',503);
  const origin=env.APP_ORIGIN??'http://127.0.0.1:4311';
  if(!['http://127.0.0.1:4311','http://localhost:4311'].includes(origin))throw new AppError('configuration_required',503);
  const aiMode=env.AI_MODE??'mock';if(!['mock','saved_result','live'].includes(aiMode))throw new AppError('configuration_required',503);
  return{origin,port:4312,supabaseUrl,publishableKey:env.SUPABASE_PUBLISHABLE_KEY??'',serverKey:env.SUPABASE_SERVER_KEY??'',openaiKey:env.OPENAI_API_KEY??'',decartKey:env.DECART_API_KEY??'',liveEnabled:(env.LIVE_API_ENABLED??env.LIVE_ENABLED)==='true',aiMode:aiMode as AiMode};
}
export function publicConfig(c:ServerConfig){return{project_ref:PROJECT_REF,database_configured:!!(c.supabaseUrl&&c.publishableKey),ai_mode:c.aiMode,live_enabled:c.liveEnabled,key_present:{supabase_publishable:!!c.publishableKey,supabase_server:!!c.serverKey,openai:!!c.openaiKey,decart:!!c.decartKey}};}
