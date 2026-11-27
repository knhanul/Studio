import type {Bgm,Clip,ComposerProject,DubbingTake,SubtitleItem,Transition} from './types';

export const DEFAULT_IMAGE_SECONDS=4;
export const round=(n:number,d=3)=>{const k=10**d;return Math.round(n*k)/k;};
export const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));

export function createProject(title='제목 없음'):ComposerProject{
  return {version:2,title,output:{width:1920,height:1080,fps:30,fit:'cover',file:'output.mp4'},transition:{type:'crossfade',duration:.5},clips:[],
    subtitle:{offset:0,burn_in:true,items:[],style:{font:'Malgun Gothic',size:52,color:'#FFFFFF',position:'bottom',outline:2.5,box:false,margin_v:70}},
    bgm:{file:null,volume:.25,loop:true,duck_under_voice:true,duck_ratio:6,fade_in:1,fade_out:2},dubbing:{folder:'takes',takes:[],volume:1},tracks:{}};
}
export function normalizeProject(raw:unknown):ComposerProject{
  if(!raw||typeof raw!=='object')throw new Error('올바른 프로젝트 JSON이 아닙니다.');
  const d=raw as Partial<ComposerProject>;
  if(d.version!==2&&d.version!==1)throw new Error('지원되지 않는 프로젝트 버전입니다. (v1 / v2만 열 수 있음)');
  const base=createProject(d.title||'제목 없음');
  return {...base,...d,version:d.version,clips:Array.isArray(d.clips)?d.clips:[],output:{...base.output,...d.output},transition:{...base.transition,...d.transition},
    subtitle:{...base.subtitle,...d.subtitle,style:{...base.subtitle.style,...(d.subtitle?.style||{})}},bgm:{...base.bgm,...d.bgm},
    dubbing:{...base.dubbing,...d.dubbing,takes:Array.isArray(d.dubbing?.takes)?d.dubbing.takes:[]}};
}

/** 영상 클립에서 실제로 쓰는 원본 구간 길이(초). 원본 길이를 모르면 null */
export function videoSourceSpan(c:Clip):number|null{
  const start=Number(c.trim_start)||0;
  const end=c.trim_end!=null?Number(c.trim_end):(typeof c.source_duration==='number'&&c.source_duration>0?c.source_duration:null);
  return end==null?null:Math.max(.1,end-start);
}
export function clipDuration(c:Clip):number{
  if(typeof c.fit_duration==='number'&&c.fit_duration>0)return c.fit_duration;
  if(c.type==='image')return Math.max(.1,Number(c.duration)||DEFAULT_IMAGE_SECONDS);
  const span=videoSourceSpan(c);
  if(span!=null)return Math.max(.1,span/Math.max(.1,Number(c.speed)||1));
  return Math.max(.1,Number(c.duration)||DEFAULT_IMAGE_SECONDS); // 원본 길이를 아직 모르는 영상: 추정값
}
/** 영상 재생 배속 (길이 맞춤이 있으면 그 길이에 맞춘 배속) */
export function clipSpeed(c:Clip):number{
  if(c.type!=='video')return 1;
  const span=videoSourceSpan(c);
  if(typeof c.fit_duration==='number'&&c.fit_duration>0&&span!=null)return span/c.fit_duration;
  return Math.max(.1,Number(c.speed)||1);
}
export function timeline(data:ComposerProject){let offset=0;return data.clips.map((clip,index)=>{const start=offset;const duration=clipDuration(clip);offset+=duration;return {clip,index,start,duration,end:offset};});}
export function totalDuration(data:ComposerProject){return timeline(data).reduce((n,c)=>n+c.duration,0);}
/** i번째 클립으로 들어올 때의 전환 (첫 클립은 없음). 전환 길이는 두 클립 중 짧은 쪽의 절반을 넘지 않음 */
export function transitionInto(data:ComposerProject,i:number):Transition{
  if(i<=0||i>=data.clips.length)return {type:'none',duration:0};
  const t=data.clips[i].transition||data.transition||{type:'none',duration:0};
  if(!t.type||t.type==='none'||!(t.duration>0))return {type:'none',duration:0};
  const limit=Math.min(clipDuration(data.clips[i-1]),clipDuration(data.clips[i]))/2;
  return {type:t.type,duration:round(Math.min(t.duration,limit),3)};
}

