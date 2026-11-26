/** 장면 구간 · 카메라 움직임 · 전환 규칙 — 내보내기(render.ts)와 편집 화면 미리보기(Monitor.tsx)가 같이 쓴다.
 *
 *  고모 창작실 효과 규격(gomo.effects.v1)은 장면 하나(같은 그림)를 샷 클립 여러 개로 나눠 보낸다.
 *  샷마다 따로 움직임을 처음부터 다시 시작하고 샷 사이를 섞으면 화면이 꿀렁이고 어두워진다(깜박임).
 *  그래서 같은 장면의 연속 이미지 샷은 **한 구간**으로 묶고, 카메라(배율 z, 중심 cx·cy)를
 *  샷 경계에서 이어지게(속도까지 이어지게) 보간한다. 구간 사이만 xfade로 섞는다.
 *
 *  시간 규칙: 구간 시작 시각 = 클립 duration 누적값(자막·녹음 기준과 같음). 다음 구간과 섞일 시간만큼
 *  앞 구간을 뒤로 늘려 그린다(마지막 카메라 움직임이 그 시간 동안 이어짐). 그래서 전체 길이와 자막 시각은 그대로다.
 *  모든 시각은 프레임 단위로 반올림해 오차가 쌓이지 않게 한다. */
import type {Clip,ComposerProject} from './types';
import {clipDuration,motionState} from './project';

export const EFFECTS_SPEC='gomo.effects.v1';
export interface Cam{z:number;cx:number;cy:number}
export const CAM0:Cam={z:1,cx:.5,cy:.5};
export const Z_MAX=1.6;

/** 창작실 효과 규격 프로젝트인가 (전환 이름을 FFmpeg xfade 이름 그대로 해석) */
export function isEffectsProject(p:Pick<ComposerProject,'clips'>&{effects_spec?:unknown}):boolean{
  return p.effects_spec===EFFECTS_SPEC||p.clips.some(c=>typeof c.shot_index==='number');
}

// ── 전환 ──
/** 편집실이 그대로 쓰는 xfade 전환 (그 밖의 이름은 서서히 섞기로) */
export const XFADE_TYPES=new Set(['fade','fadeblack','fadewhite','fadegrays','wipeleft','wiperight','wipeup','wipedown','slideleft','slideright','slideup','slidedown',
  'smoothleft','smoothright','smoothup','smoothdown','circleopen','circleclose','circlecrop','rectcrop','radial','zoomin','hblur','distance','vertopen','vertclose','horzopen','horzclose','diagtl','diagtr','diagbl','diagbr']);
/** 프로젝트에 적힌 전환 이름 → 실제로 쓰는 xfade 이름 ('none' = 컷).
 *  - 'crossfade' = 서서히 섞기(xfade fade)
 *  - 'fade' = 예전 편집실 프로젝트에서는 「검은 화면 페이드」, 창작실 효과 규격에서는 xfade fade(서서히 섞기)
 *  - 'dissolve' = xfade dissolve 는 무작위 점으로 섞여 화면이 반짝인다 → 서서히 섞기로 바꿔 쓴다 */
export function resolveTransition(type:string|undefined|null,effects:boolean):string{
  const t=String(type||'').trim();
  if(!t||t==='none'||t==='cut')return 'none';
  if(t==='crossfade'||t==='dissolve')return 'fade';
  if(t==='fade')return effects?'fade':'fadeblack';
  return XFADE_TYPES.has(t)?t:'fade';
}

// ── 색감 (tone) ──
/** 3×3 RGB 행렬 (행 = 출력 R,G,B). FFmpeg colorchannelmixer 와 미리보기 SVG feColorMatrix 가 같은 값을 쓴다 */
export const TONES:Record<string,number[]>={
  warm:[1.06,.02,0, 0,1.02,0, 0,0,.92],
  cool:[.93,0,0, 0,1,.02, 0,.02,1.08],
  golden:[1.08,.04,0, .02,1.03,0, 0,0,.84],
  dusk:[1.04,0,.04, 0,.92,.02, .03,0,1.02],
  night:[.74,0,0, 0,.82,.04, 0,.04,1],
  bright:[1.1,0,0, 0,1.1,0, 0,0,1.1],
  sepia:[.393,.769,.189, .349,.686,.168, .272,.534,.131],
  mono:[.299,.587,.114, .299,.587,.114, .299,.587,.114]
};
export const TONE_LABELS:Record<string,string>={none:'원본',warm:'따뜻하게',cool:'차갑게',golden:'황금빛',dusk:'해질녘',night:'밤',bright:'밝게',sepia:'세피아',mono:'흑백'};
export const toneMatrix=(tone:unknown)=>typeof tone==='string'&&TONES[tone]?TONES[tone]:null;
/** 지금 구현한 분위기 효과 (그 밖의 overlay 는 무시하고 기록) */
export const OVERLAYS_SUPPORTED=new Set(['none','vignette']);

