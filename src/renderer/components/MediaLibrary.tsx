import {useEffect,useMemo,useRef,useState} from 'react';
import {Film,FolderSearch,Image as ImageIcon,Library,Music2,Pause,Play,Plus,RefreshCw,Replace,Sparkles,X} from 'lucide-react';
import {clipDuration,round} from '../../shared/project';
import {clipFromItem,importedItems,librarySummary,mediaUsage,mergeLibrary,newCueId,scenePoster,swapClipMedia,switchMusicAt} from '../../shared/media';
import type {MediaItem} from '../../shared/types';
import {fileName,useEditor,type LibraryMode} from '../editor';
import {Button,Segmented,Tag} from './UI';

const ROLE_LABEL:Record<MediaItem['role'],string>={scene:'장면에 연결',reference:'기준 이미지',alternate:'다른 버전',bgm:'배경음악',audio:'소리',extra:'추가 파일'};
type Filter='all'|'image'|'video'|'audio';

/** 보관함 항목을 장면·소리로 쓰는 동작 (보관함 창과 장면 설정 패널이 함께 씀) */
export function useMediaActions(){
  const {doc,commit,toast,setSelectedClip,playhead,tracks,selectedClip,setSelectedAudio}=useEditor();
  const probe=async(item:MediaItem)=>item.kind==='image'?null:item.duration??(await window.compose.media.probe(item.file).catch(()=>({duration:null}))).duration;
  return {
    async addScene(item:MediaItem,at?:number){
      const clip=clipFromItem(doc,item,await probe(item));if(!clip)return;
      const pos=at==null?doc.clips.length:at;
      commit(p=>{p.clips.splice(pos,0,clip);return p;});setSelectedClip(pos);toast(`「${item.name}」을(를) ${pos+1}번 장면으로 넣었어요.`,'success');
    },
    async replaceClip(index:number,item:MediaItem){
      const clip=doc.clips[index];if(!clip||item.kind==='audio')return;
      const d=await probe(item);const dur=clipDuration(clip);
      commit(p=>{p.clips[index]=swapClipMedia(p.clips[index],{file:item.file,kind:item.kind,duration:d},dur,scenePoster(p,item.scene_id??p.clips[index].scene_id));if(item.scene_id&&!p.clips[index].scene_id)p.clips[index].scene_id=item.scene_id;return p;});
      toast(`장면 ${index+1}을(를) ${item.kind==='image'?'이미지':'영상'} 「${item.name}」(으)로 바꿨어요.`,'success');
    },
    setBgm(item:MediaItem){commit(p=>{p.bgm={...p.bgm,file:item.file,end:null};return p;});toast(`배경음악: ${item.name}`,'success');},
    async switchMusic(item:MediaItem,at:number){
      const d=await probe(item);commit(p=>switchMusicAt(p,at,{file:item.file,name:item.name,duration:d}));
      toast(at>0.1&&doc.bgm.file?`${round(at,1)}초부터 「${item.name}」(으)로 음악이 바뀌어요.`:`배경음악: ${item.name}`,'success');
    },
    async addEffect(item:MediaItem,at:number){
      const d=await probe(item);const id=newCueId();
      commit(p=>{p.audio_cues=[...(p.audio_cues||[]),{id,file:item.file,label:item.name.replace(/\.[^.]+$/,''),kind:'effect',start:round(Math.max(0,at),2),end:null,volume:1,loop:false,fade_in:0,fade_out:0,duck_under_voice:false,duration:d}];return p;});
      setSelectedAudio(id);toast(`${round(at,1)}초에 효과음 「${item.name}」을(를) 넣었어요.`,'success');
    },
    /** 선택한 장면이 시작되는 시각 (없으면 재생 위치) */
    sceneStart(){return selectedClip!=null&&tracks[selectedClip]?tracks[selectedClip].start:playhead;}
  };
}

function Thumb({item}:{item:MediaItem}){
  const {urls,doc}=useEditor();
  const poster=item.kind==='video'?scenePoster(doc,item.scene_id):null;
  if(item.kind==='image'&&urls[item.file])return <img src={urls[item.file]} alt="" loading="lazy"/>;
  if(item.kind==='video'&&poster&&urls[poster])return <><img src={urls[poster]} alt="" loading="lazy"/><span className="lib-play-badge"><Film size={12}/></span></>;
  if(item.kind==='video'&&urls[item.file])return <video src={urls[item.file]} muted preload="metadata"/>;
  return <div className="media-placeholder">{item.kind==='image'?<ImageIcon size={20}/>:item.kind==='video'?<Film size={20}/>:<Music2 size={20}/>}</div>;
}

