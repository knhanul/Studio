import {useRef,useState,type MouseEvent} from 'react';
import {Captions,Film,Image as ImageIcon,Mic2,Music2,ZoomIn,ZoomOut} from 'lucide-react';
import {fmt,takeSpan} from '../../shared/project';
import {fileName,useEditor} from '../editor';
import {musicLayers} from '../../shared/media';
import {useElementSize} from '../hooks/useElementSize';

/** 간단한 타임라인: 장면 / 더빙 / 자막 / 배경음악 4줄. 누르면 그 시점으로 이동 */
export function Timeline(){
  const {doc,tracks,total,cues,playhead,seek,selectedClip,setSelectedClip,selectedCue,setSelectedCue,urls,selectedAudio,setSelectedAudio}=useEditor();
  const layers=musicLayers(doc,total);
  const effects=layers.filter(l=>l.kind==='effect');
  const [zoom,setZoom]=useState(1);
  const [wrapRef,size]=useElementSize<HTMLDivElement>();
  const scroller=useRef<HTMLDivElement>(null);
  const LABEL=88;const span=Math.max(total,1);
  const pps=Math.max(4,((size.width-LABEL-16)/span)*zoom);
  const width=span*pps;
  const x=(t:number)=>t*pps;
  const at=(e:MouseEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(total,(e.clientX-r.left)/pps));};
  const latency=Number(doc.dubbing.latency_ms)||0;
  const ticks:number[]=[];const step=pps>60?1:pps>25?2:pps>10?5:pps>4?10:30;for(let t=0;t<=span;t+=step)ticks.push(t);
  return <div className="timeline" ref={wrapRef}>
    <div className="timeline-tools"><span className="timeline-title">타임라인</span><span className="timeline-hint">빈 곳을 누르면 그 시점으로 이동해요</span>
      <button type="button" className="icon-btn" title="좁게 보기" aria-label="좁게 보기" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z/1.5))}><ZoomOut size={15}/></button>
      <button type="button" className="icon-btn" title="넓게 보기" aria-label="넓게 보기" disabled={zoom>=12} onClick={()=>setZoom(z=>Math.min(12,z*1.5))}><ZoomIn size={15}/></button></div>
    <div className="timeline-body">
      <div className="timeline-labels" style={{width:LABEL}}>
        <div className="tl-ruler-pad"/>
        <div className="tl-label"><Film size={13}/> 장면</div><div className="tl-label"><Mic2 size={13}/> 더빙</div><div className="tl-label"><Captions size={13}/> 자막</div><div className="tl-label"><Music2 size={13}/> 배경음악</div>{effects.length>0&&<div className="tl-label"><Music2 size={13}/> 효과음</div>}
      </div>
      <div className="timeline-scroll" ref={scroller}>
        <div className="timeline-canvas" style={{width:width+16}} onMouseDown={e=>{if((e.target as HTMLElement).closest('.tl-item'))return;seek(at(e));}}>
          <div className="tl-ruler">{ticks.map(t=><span key={t} style={{left:x(t)}}>{fmt(t).replace(/\.0$/,'')}</span>)}</div>
          <div className="tl-row">{tracks.map(t=><button type="button" key={t.index} className={`tl-item tl-clip ${selectedClip===t.index?'selected':''}`} style={{left:x(t.start),width:Math.max(2,x(t.duration)-2)}} title={`${t.index+1}. ${t.clip.label||fileName(t.clip.file)} · ${t.duration.toFixed(1)}초`} onClick={()=>{setSelectedClip(t.index);seek(t.start);}}>
            {t.clip.type==='image'&&urls[t.clip.file]?<img src={urls[t.clip.file]} alt=""/>:t.clip.type==='video'&&t.clip.poster&&urls[t.clip.poster]?<img src={urls[t.clip.poster]} alt=""/>:t.clip.type==='image'?<ImageIcon size={12}/>:<Film size={12}/>}<span>{t.index+1}. {t.clip.label||fileName(t.clip.file)}</span></button>)}</div>
          <div className="tl-row">{doc.dubbing.takes.map((tk,j)=>{const s=takeSpan(tk,cues,latency);const len=Math.max(.2,s.end-s.start);return <button type="button" key={j} className={`tl-item tl-take ${tk.subtitle!=null&&selectedCue===tk.subtitle?'selected':''}`} style={{left:x(Math.max(0,s.start)),width:Math.max(3,x(len)-1)}} title={`녹음 · ${len.toFixed(1)}초`} onClick={()=>{if(tk.subtitle!=null)setSelectedCue(tk.subtitle);seek(Math.max(0,s.start));}}><span>{tk.subtitle!=null?`#${tk.subtitle}`:'녹음'}</span></button>;})}</div>
          <div className="tl-row">{cues.map(c=><button type="button" key={c.index} className={`tl-item tl-cue ${selectedCue===c.index?'selected':''}`} style={{left:x(c.start),width:Math.max(3,x(c.end-c.start)-1)}} title={c.text} onClick={()=>{setSelectedCue(c.index);seek(c.start);}}><span>{c.text}</span></button>)}</div>
          <div className="tl-row">{layers.filter(l=>l.kind!=='effect').map(l=><button type="button" key={l.key} className={`tl-item tl-bgm ${l.kind==='music'?'tl-music':''} ${selectedAudio===l.key?'selected':''}`} style={{left:x(l.start),width:Math.max(3,x(l.end-l.start)-1)}} title={`${l.kind==='bgm'?'배경음악':'바뀌는 음악'} · ${fileName(l.file)} · ${l.start.toFixed(1)}~${l.end.toFixed(1)}초`} onClick={()=>{setSelectedAudio(l.key);seek(l.start);}}><span>{l.label}</span></button>)}</div>
          {effects.length>0&&<div className="tl-row">{effects.map(l=><button type="button" key={l.key} className={`tl-item tl-sfx ${selectedAudio===l.key?'selected':''}`} style={{left:x(l.start),width:Math.max(3,x(l.end-l.start)-1)}} title={`효과음 · ${fileName(l.file)} · ${l.start.toFixed(1)}초`} onClick={()=>{setSelectedAudio(l.key);seek(l.start);}}><span>{l.label}</span></button>)}</div>}
          <div className="tl-playhead" style={{left:x(playhead)}}/>
        </div>
      </div>
    </div>
  </div>;
}