// ── 카메라 ──
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
export function clampCam(c:Cam):Cam{const z=clamp(c.z,1,Z_MAX);const m=.5/z;return {z,cx:clamp(c.cx,m,1-m),cy:clamp(c.cy,m,1-m)};}
const LEGACY_MOTIONS=new Set(['zoom_in','zoom_out','pan_left','pan_right','pan_up','pan_down','zoom_in_left','zoom_in_right','ken_burns']);

/** 앞 샷이 끝난 상태에서 이 샷의 motion 만큼 상대적으로 움직인 다음 상태 */
export function nextCam(from:Cam,clip:Pick<Clip,'motion'|'motion_strength'|'motion_focus'>,shotIndex=0):Cam{
  const s=clamp(Number(clip.motion_strength??.08)||0,0,.3);const c={...from};
  const pan=(axis:'cx'|'cy',dir:number)=>{let z=c.z;const need=.5/(z)+s/2;if(Math.abs(c[axis]+dir*s/2-.5)>.5-.5/z||need>.5)z=Math.max(z,1+s);
    const m=.5/z;return {...c,z,[axis]:clamp(c[axis]+dir*s/2,m,1-m)};};
  const focus=clip.motion_focus as {x?:number;y?:number}|undefined;
  switch(String(clip.motion||'static')){
    case 'zoom_in':return clampCam({...c,z:c.z+s});
    case 'zoom_out':return clampCam({...c,z:Math.max(1,c.z-s)});
    case 'pan_left':return clampCam(pan('cx',-1));
    case 'pan_right':return clampCam(pan('cx',1));
    case 'pan_up':return clampCam(pan('cy',-1));
    case 'pan_down':return clampCam(pan('cy',1));
    case 'focus_in':return clampCam({z:c.z+2*s,cx:clamp(Number(focus?.x??.5),0,1),cy:clamp(Number(focus?.y??.5),0,1)});
    case 'focus_out':return clampCam({z:Math.max(1,c.z-2*s),cx:c.cx+(.5-c.cx)*.8,cy:c.cy+(.5-c.cy)*.8});
    case 'drift':{const z=Math.max(c.z+s/2,1+s*.6);const dx=(c.cx<=.5?1:-1)*(shotIndex%2?-1:1),dy=c.cy<=.5?1:-1;return clampCam({z,cx:c.cx+dx*s/3,cy:c.cy+dy*s/3});}
    case 'zoom_in_left':return clampCam({z:c.z+s,cx:c.cx-s/2,cy:c.cy});
    case 'zoom_in_right':return clampCam({z:c.z+s,cx:c.cx+s/2,cy:c.cy});
    case 'ken_burns':return clampCam({z:c.z+s,cx:c.cx+s/2,cy:c.cy+s/2});
    default:return c;
  }
}

/** 단조 3차 에르미트(Fritsch–Carlson): 매듭 값을 지나며 속도가 이어지고, 넘치지 않는다. 양 끝 속도 0 = 구간 처음·끝만 ease */
export interface Spline{t:number[];y:number[];m:number[]}
export function monotoneSpline(t:number[],y:number[]):Spline{
  const n=t.length;const m=new Array(n).fill(0);
  const d:number[]=[];for(let i=0;i<n-1;i++){const h=t[i+1]-t[i];d.push(h>0?(y[i+1]-y[i])/h:0);}
  for(let i=1;i<n-1;i++){
    if(d[i-1]*d[i]<=0){m[i]=0;continue;}
    const h0=t[i]-t[i-1],h1=t[i+1]-t[i];const w1=2*h1+h0,w2=h1+2*h0;
    m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
  }
  return {t,y,m};
}
export function evalSpline(s:Spline,x:number):number{
  const {t,y,m}=s;const n=t.length;if(n===1||x<=t[0])return y[0];if(x>=t[n-1])return y[n-1];
  let i=0;while(i<n-2&&x>=t[i+1])i++;
  const h=t[i+1]-t[i];const u=(x-t[i])/h;const u2=u*u,u3=u2*u;
  return (2*u3-3*u2+1)*y[i]+(u3-2*u2+u)*h*m[i]+(-2*u3+3*u2)*y[i+1]+(u3-u2)*h*m[i+1];
}
/** FFmpeg 식: 같은 3차 식을 구간별 if 로 (변수 T = 초) */
export function splineExpr(s:Spline,T='T'):string{
  const {t,y,m}=s;const n=t.length;const num=(v:number)=>{const r=Math.round(v*1e6)/1e6;return r<0?`(${r})`:String(r);};
  if(n===1||y.every(v=>Math.abs(v-y[0])<1e-9))return num(y[0]);
  const piece=(i:number)=>{const h=t[i+1]-t[i];const u=`((${T}-${num(t[i])})/${num(h)})`;
    // 3차 다항식 계수 (u의 거듭제곱)
    const a=y[i],b=h*m[i],c=-3*y[i]-2*h*m[i]+3*y[i+1]-h*m[i+1],d=2*y[i]+h*m[i]-2*y[i+1]+h*m[i+1];
    return `(${num(a)}+${u}*(${num(b)}+${u}*(${num(c)}+${u}*${num(d)})))`;};
  let e=num(y[n-1]);
  for(let i=n-2;i>=0;i--)e=`if(lt(${T},${num(t[i+1])}),${piece(i)},${e})`;
  return `if(lt(${T},${num(t[0])}),${num(y[0])},${e})`;
}

