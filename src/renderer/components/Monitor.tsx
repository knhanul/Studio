import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronFirst,ChevronLeft,ChevronRight,Film,Pause,Play} from 'lucide-react';
import {clipSpeed,fmt} from '../../shared/project';
import {buildSegments,cameraAt,TONES,toneMatrix,type Segment} from '../../shared/camera';
import {drawOverlay,glowParams,overlayMode,overlaySize} from '../../shared/overlays';
import type {Clip,ComposerProject,SubtitleItem} from '../../shared/types';
import {useEditor} from '../editor';
import {useElementSize} from '../hooks/useElementSize';

/** 구간 하나 그리기 — 이미지는 내보내기와 같은 카메라 경로(cameraAt), 영상은 같은 속도·시작점 */
/** 영상 앞 검은 프레임 길이 (내보내기와 같이 그만큼 건너뛴다) */
const leads=new Map<string,number>();
function useLead(file:string,isVideo:boolean){
  const [v,setV]=useState(()=>leads.get(file)??0);
  useEffect(()=>{if(!isVideo||leads.has(file))return;let dead=false;void window.compose.media.probe(file).then(i=>{leads.set(file,Number(i.lead)||0);if(!dead)setV(Number(i.lead)||0);}).catch(()=>{});return()=>{dead=true;};},[file,isVideo]);
  return v;
}
function SegmentLayer({doc,seg,urls,local,style,playing,visible,silent=false,frameH=540}:{doc:ComposerProject;seg:Segment;urls:Record<string,string>;local:number;style:CSSProperties;playing:boolean;visible:boolean;silent?:boolean;frameH?:number}){
  const clip:Clip=doc.clips[seg.clips[0]];const ref=useRef<HTMLVideoElement>(null);
  const url=urls[seg.file];const poster=clip.poster?urls[clip.poster]:undefined;
  const lead=useLead(seg.file,seg.type==='video');
  const start=Number(clip.trim_start)>0?Number(clip.trim_start):Math.min(.5,lead);
  const target=start+Math.max(0,local)*clipSpeed({...clip,trim_start:start});
  useEffect(()=>{const v=ref.current;if(!v)return;
    if(Math.abs(v.currentTime-target)>(playing&&visible?.35:.04)&&Number.isFinite(target)){try{v.currentTime=Math.max(0,target);}catch{/* 아직 못 읽음 */}}
    v.playbackRate=Math.min(4,Math.max(.25,clipSpeed(clip)));v.muted=silent||!playing||!visible||Boolean(clip.mute);v.volume=Math.min(1,Math.max(0,clip.volume==null?1:Number(clip.volume)));
    const run=playing&&visible&&local>=0;if(run&&v.paused)void v.play().catch(()=>{});if(!run&&!v.paused)v.pause();
  });
  const fit=(clip.fit||'cover')==='contain'?'contain':'cover';
  const tone=toneMatrix(seg.tone)?`url(#gomo-tone-${seg.tone})`:undefined;
  const fx=seg.overlay;const fps=Number(doc.output.fps)||30;
  const vignette=<>{fx==='vignette'&&<div className="monitor-vignette" style={{opacity:.35+.55*Math.max(0,Math.min(1,seg.overlayStrength))}}/>}
    {fx&&overlayMode(fx)!=='filter'&&overlayMode(fx)&&<OverlayCanvas kind={fx} strength={seg.overlayStrength} t={seg.startFrame/fps+Math.max(0,local)} aspect={(doc.output.width||1920)/(doc.output.height||1080)}/>}</>;
  if(!url&&poster)return <div className="monitor-layer" style={style}><img src={poster} alt="" draggable={false} style={{objectFit:fit,filter:tone}}/>{vignette}<span className="monitor-badge">영상 파일을 찾을 수 없어 기준 이미지를 보여 줘요</span></div>;
  if(!url)return <div className="monitor-layer monitor-missing" style={style}><Film size={26}/><span>{seg.file?'파일을 찾을 수 없어요':'미디어 없음'}</span></div>;
  if(seg.type==='video')return <div className="monitor-layer" style={style}><video ref={ref} src={url} poster={poster} preload="auto" playsInline style={{objectFit:fit,filter:tone}}/>{vignette}</div>;
  const c=cameraAt(seg.camera,Math.max(0,local));
  const transform=c.z===1&&c.cx===.5&&c.cy===.5?'none':`scale(${c.z.toFixed(5)}) translate(${(-(c.cx-.5/c.z)*100).toFixed(4)}%, ${(-(c.cy-.5/c.z)*100).toFixed(4)}%)`;
  // 빛 번짐: 같은 그림을 흐리게 한 장 더 겹쳐 screen 으로 (내보내기의 gblur + screen 과 같은 뜻)
  const glow=fx==='glow'?glowParams(seg.overlayStrength,doc.output.height||1080):null;
  return <div className="monitor-layer" style={style}><img src={url} alt="" draggable={false} style={{objectFit:fit,transform,transformOrigin:'0 0',filter:tone}}/>
    {glow&&<img src={url} alt="" aria-hidden="true" draggable={false} className="monitor-glow" style={{objectFit:fit,transform,transformOrigin:'0 0',opacity:glow.opacity,filter:`${tone?tone+' ':''}blur(${(glow.sigma*frameH/Math.max(1,doc.output.height||1080)).toFixed(1)}px) brightness(${(1+glow.lift*3).toFixed(2)})`}}/>}
    {vignette}</div>;
}
/** 빛·입자 효과 미리보기: 내보내기와 같은 drawOverlay 로 그린다 (작은 크기로 그려 화면에 맞게 늘림) */
function OverlayCanvas({kind,strength,t,aspect}:{kind:string;strength:number;t:number;aspect:number}){
  const ref=useRef<HTMLCanvasElement>(null);const size=overlaySize(kind,aspect,true);const img=useRef<ImageData|null>(null);
  useEffect(()=>{const c=ref.current;if(!c||!size)return;const ctx=c.getContext('2d');if(!ctx)return;
    if(!img.current||img.current.width!==size.w||img.current.height!==size.h)img.current=ctx.createImageData(size.w,size.h);
    drawOverlay(kind,img.current.data,size.w,size.h,t,strength);ctx.putImageData(img.current,0,0);});
  if(!size)return null;
  return <canvas ref={ref} width={size.w} height={size.h} className={`monitor-overlay mode-${overlayMode(kind)}`} aria-hidden="true"/>;
}
/** 전환 한 프레임: 앞 구간(prev)·들어오는 구간(cur)의 모양. 내보내기의 xfade 이름과 같은 뜻 (a: 0→1) */
function blend(type:string,a:number):{prev:CSSProperties;cur:CSSProperties;veil?:CSSProperties}{
  const pct=(v:number)=>`${(v*100).toFixed(3)}%`;
  switch(type){
    case 'fadeblack':return {prev:{opacity:Math.max(0,1-2*a)},cur:{opacity:Math.max(0,2*a-1)}};
    case 'fadewhite':return {prev:{opacity:a<.5?1:0},cur:{opacity:a<.5?0:1},veil:{background:'#fff',opacity:1-Math.abs(2*a-1)}};
    case 'wipeleft':return {prev:{},cur:{clipPath:`inset(0 0 0 ${pct(1-a)})`}};
    case 'wiperight':return {prev:{},cur:{clipPath:`inset(0 ${pct(1-a)} 0 0)`}};
    case 'wipeup':return {prev:{},cur:{clipPath:`inset(${pct(1-a)} 0 0 0)`}};
    case 'wipedown':return {prev:{},cur:{clipPath:`inset(0 0 ${pct(1-a)} 0)`}};
    case 'slideleft':return {prev:{transform:`translateX(${pct(-a)})`},cur:{transform:`translateX(${pct(1-a)})`}};
    case 'slideright':return {prev:{transform:`translateX(${pct(a)})`},cur:{transform:`translateX(${pct(a-1)})`}};
    case 'slideup':return {prev:{transform:`translateY(${pct(-a)})`},cur:{transform:`translateY(${pct(1-a)})`}};
    case 'slidedown':return {prev:{transform:`translateY(${pct(a)})`},cur:{transform:`translateY(${pct(a-1)})`}};
    case 'circleopen':return {prev:{},cur:{clipPath:`circle(${pct(a*.75)} at 50% 50%)`}};
    case 'circleclose':return {prev:{clipPath:`circle(${pct((1-a)*.75)} at 50% 50%)`,zIndex:3},cur:{}};
    default:return {prev:{},cur:{opacity:a}}; // fade · zoomin · hblur 등: 서서히 섞기
  }
}
/** 색감 필터 (내보내기 colorchannelmixer 와 같은 행렬) */
function ToneDefs(){return <svg className="monitor-defs" aria-hidden="true" width="0" height="0"><defs>{Object.entries(TONES).map(([id,m])=><filter key={id} id={`gomo-tone-${id}`} colorInterpolationFilters="sRGB">
  <feColorMatrix type="matrix" values={`${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`}/></filter>)}</defs></svg>;}
