import {useEffect,useRef,type CSSProperties} from 'react';
import {ChevronFirst,ChevronLeft,ChevronRight,Film,Pause,Play} from 'lucide-react';
import {clipSpeed,fmt,motionCss,transitionInto} from '../../shared/project';
import type {Clip,ComposerProject,SubtitleItem} from '../../shared/types';
import {useEditor} from '../editor';
import {useElementSize} from '../hooks/useElementSize';

function Layer({clip,url,poster,local,progress,opacity,playing,z}:{clip:Clip;url?:string;poster?:string;local:number;progress:number;opacity:number;playing:boolean;z:number}){
  const ref=useRef<HTMLVideoElement>(null);
  const target=(Number(clip.trim_start)||0)+local*clipSpeed(clip);
  useEffect(()=>{const v=ref.current;if(!v)return;
    if(Math.abs(v.currentTime-target)>(playing?.35:.04)&&Number.isFinite(target)){try{v.currentTime=Math.max(0,target);}catch{/* 아직 못 읽음 */}}
    v.playbackRate=Math.min(4,Math.max(.25,clipSpeed(clip)));v.muted=!playing||Boolean(clip.mute);v.volume=Math.min(1,Math.max(0,clip.volume==null?1:Number(clip.volume)));
    if(playing&&v.paused)void v.play().catch(()=>{});if(!playing&&!v.paused)v.pause();
  });
  const style:CSSProperties={opacity,zIndex:z};
  if(!url&&poster)return <div className="monitor-layer" style={style}><img src={poster} alt="" draggable={false} style={{objectFit:(clip.fit||'cover')==='contain'?'contain':'cover'}}/><span className="monitor-badge">영상 파일을 찾을 수 없어 기준 이미지를 보여 줘요</span></div>;
  if(!url)return <div className="monitor-layer monitor-missing" style={style}><Film size={26}/><span>{clip.file?'파일을 찾을 수 없어요':'미디어 없음'}</span></div>;
  const fit=(clip.fit||'cover')==='contain'?'contain':'cover';
  return <div className="monitor-layer" style={style}>{clip.type==='video'
    ?<video ref={ref} src={url} poster={poster} preload="auto" playsInline style={{objectFit:fit}}/>
    :<img src={url} alt="" draggable={false} style={{objectFit:fit,transform:motionCss(String(clip.motion||'none'),Number(clip.motion_strength??.15),progress),transformOrigin:'0 0'}}/>}</div>;
}
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
export function Monitor({showTransport=true}:{showTransport?:boolean}){
  const {doc,tracks,total,urls,playhead,seek,playing,setPlaying,cues}=useEditor();
  const [boxRef,box]=useElementSize<HTMLDivElement>();
  const W=doc.output.width||1920,H=doc.output.height||1080;
  const scale=Math.min(box.width/W,box.height/H)||0;const fw=Math.floor(W*scale),fh=Math.floor(H*scale);
  const i=tracks.findIndex(t=>playhead>=t.start&&playhead<t.end);const cur=i>=0?i:tracks.length-1;
  const layers:{k:number;opacity:number;z:number}[]=[];
  if(cur>=0){
    const t=tracks[cur];const tr=transitionInto(doc,cur);const into=playhead-t.start;
    if(tr.duration>0&&into<tr.duration&&cur>0){
      const a=into/tr.duration;
      if(tr.type==='fade'){if(a<.5)layers.push({k:cur-1,opacity:1-a*2,z:1});else layers.push({k:cur,opacity:(a-.5)*2,z:2});}
      else{layers.push({k:cur-1,opacity:1,z:1},{k:cur,opacity:a,z:2});}
    }else layers.push({k:cur,opacity:1,z:2});
  }
  const cue=cues.find(c=>playhead>=c.start&&playhead<c.end);
  const jump=(d:number)=>{const idx=Math.max(0,Math.min(tracks.length-1,cur+d));if(tracks[idx])seek(tracks[idx].start);};
  return <div className="monitor">
    <div className="monitor-stage" ref={boxRef}>
      <div className="monitor-frame" style={{width:fw,height:fh}}>
        {!tracks.length&&<div className="monitor-layer monitor-missing"><Film size={28}/><span>장면을 추가하면 여기에서 미리 볼 수 있어요</span></div>}
        {layers.map(l=>{const t=tracks[l.k];const handle=transitionInto(doc,l.k+1).duration;return <Layer key={l.k} clip={t.clip} url={urls[t.clip.file]} poster={t.clip.poster?urls[t.clip.poster]:undefined} local={playhead-t.start} progress={(playhead-t.start)/(t.duration+handle)} opacity={l.opacity} z={l.z} playing={playing}/>;})}
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
