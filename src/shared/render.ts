/** FFmpeg 명령 생성 (순수 함수, 테스트 가능).
 *  기존 영상 합성기(knhanul/dubbing) composer/render/ffmpeg_builder.py 의 2단계 방식을 가볍게 옮겼다.
 *  1) 장면마다 같은 해상도·fps·48kHz 스테레오 중간 파일(.mkv)
 *  2) 전환(xfade/acrossfade)으로 잇고 자막(ASS)·더빙·배경음악(덕킹)을 섞어 MP4
 *  이미지 움직임은 perspective 필터의 소수점 좌표를 써서 떨림이 없다. */
import type {ComposerProject,SubtitleItem} from './types';
import {clipDuration,clipSpeed,projectCues,takePosition} from './project';
import {buildSegments,ignoredEffects,resolveTransition,splineExpr,toneMatrix,type Segment} from './camera';
import {musicLayers} from './media';

export const AUDIO_RATE=48000;
export interface MediaInfo{duration:number|null;hasAudio:boolean;
  /** 앞에서 잘라 낼 검은(또는 늦게 나오는) 첫 프레임 구간(초) */lead?:number}
export interface RenderOptions{
  draft:boolean;
  /** 프로젝트 기준 상대 경로 → 절대 경로 */
  resolve:(rel:string)=>string;
  /** 절대 경로의 미디어 정보 (없으면 길이 모름·소리 없음) */
  info:(abs:string)=>MediaInfo|undefined;
  /** 작업 폴더 안 파일 절대 경로 */
  workFile:(name:string)=>string;
  output:string;
  /** Windows 글꼴 폴더 등 (선택) */
  fontsDir?:string;
}
export interface ClipJob{index:number;args:string[];output:string;duration:number}
export interface RenderPlan{size:{w:number;h:number};fps:number;total:number;clipJobs:ClipJob[];assembly:{args:string[];graph:string};ass:string|null;
  /** 아직 구현하지 않아 무시한 효과 필드 (로그용) */ignored:string[]}

export const f=(v:number)=>{const s=(Math.round(v*1e6)/1e6).toFixed(6).replace(/0+$/,'').replace(/\.$/,'');return s==='-0'?'0':s;};
const even=(n:number)=>Math.max(2,Math.round(n/2)*2);
export function renderSize(p:ComposerProject,draft:boolean){
  const w=even(p.output.width||1920),h=even(p.output.height||1080);
  if(!draft)return {w,h};
  const k=Math.min(1,640/Math.max(w,h));return {w:even(w*k),h:even(h*k)};
}
export function atempoChain(speed:number):string[]{
  if(Math.abs(speed-1)<1e-6)return [];
  const parts:number[]=[];let s=speed;
  while(s>2){parts.push(2);s/=2;}while(s<.5){parts.push(.5);s/=.5;}parts.push(s);
  return parts.map(x=>`atempo=${f(x)}`);
}
export function fitFilters(fit:string,w:number,h:number,bg='#000000'):string[]{
  if(fit==='contain')return [`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`,`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg.replace('#','0x')}`];
  return [`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`,`crop=${w}:${h}:(iw-ow)/2:(ih-oh)/2`];
}
/** perspective 필터 꼭짓점 식 (쉼표 없는 식만) — 영상 합성기 motion_quad 와 같은 경로 */
export function motionFilter(motion:string,strength:number,frames:number):string|null{
  const n1=Math.max(1,frames-1);const lin=`(in/${n1})`;const p=`((1-cos(PI*${lin}))/2)`;
  const s=f(Math.max(0,Math.min(1,strength)));
  const zin=`(1+${s}*${p})`,zout=`(1+${s}*(1-${p}))`,zfix=`(1+${s})`;
  const table:Record<string,[string,string,string]>={zoom_in:[zin,'0.5','0.5'],zoom_out:[zout,'0.5','0.5'],pan_right:[zfix,p,'0.5'],pan_left:[zfix,`(1-${p})`,'0.5'],
    pan_down:[zfix,'0.5',p],pan_up:[zfix,'0.5',`(1-${p})`],zoom_in_left:[zin,`(0.5-0.5*${p})`,'0.5'],zoom_in_right:[zin,`(0.5+0.5*${p})`,'0.5'],ken_burns:[zin,p,p]};
  const row=table[motion];if(!row||Number(strength)<=0)return null;
  const [z,fx,fy]=row;const cw=`(W/${z})`,ch=`(H/${z})`;const x=`((W-W/${z})*${fx})`,y=`((H-H/${z})*${fy})`;
  const q={x0:x,y0:y,x1:`${x}+${cw}`,y1:y,x2:x,y2:`${y}+${ch}`,x3:`${x}+${cw}`,y3:`${y}+${ch}`};
  return `perspective=${Object.entries(q).map(([k,v])=>`${k}='${v}'`).join(':')}:interpolation=cubic:sense=source:eval=frame`;
}
export function encoderArgs(draft:boolean,stage:'intermediate'|'final',fps:number):string[]{
  const gop=String(Math.max(1,Math.round(fps*2)));
  if(draft)return ['-c:v','libx264','-preset','veryfast','-crf','24','-g',gop,'-pix_fmt','yuv420p'];
  if(stage==='intermediate')return ['-c:v','libx264','-preset','veryfast','-crf','14','-g',gop,'-pix_fmt','yuv420p'];
  return ['-c:v','libx264','-preset','medium','-crf','18','-g',gop,'-pix_fmt','yuv420p'];
}
/** 예전 이름 호환 — 실제 규칙은 camera.ts resolveTransition */
export const xfadeName=(type:string)=>resolveTransition(type,false);