/** 자막 미리보기: 렌더(ASS)와 같은 크기 비율·위치 */
export function SubtitleOverlay({doc,cue,height}:{doc:ComposerProject;cue?:SubtitleItem;height:number}){
  if(!cue||doc.subtitle.burn_in===false)return null;
  const st=doc.subtitle.style||{};const k=height/Math.max(1,doc.output.height||1080);
  const size=Math.max(8,(Number(st.size)||52)*k);const o=Math.max(0,(Number(st.outline??2))*k);const oc=String(st.outline_color||'#000000');
  const shadow=o>0&&!st.box?[[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0]].map(([x,y])=>`${x*o}px ${y*o}px 0 ${oc}`).join(','):'none';
  const pos=st.position==='top'?{top:(Number(st.margin_v)||60)*k}:st.position==='center'?{top:'50%',transform:'translateY(-50%)'}:{bottom:(Number(st.margin_v)||60)*k};
  return <div className="monitor-subtitle" style={{...pos}}><span style={{fontSize:size,color:String(st.color||'#fff'),textShadow:shadow,fontWeight:st.bold===false?500:700,fontFamily:`'${st.font||'Malgun Gothic'}','Malgun Gothic',sans-serif`,
    ...(st.box?{background:`color-mix(in srgb, ${String(st.box_color||'#000')} ${Math.round((Number(st.box_opacity??.6))*100)}%, transparent)`,padding:`${4*k*2}px ${12*k*2}px`,borderRadius:4}:{})}}>{cue.text}</span></div>;
}
/** 미리보기 화면.
 *  time·run 을 주면 편집 화면의 재생 위치 대신 그 시각을 보여 준다 (더빙 녹음: 이 화면만 다시 그려 녹음이 끊기지 않게).
 *  silent 면 영상 원래 소리를 내지 않는다 (마이크에 들어가지 않게) */
