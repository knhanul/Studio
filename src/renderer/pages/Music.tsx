import type {ReactNode} from 'react';
import {Library,Music2,Plus,Sparkles,Trash2,X} from 'lucide-react';
import {fmt,round} from '../../shared/project';
import {bgmSpan,cueSpan,importedItems,mediaUsage,mergeLibrary,newCueId} from '../../shared/media';
import type {AudioCue,Bgm} from '../../shared/types';
import {Monitor} from '../components/Monitor';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {useMediaActions} from '../components/MediaLibrary';
import {Button,Empty,Field,IconButton,Section,Segmented,Slider,Tag,Toggle} from '../components/UI';
import {fileName,useEditor} from '../editor';

const DUCK=[{id:3,label:'조금'},{id:6,label:'보통'},{id:12,label:'많이'}];

function CueEditor({cue}:{cue:AudioCue}){
  const {commit,playhead,total,setSelectedAudio}=useEditor();
  const set=(x:Partial<AudioCue>)=>commit(p=>{p.audio_cues=(p.audio_cues||[]).map(c=>c.id===cue.id?{...c,...x}:c);return p;});
  const span=cueSpan(cue,total);const music=cue.kind!=='effect';
  return <div className="cue-editor">
    <div className="cue-editor-head"><strong>{cue.label||fileName(cue.file)}</strong>
      <IconButton label="이 소리 빼기" danger onClick={()=>{commit(p=>{p.audio_cues=(p.audio_cues||[]).filter(c=>c.id!==cue.id);return p;});setSelectedAudio(null);}}><Trash2 size={14}/></IconButton></div>
    <Field label="이름"><input value={cue.label||''} onChange={e=>set({label:e.target.value})} placeholder={fileName(cue.file)}/></Field>
    <Segmented label="종류" value={cue.kind} options={[{id:'music' as const,label:'음악 (바뀌는 배경음악)'},{id:'effect' as const,label:'효과음'}]} onChange={v=>set({kind:v,...(v==='effect'?{loop:false,duck_under_voice:false,fade_in:0,fade_out:0}:{loop:true,duck_under_voice:true,fade_in:1,fade_out:2})})}/>
    <div className="field-row">
      <Field label="시작 (초)"><input type="number" min={0} step={.1} value={round(Number(cue.start)||0,2)} onChange={e=>set({start:Math.max(0,Number(e.target.value)||0)})}/></Field>
      <Field label="끝 (초)"><input type="number" min={0} step={.1} value={cue.end??''} placeholder={`${span.end.toFixed(1)} (자동)`} onChange={e=>set({end:e.target.value===''?null:Math.max(0,Number(e.target.value))})}/></Field>
    </div>
    <div className="btn-row"><Button size="sm" kind="ghost" onClick={()=>set({start:round(playhead,2)})}>재생 위치({fmt(playhead)})에서 시작</Button><Button size="sm" kind="ghost" disabled={playhead<=cue.start} onClick={()=>set({end:round(playhead,2)})}>재생 위치에서 끝</Button></div>
    <Slider label="크기" value={Number(cue.volume??(music?.25:1))} min={0} max={music?1:2} step={.01} format={v=>`${Math.round(v*100)}%`} onChange={v=>set({volume:round(v,2)})}/>
    <Toggle label={music?'음악이 짧으면 반복 재생':'반복 재생'} checked={Boolean(cue.loop)} onChange={v=>set({loop:v})}/>
    <Toggle label="목소리 나올 때 줄이기" checked={cue.duck_under_voice==null?music:Boolean(cue.duck_under_voice)} onChange={v=>set({duck_under_voice:v})}/>
    <div className="field-row">
      <Slider label="서서히 커지기" value={Number(cue.fade_in??(music?1:0))} min={0} max={6} step={.25} format={v=>v?`${v}초`:'없음'} onChange={v=>set({fade_in:v})}/>
      <Slider label="서서히 작아지기" value={Number(cue.fade_out??(music?1.5:0))} min={0} max={6} step={.25} format={v=>v?`${v}초`:'없음'} onChange={v=>set({fade_out:v})}/>
    </div>
    <p className="muted-text small">{span.start.toFixed(1)}초 ~ {span.end.toFixed(1)}초에 들려요.</p>
  </div>;
}

