/** FFmpeg 실행 (Electron 없이도 동작 — scripts/render-smoke.mjs 에서도 사용) */
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ComposerProject,FfmpegStatus} from '../shared/types';
import {buildRenderPlan,parseMediaInfo,parseProgressSeconds,type MediaInfo} from '../shared/render';
import {musicLayers} from '../shared/media';

function bundledPath():string{
  try{
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p=require('ffmpeg-static') as string|null;
    if(!p)return '';
    const unpacked=p.replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    return existsSync(unpacked)?unpacked:existsSync(p)?p:'';
  }catch{return '';}
}
function versionOf(bin:string):string{
  try{const r=spawnSync(bin,['-hide_banner','-version'],{encoding:'utf8',windowsHide:true,timeout:15000});if(r.status===0)return (r.stdout.split('\n')[0]||'').replace(/^ffmpeg version\s*/,'').split(' ')[0]||'';}catch{/* 없음 */}
  return '';
}
/** 사용자 지정 → 함께 설치된 ffmpeg-static → 시스템 PATH 순서로 찾는다 */
export function resolveFfmpeg(custom=''):FfmpegStatus{
  const candidates:[string,FfmpegStatus['source']][]=[];
  if(custom)candidates.push([custom,'custom']);
  const b=bundledPath();if(b)candidates.push([b,'bundled']);
  candidates.push([process.platform==='win32'?'ffmpeg.exe':'ffmpeg','system']);
  for(const [bin,source] of candidates){
    const v=versionOf(bin);
    if(v)return {ok:true,path:bin,source,version:v,message:source==='custom'?'직접 지정한 FFmpeg를 사용해요.':source==='bundled'?'프로그램에 함께 들어 있는 FFmpeg를 사용해요.':'컴퓨터에 설치된 FFmpeg를 사용해요.'};
  }
  return {ok:false,path:'',source:'none',version:'',message:'FFmpeg를 찾지 못했어요. npm install을 다시 실행하거나 환경 설정에서 ffmpeg.exe를 직접 지정해 주세요.'};
}
export async function probeMedia(ffmpeg:string,file:string):Promise<MediaInfo>{
  return new Promise(resolve=>{
    const p=spawn(ffmpeg,['-hide_banner','-nostdin','-i',file],{windowsHide:true});let err='';
    p.stderr.setEncoding('utf8');p.stderr.on('data',(d:string)=>{err+=d;});
    p.on('error',()=>resolve({duration:null,hasAudio:false}));
    p.on('close',()=>resolve(parseMediaInfo(err)));
  });
}
export interface RunOptions{cwd?:string;duration?:number;onProgress?:(fraction:number)=>void;signal?:AbortSignal}
export function runFfmpeg(ffmpeg:string,args:string[],o:RunOptions={}):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(o.signal?.aborted)return reject(new Error('취소됨'));
    const p=spawn(ffmpeg,args,{cwd:o.cwd,windowsHide:true});let tail='';
    p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
    p.stdout.on('data',(d:string)=>{const t=parseProgressSeconds(d);if(t!=null&&o.duration)o.onProgress?.(Math.min(1,t/o.duration));});
    p.stderr.on('data',(d:string)=>{tail=(tail+d).slice(-4000);});
    const abort=()=>{p.kill('SIGKILL');};o.signal?.addEventListener('abort',abort);
    p.on('error',e=>{o.signal?.removeEventListener('abort',abort);reject(e);});
    p.on('close',code=>{o.signal?.removeEventListener('abort',abort);
      if(o.signal?.aborted)return reject(new Error('취소됨'));
      if(code===0)resolve();else reject(new Error(`FFmpeg 오류 (코드 ${code})\n${tail.split('\n').filter(Boolean).slice(-6).join('\n')}`));});
  });
}
export interface RenderJobOptions{ffmpeg:string;baseDir:string;output:string;draft:boolean;onProgress?:(fraction:number,message:string)=>void;signal?:AbortSignal;keepWork?:boolean}
/** 프로젝트 → MP4. 진행률 0~1 */
export async function renderProject(project:ComposerProject,o:RenderJobOptions):Promise<{output:string;duration:number;bytes:number}>{
  const work=await mkdtemp(path.join(os.tmpdir(),'gomo-render-'));
  try{
    const resolve=(rel:string)=>path.resolve(o.baseDir,rel);
    const sounds=musicLayers(project).map(l=>resolve(l.file));
    const files=[...new Set([...project.clips.filter(c=>c.type==='video').map(c=>resolve(c.file)),...sounds])];
    if(project.clips.some(c=>!c.file))throw new Error('미디어가 비어 있는 장면이 있어요. 장면 구성에서 이미지·영상을 넣어 주세요.');
    const missing=[...new Set([...project.clips.map(c=>resolve(c.file)),...project.dubbing.takes.map(t=>resolve(t.file)),...sounds])].filter(f=>!existsSync(f));
    if(missing.length)throw new Error(`파일을 찾을 수 없어요: ${missing.slice(0,3).map(f=>path.basename(f)).join(', ')}${missing.length>3?` 외 ${missing.length-3}개`:''}`);
    o.onProgress?.(0,'미디어 정보를 읽는 중');
    const info=new Map<string,MediaInfo>();
    for(const f of files)info.set(f,await probeMedia(o.ffmpeg,f));
    const fontsDir=process.platform==='win32'?path.join(process.env.WINDIR||'C:\\Windows','Fonts'):undefined;
    const plan=buildRenderPlan(project,{draft:o.draft,resolve,info:f=>info.get(f),workFile:n=>path.join(work,n),output:o.output,fontsDir});
    if(plan.ass)await writeFile(path.join(work,'subs.ass'),'\uFEFF'+plan.ass,'utf8');
    await mkdir(path.dirname(o.output),{recursive:true});
    const clipTotal=plan.clipJobs.reduce((n,j)=>n+j.duration,0)||1;
    const W=.65;let done=0;
    for(const job of plan.clipJobs){
      await runFfmpeg(o.ffmpeg,job.args,{cwd:work,duration:job.duration,signal:o.signal,onProgress:fr=>o.onProgress?.(W*(done+fr*job.duration)/clipTotal,`장면 ${job.index+1}/${plan.clipJobs.length} 만드는 중`)});
      done+=job.duration;
    }
    o.onProgress?.(W,'장면 잇기 · 자막 · 소리 섞는 중');
    await runFfmpeg(o.ffmpeg,plan.assembly.args,{cwd:work,duration:plan.total,signal:o.signal,onProgress:fr=>o.onProgress?.(W+(1-W)*fr,'장면 잇기 · 자막 · 소리 섞는 중')});
    const st=await stat(o.output);
    o.onProgress?.(1,'완료');
    return {output:o.output,duration:plan.total,bytes:st.size};
  }finally{if(!o.keepWork)await rm(work,{recursive:true,force:true}).catch(()=>{});}
}
