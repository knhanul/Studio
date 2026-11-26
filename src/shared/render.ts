/** FFmpeg 명령 생성 (순수 함수, 테스트 가능).
 *  기존 영상 합성기(knhanul/dubbing) composer/render/ffmpeg_builder.py 의 2단계 방식을 가볍게 옮겼다.
 *  1) 장면마다 같은 해상도·fps·48kHz 스테레오 중간 파일(.mkv)
 *  2) 전환(xfade/acrossfade)으로 잇고 자막(ASS)·더빙·배경음악(덕킹)을 섞어 MP4
 *  이미지 움직임은 perspective 필터의 소수점 좌표를 써서 떨림이 없다. */
import type {ComposerProject,SubtitleItem} from './types';
import {clipDuration,clipSpeed,projectCues,takePosition,transitionInto} from './project';

export const AUDIO_RATE=48000;
export interface MediaInfo{duration:number|null;hasAudio:boolean}
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
export interface RenderPlan{size:{w:number;h:number};fps:number;total:number;clipJobs:ClipJob[];assembly:{args:string[];graph:string};ass:string|null}

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
  if(draft)return ['-c:v','libx264','-preset','ultrafast','-crf','28','-g',gop,'-pix_fmt','yuv420p'];
  if(stage==='intermediate')return ['-c:v','libx264','-preset','veryfast','-crf','14','-g',gop,'-pix_fmt','yuv420p'];
  return ['-c:v','libx264','-preset','medium','-crf','18','-g',gop,'-pix_fmt','yuv420p'];
}
const XFADE:Record<string,string>={fade:'fadeblack',crossfade:'fade'};
export const xfadeName=(type:string)=>XFADE[type]||type;

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

// ── 1단계: 장면 중간 파일 ──
export function buildClipJobs(p:ComposerProject,o:RenderOptions):ClipJob[]{
  const {w,h}=renderSize(p,o.draft);const fps=Number(p.output.fps)||30;const fs=f(fps);const up=o.draft?1:2;
  return p.clips.map((clip,i)=>{
    const dur=clipDuration(clip);const handle=transitionInto(p,i+1).duration; // 다음 장면과 겹칠 여분
    const len=dur+handle;const ls=f(len);const src=o.resolve(clip.file);const out=o.workFile(`clip_${String(i).padStart(3,'0')}.mkv`);
    const fit=String(clip.fit||p.output.fit||'cover');const bg=String(p.output.background||'#000000');
    const args=['-hide_banner','-y','-nostdin'];let vf:string[];let useAudio=false;
    const eq=[clip.brightness,clip.contrast,clip.saturation].some(v=>v!=null&&v!==0&&v!==1)?[`eq=brightness=${f(Number(clip.brightness)||0)}:contrast=${f(clip.contrast==null?1:Number(clip.contrast))}:saturation=${f(clip.saturation==null?1:Number(clip.saturation))}`]:[];
    if(clip.type==='image'){
      args.push('-loop','1','-framerate',fs,'-t',ls,'-i',src);
      const mf=motionFilter(String(clip.motion||'none'),Number(clip.motion_strength??.15),Math.max(1,Math.round(len*fps)));
      vf=mf?[...fitFilters(fit,w*up,h*up,bg),'format=yuv444p',mf,...(up>1?[`scale=${w}:${h}:flags=lanczos`]:[]),`fps=${fs}`]:[...fitFilters(fit,w,h,bg),`fps=${fs}`];
    }else{
      const info=o.info(src);const start=Number(clip.trim_start)||0;
      const end=clip.trim_end!=null?Number(clip.trim_end):(info?.duration??(typeof clip.source_duration==='number'?clip.source_duration:null));
      const speed=clipSpeed({...clip,source_duration:info?.duration??clip.source_duration});
      if(start>0)args.push('-ss',f(start));
      if(end!=null)args.push('-t',f(Math.max(.1,end-start)));
      args.push('-i',src);
      vf=[Math.abs(speed-1)>1e-6?`setpts=(PTS-STARTPTS)/${f(speed)}`:'setpts=PTS-STARTPTS',`fps=${fs}`,...fitFilters(fit,w,h,bg)];
      useAudio=Boolean(info?.hasAudio)&&!clip.mute&&(clip.volume==null||Number(clip.volume)>0);
      if(useAudio){
        const af=['asetpts=PTS-STARTPTS',...atempoChain(speed),`aresample=${AUDIO_RATE}`,'aformat=sample_fmts=fltp:channel_layouts=stereo',
          ...(clip.volume!=null&&Math.abs(Number(clip.volume)-1)>1e-6?[`volume=${f(Number(clip.volume))}`]:[]),`apad=whole_dur=${ls}`,`atrim=duration=${ls}`];
        vf.push(...eq,'setsar=1','format=yuv420p',`tpad=stop_mode=clone:stop_duration=${ls}`,`trim=duration=${ls}`,'setpts=PTS-STARTPTS');
        args.push('-filter_complex',`[0:v]${vf.join(',')}[v];[0:a]${af.join(',')}[a]`,'-map','[v]','-map','[a]');
      }
    }
    if(!useAudio){
      vf.push(...eq,'setsar=1','format=yuv420p',`tpad=stop_mode=clone:stop_duration=${ls}`,`trim=duration=${ls}`,'setpts=PTS-STARTPTS');
      args.push('-f','lavfi','-t',ls,'-i',`anullsrc=r=${AUDIO_RATE}:cl=stereo`,'-filter_complex',`[0:v]${vf.join(',')}[v]`,'-map','[v]','-map','1:a');
    }
    args.push(...encoderArgs(o.draft,'intermediate',fps),'-r',fs,'-c:a','pcm_s16le','-ar',String(AUDIO_RATE),'-ac','2','-t',ls,'-progress','pipe:1','-nostats',out);
    return {index:i,args,output:out,duration:len};
  });
}