export function MusicStep({header,actionBar}:{header:ReactNode;actionBar:ReactNode}){
  const {doc,commit,toast,total,tracks,selectedClip,setSelectedClip,seek,openLibrary,selectedAudio,setSelectedAudio,playhead}=useEditor();const b=doc.bgm;
  const act=useMediaActions();
  const set=(x:Partial<Bgm>)=>commit(p=>{p.bgm={...p.bgm,...x};return p;});
  const pick=async()=>{const [it]=await window.compose.media.import('audio',false);if(!it)return;commit(p=>{p.media_library=mergeLibrary(p.media_library,importedItems([it]));p.bgm={...p.bgm,file:it.file};return p;});toast(`배경음악: ${it.name}`,'success');};
  const addEffectFile=async()=>{const [it]=await window.compose.media.import('audio',false);if(!it)return;const id=newCueId();
    commit(p=>{p.media_library=mergeLibrary(p.media_library,importedItems([it]));p.audio_cues=[...(p.audio_cues||[]),{id,file:it.file,label:it.name.replace(/\.[^.]+$/,''),kind:'effect',start:round(playhead,2),end:null,volume:1,loop:false,fade_in:0,fade_out:0,duck_under_voice:false,duration:it.duration??null}];return p;});setSelectedAudio(id);toast(`효과음을 ${fmt(playhead)}에 넣었어요.`,'success');};
  const duck=Number(b.duck_ratio)||6;const near=DUCK.reduce((a,c)=>Math.abs(c.id-duck)<Math.abs(a.id-duck)?c:a).id;
  const packageMusic=(doc.media_library||[]).filter(m=>m.kind==='audio');
  const cues=[...(doc.audio_cues||[])].sort((a,c)=>a.start-c.start);
  const selectedCue=cues.find(c=>c.id===selectedAudio)||null;
  const bspan=bgmSpan(b,total);
  const from=act.sceneStart();
  const panel=<SidePanel title="배경음악과 소리" className="wide-panel">
    <Section title="배경음악" aside={packageMusic.length?<Tag tone="accent">패키지 음악 {packageMusic.length}개</Tag>:undefined}>
      {b.file?<div className={`bgm-file ${selectedAudio==='bgm'?'is-selected':''}`}><Music2 size={16}/><span className="path-text" title={b.file}>{fileName(b.file)}</span>
          <small className="bgm-span">{fmt(bspan.start)}~{fmt(bspan.end)}</small>
          <button type="button" className="icon-btn" title="배경음악 빼기" aria-label="배경음악 빼기" onClick={()=>set({file:null,end:null})}><X size={14}/></button></div>
        :<Empty icon={<Music2 size={24}/>} title="배경음악이 없어요" description="창작실에서 만든 BGM이나 컴퓨터의 음악 파일을 넣을 수 있어요."/>}
      {b.file&&b.end!=null&&<div className="inline-hint">배경음악이 {fmt(Number(b.end))}에 끝나고 다음 음악으로 바뀌어요. <button type="button" className="link-btn" onClick={()=>set({end:null})}>끝까지 이어 재생</button></div>}
      {packageMusic.length>0&&<div className="music-chips">{packageMusic.map(m=>{const used=mediaUsage(doc,m.file);return <button type="button" key={m.file} className={`music-chip ${b.file===m.file?'on':''}`} title={`${m.file}${used.length?` · ${used.join(', ')}`:''}`} onClick={()=>act.setBgm(m)}><Music2 size={12}/>{fileName(m.file)}{used.length>0&&b.file!==m.file&&<small>사용 중</small>}</button>;})}</div>}
      <div className="btn-row">
        <Button size="sm" kind="outline" onClick={()=>openLibrary({kind:'bgm'})}><Library size={14}/> 보관함에서 고르기</Button>
        <Button size="sm" kind="ghost" onClick={()=>void pick()}><Plus size={14}/> 음악 파일 넣기</Button>
      </div>
    </Section>
    <Section title="장면마다 음악 바꾸기 · 효과음">
      <Field label="어느 장면부터 바꿀까요?"><select value={selectedClip??''} onChange={e=>{const v=e.target.value===''?null:Number(e.target.value);setSelectedClip(v);if(v!=null&&tracks[v])seek(tracks[v].start);}}>
        <option value="">재생 위치 ({fmt(playhead)})</option>
        {tracks.map(t=><option key={t.index} value={t.index}>장면 {t.index+1} · {t.clip.label||fileName(t.clip.file)} ({fmt(t.start)})</option>)}
      </select></Field>
      <div className="btn-row">
        <Button size="sm" kind="outline" onClick={()=>openLibrary({kind:'music'})} title="앞 음악은 그 시각에 서서히 끝나고 새 음악이 이어집니다"><Music2 size={14}/> {fmt(from)}부터 다른 음악</Button>
        <Button size="sm" kind="outline" onClick={()=>openLibrary({kind:'effect'})}><Sparkles size={14}/> 재생 위치에 효과음</Button>
        <Button size="sm" kind="ghost" onClick={()=>void addEffectFile()}><Plus size={14}/> 효과음 파일</Button>
      </div>
      {cues.length>0?<div className="cue-list">{cues.map(c=>{const s=cueSpan(c,total);return <button type="button" key={c.id} className={`cue-row ${selectedAudio===c.id?'selected':''}`} onClick={()=>{setSelectedAudio(c.id);seek(s.start);}}>
          <span className={`strip-kind ${c.kind==='effect'?'kind-effect':'kind-audio'}`}>{c.kind==='effect'?'효과음':'음악'}</span><span className="path-text">{c.label||fileName(c.file)}</span><small>{fmt(s.start)}~{fmt(s.end)}</small></button>;})}</div>
        :<p className="muted-text small">창작실 패키지의 BGM_02 같은 음악으로 장면마다 분위기를 바꾸거나, 원하는 위치에 효과음을 넣을 수 있어요.</p>}
      {selectedCue&&<CueEditor cue={selectedCue}/>}
    </Section>
    <Section title="소리 크기 (들어 보며 맞추세요)">
      <Slider label="목소리(더빙)" value={Number(doc.dubbing.volume??1)} min={0} max={2} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>commit(p=>{p.dubbing.volume=round(v,2);return p;})}/>
      <Slider label="배경음악" value={Number(b.volume??.25)} min={0} max={1} step={.01} format={v=>`${Math.round(v*100)}%`} onChange={v=>set({volume:round(v,2)})}/>
      {doc.clips.some(c=>c.type==='video'&&!c.mute)&&<Slider label="영상 원래 소리" value={Number(doc.output.original_volume??1)} min={0} max={2} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>commit(p=>{p.output.original_volume=round(v,2);return p;})}/>}
    </Section>
    <Section title="목소리가 나올 때">
      <Toggle label="배경음악 자동으로 줄이기" checked={b.duck_under_voice!==false} onChange={v=>set({duck_under_voice:v})} description="더빙 목소리가 나오는 동안만 음악을 낮춰 말이 잘 들려요. 바뀌는 음악에도 같이 적용돼요."/>
      {b.duck_under_voice!==false&&<Segmented label="줄이는 정도" value={near} options={DUCK} onChange={v=>set({duck_ratio:v})}/>}
    </Section>
    <Section title="시작과 끝">
      <Slider label="처음에 서서히 커지기" value={Number(b.fade_in??1)} min={0} max={6} step={.5} format={v=>v?`${v}초`:'없음'} onChange={v=>set({fade_in:v})}/>
      <Slider label="끝에서 서서히 작아지기" value={Number(b.fade_out??2)} min={0} max={10} step={.5} format={v=>v?`${v}초`:'없음'} onChange={v=>set({fade_out:v})}/>
      <Toggle label="음악이 짧으면 반복 재생" checked={b.loop!==false} onChange={v=>set({loop:v})}/>
    </Section>
  </SidePanel>;
  return <StepLayout header={header} actionBar={actionBar} panel={panel}><div className="editor-stack"><Monitor/><Timeline/></div></StepLayout>;
}
