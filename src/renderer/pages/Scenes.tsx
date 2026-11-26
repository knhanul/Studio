import {useState,type DragEvent} from 'react';
import {ArrowDown,ArrowUp,Film,Image as ImageIcon,Plus,RefreshCw,Trash2} from 'lucide-react';
import {clipDuration,clipSpeed,MOTIONS,round,TRANSITIONS,videoSourceSpan} from '../../shared/project';
import type {Clip} from '../../shared/types';
import {Monitor} from '../components/Monitor';
import {SidePanel} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {Button,Empty,Field,IconButton,Section,Segmented,Slider} from '../components/UI';
import {fileName,sec1,useEditor} from '../editor';

export function useAddScenes(){
  const {commit,toast,setSelectedClip,doc}=useEditor();
  return async()=>{
    const items=await window.compose.media.import('visual');if(!items.length)return;
    const visual=items.filter(i=>i.type==='image'||i.type==='video');
    commit(p=>{for(const it of visual){const c:Clip={file:it.file,type:it.type as Clip['type'],label:it.name.replace(/\.[^.]+$/,''),motion:it.type==='image'?'zoom_in':'none',motion_strength:.08};if(it.type==='image')c.duration=4;else if(it.duration)c.source_duration=round(it.duration);p.clips.push(c);}return p;});
    setSelectedClip(doc.clips.length);toast(`장면 ${visual.length}개를 추가했어요.`,'success');
  };
}
export function ScenesMain(){
  const {doc,tracks,urls,selectedClip,setSelectedClip,seek,commit}=useEditor();
  const [drag,setDrag]=useState<number|null>(null);
  const addScenes=useAddScenes();
  const move=(from:number,to:number)=>{if(from===to||to<0||to>=doc.clips.length)return;commit(p=>{const [c]=p.clips.splice(from,1);p.clips.splice(to,0,c);return p;});setSelectedClip(to);};
  return <div className="editor-stack">
    <Monitor/>
    <div className="scene-strip" aria-label="장면 목록">
      {tracks.map(t=><button type="button" key={t.index} draggable onDragStart={()=>setDrag(t.index)} onDragOver={(e:DragEvent)=>e.preventDefault()} onDrop={()=>{if(drag!=null)move(drag,t.index);setDrag(null);}}
        className={`strip-card ${selectedClip===t.index?'selected':''} ${drag===t.index?'dragging':''}`} onClick={()=>{setSelectedClip(t.index);seek(t.start);}} title="끌어서 순서를 바꿀 수 있어요">
        <div className="strip-thumb">{t.clip.type==='image'&&urls[t.clip.file]?<img src={urls[t.clip.file]} alt=""/>:t.clip.type==='video'&&urls[t.clip.file]?<video src={urls[t.clip.file]} muted preload="metadata"/>:<div className="media-placeholder">{t.clip.type==='image'?<ImageIcon size={18}/>:<Film size={18}/>}</div>}
          <span className="strip-index">{t.index+1}</span><span className={`strip-kind kind-${t.clip.type}`}>{t.clip.type==='image'?'이미지':'영상'}</span></div>
        <div className="strip-info"><strong>{t.clip.label||fileName(t.clip.file)}</strong><small>{sec1(t.duration)}{t.clip.type==='image'&&t.clip.motion&&t.clip.motion!=='none'?` · ${MOTIONS.find(m=>m.id===t.clip.motion)?.label||''}`:''}</small></div>
      </button>)}
      <button type="button" className="strip-add" onClick={()=>void addScenes()}><Plus size={18}/><span>장면 추가</span><small>이미지·영상</small></button>
    </div>
    <Timeline/>
  </div>;
}
export function ScenesPanel(){
  const {doc,selectedClip,setSelectedClip,commit,toast}=useEditor();
  const clip=selectedClip!=null?doc.clips[selectedClip]:null;
  if(!clip||selectedClip==null)return <SidePanel title="장면 설정"><Empty title="장면을 선택해 주세요" description="아래 장면 카드나 타임라인의 장면을 누르면 길이·움직임·전환을 바꿀 수 있어요."/></SidePanel>;
  const i=selectedClip;const patch=(x:Partial<Clip>)=>commit(p=>{p.clips[i]={...p.clips[i],...x};return p;});
  const dur=clipDuration(clip);const span=videoSourceSpan(clip);
  const tr=clip.transition||doc.transition;
  const replace=async()=>{const [it]=await window.compose.media.import('visual',false);if(!it)return;if(it.type!=='image'&&it.type!=='video')return;
    patch({file:it.file,type:it.type as Clip['type'],...(it.type==='video'?{source_duration:it.duration?round(it.duration):null,trim_start:0,trim_end:null,fit_duration:clip.type==='video'?clip.fit_duration:dur}:{duration:dur,fit_duration:null})});toast('장면 미디어를 바꿨어요.','success');};
  return <SidePanel title={`장면 ${i+1} 설정`} head={<div className="panel-head-actions">
      <IconButton label="앞으로 옮기기" disabled={i===0} onClick={()=>{commit(p=>{const [c]=p.clips.splice(i,1);p.clips.splice(i-1,0,c);return p;});setSelectedClip(i-1);}}><ArrowUp size={15}/></IconButton>
      <IconButton label="뒤로 옮기기" disabled={i>=doc.clips.length-1} onClick={()=>{commit(p=>{const [c]=p.clips.splice(i,1);p.clips.splice(i+1,0,c);return p;});setSelectedClip(i+1);}}><ArrowDown size={15}/></IconButton>
      <IconButton label="장면 삭제" danger onClick={()=>{if(!confirm(`장면 ${i+1}을(를) 삭제할까요? (파일은 지우지 않아요)`))return;commit(p=>{p.clips.splice(i,1);return p;});setSelectedClip(null);}}><Trash2 size={15}/></IconButton></div>}>
    <Section title="미디어">
      <div className="media-line"><span className={`strip-kind kind-${clip.type}`}>{clip.type==='image'?'이미지':'영상'}</span><span className="path-text" title={clip.file}>{fileName(clip.file)}</span></div>
      <Field label="장면 이름"><input value={clip.label||''} onChange={e=>patch({label:e.target.value})} placeholder="예: 01 출발"/></Field>
      <Button kind="outline" size="sm" onClick={()=>void replace()}><RefreshCw size={14}/> 다른 이미지·영상으로 바꾸기</Button>
    </Section>
    <Section title="길이">
      {clip.type==='image'
        ?<Slider label="보여 줄 시간" value={dur} min={.5} max={30} step={.1} format={v=>`${v.toFixed(1)}초`} onChange={v=>patch({duration:round(v,2),fit_duration:null})}/>
        :<>
          <Segmented label="영상 길이 방식" value={clip.fit_duration?'fit':'speed'} options={[{id:'speed',label:'배속으로 정하기'},{id:'fit',label:'길이에 맞추기'}]} onChange={v=>patch(v==='fit'?{fit_duration:round(dur,2)}:{fit_duration:null,speed:1})}/>
          {clip.fit_duration
            ?<Slider label="장면 길이" value={dur} min={.5} max={60} step={.1} format={v=>`${v.toFixed(1)}초 · ${clipSpeed(clip).toFixed(2)}배속`} onChange={v=>patch({fit_duration:round(v,2)})} description="원본 영상을 이 길이에 맞게 빠르게/느리게 재생해요."/>
            :<Slider label="재생 배속" value={Number(clip.speed)||1} min={.25} max={4} step={.05} format={v=>`${v.toFixed(2)}배 · ${dur.toFixed(1)}초`} onChange={v=>patch({speed:round(v,2)})}/>}
          <div className="field-row">
            <Field label="원본 시작 (초)"><input type="number" min={0} step={.1} value={Number(clip.trim_start)||0} onChange={e=>patch({trim_start:Math.max(0,Number(e.target.value)||0)})}/></Field>
            <Field label="원본 끝 (초)"><input type="number" min={0} step={.1} value={clip.trim_end??''} placeholder={span!=null?String(round((Number(clip.trim_start)||0)+span,1)):'끝까지'} onChange={e=>patch({trim_end:e.target.value===''?null:Math.max(0,Number(e.target.value))})}/></Field>
          </div>
          <label className="check-line"><input type="checkbox" checked={!clip.mute} onChange={e=>patch({mute:!e.target.checked})}/> 영상 원래 소리 사용</label>
        </>}
    </Section>
    {clip.type==='image'&&<Section title="움직임">
      <Field label="화면 움직임"><select value={String(clip.motion||'none')} onChange={e=>patch({motion:e.target.value})}>{MOTIONS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
      {clip.motion&&clip.motion!=='none'&&<Slider label="움직임 크기" value={Number(clip.motion_strength??.15)} min={.03} max={.4} step={.01} format={v=>v<.08?'아주 약하게':v<.16?'약하게':v<.26?'보통':'크게'} onChange={v=>patch({motion_strength:round(v,2)})}/>}
      <Button kind="ghost" size="sm" onClick={()=>commit(p=>{p.clips.forEach(c=>{if(c.type==='image'){c.motion=clip.motion;c.motion_strength=clip.motion_strength;}});return p;})}>모든 이미지 장면에 같은 움직임 적용</Button>
    </Section>}
    <Section title={i===0?'전환 (첫 장면은 없음)':'앞 장면에서 넘어올 때'}>
      {i>0&&<><Segmented label="전환" value={tr?.type&&tr.type!=='none'?(TRANSITIONS.some(t=>t.id===tr.type)?tr.type:'crossfade'):'none'} options={TRANSITIONS.map(t=>({id:t.id,label:t.label}))} onChange={v=>patch({transition:{type:v,duration:v==='none'?0:Math.max(.2,tr?.duration||.5)}})}/>
        {tr&&tr.type!=='none'&&<Slider label="전환 시간" value={tr.duration||.5} min={.2} max={2} step={.1} format={v=>`${v.toFixed(1)}초`} onChange={v=>patch({transition:{type:tr.type,duration:round(v,2)}})}/>}
        <Button kind="ghost" size="sm" onClick={()=>commit(p=>{p.clips.forEach((c,k)=>{if(k>0)c.transition=clip.transition?{...clip.transition}:null;});return p;})}>모든 장면에 같은 전환 적용</Button></>}
    </Section>
  </SidePanel>;
}