export function MediaLibrary({mode,onClose}:{mode:LibraryMode;onClose:()=>void}){
  const {doc,commit,toast,urls,playhead,selectedClip}=useEditor();
  const act=useMediaActions();
  const [filter,setFilter]=useState<Filter>(mode.kind==='bgm'||mode.kind==='music'||mode.kind==='effect'?'audio':mode.kind==='clip'?'all':'all');
  const [unusedOnly,setUnusedOnly]=useState(false);
  const [busy,setBusy]=useState(false);
  const [listening,setListening]=useState<string|null>(null);
  const audio=useRef<HTMLAudioElement|null>(null);
  useEffect(()=>()=>{audio.current?.pause();},[]);
  useEffect(()=>{const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);},[onClose]);
  const lib=doc.media_library||[];
  const shown=lib.filter(m=>(filter==='all'||m.kind===filter)&&(mode.kind!=='clip'||m.kind!=='audio')&&(!unusedOnly||!mediaUsage(doc,m.file).length));
  const groups=useMemo(()=>{
    const out:{key:string;title:string;items:MediaItem[]}[]=[];
    for(const m of shown){
      const key=m.kind==='audio'?'~audio':m.scene_id?`s:${m.scene_id}`:'~extra';
      let g=out.find(x=>x.key===key);
      if(!g){g={key,title:m.kind==='audio'?'음악 · 소리':m.scene_id?`${m.scene_id}${m.scene_title?` · ${m.scene_title}`:''}`:'장면과 상관없는 파일',items:[]};out.push(g);}
      g.items.push(m);
    }
    return out.sort((a,b)=>(a.key.startsWith('~')?1:0)-(b.key.startsWith('~')?1:0));
  },[shown]);
  const clipIndex=mode.kind==='clip'?mode.index:selectedClip;
  const target=clipIndex!=null?doc.clips[clipIndex]:null;
  const listen=(m:MediaItem)=>{audio.current?.pause();if(listening===m.file){setListening(null);return;}const url=urls[m.file];if(!url)return;const a=new Audio(url);audio.current=a;a.onended=()=>setListening(null);void a.play().catch(()=>{});setListening(m.file);};
  const rescan=async()=>{setBusy(true);try{const found=await window.compose.media.library();commit(p=>{p.media_library=mergeLibrary(p.media_library,found);return p;});toast(`작업 폴더를 다시 읽었어요. ${librarySummary(mergeLibrary(lib,found))}`,'success');}catch(e){toast(e instanceof Error?e.message:String(e),'error');}finally{setBusy(false);}};
  const importFiles=async()=>{const items=await window.compose.media.import(filter==='audio'?'audio':filter==='all'?'any':'visual');if(!items.length)return;commit(p=>{p.media_library=mergeLibrary(p.media_library,importedItems(items));return p;});toast(`보관함에 파일 ${items.length}개를 넣었어요.`,'success');};
  const done=(fn:()=>unknown)=>async()=>{await fn();if(mode.kind!=='browse')onClose();};
  const musicAt=act.sceneStart();

  const actions=(m:MediaItem)=>{
    if(m.kind==='audio'){
      if(mode.kind==='effect')return <Button size="sm" onClick={done(()=>act.addEffect(m,playhead))}><Sparkles size={13}/> 재생 위치에 넣기</Button>;
      if(mode.kind==='bgm')return <Button size="sm" onClick={done(()=>act.setBgm(m))}><Music2 size={13}/> 배경음악으로</Button>;
      if(mode.kind==='music')return <Button size="sm" onClick={done(()=>act.switchMusic(m,musicAt))}><Music2 size={13}/> {musicAt>.1?`${round(musicAt,1)}초부터 이 음악`:'배경음악으로'}</Button>;
      return <>
        <Button size="sm" kind="secondary" onClick={()=>act.setBgm(m)} title="영상 전체 배경음악으로 씁니다"><Music2 size={13}/> 배경음악</Button>
        {doc.bgm.file&&doc.bgm.file!==m.file&&musicAt>.1&&<Button size="sm" kind="ghost" onClick={()=>void act.switchMusic(m,musicAt)} title="선택한 장면(또는 재생 위치)부터 이 음악으로 바꿉니다">{round(musicAt,1)}초부터</Button>}
        <Button size="sm" kind="ghost" onClick={()=>void act.addEffect(m,playhead)} title="지금 재생 위치에 효과음으로 넣습니다">효과음</Button>
      </>;
    }
    if(mode.kind==='clip')return <Button size="sm" onClick={done(()=>act.replaceClip(mode.index,m))}><Replace size={13}/> 이 장면에 쓰기</Button>;
    return <>
      {target&&clipIndex!=null&&target.file!==m.file&&<Button size="sm" kind="secondary" onClick={()=>void act.replaceClip(clipIndex,m)} title={`장면 ${clipIndex+1}의 미디어를 이걸로 바꿉니다`}><Replace size={13}/> 장면 {clipIndex+1} 바꾸기</Button>}
      <Button size="sm" kind="ghost" onClick={()=>void act.addScene(m,clipIndex!=null?clipIndex+1:undefined)} title={clipIndex!=null?`장면 ${clipIndex+1} 뒤에 새 장면으로 넣습니다`:'맨 끝에 새 장면으로 넣습니다'}><Plus size={13}/> 새 장면</Button>
    </>;
  };
  const title=mode.kind==='clip'?`장면 ${mode.index+1}에 쓸 미디어 고르기`:mode.kind==='bgm'?'배경음악 고르기':mode.kind==='music'?'바꿀 음악 고르기':mode.kind==='effect'?'효과음 고르기':'미디어 보관함';
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal library-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div className="modal-head-icon"><Library size={18}/></div><div><h2>{title}</h2><p>{lib.length?`창작실 패키지와 작업 폴더의 미디어 · ${librarySummary(lib)}`:'아직 보관함이 비어 있어요. 작업 폴더를 다시 읽거나 파일을 가져오세요.'}</p></div>
        <button type="button" className="icon-btn" aria-label="닫기" title="닫기 (Esc)" onClick={onClose}><X size={16}/></button></div>
      <div className="library-tools">
        <Segmented label="종류" value={filter} options={[{id:'all' as Filter,label:'전체'},{id:'image' as Filter,label:'이미지'},{id:'video' as Filter,label:'영상'},...(mode.kind==='clip'?[]:[{id:'audio' as Filter,label:'음악·소리'}])]} onChange={setFilter}/>
        <label className="check-line"><input type="checkbox" checked={unusedOnly} onChange={e=>setUnusedOnly(e.target.checked)}/> 아직 안 쓴 것만</label>
        <span className="library-spacer"/>
        <Button size="sm" kind="ghost" disabled={busy} onClick={()=>void rescan()} title="작업 폴더의 assets/ · media/ 를 다시 읽어 새로 넣은 파일을 찾습니다"><RefreshCw size={13} className={busy?'spin':''}/> 폴더 다시 읽기</Button>
        <Button size="sm" kind="outline" onClick={()=>void importFiles()}><FolderSearch size={13}/> 파일 가져오기</Button>
      </div>
      <div className="library-body">
        {!groups.length&&<p className="muted-text library-empty">{lib.length?'조건에 맞는 미디어가 없어요.':'창작실에서 「더빙 전달」로 내보낸 패키지를 열면 장면별 이미지·영상·배경음악이 여기에 모여요.'}</p>}
        {groups.map(g=><section key={g.key} className="library-group">
          <h4>{g.title}{target?.scene_id&&g.key===`s:${target.scene_id}`&&<Tag tone="accent">선택한 장면</Tag>}</h4>
          <div className="library-grid">{g.items.map(m=>{const used=mediaUsage(doc,m.file);return <article key={m.file} className={`library-card ${used.length?'is-used':''}`}>
            <div className="library-thumb">{m.kind==='audio'
              ?<button type="button" className="library-listen" onClick={()=>listen(m)} aria-label={listening===m.file?'멈추기':'들어 보기'} title={listening===m.file?'멈추기':'들어 보기'}>{listening===m.file?<Pause size={20}/>:<Play size={20}/>}</button>
              :<Thumb item={m}/>}
              <span className={`strip-kind kind-${m.kind==='audio'?'audio':m.kind}`}>{m.kind==='image'?'이미지':m.kind==='video'?'영상':'소리'}</span></div>
            <div className="library-info"><strong title={m.file}>{fileName(m.file)}</strong>
              <div className="library-tags"><Tag tone={m.role==='scene'?'success':m.role==='reference'?'accent':'muted'}>{ROLE_LABEL[m.role]}{m.version&&m.version>1?` v${m.version}`:''}</Tag>{used.length>0&&<Tag tone="warning">사용 중 · {used.slice(0,2).join(', ')}{used.length>2?' …':''}</Tag>}</div>
            </div>
            <div className="library-actions">{actions(m)}</div>
          </article>;})}</div>
        </section>)}
      </div>
    </div>
  </div>;
}