export function Monitor({showTransport=true,time,run,silent=false,subtitleCue}:{showTransport?:boolean;time?:number;run?:boolean;silent?:boolean;
  /** 자막 대신 이 문장을 크게 강조해 보여 줌 (없으면 그 시각의 자막) */subtitleCue?:SubtitleItem|null}){
  const ed=useEditor();const {doc,tracks,total,urls,seek,setPlaying,cues}=ed;
  const playhead=time??ed.playhead;const playing=run??ed.playing;
  const [boxRef,box]=useElementSize<HTMLDivElement>();
  const W=doc.output.width||1920,H=doc.output.height||1080;
  const scale=Math.min(box.width/W,box.height/H)||0;const fw=Math.floor(W*scale),fh=Math.floor(H*scale);
  const segs=useMemo(()=>buildSegments(doc),[doc]);const fps=Number(doc.output.fps)||30;
  const i=tracks.findIndex(t=>playhead>=t.start&&playhead<t.end);const cur=i>=0?i:tracks.length-1;
  const frame=Math.round(playhead*fps);
  let si=segs.findIndex((s,k)=>frame>=s.startFrame&&(k===segs.length-1||frame<segs[k+1].startFrame));if(si<0)si=segs.length-1;
  type L={seg:Segment;style:CSSProperties;visible:boolean};const layers:L[]=[];let veil:CSSProperties|undefined;
  if(si>=0){
    const s=segs[si];const tr=s.transition;const into=playhead-s.startFrame/fps;
    if(si>0&&tr.frames>0&&into<tr.duration){const bl=blend(tr.type,Math.max(0,into/tr.duration));veil=bl.veil;
      layers.push({seg:segs[si-1],style:{zIndex:1,...bl.prev},visible:true},{seg:s,style:{zIndex:2,...bl.cur},visible:true});}
    else layers.push({seg:s,style:{zIndex:2},visible:true});
    // 다음 구간을 미리 올려 두어(보이지 않게) 영상 첫 프레임이 늦게 나와 검게 깜박이지 않게 한다
    const nx=segs[si+1];if(nx&&nx.startFrame/fps-playhead<1.5)layers.push({seg:nx,style:{zIndex:0,opacity:0},visible:false});
  }
  const cue=subtitleCue===undefined?cues.find(c=>playhead>=c.start&&playhead<c.end):subtitleCue||undefined;
  const jump=(d:number)=>{const idx=Math.max(0,Math.min(tracks.length-1,cur+d));if(tracks[idx])seek(tracks[idx].start);};
  return <div className="monitor">
    <div className="monitor-stage" ref={boxRef}>
      <div className="monitor-frame" style={{width:fw,height:fh}}><ToneDefs/>
        {!tracks.length&&<div className="monitor-layer monitor-missing"><Film size={28}/><span>장면을 추가하면 여기에서 미리 볼 수 있어요</span></div>}
        {layers.map(l=><SegmentLayer key={`seg-${l.seg.index}-${l.seg.file}`} doc={doc} seg={l.seg} urls={urls} local={playhead-l.seg.startFrame/fps} style={l.style} playing={playing} visible={l.visible} silent={silent} frameH={fh}/>)}
        {veil&&<div className="monitor-layer" style={{zIndex:4,...veil}}/>}
        <SubtitleOverlay doc={doc} cue={cue} height={fh}/>
      </div>
    </div>
    {showTransport&&<div className="transport">
      <button type="button" className="icon-btn" title="처음으로" aria-label="처음으로" onClick={()=>seek(0)}><ChevronFirst size={17}/></button>
      <button type="button" className="icon-btn" title="이전 장면" aria-label="이전 장면" onClick={()=>jump(-1)}><ChevronLeft size={17}/></button>
      <button type="button" className="transport-play" title={playing?'일시 정지 (Space)':'재생 (Space)'} aria-label={playing?'일시 정지':'재생'} disabled={!tracks.length} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>
      <button type="button" className="icon-btn" title="다음 장면" aria-label="다음 장면" onClick={()=>jump(1)}><ChevronRight size={17}/></button>
      <span className="transport-time"><b>{fmt(playhead)}</b> / {fmt(total)}</span>
      <span className="transport-scene">{cur>=0?`장면 ${cur+1} / ${tracks.length}`:'장면 없음'}</span>
      <span className="transport-note">미리보기는 실제 영상과 조금 다를 수 있어요</span>
    </div>}
  </div>;
}