// ── 자막 ASS ──
export function assColor(hex:string|undefined,alpha=0):string{
  let h=(hex||'#FFFFFF').replace('#','');if(!/^[0-9a-fA-F]{6}$/.test(h))h='FFFFFF';
  const a=Math.round(Math.max(0,Math.min(1,alpha))*255).toString(16).padStart(2,'0');
  return `&H${a}${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}`.toUpperCase();
}
export function assTime(sec:number):string{const cs=Math.max(0,Math.round(sec*100));const h=Math.floor(cs/360000),m=Math.floor(cs%360000/6000),s=Math.floor(cs%6000/100),c=cs%100;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;}
export function assText(text:string):string{return text.replace(/\r/g,'').replace(/[{}]/g,m=>m==='{'?'(':')').replace(/\\/g,'＼').split('\n').map(s=>s.trim()).filter(Boolean).join('\\N');}
export function buildAss(p:ComposerProject,cues:SubtitleItem[],w:number,h:number):string{
  const st=p.subtitle.style||{};const k=h/Math.max(1,p.output.height||h);
  const size=Math.round((Number(st.size)||52)*k);const margin=Math.round((Number(st.margin_v)||60)*k);
  const align=st.position==='top'?8:st.position==='center'?5:2;
  const box=Boolean(st.box);
  const outline=box?Math.max(2,Math.round(12*k)):Math.round((Number(st.outline??2)||0)*k*10)/10;
  const outlineColour=box?assColor(st.box_color||'#000000',1-(Number(st.box_opacity??.6))):assColor(st.outline_color||'#000000');
  const style=['Default',st.font||'Malgun Gothic',size,assColor(st.color||'#FFFFFF'),assColor(st.color||'#FFFFFF'),outlineColour,box?outlineColour:assColor('#000000',.5),
    st.bold===false?0:-1,0,0,0,100,100,0,0,box?3:1,outline,0,align,Math.round(40*k),Math.round(40*k),margin,1].join(',');
  const lines=cues.filter(c=>c.end>c.start&&c.text.trim()).map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`);
  return ['[Script Info]','ScriptType: v4.00+',`PlayResX: ${w}`,`PlayResY: ${h}`,'WrapStyle: 0','ScaledBorderAndShadow: yes','',
    '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,'','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',...lines,''].join('\n');
}

// ── 1단계: 장면 구간 중간 파일 ──
/** 카메라 경로 → perspective 필터 (원본을 키운 뒤 소수점 좌표로 잘라 내므로 떨림이 없다) */
export function cameraFilter(seg:Segment,fps:number):string|null{
  const cam=seg.camera;
  if(cam.kind==='static')return null;
  if(cam.kind==='legacy'&&cam.legacy)return motionFilter(cam.legacy.motion,cam.legacy.strength,Math.max(1,seg.renderFrames));
  const T=`(in/${f(fps)})`;
  const Z=`(${splineExpr(cam.z,T)})`;
  const cxs=splineExpr(cam.cx,T),cys=splineExpr(cam.cy,T);
  const X=`(clip(${cxs},0.5/${Z},1-0.5/${Z})-0.5/${Z})`,Y=`(clip(${cys},0.5/${Z},1-0.5/${Z})-0.5/${Z})`;
  const q={x0:`W*${X}`,y0:`H*${Y}`,x1:`W*(${X}+1/${Z})`,y1:`H*${Y}`,x2:`W*${X}`,y2:`H*(${Y}+1/${Z})`,x3:`W*(${X}+1/${Z})`,y3:`H*(${Y}+1/${Z})`};
  return `perspective=${Object.entries(q).map(([k,v])=>`${k}='${v}'`).join(':')}:interpolation=cubic:sense=source:eval=frame`;
}
/** 색감·분위기 효과: 구간마다 xfade 전에 넣어 전환 동안 자연스럽게 섞이게 한다 */
export function lookFilters(seg:Segment):string[]{
  const out:string[]=[];const m=toneMatrix(seg.tone);
  if(m){const k=['rr','rg','rb','gr','gg','gb','br','bg','bb'];out.push('format=gbrp',`colorchannelmixer=${k.map((n,i)=>`${n}=${f(m[i])}`).join(':')}`);}
  if(seg.overlay==='vignette')out.push(`vignette=angle=${f(.3+.6*Math.max(0,Math.min(1,seg.overlayStrength)))}`);
  return out;
}
export function buildClipJobs(p:ComposerProject,o:RenderOptions,segments:Segment[]=buildSegments(p)):ClipJob[]{
  const {w,h}=renderSize(p,o.draft);const fps=Number(p.output.fps)||30;const fs=f(fps);const up=o.draft?1:2;
  return segments.map(seg=>{
    const clip=p.clips[seg.clips[0]];
    const N=Math.max(1,seg.renderFrames);const len=N/fps;const ls=f(len);const src=o.resolve(seg.file);const out=o.workFile(`clip_${String(seg.index).padStart(3,'0')}.mkv`);
    const fit=String(clip.fit||p.output.fit||'cover');const bg=String(p.output.background||'#000000');
    const args=['-hide_banner','-y','-nostdin'];let vf:string[];let useAudio=false;
    const eq=[clip.brightness,clip.contrast,clip.saturation].some(v=>v!=null&&v!==0&&v!==1)?[`eq=brightness=${f(Number(clip.brightness)||0)}:contrast=${f(clip.contrast==null?1:Number(clip.contrast))}:saturation=${f(clip.saturation==null?1:Number(clip.saturation))}`]:[];
    const look=[...eq,...lookFilters(seg)];
    // 모든 구간 공통 끝맺음: 같은 크기·SAR·픽셀 형식·fps, 프레임 수를 정확히 N개로
    const tail=[...look,'setsar=1','format=yuv420p',`tpad=stop_mode=clone:stop=-1`,`trim=end_frame=${N}`,'setpts=N/FRAME_RATE/TB'];
    if(seg.type==='image'){
      args.push('-loop','1','-framerate',fs,'-t',f(len+2/fps),'-i',src);
      const mf=cameraFilter(seg,fps);
      vf=mf?[...fitFilters(fit,w*up,h*up,bg),'format=yuv444p',mf,...(up>1?[`scale=${w}:${h}:flags=lanczos`]:[]),`fps=${fs}`]:[...fitFilters(fit,w,h,bg),`fps=${fs}`];
    }else{
      const info=o.info(src);
      // 첫 프레임이 검거나 늦게 나오는 영상: 앞을 조금 잘라 내고 다시 인코딩 (사용자가 시작점을 정했으면 그대로)
      const start=Number(clip.trim_start)>0?Number(clip.trim_start):Math.min(.5,Math.max(0,Number(info?.lead)||0));
      const end=clip.trim_end!=null?Number(clip.trim_end):(info?.duration??(typeof clip.source_duration==='number'?clip.source_duration:null));
      const speed=clipSpeed({...clip,trim_start:start,source_duration:info?.duration??clip.source_duration});
      if(start>0)args.push('-ss',f(start));
      if(end!=null)args.push('-t',f(Math.max(.1,end-start)));
      args.push('-i',src);
      vf=[Math.abs(speed-1)>1e-6?`setpts=(PTS-STARTPTS)/${f(speed)}`:'setpts=PTS-STARTPTS',`fps=${fs}`,...fitFilters(fit,w,h,bg)];
      useAudio=Boolean(info?.hasAudio)&&!clip.mute&&(clip.volume==null||Number(clip.volume)>0);
      if(useAudio){
        const af=['asetpts=PTS-STARTPTS',...atempoChain(speed),`aresample=${AUDIO_RATE}`,'aformat=sample_fmts=fltp:channel_layouts=stereo',
          ...(clip.volume!=null&&Math.abs(Number(clip.volume)-1)>1e-6?[`volume=${f(Number(clip.volume))}`]:[]),`apad=whole_dur=${ls}`,`atrim=duration=${ls}`];
        vf.push(...tail);
        args.push('-filter_complex',`[0:v]${vf.join(',')}[v];[0:a]${af.join(',')}[a]`,'-map','[v]','-map','[a]');
      }
    }
    if(!useAudio){
      vf.push(...tail);
      args.push('-f','lavfi','-t',ls,'-i',`anullsrc=r=${AUDIO_RATE}:cl=stereo`,'-filter_complex',`[0:v]${vf.join(',')}[v]`,'-map','[v]','-map','1:a');
    }
    args.push(...encoderArgs(o.draft,'intermediate',fps),'-r',fs,'-frames:v',String(N),'-c:a','pcm_s16le','-ar',String(AUDIO_RATE),'-ac','2','-t',ls,'-progress','pipe:1','-nostats',out);
    return {index:seg.index,args,output:out,duration:len};
  });
}

// ── 2단계: 조립 ──
export function buildAssembly(p:ComposerProject,o:RenderOptions,clipFiles:string[],assName:string|null,segments:Segment[]=buildSegments(p)):{args:string[];graph:string;total:number}{
  const fps=Number(p.output.fps)||30;const fs=f(fps);
  const totalFrames=Math.round(p.clips.reduce((n,c)=>n+clipDuration(c),0)*fps);const total=totalFrames/fps;const ts=f(total);
  const args=['-hide_banner','-y','-nostdin'];const g:string[]=[];
  clipFiles.forEach(file=>args.push('-i',file));
  const n=clipFiles.length;
  for(let i=0;i<n;i++){g.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${fs}[v${i}]`);g.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);}
  // 구간 사이만 섞는다. offset = 구간 시작 프레임 / fps (프레임 단위라 오차가 쌓이지 않음)
  let cv='v0',ca='a0';
  for(let i=1;i<n;i++){
    const seg=segments[i];const tr=seg.transition;const nv=`vx${i}`,na=`ax${i}`;
    if(tr.frames<=0){g.push(`[${cv}][${ca}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);}
    else{g.push(`[${cv}][v${i}]xfade=transition=${tr.type}:duration=${f(tr.frames/fps)}:offset=${f(seg.startFrame/fps)}[${nv}]`);g.push(`[${ca}][a${i}]acrossfade=d=${f(tr.frames/fps)}:c1=tri:c2=tri[${na}]`);}
    cv=nv;ca=na;
  }
  let vlast=cv;
  if(assName){const fd=o.fontsDir?`:fontsdir='${o.fontsDir.replace(/\\/g,'/').replace(/:/g,'\\:')}'`:'';g.push(`[${vlast}]ass=filename=${assName}${fd}[vsub]`);vlast='vsub';}
  const fin=Number(p.output.fade_in)||0,fout=Number(p.output.fade_out)||0;
  const fv=[...(fin>0?[`fade=t=in:st=0:d=${f(fin)}`]:[]),...(fout>0?[`fade=t=out:st=${f(Math.max(0,total-fout))}:d=${f(fout)}`]:[])];
  const fa=[...(fin>0?[`afade=t=in:st=0:d=${f(fin)}`]:[]),...(fout>0?[`afade=t=out:st=${f(Math.max(0,total-fout))}:d=${f(fout)}`]:[])];
  g.push(`[${vlast}]${[...fv,'format=yuv420p',`trim=end_frame=${totalFrames}`].join(',')}[vout]`);
  // 오디오
  let idx=n;g.push(`[${ca}]volume=${f(Number(p.output.original_volume??1))}[abase]`);const mix=['[abase]'];
  const cues=projectCues(p);const latency=Number(p.dubbing.latency_ms)||0;const dv=Number(p.dubbing.volume??1);
  const voices:string[]=[];
  p.dubbing.takes.forEach((t,j)=>{
    const src=o.resolve(t.file);const pos=takePosition(t,cues,latency);
    const s0=Math.max(Number(t.trim_start)||0,pos<0?-pos:0);
    const chain=[`aresample=${AUDIO_RATE}`,'aformat=sample_fmts=fltp:channel_layouts=stereo'];
    if(s0>0||t.trim_end!=null)chain.push(`atrim=start=${f(s0)}${t.trim_end!=null?`:end=${f(Number(t.trim_end))}`:''}`,'asetpts=PTS-STARTPTS');
    chain.push(`volume=${f((t.volume==null?1:Number(t.volume))*dv)}`);
    const ms=Math.round(Math.max(0,pos+s0)*1000);if(ms>0)chain.push(`adelay=delays=${ms}:all=1`);
    args.push('-i',src);g.push(`[${idx}:a]${chain.join(',')}[t${j}]`);voices.push(`[t${j}]`);idx++;
  });
  let voice:string|null=null;
  if(voices.length){g.push(`${voices.join('')}${voices.length>1?`amix=inputs=${voices.length}:normalize=0:duration=longest,`:''}apad=whole_dur=${ts},atrim=duration=${ts}[voice]`);voice='voice';}
  // 배경음악 + 추가 소리(장면별 음악 바꾸기·효과음). 자동 줄이기가 켜진 소리는 한 묶음으로 목소리에 맞춰 줄인다
  const ducked:string[]=[],plain:string[]=[];
  musicLayers(p,total).forEach((l,j)=>{
    if(l.start>=total||l.end-l.start<.05)return;
    const src=o.resolve(l.file);const info=o.info(src);
    if(l.loop)args.push('-stream_loop','-1');args.push('-i',src);
    let avail=Math.min(total,l.end)-l.start;
    if(!l.loop&&info?.duration)avail=Math.min(avail,Math.max(.1,info.duration-l.file_start));
    const chain=[...(l.file_start>0?[`atrim=start=${f(l.file_start)}`]:[]),'asetpts=PTS-STARTPTS',`aresample=${AUDIO_RATE}`,'aformat=sample_fmts=fltp:channel_layouts=stereo',`atrim=duration=${f(avail)}`];
    if(l.fade_in>0)chain.push(`afade=t=in:st=0:d=${f(Math.min(l.fade_in,avail))}`);
    if(l.fade_out>0){const fo=Math.min(l.fade_out,avail);chain.push(`afade=t=out:st=${f(avail-fo)}:d=${f(fo)}`);}
    chain.push(`volume=${f(l.volume)}`);const ms=Math.round(l.start*1000);if(ms>0)chain.push(`adelay=delays=${ms}:all=1`);
    const name=l.kind==='bgm'?'bgm':`snd${j}`;
    chain.push(`apad=whole_dur=${ts}`,`atrim=duration=${ts}`);g.push(`[${idx}:a]${chain.join(',')}[${name}]`);idx++;
    (l.duck?ducked:plain).push(`[${name}]`);
  });
  if(ducked.length){
    let bus=ducked[0];
    if(ducked.length>1){g.push(`${ducked.join('')}amix=inputs=${ducked.length}:normalize=0:duration=first[musicbus]`);bus='[musicbus]';}
    if(voice){g.push(`[voice]asplit=2[voicemix][voicesc]`);g.push(`${bus}[voicesc]sidechaincompress=threshold=0.02:ratio=${f(Number(p.bgm.duck_ratio)||6)}:attack=20:release=400[bgmd]`);voice='voicemix';mix.push('[bgmd]');}
    else mix.push(bus);
  }
  mix.push(...plain);
  if(voice)mix.push(`[${voice}]`);
  const afs=fa.length?','+fa.join(','):'';
  if(mix.length>1)g.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.97:level=0,atrim=duration=${ts}${afs}[aout]`);
  else g.push(`[abase]atrim=duration=${ts}${afs}[aout]`);
  const graph=g.join(';');
  args.push('-filter_complex',graph,'-map','[vout]','-map','[aout]',...encoderArgs(o.draft,'final',fps),'-r',fs,'-frames:v',String(totalFrames),'-c:a','aac','-b:a',o.draft?'128k':'192k','-ar',String(AUDIO_RATE),'-t',ts,'-movflags','+faststart','-progress','pipe:1','-nostats',o.output);
  return {args,graph,total};
}

export function buildRenderPlan(p:ComposerProject,o:RenderOptions):RenderPlan{
  if(!p.clips.length)throw new Error('장면이 없어 영상을 만들 수 없습니다.');
  const size=renderSize(p,o.draft);const cues=projectCues(p);
  const burn=p.subtitle.burn_in!==false&&cues.some(c=>c.text.trim());
  const ass=burn?buildAss(p,cues,size.w,size.h):null;
  const segments=buildSegments(p);
  const clipJobs=buildClipJobs(p,o,segments);
  const assembly=buildAssembly(p,o,clipJobs.map(j=>j.output),ass?'subs.ass':null,segments);
  return {size:{w:size.w,h:size.h},fps:Number(p.output.fps)||30,total:assembly.total,clipJobs,assembly:{args:assembly.args,graph:assembly.graph},ass,ignored:ignoredEffects(p)};
}
/** -progress pipe:1 출력에서 진행 시간(초) */
export function parseProgressSeconds(chunk:string):number|null{
  const m=[...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();return m?Number(m[1])/1e6:null;
}
/** ffmpeg -i 출력(stderr)에서 길이·오디오 여부 */
export function parseMediaInfo(stderr:string):MediaInfo{
  const m=stderr.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  const duration=m?(+m[1])*3600+(+m[2])*60+parseFloat(m[3]):null;
  return {duration,hasAudio:/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(stderr)};
}

/** signalstats YAVG 출력 → 앞에서 잘라 낼 검은 첫 프레임 구간(초, 최대 0.5) */
export function leadFromStats(text:string):number{
  const rows:{t:number;y:number}[]=[];let t=0;
  for(const line of text.split('\n')){const m=line.match(/pts_time:([\d.]+)/);if(m)t=Number(m[1]);const y=line.match(/YAVG=([\d.]+)/);if(y)rows.push({t,y:Number(y[1])});}
  if(rows.length<2||rows[0].y>=24)return 0;
  const first=rows.findIndex(r=>r.y>=24);if(first<=0)return 0;
  return Math.min(.5,Math.round((rows[first].t-rows[0].t)*1000)/1000);
}