// ── 2단계: 조립 ──
export function buildAssembly(p:ComposerProject,o:RenderOptions,clipFiles:string[],assName:string|null):{args:string[];graph:string;total:number}{
  const fps=Number(p.output.fps)||30;const fs=f(fps);
  const total=p.clips.reduce((n,c)=>n+clipDuration(c),0);const ts=f(total);
  const args=['-hide_banner','-y','-nostdin'];const g:string[]=[];
  clipFiles.forEach(file=>args.push('-i',file));
  const n=clipFiles.length;
  for(let i=0;i<n;i++){g.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${fs}[v${i}]`);g.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);}
  let cv='v0',ca='a0',start=0;
  for(let i=1;i<n;i++){
    start+=clipDuration(p.clips[i-1]);const tr=transitionInto(p,i);const nv=`vx${i}`,na=`ax${i}`;
    if(tr.duration<=0){g.push(`[${cv}][${ca}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}c][${na}]`);g.push(`[${nv}c]fps=${fs}[${nv}]`);}
    else{g.push(`[${cv}][v${i}]xfade=transition=${xfadeName(tr.type)}:duration=${f(tr.duration)}:offset=${f(start)}[${nv}]`);g.push(`[${ca}][a${i}]acrossfade=d=${f(tr.duration)}:c1=tri:c2=tri[${na}]`);}
    cv=nv;ca=na;
  }
  let vlast=cv;
  if(assName){const fd=o.fontsDir?`:fontsdir='${o.fontsDir.replace(/\\/g,'/').replace(/:/g,'\\:')}'`:'';g.push(`[${vlast}]ass=filename=${assName}${fd}[vsub]`);vlast='vsub';}
  const fin=Number(p.output.fade_in)||0,fout=Number(p.output.fade_out)||0;
  const fv=[...(fin>0?[`fade=t=in:st=0:d=${f(fin)}`]:[]),...(fout>0?[`fade=t=out:st=${f(Math.max(0,total-fout))}:d=${f(fout)}`]:[])];
  const fa=[...(fin>0?[`afade=t=in:st=0:d=${f(fin)}`]:[]),...(fout>0?[`afade=t=out:st=${f(Math.max(0,total-fout))}:d=${f(fout)}`]:[])];
  g.push(`[${vlast}]${[...fv,'format=yuv420p'].join(',')}[vout]`);
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
  const b=p.bgm;const bvol=b.volume==null?.3:Number(b.volume);const bstart=Number(b.start_offset)||0;
  if(b.file&&bvol>0&&bstart<total){
    const src=o.resolve(b.file);const info=o.info(src);const loop=b.loop!==false;
    if(loop)args.push('-stream_loop','-1');args.push('-i',src);
    let avail=total-bstart;const fstart=Number(b.file_start)||0;
    if(!loop&&info?.duration)avail=Math.min(avail,Math.max(.1,info.duration-fstart));
    const chain=[...(fstart>0?[`atrim=start=${f(fstart)}`]:[]),'asetpts=PTS-STARTPTS',`aresample=${AUDIO_RATE}`,'aformat=sample_fmts=fltp:channel_layouts=stereo',`atrim=duration=${f(avail)}`];
    const bfi=b.fade_in==null?1:Number(b.fade_in),bfo=b.fade_out==null?2:Number(b.fade_out);
    if(bfi>0)chain.push(`afade=t=in:st=0:d=${f(Math.min(bfi,avail))}`);
    if(bfo>0){const fo=Math.min(bfo,avail);chain.push(`afade=t=out:st=${f(avail-fo)}:d=${f(fo)}`);}
    chain.push(`volume=${f(bvol)}`);const ms=Math.round(bstart*1000);if(ms>0)chain.push(`adelay=delays=${ms}:all=1`);
    chain.push(`apad=whole_dur=${ts}`,`atrim=duration=${ts}`);g.push(`[${idx}:a]${chain.join(',')}[bgm]`);idx++;
    if(voice&&b.duck_under_voice!==false){g.push(`[voice]asplit=2[voicemix][voicesc]`);g.push(`[bgm][voicesc]sidechaincompress=threshold=0.02:ratio=${f(Number(b.duck_ratio)||6)}:attack=20:release=400[bgmd]`);voice='voicemix';mix.push('[bgmd]');}
    else mix.push('[bgm]');
  }
  if(voice)mix.push(`[${voice}]`);
  const afs=fa.length?','+fa.join(','):'';
  if(mix.length>1)g.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.97:level=0,atrim=duration=${ts}${afs}[aout]`);
  else g.push(`[abase]atrim=duration=${ts}${afs}[aout]`);
  const graph=g.join(';');
  args.push('-filter_complex',graph,'-map','[vout]','-map','[aout]',...encoderArgs(o.draft,'final',fps),'-r',fs,'-c:a','aac','-b:a',o.draft?'128k':'192k','-ar',String(AUDIO_RATE),'-t',ts,'-movflags','+faststart','-progress','pipe:1','-nostats',o.output);
  return {args,graph,total};
}

export function buildRenderPlan(p:ComposerProject,o:RenderOptions):RenderPlan{
  if(!p.clips.length)throw new Error('장면이 없어 영상을 만들 수 없습니다.');
  const size=renderSize(p,o.draft);const cues=projectCues(p);
  const burn=p.subtitle.burn_in!==false&&cues.some(c=>c.text.trim());
  const ass=burn?buildAss(p,cues,size.w,size.h):null;
  const clipJobs=buildClipJobs(p,o);
  const assembly=buildAssembly(p,o,clipJobs.map(j=>j.output),ass?'subs.ass':null);
  return {size:{w:size.w,h:size.h},fps:Number(p.output.fps)||30,total:assembly.total,clipJobs,assembly:{args:assembly.args,graph:assembly.graph},ass};
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
