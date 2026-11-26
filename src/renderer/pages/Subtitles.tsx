import {useState,type ReactNode} from 'react';
import {Download,Mic2,Plus,Trash2,Upload} from 'lucide-react';
import {fmt,fromSrt,nextCueIndex,parseTime,round,sortCues,takeForCue,takeLength} from '../../shared/project';
import type {SubtitleItem,SubtitleStyle} from '../../shared/types';
import {Monitor} from '../components/Monitor';
import {SidePanel,StepLayout} from '../components/Shell';
import {Timeline} from '../components/Timeline';
import {Button,Empty,Field,IconButton,Section,Segmented,Slider,Toggle} from '../components/UI';
import {useEditor} from '../editor';

function TimeInput({value,onChange,label}:{value:number;onChange:(v:number)=>void;label:string}){
  const [text,setText]=useState<string|null>(null);
  return <input aria-label={label} className="time-input" value={text??fmt(value)} onFocus={()=>setText(fmt(value))} onChange={e=>setText(e.target.value)}
    onBlur={()=>{const v=text==null?null:parseTime(text);if(v!=null)onChange(round(v));setText(null);}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}/>;
}
export function SubtitlesStep({header,actionBar}:{header:ReactNode;actionBar:ReactNode}){
  const {doc,commit,playhead,seek,selectedCue,setSelectedCue,toast}=useEditor();
  const [tab,setTab]=useState<'text'|'style'>('text');
  const items=sortCues(doc.subtitle.items||[]);const off=Number(doc.subtitle.offset)||0;
  const patch=(index:number,x:Partial<SubtitleItem>)=>commit(p=>{p.subtitle.items=(p.subtitle.items||[]).map(c=>c.index===index?{...c,...x}:c);return p;});
  const st=doc.subtitle.style||{};const setStyle=(x:Partial<SubtitleStyle>)=>commit(p=>{p.subtitle.style={...p.subtitle.style,...x};return p;});
  const add=()=>{const idx=nextCueIndex(doc);const start=round(playhead-off);commit(p=>{p.subtitle.items=sortCues([...(p.subtitle.items||[]),{index:idx,start,end:round(start+2.5),text:''}]);return p;});setSelectedCue(idx);};
  const importSrt=async()=>{const text=await window.compose.subtitle.importSrt();if(!text)return;const list=fromSrt(text);if(!list.length)return toast('SRT에서 자막을 찾지 못했어요.','error');if(items.length&&!confirm(`지금 자막 ${items.length}개를 SRT 자막 ${list.length}개로 바꿀까요? (문장별 녹음 연결은 번호 기준으로 유지돼요)`))return;commit(p=>{p.subtitle.items=list;return p;});toast(`자막 ${list.length}개를 불러왔어요.`,'success');};
  const panel=<SidePanel title="자막" className="wide-panel" head={<Segmented label="자막 보기" value={tab} options={[{id:'text',label:'문장'},{id:'style',label:'모양'}]} onChange={setTab}/>}>
    {tab==='text'?<>
      <div className="btn-row"><Button size="sm" onClick={add}><Plus size={14}/> 현재 위치에 자막 추가</Button><Button size="sm" kind="ghost" onClick={()=>void importSrt()}><Upload size={14}/> SRT 불러오기</Button><Button size="sm" kind="ghost" disabled={!items.length} onClick={()=>void window.compose.subtitle.saveSrt(items).then(f=>f&&toast('SRT 파일로 저장했어요.','success'))}><Download size={14}/> SRT 저장</Button></div>
      {!items.length?<Empty title="자막이 없어요" description="재생 위치를 옮긴 뒤 「현재 위치에 자막 추가」를 누르거나 SRT 파일을 불러오세요."/>:
      <ol className="sub-list">{items.map((c,k)=>{const t=takeForCue(doc,c.index);const sel=c.index===selectedCue;return <li key={c.index} className={sel?'selected':''} onClick={()=>{if(!sel){setSelectedCue(c.index);seek(c.start+off);}}}>
        <div className="sub-row-head"><span className="cue-num">{k+1}</span>
          <TimeInput label="시작 시간" value={c.start+off} onChange={v=>patch(c.index,{start:round(v-off)})}/><span className="muted-text">→</span><TimeInput label="끝 시간" value={c.end+off} onChange={v=>patch(c.index,{end:round(v-off)})}/>
          <span className={`tag ${c.end<=c.start?'tag-warning':''}`}>{(c.end-c.start).toFixed(1)}초</span>
          <IconButton label="자막 삭제" danger onClick={()=>{commit(p=>{p.subtitle.items=(p.subtitle.items||[]).filter(x=>x.index!==c.index);return p;});setSelectedCue(null);}}><Trash2 size={14}/></IconButton></div>
        <textarea rows={2} value={c.text} placeholder="자막 문구" onChange={e=>patch(c.index,{text:e.target.value})}/>
        {sel&&<div className="btn-row tight">
          <Button size="sm" kind="ghost" onClick={()=>patch(c.index,{start:round(playhead-off)})}>시작 = 재생 위치</Button>
          <Button size="sm" kind="ghost" onClick={()=>patch(c.index,{end:round(playhead-off)})}>끝 = 재생 위치</Button>
          <Button size="sm" kind="ghost" onClick={()=>patch(c.index,{start:round(c.start-.1),end:round(c.end-.1)})}>◀ 0.1초</Button>
          <Button size="sm" kind="ghost" onClick={()=>patch(c.index,{start:round(c.start+.1),end:round(c.end+.1)})}>0.1초 ▶</Button>
          {t&&takeLength(t)>0&&<Button size="sm" kind="ghost" title="이 자막의 길이를 녹음 길이와 같게" onClick={()=>patch(c.index,{end:round(c.start+takeLength(t))})}><Mic2 size={13}/> 녹음 길이에 맞춤</Button>}
        </div>}
      </li>;})}</ol>}
    </>:<>
      <Toggle label="영상에 자막 넣기" checked={doc.subtitle.burn_in!==false} onChange={v=>commit(p=>{p.subtitle.burn_in=v;return p;})} description="끄면 완성 영상에 자막이 나오지 않아요."/>
      <Section title="위치와 크기">
        <Segmented label="자막 위치" value={String(st.position||'bottom')} options={[{id:'bottom',label:'아래'},{id:'center',label:'가운데'},{id:'top',label:'위'}]} onChange={v=>setStyle({position:v})}/>
        <Slider label="글자 크기" value={Number(st.size)||52} min={24} max={120} step={1} format={v=>`${v}px`} onChange={v=>setStyle({size:v})} description="완성 영상 높이 기준 크기예요."/>
        <Slider label="가장자리에서 떨어진 거리" value={Number(st.margin_v)||60} min={0} max={300} step={5} format={v=>`${v}px`} onChange={v=>setStyle({margin_v:v})}/>
      </Section>
      <Section title="글자 모양">
        <div className="field-row"><Field label="글자 색"><input type="color" value={String(st.color||'#FFFFFF')} onChange={e=>setStyle({color:e.target.value})}/></Field><Field label="외곽선 색"><input type="color" value={String(st.outline_color||'#000000')} onChange={e=>setStyle({outline_color:e.target.value})}/></Field></div>
        <Slider label="외곽선 두께" value={Number(st.outline??2)} min={0} max={8} step={.5} format={v=>v?`${v}px`:'없음'} onChange={v=>setStyle({outline:v})}/>
        <Toggle label="굵게" checked={st.bold!==false} onChange={v=>setStyle({bold:v})}/>
        <Toggle label="글자 뒤 배경 상자" checked={Boolean(st.box)} onChange={v=>setStyle({box:v})}/>
        {st.box&&<Slider label="배경 상자 진하기" value={Number(st.box_opacity??.6)} min={.1} max={1} step={.05} format={v=>`${Math.round(v*100)}%`} onChange={v=>setStyle({box_opacity:round(v,2)})}/>}
      </Section>
      <Section title="전체 자막 밀기"><Slider label="모든 자막 시간 이동" value={off} min={-5} max={5} step={.1} format={v=>`${v>0?'+':''}${v.toFixed(1)}초`} onChange={v=>commit(p=>{p.subtitle.offset=round(v,2);return p;})}/></Section>
    </>}
  </SidePanel>;
  return <StepLayout header={header} actionBar={actionBar} panel={panel}><div className="editor-stack"><Monitor/><Timeline/></div></StepLayout>;
}
