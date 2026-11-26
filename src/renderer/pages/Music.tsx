import type {ReactNode} from 'react';
import {Music2,Plus,X} from 'lucide-react';
import {round} from '../../shared/project';
import type {Bgm} from '../../shared/types';
import {Monitor} from '../components/Monitor';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {Button,Empty,Section,Segmented,Slider,Toggle} from '../components/UI';
import {fileName,useEditor} from '../editor';

const DUCK=[{id:3,label:'조금'},{id:6,label:'보통'},{id:12,label:'많이'}];
export function MusicStep({header,actionBar}:{header:ReactNode;actionBar:ReactNode}){
  const {doc,commit,toast}=useEditor();const b=doc.bgm;
  const set=(x:Partial<Bgm>)=>commit(p=>{p.bgm={...p.bgm,...x};return p;});
  const pick=async()=>{const [it]=await window.compose.media.import('audio',false);if(!it)return;set({file:it.file});toast(`배경음악: ${it.name}`,'success');};
  const duck=Number(b.duck_ratio)||6;const near=DUCK.reduce((a,c)=>Math.abs(c.id-duck)<Math.abs(a.id-duck)?c:a).id;
  const panel=<SidePanel title="배경음악과 소리 크기" className="wide-panel">
    <Section title="배경음악">
      {b.file?<div className="bgm-file"><Music2 size={16}/><span className="path-text" title={b.file}>{fileName(b.file)}</span><button type="button" className="icon-btn" title="배경음악 빼기" aria-label="배경음악 빼기" onClick={()=>set({file:null})}><X size={14}/></button></div>
        :<Empty icon={<Music2 size={24}/>} title="배경음악이 없어요" description="창작실에서 만든 BGM이나 컴퓨터의 음악 파일을 넣을 수 있어요."/>}
      <Button size="sm" kind="outline" onClick={()=>void pick()}><Plus size={14}/> {b.file?'다른 음악으로 바꾸기':'음악 파일 넣기'}</Button>
    </Section>
    <Section title="소리 크기 (들어 보며 맞추세요)">
      <Slider label="목소리(더빙)" value={Number(doc.dubbing.volume??1)} min={0} max={2} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>commit(p=>{p.dubbing.volume=round(v,2);return p;})}/>
      <Slider label="배경음악" value={Number(b.volume??.25)} min={0} max={1} step={.01} format={v=>`${Math.round(v*100)}%`} onChange={v=>set({volume:round(v,2)})}/>
      {doc.clips.some(c=>c.type==='video'&&!c.mute)&&<Slider label="영상 원래 소리" value={Number(doc.output.original_volume??1)} min={0} max={2} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>commit(p=>{p.output.original_volume=round(v,2);return p;})}/>}
    </Section>
    <Section title="목소리가 나올 때">
      <Toggle label="배경음악 자동으로 줄이기" checked={b.duck_under_voice!==false} onChange={v=>set({duck_under_voice:v})} description="더빙 목소리가 나오는 동안만 음악을 낮춰 말이 잘 들려요."/>
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