export interface CameraPath{kind:'spline'|'legacy'|'static';z:Spline;cx:Spline;cy:Spline;legacy?:{motion:string;strength:number;length:number};keys:Cam[];times:number[]}
const constSpline=(v:number):Spline=>({t:[0],y:[v],m:[0]});
export function cameraAt(path:CameraPath,t:number):Cam{
  if(path.kind==='legacy'&&path.legacy){const L=path.legacy;const {z,fx,fy}=motionState(L.motion,L.strength,L.length>0?t/L.length:0);
    return {z,cx:z>1?(1-1/z)*fx+.5/z:.5,cy:z>1?(1-1/z)*fy+.5/z:.5};}
  return clampCam({z:evalSpline(path.z,t),cx:evalSpline(path.cx,t),cy:evalSpline(path.cy,t)});
}

// ── 장면 구간 ──
export interface Segment{
  index:number;clips:number[];type:'image'|'video';file:string;sceneId:string|null;
  /** 타임라인 시작(초, duration 누적) · 길이(초) */start:number;duration:number;
  /** 프레임 단위 시작 · 길이(다음 구간과 겹치는 여분 제외) · 실제로 그리는 프레임 수(여분 포함) */
  startFrame:number;frames:number;renderFrames:number;
  /** 이 구간으로 들어올 때의 전환 (xfade 이름, 프레임 단위 길이) */transition:{type:string;frames:number;duration:number;raw:string};
  /** 다음 구간과 겹쳐 그리는 여분(초) */handle:number;
  camera:CameraPath;tone:string|null;overlay:string|null;overlayStrength:number;
}
const same=(a:Clip,b:Clip)=>a.type==='image'&&b.type==='image'&&a.scene_id!=null&&a.scene_id!==''&&a.scene_id===b.scene_id&&a.file===b.file;

