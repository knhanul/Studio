import {useState,type DragEvent} from 'react';
import {ArrowDown,ArrowUp,Film,Image as ImageIcon,ImagePlus,Library,Plus,RefreshCw,Replace,Trash2} from 'lucide-react';
import {clipDuration,clipSpeed,MOTIONS,round,TRANSITIONS,videoSourceSpan} from '../../shared/project';
import {isEffectsProject,resolveTransition,TONE_LABELS} from '../../shared/camera';
import {OVERLAY_LABELS} from '../../shared/overlays';
import {importedItems,insertPosterBefore,mergeLibrary,sceneAlternatives,swapClipMedia} from '../../shared/media';
import type {Clip} from '../../shared/types';
import {useMediaActions} from '../components/MediaLibrary';
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
    commit(p=>{p.media_library=mergeLibrary(p.media_library,importedItems(items));for(const it of visual){const c:Clip={file:it.file,type:it.type as Clip['type'],label:it.name.replace(/\.[^.]+$/,''),motion:it.type==='image'?'zoom_in':'none',motion_strength:.08};if(it.type==='image')c.duration=4;else if(it.duration)c.source_duration=round(it.duration);p.clips.push(c);}return p;});
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
        <div className="strip-thumb">{t.clip.type==='image'&&urls[t.clip.file]?<img src={urls[t.clip.file]} alt=""/>:t.clip.type==='video'&&t.clip.poster&&urls[t.clip.poster]?<img src={urls[t.clip.poster]} alt=""/>:t.clip.type==='video'&&urls[t.clip.file]?<video src={urls[t.clip.file]} muted preload="metadata"/>:<div className="media-placeholder">{t.clip.type==='image'?<ImageIcon size={18}/>:<Film size={18}/>}</div>}
          <span className="strip-index">{t.index+1}</span><span className={`strip-kind kind-${t.clip.type}`}>{t.clip.type==='image'?'이미지':'영상'}</span>{sceneAlternatives(doc,t.clip).length>0&&<span className="strip-alt" title="같은 장면의 다른 이미지·영상이 보관함에 있어요">+{sceneAlternatives(doc,t.clip).length}</span>}</div>
        <div className="strip-info"><strong>{t.clip.label||fileName(t.clip.file)}</strong><small>{sec1(t.duration)}{t.clip.type==='image'&&t.clip.motion&&t.clip.motion!=='none'?` · ${MOTIONS.find(m=>m.id===t.clip.motion)?.label||''}`:''}</small></div>
      </button>)}
      <button type="button" className="strip-add" onClick={()=>void addScenes()}><Plus size={18}/><span>장면 추가</span><small>이미지·영상</small></button>
    </div>
    <Timeline/>
  </div>;
}
/** 앞 클립과 같은 장면·같은 그림의 다음 샷인가 (내보내기에서 한 구간으로 묶임) */
function isSameShot(doc:{clips:Clip[]},i:number){const a=doc.clips[i-1],b=doc.clips[i];return !!a&&!!b&&a.type==='image'&&b.type==='image'&&a.scene_id!=null&&a.scene_id===b.scene_id&&a.file===b.file;}
export function ScenesPanel(){
  const {doc,selectedClip,setSelectedClip,commit,toast,urls,openLibrary}=useEditor();
  const act=useMediaActions();
  const clip=selectedClip!=null?doc.clips[selectedClip]:null;
  if(!clip||selectedClip==null)return <SidePanel title="장면 설정"><Empty title="장면을 선택해 주세요" description="아래 장면 카드나 타임라인의 장면을 누르면 길이·움직임·전환을 바꿀 수 있어요."/></SidePanel>;
  const i=selectedClip;const patch=(x:Partial<Clip>)=>commit(p=>{p.clips[i]={...p.clips[i],...x};return p;});
  const dur=clipDuration(clip);const span=videoSourceSpan(clip);
  const tr=clip.transition||doc.transition;
  const replace=async()=>{const [it]=await window.compose.media.import('visual',false);if(!it)return;if(it.type!=='image'&&it.type!=='video')return;
    commit(p=>{p.media_library=mergeLibrary(p.media_library,importedItems([it]));p.clips[i]=swapClipMedia(p.clips[i],{file:it.file,kind:it.type as Clip['type'],duration:it.duration},dur);return p;});toast('장면 미디어를 바꿨어요.','success');};
  const alts=sceneAlternatives(doc,clip);
  /** 같은 장면(scene_id)의 샷 전체에 적용 — 효과·색감은 장면 단위 */
  const patchScene=(x:Partial<Clip>)=>commit(p=>{const sid=p.clips[i].scene_id;p.clips=p.clips.map((c,k)=>k===i||(sid!=null&&c.scene_id===sid)?{...c,...x}:c);return p;});
  const sameShot=isSameShot(doc,i);
  const resolved=resolveTransition(tr?.type,isEffectsProject(doc));
  const trValue=resolved==='none'?'none':resolved==='fade'?'crossfade':resolved==='fadeblack'?'fadeblack':String(tr?.type);
  const trOptions=[...TRANSITIONS.map(t=>({id:t.id,label:t.label})),...(TRANSITIONS.some(t=>t.id===trValue)?[]:[{id:trValue,label:`창작실 전환 (${trValue})`}])];
  return <SidePanel title={`장면 ${i+1} 설정`} head={<div className="panel-head-actions">
      <IconButton label="앞으로 옮기기" disabled={i===0} onClick={()=>{commit(p=>{const [c]=p.clips.splice(i,1);p.clips.splice(i-1,0,c);return p;});setSelectedClip(i-1);}}><ArrowUp size={15}/></IconButton>
      <IconButton label="뒤로 옮기기" disabled={i>=doc.clips.length-1} onClick={()=>{commit(p=>{const [c]=p.clips.splice(i,1);p.clips.splice(i+1,0,c);return p;});setSelectedClip(i+1);}}><ArrowDown size={15}/></IconButton>
      <IconButton label="장면 삭제" danger onClick={()=>{if(!confirm(`장면 ${i+1}을(를) 삭제할까요? (파일은 지우지 않아요)`))return;commit(p=>{p.clips.splice(i,1);return p;});setSelectedClip(null);}}><Trash2 size={15}/></IconButton></div>}>
    <Section title="미디어" aside={clip.scene_id?<span className="chip" title="창작실 장면 ID">{clip.scene_id}</span>:undefined}>
      <div className="media-line"><span className={`strip-kind kind-${clip.type}`}>{clip.type==='image'?'이미지':'영상'}</span><span className="path-text" title={clip.file}>{fileName(clip.file)}</span></div>
      {clip.type==='video'&&clip.poster&&<div className="media-line muted-text"><ImageIcon size={12}/><span className="path-text" title={clip.poster}>기준 이미지 · {fileName(clip.poster)}</span></div>}
      <Field label="장면 이름"><input value={clip.label||''} onChange={e=>patch({label:e.target.value})} placeholder="예: 01 출발"/></Field>
      {alts.length>0&&<div className="alt-list" aria-label="같은 장면의 다른 미디어">
        <span className="field-label">같은 장면의 다른 미디어 {alts.length}개</span>
        {alts.slice(0,6).map(m=><button type="button" key={m.file} className="alt-item" onClick={()=>void act.replaceClip(i,m)} title={`이걸로 바꾸기 · ${m.file}`}>
          <span className="alt-thumb">{m.kind==='image'&&urls[m.file]?<img src={urls[m.file]} alt=""/>:m.kind==='video'&&clip.poster&&urls[clip.poster]?<img src={urls[clip.poster]} alt=""/>:m.kind==='image'?<ImageIcon size={14}/>:<Film size={14}/>}</span>
          <span className="alt-text"><strong>{fileName(m.file)}</strong><small>{m.kind==='image'?'이미지':'영상'}{m.role==='reference'?' · 기준 이미지':m.version&&m.version>1?` · v${m.version}`:''}</small></span><Replace size={13}/></button>)}
      </div>}
      <div className="btn-row">
        <Button kind="outline" size="sm" onClick={()=>openLibrary({kind:'clip',index:i})}><Library size={14}/> 보관함에서 고르기</Button>
        <Button kind="ghost" size="sm" onClick={()=>void replace()}><RefreshCw size={14}/> 파일에서 바꾸기</Button>
      </div>
      {clip.type==='video'&&clip.poster&&<Button kind="ghost" size="sm" onClick={()=>{commit(p=>insertPosterBefore(p,i,2));setSelectedClip(i+1);toast('기준 이미지를 앞 장면(2초)으로 넣고, 영상으로 서서히 바뀌게 했어요.','success');}} title="이미지로 시작해 같은 그림의 영상으로 자연스럽게 이어집니다"><ImagePlus size={14}/> 기준 이미지를 앞에 넣기 (이미지 → 영상)</Button>}
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
    <Section title="분위기 효과 · 색감" aside={clip.scene_id?<span className="muted-text small">{String(clip.scene_id)} 장면 전체</span>:undefined}>
      <Field label="분위기 효과"><select value={String(clip.overlay||'none')} onChange={e=>patchScene({overlay:e.target.value==='none'?null:e.target.value,...(clip.overlay_strength==null?{overlay_strength:.5}:{})})}>{Object.entries(OVERLAY_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
      {clip.overlay&&clip.overlay!=='none'&&<Slider label="효과 세기" value={Number(clip.overlay_strength??.5)} min={0} max={1} step={.05} format={v=>v<.25?'아주 약하게':v<.5?'약하게':v<.75?'보통':'강하게'} onChange={v=>patchScene({overlay_strength:round(v,2)})}/>}
      <Field label="색감"><select value={String(clip.tone||'none')} onChange={e=>patchScene({tone:e.target.value==='none'?null:e.target.value})}>{Object.entries(TONE_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
      <Button kind="ghost" size="sm" onClick={()=>commit(p=>{p.clips.forEach(c=>{c.overlay=clip.overlay??null;c.overlay_strength=clip.overlay_strength;c.tone=clip.tone??null;});return p;})}>모든 장면에 같은 효과·색감 적용</Button>
    </Section>
    {clip.type==='image'&&<Section title="움직임">
      <Field label="화면 움직임"><select value={String(clip.motion||'none')} onChange={e=>patch({motion:e.target.value})}>{MOTIONS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
      {clip.motion&&clip.motion!=='none'&&<Slider label="움직임 크기" value={Number(clip.motion_strength??.15)} min={.03} max={.4} step={.01} format={v=>v<.08?'아주 약하게':v<.16?'약하게':v<.26?'보통':'크게'} onChange={v=>patch({motion_strength:round(v,2)})}/>}
      <Button kind="ghost" size="sm" onClick={()=>commit(p=>{p.clips.forEach(c=>{if(c.type==='image'){c.motion=clip.motion;c.motion_strength=clip.motion_strength;}});return p;})}>모든 이미지 장면에 같은 움직임 적용</Button>
    </Section>}
    <Section title={i===0?'전환 (첫 장면은 없음)':'앞 장면에서 넘어올 때'}>
      {i>0&&sameShot&&<p className="muted-text small">같은 장면({String(clip.scene_id)})의 다음 샷이에요. 샷 사이는 섞지 않고 카메라가 이어서 움직여요.</p>}
      {i>0&&!sameShot&&<><Segmented label="전환" value={trValue} options={trOptions} onChange={v=>patch({transition:{type:v,duration:v==='none'?0:Math.max(.2,tr?.duration||.5)}})}/>
        {tr&&trValue!=='none'&&<Slider label="전환 시간" value={tr.duration||.5} min={.2} max={2} step={.1} format={v=>`${v.toFixed(1)}초`} onChange={v=>patch({transition:{...tr,duration:round(v,2)}})}/>}
        <Button kind="ghost" size="sm" onClick={()=>commit(p=>{p.clips.forEach((c,k)=>{if(k>0&&!isSameShot(p,k))c.transition=clip.transition?{...clip.transition}:null;});return p;})}>모든 장면에 같은 전환 적용</Button></>}
    </Section>
  </SidePanel>;
}
