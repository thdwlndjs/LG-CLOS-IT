import { createHash } from 'node:crypto';
import { AppError } from './errors';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,unlink,rmdir,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
export const MAX_IMAGE_BYTES=10*1024*1024,MAX_VIDEO_BYTES=100*1024*1024;
export function inspectMedia(data:Buffer,mime:string){
 if(!data.length||data.length>(mime.startsWith('image/')?MAX_IMAGE_BYTES:MAX_VIDEO_BYTES))throw new AppError('invalid_input');
 const sha256=createHash('sha256').update(data).digest('hex');
 if(mime==='image/png'&&data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{sha256,mime,bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
 if(mime==='image/jpeg'&&data[0]===255&&data[1]===216){let n=2;while(n+9<data.length){if(data[n]!==255)break;const marker=data[n+1],size=data.readUInt16BE(n+2);if(size<2)break;if([192,193,194].includes(marker))return{sha256,mime,bytes:data.length,width:data.readUInt16BE(n+7),height:data.readUInt16BE(n+5)};n+=size+2;}throw new AppError('invalid_input');}
 if(mime==='image/webp'&&data.length>=30&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'){const kind=data.toString('ascii',12,16);if(kind==='VP8X')return{sha256,mime,bytes:data.length,width:1+data.readUIntLE(24,3),height:1+data.readUIntLE(27,3)};if(kind==='VP8 '&&data[23]===157&&data[24]===1&&data[25]===42)return{sha256,mime,bytes:data.length,width:data.readUInt16LE(26)&16383,height:data.readUInt16LE(28)&16383};if(kind==='VP8L'&&data[20]===47){const bits=data.readUInt32LE(21);return{sha256,mime,bytes:data.length,width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}throw new AppError('invalid_input');}
 if(mime==='video/mp4'&&data.length>32&&data.toString('ascii',4,8)==='ftyp'){
  let duration=0,width=0,height=0,codec='';
  function boxes(start:number,end:number,depth=0){if(depth>10)throw new AppError('invalid_input');let at=start;while(at+8<=end){let size=data.readUInt32BE(at),head=8;const type=data.toString('ascii',at+4,at+8);if(size===1){if(at+16>end)throw new AppError('invalid_input');size=Number(data.readBigUInt64BE(at+8));head=16;}if(size===0)size=end-at;if(size<head||at+size>end)throw new AppError('invalid_input');const p=at+head;
   if(['moov','trak','mdia','minf','stbl'].includes(type))boxes(p,at+size,depth+1);
   if(type==='mvhd'){const v=data[p];const t=v===1?p+20:p+12;if(t+(v===1?12:8)>at+size)throw new AppError('invalid_input');const scale=data.readUInt32BE(t);const ticks=v===1?Number(data.readBigUInt64BE(t+4)):data.readUInt32BE(t+4);duration=scale?ticks/scale:0;}
   if(type==='stsd'){let e=p+8;for(let i=0;i<data.readUInt32BE(p+4);i++){if(e+8>at+size)throw new AppError('invalid_input');const len=data.readUInt32BE(e),format=data.toString('ascii',e+4,e+8);if(len<8||e+len>at+size)throw new AppError('invalid_input');if(format==='avc1'||format==='avc3'){if(len<36)throw new AppError('invalid_input');codec='h264';width=data.readUInt16BE(e+32);height=data.readUInt16BE(e+34);}e+=len;}}
   at+=size;}}
  boxes(0,data.length);if(codec!=='h264'||!Number.isFinite(duration)||duration<=0||!width||!height)throw new AppError('invalid_input');
  const ratio=width/height;if(![16/9,9/16,2,0.5].some(r=>Math.abs(ratio-r)<0.035))throw new AppError('invalid_input');
  return{sha256,mime,bytes:data.length,durationSeconds:duration,width,height,codec:'h264' as const};
 }
 throw new AppError('invalid_input');
}

const runFile=promisify(execFile);
async function mediaExecutable(name:'ffprobe'|'ffmpeg'){
 const configured=process.env[name==='ffprobe'?'FFPROBE_PATH':'FFMPEG_PATH'];if(configured&&existsSync(configured))return configured;
 const root=resolve('tmp/media-tools/extracted');if(existsSync(root)){for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory())continue;const candidate=join(root,entry.name,'bin',`${name}.exe`);if(existsSync(candidate))return candidate;}}
 throw new AppError('configuration_required',503);
}
/** Fully decode the private local input; never trust only browser/MP4 duration metadata. */
export async function verifyVideo(bytes:Buffer,mime:string):Promise<{durationSeconds:number;codec:'h264'|'vp8'|'vp9';width:number;height:number;inspected:true}>{
 const header=inspectMedia(bytes,mime);if(mime!=='video/mp4')throw new AppError('invalid_input');const probe=await mediaExecutable('ffprobe'),decoder=await mediaExecutable('ffmpeg');
 const dir=await mkdtemp(join(tmpdir(),'smartcloset-inspect-')),file=join(dir,'input.mp4');
 try{
  await writeFile(file,bytes,{flag:'wx'});
  const result=await runFile(probe,['-v','error','-protocol_whitelist','file','-select_streams','v:0','-count_frames','-show_packets','-show_entries','stream=codec_name,width,height,duration,nb_read_frames,avg_frame_rate:format=duration:packet=pts_time,dts_time,duration_time','-of','json',file],{windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
  if(result.stderr.trim())throw new AppError('invalid_input');const report=JSON.parse(result.stdout);const stream=report.streams?.[0];if(!stream||stream.codec_name!=='h264'||!Array.isArray(report.packets)||!report.packets.length)throw new AppError('invalid_input');
  const ends=report.packets.map((p:Record<string,unknown>)=>Number(p.pts_time??p.dts_time)+Number(p.duration_time??0));if(ends.some((x:number)=>!Number.isFinite(x)))throw new AppError('invalid_input');
  const duration=Math.max(Number(report.format?.duration),Number(stream.duration),...ends);const frames=Number(stream.nb_read_frames),width=Number(stream.width),height=Number(stream.height);
  if(!Number.isFinite(duration)||duration<=0||duration>180||!Number.isInteger(frames)||frames<1||frames>10800||width>1920||height>1920||width!==header.width||height!==header.height)throw new AppError('invalid_input');
  const decoded=await runFile(decoder,['-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file','-i',file,'-map','0:v:0','-an','-f','null','-'],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});if(decoded.stderr.trim())throw new AppError('invalid_input');
  return{durationSeconds:Math.ceil(duration*1000)/1000,codec:'h264',width,height,inspected:true};
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('invalid_input');}finally{await unlink(file).catch(()=>{});await rmdir(dir).catch(()=>{});}
}