export function buildSegments(p:ComposerProject):Segment[]{
  const fps=Number(p.output.fps)||30;const effects=isEffectsProject(p);
  const groups:number[][]=[];
  p.clips.forEach((c,i)=>{const g=groups[groups.length-1];if(g&&same(p.clips[g[g.length-1]],c))g.push(i);else groups.push([i]);});
  let t=0;
  const segs:Segment[]=groups.map((g,index)=>{const first=p.clips[g[0]];const durs=g.map(i=>clipDuration(p.clips[i]));const duration=durs.reduce((n,d)=>n+d,0);
    const seg:Segment={index,clips:g,type:first.type,file:first.file,sceneId:first.scene_id!=null?String(first.scene_id):null,start:t,duration,startFrame:0,frames:0,renderFrames:0,
      transition:{type:'none',frames:0,duration:0,raw:String(first.transition?.type||'')},handle:0,camera:{kind:'static',z:constSpline(1),cx:constSpline(.5),cy:constSpline(.5),keys:[CAM0],times:[0]},
      tone:typeof first.tone==='string'&&first.tone!=='none'?first.tone:null,overlay:typeof first.overlay==='string'&&first.overlay!=='none'?first.overlay:null,overlayStrength:Number(first.overlay_strength??.5)};
    t+=duration;return seg;});
  const totalFrames=Math.round(t*fps);
  segs.forEach((s,k)=>{s.startFrame=Math.round(s.start*fps);});
  segs.forEach((s,k)=>{s.frames=Math.max(1,(k+1<segs.length?segs[k+1].startFrame:totalFrames)-s.startFrame);});
  // 들어오는 전환
  segs.forEach((s,k)=>{
    if(k===0)return;const prev=segs[k-1];const first=p.clips[s.clips[0]];
    const raw=first.transition??(effects?null:p.transition)??null;
    let type=resolveTransition(raw?.type,effects);let dur=Number(raw?.duration)||0;
    // 영상 장면: 기준 이미지 정지 샷 → 영상 샷 은 거의 같은 그림이라 짧은 서서히 섞기로 잇는다
    if(s.type==='video'&&prev.type==='image'&&s.sceneId&&s.sceneId===prev.sceneId){type='fade';dur=clamp(dur||.4,.3,.5);}
    if(type==='none'||dur<=0){s.transition={type:'none',frames:0,duration:0,raw:String(raw?.type||'')};return;}
    const maxFrames=Math.floor(Math.min(prev.frames,s.frames)/2);
    const frames=Math.min(maxFrames,Math.round(dur*fps));
    s.transition=frames>=1?{type,frames,duration:frames/fps,raw:String(raw?.type||'')}:{type:'none',frames:0,duration:0,raw:String(raw?.type||'')};
  });
  segs.forEach((s,k)=>{const nf=k+1<segs.length?segs[k+1].transition.frames:0;s.renderFrames=s.frames+nf;s.handle=nf/fps;s.camera=cameraPath(p,s,segs[k+1]);});
  return segs;
}

/** 구간의 카메라 경로 (구간 처음부터의 초). 마지막 매듭은 다음 구간과 섞이는 여분 끝까지 늘린다 */
function cameraPath(p:ComposerProject,s:Segment,next?:Segment):CameraPath{
  const fps=Number(p.output.fps)||30;const length=s.renderFrames/fps;
  const statik:CameraPath={kind:'static',z:constSpline(1),cx:constSpline(.5),cy:constSpline(.5),keys:[CAM0],times:[0]};
  if(s.type!=='image')return statik;
  const clips=s.clips.map(i=>p.clips[i]);
  // 영상 장면의 기준 이미지 정지 샷: 영상 첫 프레임과 맞도록 움직이지 않는다
  if(next&&next.type==='video'&&s.sceneId&&next.sceneId===s.sceneId)return statik;
  const first=clips[0];
  if(clips.length===1&&first.scene_id==null&&LEGACY_MOTIONS.has(String(first.motion||''))){
    const strength=Number(first.motion_strength??.15);
    return {...statik,kind:'legacy',legacy:{motion:String(first.motion),strength,length}};
  }
  const keys:Cam[]=[CAM0];const times:number[]=[0];let acc=0;
  clips.forEach((c,k)=>{keys.push(nextCam(keys[k],c,typeof c.shot_index==='number'?c.shot_index:k));acc+=clipDuration(c);times.push(k===clips.length-1?length:Math.min(acc,length));});
  if(keys.every(k=>Math.abs(k.z-1)<1e-9&&Math.abs(k.cx-.5)<1e-9&&Math.abs(k.cy-.5)<1e-9))return statik;
  // 같은 시각 매듭(길이 0 샷) 정리
  const T:number[]=[],K:Cam[]=[];times.forEach((x,i)=>{if(T.length&&x-T[T.length-1]<1e-6){K[K.length-1]=keys[i];return;}T.push(x);K.push(keys[i]);});
  return {kind:'spline',z:monotoneSpline(T,K.map(k=>k.z)),cx:monotoneSpline(T,K.map(k=>k.cx)),cy:monotoneSpline(T,K.map(k=>k.cy)),keys:K,times:T};
}

/** 렌더 때 무시한(아직 구현하지 않은) 효과 필드 */
export function ignoredEffects(p:ComposerProject):string[]{
  const out=new Set<string>();
  for(const c of p.clips){
    if(typeof c.overlay==='string'&&!OVERLAYS_SUPPORTED.has(c.overlay))out.add(`overlay=${c.overlay}`);
    if(typeof c.tone==='string'&&c.tone!=='none'&&!TONES[c.tone])out.add(`tone=${c.tone}`);
    if(c.type==='image'&&c.motion&&!['none','static','zoom_in','zoom_out','pan_left','pan_right','pan_up','pan_down','focus_in','focus_out','drift','zoom_in_left','zoom_in_right','ken_burns'].includes(String(c.motion)))out.add(`motion=${c.motion}`);
  }
  return [...out];
}