export const fmt=(sec:number)=>`${Math.floor(Math.max(sec,0)/60).toString().padStart(2,'0')}:${(Math.max(sec,0)%60).toFixed(1).padStart(4,'0')}`;
/** "01:05.5" · "65.5" · "1:02:03.4" 형식의 시간 입력을 초로 */
export function parseTime(text:string):number|null{
  const s=text.trim().replace(',','.');if(!s)return null;
  const parts=s.split(':');if(parts.length>3)return null;
  let total=0;for(const p of parts){if(!/^\d+(\.\d+)?$/.test(p))return null;total=total*60+parseFloat(p);}
  return total;
}
const tc=(seconds:number)=>{const ms=Math.max(0,Math.round(seconds*1000));const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),re=ms%1000;return `${[h,m,s].map(n=>String(n).padStart(2,'0')).join(':')},${String(re).padStart(3,'0')}`;};
export function toSrt(items:SubtitleItem[]):string{return items.map((it,i)=>`${i+1}\n${tc(it.start)} --> ${tc(it.end)}\n${it.text}`).join('\n\n')+'\n';}
export function fromSrt(text:string):SubtitleItem[]{
  const time=(v:string)=>{const [h,mi,rest]=v.replace(',','.').split(':');return (+h)*3600+(+mi)*60+parseFloat(rest);};
  return text.replace(/\r/g,'').replace(/^\uFEFF/,'').trim().split(/\n\s*\n/).map(block=>{
    const m=block.match(/(?:^|\n)(\d{1,2}:\d\d:\d\d[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d\d:\d\d[,.]\d{1,3})[^\n]*/);if(!m)return null;
    return {index:0,start:time(m[1]),end:time(m[2]),text:block.slice((m.index||0)+m[0].length).trim()};
  }).filter((it):it is SubtitleItem=>Boolean(it)).map((it,i)=>({...it,index:i+1}));
}
export function validProject(d:ComposerProject):string[]{const warnings:string[]=[];if(!d.clips.length)warnings.push('클립이 없습니다.');d.clips.forEach((c,i)=>{if(!c.file)warnings.push(`${i+1}번 클립 파일 경로 없음`);if(clipDuration(c)<=0)warnings.push(`${i+1}번 클립 길이 오류`);});return warnings;}

// ── 자막 ───────────────────────────────────────────
/** 화면에 실제로 나오는 자막 (전체 밀기 offset 적용, 시간순) */
export function projectCues(d:ComposerProject):SubtitleItem[]{
  const off=Number(d.subtitle.offset)||0;
  return [...(d.subtitle.items||[])].map(c=>({...c,start:round(c.start+off),end:round(c.end+off)})).sort((a,b)=>a.start-b.start);
}
export function nextCueIndex(d:ComposerProject):number{return Math.max(0,...(d.subtitle.items||[]).map(s=>s.index))+1;}
export function sortCues(items:SubtitleItem[]):SubtitleItem[]{return [...items].sort((a,b)=>a.start-b.start||a.index-b.index);}

// ── 더빙 ───────────────────────────────────────────
/** 녹음 파일 0초가 놓이는 타임라인 시각 (영상 합성기 take_position 과 같은 규칙) */
export function takePosition(take:DubbingTake,cues:SubtitleItem[],latencyMs=0):number{
  let base=0;
  if(take.subtitle!=null){const cue=cues.find(c=>c.index===take.subtitle);if(cue)base=cue.start;}
  return base+(Number(take.offset)||0)-latencyMs/1000;
}
/** 실제로 들리는 녹음 길이 (앞뒤 자르기 반영). 파일 길이를 모르면 0 */
export function takeLength(take:DubbingTake):number{
  const start=Number(take.trim_start)||0;
  const end=take.trim_end!=null?Number(take.trim_end):(Number(take.duration)||0);
  return Math.max(0,end-start);
}
/** 타임라인에서 목소리가 들리는 구간 */
export function takeSpan(take:DubbingTake,cues:SubtitleItem[],latencyMs=0):{start:number;end:number}{
  const start=takePosition(take,cues,latencyMs)+(Number(take.trim_start)||0);
  return {start,end:start+takeLength(take)};
}
export function takeForCue(d:ComposerProject,cueIndex:number):DubbingTake|undefined{
  const list=d.dubbing.takes.filter(t=>t.subtitle===cueIndex);return list[list.length-1];
}
/** 한 문장에는 녹음 하나만 연결 (다시 녹음하면 교체, 파일은 지우지 않음) */
export function setTakeForCue(d:ComposerProject,take:DubbingTake):ComposerProject{
  return {...d,dubbing:{...d.dubbing,takes:[...d.dubbing.takes.filter(t=>t.subtitle!==take.subtitle),take]}};
}
export function removeTakeForCue(d:ComposerProject,cueIndex:number):ComposerProject{
  return {...d,dubbing:{...d.dubbing,takes:d.dubbing.takes.filter(t=>t.subtitle!==cueIndex)}};
}
/** 앞뒤 무음 자르기 결과를 반영: 목소리가 자막 시작 시각에 바로 나오도록 offset = -trim_start */
export function applyTrim(take:DubbingTake,trimStart:number,trimEnd:number|null):DubbingTake{
  const ts=round(Math.max(0,trimStart));
  return {...take,trim_start:ts,trim_end:trimEnd==null?null:round(Math.max(ts+.05,trimEnd)),offset:round(-ts)};
}

// ── 장면별 자막 묶기 / 더빙 길이에 맞춤 ─────────────────
/** 각 장면(클립)에 속한 자막 번호들. 자막 가운데 시각이 들어 있는 장면에 속함 */
export function cuesByClip(d:ComposerProject):number[][]{
  const tl=timeline(d);const out=tl.map(()=>[] as number[]);
  for(const cue of sortCues(d.subtitle.items||[])){
    const mid=(cue.start+cue.end)/2;
    let i=tl.findIndex(t=>mid>=t.start&&mid<t.end);
    if(i<0)i=tl.length-1;
    if(i>=0)out[i].push(cue.index);
  }
  return out;
}
export interface FitOptions{lead:number;gap:number;tail:number;minImage:number}
export const DEFAULT_FIT:FitOptions={lead:.3,gap:.25,tail:.6,minImage:1.5};
/** 녹음된 문장 길이에 맞춰 자막 시간과 이미지 장면 길이를 다시 계산.
 *  - 녹음이 있는 자막: 길이 = 녹음 길이, 없는 자막: 원래 길이 유지
 *  - 이미지 장면: 자막이 들어갈 만큼 늘이거나 줄임 / 영상 장면: 길이 유지 */
export function fitTimelineToTakes(d:ComposerProject,opt:FitOptions=DEFAULT_FIT):ComposerProject{
  const next:ComposerProject=JSON.parse(JSON.stringify(d));
  const groups=cuesByClip(d);
  const items=next.subtitle.items||[];
  const byIndex=new Map(items.map(c=>[c.index,c]));
  const off=Number(next.subtitle.offset)||0;
  let cursor=0;
  next.clips.forEach((clip,i)=>{
    const ids=groups[i]||[];
    if(ids.length){
      let t=cursor+opt.lead;
      for(const id of ids){
        const cue=byIndex.get(id)!;const take=takeForCue(d,id);
        const len=take&&takeLength(take)>0?takeLength(take):Math.max(.3,cue.end-cue.start);
        cue.start=round(t-off);cue.end=round(t+len-off);t+=len+opt.gap;
      }
      if(clip.type==='image'){clip.duration=round(Math.max(opt.minImage,t-opt.gap+opt.tail-cursor),2);clip.fit_duration=null;}
    }
    cursor+=clipDuration(clip);
  });
  next.subtitle.items=sortCues(items);
  return next;
}

// ── 고모 창작실 연동 ─────────────────────────────────
export interface CreatorHandoff{schema?:string;title?:string;output?:{ratio?:string};scenes?:{id:string;title?:string;narration?:string;durationSec?:number;asset?:string|null}[];
  assembly?:{clips?:{sceneId:string;durationSec:number;transition?:string}[];subtitleMode?:string;bgmAssetId?:string|null};media?:{id:string;kind:string;path:string;name?:string}[]}
export function isCreatorHandoff(raw:unknown):raw is CreatorHandoff{return Boolean(raw&&typeof raw==='object'&&typeof (raw as CreatorHandoff).schema==='string'&&(raw as CreatorHandoff).schema!.startsWith('creator.handoff'));}
const mediaKind=(file:string):'image'|'video'|null=>/\.(png|jpe?g|webp|bmp|gif)$/i.test(file)?'image':/\.(mp4|mov|webm|m4v|mkv)$/i.test(file)?'video':null;
/** 창작실 gomo-handoff.json → 편집 프로젝트(v2). composer_project.json이 없을 때 쓴다 */
export function fromCreatorHandoff(h:CreatorHandoff):ComposerProject{
  const p=createProject(h.title||'제목 없음');
  const ratio=h.output?.ratio;
  if(ratio==='9:16'){p.output.width=1080;p.output.height=1920;}else if(ratio==='1:1'){p.output.width=1080;p.output.height=1080;}
  const scenes=h.scenes||[];
  const order=(h.assembly?.clips?.length?h.assembly.clips:scenes.map(s=>({sceneId:s.id,durationSec:s.durationSec||DEFAULT_IMAGE_SECONDS,transition:undefined as string|undefined})));
  let cursor=0;const items:SubtitleItem[]=[];
  for(const c of order){
    const s=scenes.find(x=>x.id===c.sceneId);if(!s||!s.asset)continue;
    const kind=mediaKind(s.asset);if(!kind)continue;
    const dur=Math.max(.5,Number(c.durationSec)||Number(s.durationSec)||DEFAULT_IMAGE_SECONDS);
    const tr=c.transition==='cut'?'none':c.transition==='fade_black'?'fadeblack':'crossfade'; // 창작실 fade = 서서히 섞기
    const clip:Clip={file:s.asset,type:kind,label:s.title||'',transition:{type:tr,duration:tr==='none'?0:Math.min(.5,dur/4)},motion:kind==='image'?'zoom_in':'none',motion_strength:.08};
    if(kind==='image')clip.duration=dur;else{clip.fit_duration=dur;clip.mute=true;}
    p.clips.push(clip);
    if(h.assembly?.subtitleMode!=='none'&&s.narration?.trim())items.push({index:items.length+1,start:round(cursor+.2),end:round(cursor+dur-.2),text:s.narration.trim()});
    cursor+=dur;
  }
  p.subtitle.items=items;
  const music=h.media?.find(m=>m.id===h.assembly?.bgmAssetId&&m.kind==='audio');
  if(music)p.bgm={...p.bgm,file:music.path};
  return p;
}

// ── 미리보기 움직임 (렌더의 perspective 식과 같은 경로) ──────
export const MOTIONS:{id:string;label:string}[]=[
  {id:'none',label:'움직임 없음'},{id:'zoom_in',label:'천천히 다가가기'},{id:'zoom_out',label:'천천히 멀어지기'},
  {id:'pan_left',label:'왼쪽으로 흐르기'},{id:'pan_right',label:'오른쪽으로 흐르기'},{id:'pan_up',label:'위로 흐르기'},{id:'pan_down',label:'아래로 흐르기'},{id:'ken_burns',label:'대각선 다가가기'},
  {id:'static',label:'고정'},{id:'focus_in',label:'초점으로 다가가기'},{id:'focus_out',label:'초점에서 물러나기'},{id:'drift',label:'부드럽게 흐르기'}
];
/** 편집실에서 고르는 전환. 'fade'는 예전 프로젝트의 「검은 화면 페이드」와 헷갈리므로 새로 쓸 때는 fadeblack 으로 적는다 */
export const TRANSITIONS:{id:string;label:string}[]=[{id:'none',label:'바로 전환'},{id:'crossfade',label:'서서히 바뀜'},{id:'fadeblack',label:'검은 화면 페이드'}];
export function easeProgress(t:number,linear=false){const x=clamp(t,0,1);return linear?x:(1-Math.cos(Math.PI*x))/2;}
/** 확대 배율 z와 남는 공간 중 위치(fx, fy: 0~1) */
export function motionState(motion:string|undefined,strength:number|undefined,t:number):{z:number;fx:number;fy:number}{
  const p=easeProgress(t);const s=clamp(Number(strength??.15),0,1);
  switch(motion){
    case 'zoom_in':return {z:1+s*p,fx:.5,fy:.5};
    case 'zoom_out':return {z:1+s*(1-p),fx:.5,fy:.5};
    case 'pan_right':return {z:1+s,fx:p,fy:.5};
    case 'pan_left':return {z:1+s,fx:1-p,fy:.5};
    case 'pan_down':return {z:1+s,fx:.5,fy:p};
    case 'pan_up':return {z:1+s,fx:.5,fy:1-p};
    case 'zoom_in_left':return {z:1+s*p,fx:.5-.5*p,fy:.5};
    case 'zoom_in_right':return {z:1+s*p,fx:.5+.5*p,fy:.5};
    case 'ken_burns':return {z:1+s*p,fx:p,fy:p};
    default:return {z:1,fx:0,fy:0};
  }
}
/** CSS transform (transform-origin: 0 0) */
export function motionCss(motion:string|undefined,strength:number|undefined,t:number):string{
  const {z,fx,fy}=motionState(motion,strength,t);if(z===1)return 'none';
  return `translate(${round(-(z-1)*fx*100,3)}%, ${round(-(z-1)*fy*100,3)}%) scale(${round(z,4)})`;
}

// ── BGM 덕킹 미리보기 ───────────────────────────────
/** 목소리가 나오는 동안 배경음악 크기 배율 (ratio 6 ≈ 약 0.35배) */
export function duckFactor(bgm:Bgm):number{const r=Math.max(1,Number(bgm.duck_ratio)||6);return round(Math.max(.15,1/Math.sqrt(r)*.85),3);}
