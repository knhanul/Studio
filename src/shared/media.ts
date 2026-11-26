/** 미디어 보관함 · 장면별 다른 미디어 · 추가 소리(음악 바꾸기·효과음).
 *  고모 창작실 제작 패키지는 장면마다 이미지와 영상(이미지→동영상의 기준 이미지), 다시 만든 버전(_v2),
 *  여러 배경음악(BGM_01, BGM_02 …)을 함께 담아 보낸다. 편집실은 이걸 모두 보관함으로 읽어 골라 쓰게 한다. */
import type {AudioCue,Bgm,Clip,ComposerProject,MediaItem,MediaKind,MediaRole,SubtitleItem} from './types';
import {createProject,DEFAULT_IMAGE_SECONDS,round,totalDuration} from './project';

const IMAGE_RE=/\.(png|jpe?g|webp|bmp|gif)$/i,VIDEO_RE=/\.(mp4|mov|webm|m4v|mkv)$/i,AUDIO_RE=/\.(mp3|wav|m4a|flac|ogg|aac)$/i;
export function kindOfFile(file:string):MediaKind|null{return IMAGE_RE.test(file)?'image':VIDEO_RE.test(file)?'video':AUDIO_RE.test(file)?'audio':null;}
export const baseName=(file:string)=>file.split(/[\\/]/).pop()||file;
const norm=(file:string)=>file.replace(/\\/g,'/').replace(/^\.\//,'');
const pad2=(n:number)=>String(n).padStart(2,'0');

/** 창작실 asset-naming 과 같은 규칙: 장면 ID가 안전한 ASCII면 그대로, 아니면 순서로 S01… */
export function sceneFileLabel(sceneId:string|undefined,index:number):string{
  const id=String(sceneId||'').trim();
  return /^[A-Za-z0-9_-]{1,24}$/.test(id)?id:`S${pad2(Math.max(0,index)+1)}`;
}
/** 파일 이름에서 장면 라벨·종류·버전 읽기: S04_image_v2.png → {label:'S04',tag:'image',version:2} · BGM_02.mp3 → {bgm:2} */
export function parseAssetName(file:string):{label:string|null;tag:string|null;version:number;bgm:number|null}{
  const base=baseName(file).replace(/\.[A-Za-z0-9]{1,8}$/,'');
  const bgm=/^BGM_(\d{1,4})(?:_v(\d+))?$/i.exec(base);
  if(bgm)return {label:null,tag:'bgm',version:Number(bgm[2]||1),bgm:Number(bgm[1])};
  const m=/^([A-Za-z0-9-]{1,24}?)_(image|video|audio|gemini)(?:_v(\d+))?(?:[_-].*)?$/i.exec(base);
  if(m)return {label:m[1],tag:m[2].toLowerCase(),version:Number(m[3]||1),bgm:null};
  return {label:null,tag:null,version:1,bgm:null};
}

// ── 창작실 project.json (creator.project.v1) ──
export interface CreatorAsset{id:string;kind:string;name?:string;relativePath:string;bytes?:number}
export interface CreatorScene{id:string;title?:string;narration?:string;durationSec?:number;kind?:'image'|'video';assetId?:string|null;referenceImageAssetId?:string|null}
export interface CreatorProject{schema:string;id?:string;brief?:{title?:string;aspectRatio?:string};scenes?:CreatorScene[];assets?:CreatorAsset[];
  assembly?:{clips?:{sceneId:string;durationSec:number;transition?:string}[];subtitleMode?:string;transitionDefault?:string;bgmAssetId?:string|null}}
export function isCreatorProject(raw:unknown):raw is CreatorProject{return Boolean(raw&&typeof raw==='object'&&(raw as CreatorProject).schema==='creator.project.v1');}

interface SceneRef{id:string;title:string;order:number;label:string}
function sceneRefs(scenes:{id:string;title?:string}[]):SceneRef[]{return scenes.map((s,i)=>({id:s.id,title:s.title||'',order:i,label:sceneFileLabel(s.id,i).toLowerCase()}));}
function sceneForFile(file:string,refs:SceneRef[]):SceneRef|null{
  const n=parseAssetName(file);if(!n.label)return null;
  const label=n.label.toLowerCase();
  return refs.find(r=>r.label===label)||refs.find(r=>r.id.toLowerCase()===label)||null;
}

/** 창작실 project.json → 보관함 (장면에 연결된 미디어 · 기준 이미지 · 다른 버전 · 배경음악 · 그 밖) */
export function libraryFromCreator(cp:CreatorProject):MediaItem[]{
  const scenes=cp.scenes||[];const refs=sceneRefs(scenes);const assets=cp.assets||[];
  const out:MediaItem[]=[];
  for(const a of assets){
    const file=norm(a.relativePath||'');const kind=(a.kind==='image'||a.kind==='video'||a.kind==='audio')?a.kind:kindOfFile(file);
    if(!file||!kind)continue;
    const n=parseAssetName(file);
    let scene:SceneRef|null=null;let role:MediaRole;
    const linked=scenes.findIndex(s=>s.assetId===a.id);const asRef=scenes.findIndex(s=>s.referenceImageAssetId===a.id&&s.assetId!==a.id);
    if(linked>=0){scene=refs[linked];role='scene';}
    else if(asRef>=0&&kind==='image'){scene=refs[asRef];role='reference';}
    else if(kind==='audio'){role=(n.bgm!=null||cp.assembly?.bgmAssetId===a.id)?'bgm':'audio';}
    else{scene=sceneForFile(file,refs);role=scene?'alternate':'extra';}
    out.push({file,kind,name:a.name||baseName(file),role,scene_id:scene?.id??null,scene_title:scene?.title||null,scene_order:scene?.order??null,version:n.version,source:'creator'});
  }
  return sortLibrary(out);
}
/** 폴더의 파일 목록 → 보관함 (project.json이 없을 때, 또는 나중에 넣은 파일) */
export function libraryFromFiles(files:string[],scenes:{id:string;title?:string}[]=[]):MediaItem[]{
  const refs=sceneRefs(scenes);
  const out:MediaItem[]=[];
  for(const raw of files){
    const file=norm(raw);const kind=kindOfFile(file);if(!kind)continue;
    const n=parseAssetName(file);
    if(kind==='audio'){out.push({file,kind,name:baseName(file),role:n.bgm!=null||/^(bgm|music)/i.test(baseName(file))?'bgm':'audio',version:n.version,source:'folder'});continue;}
    const scene=sceneForFile(file,refs);
    const label=n.label;
    out.push({file,kind,name:baseName(file),role:scene||label?'alternate':'extra',scene_id:scene?.id??label??null,scene_title:scene?.title||null,scene_order:scene?.order??null,version:n.version,source:'folder'});
  }
  return sortLibrary(out);
}
const ROLE_ORDER:Record<MediaRole,number>={scene:0,reference:1,alternate:2,extra:3,bgm:4,audio:5};
export function sortLibrary(items:MediaItem[]):MediaItem[]{
  return [...items].sort((a,b)=>(a.kind==='audio'?1:0)-(b.kind==='audio'?1:0)
    ||(a.scene_order??9999)-(b.scene_order??9999)||String(a.scene_id||'').localeCompare(String(b.scene_id||''))
    ||ROLE_ORDER[a.role]-ROLE_ORDER[b.role]||(a.kind===b.kind?0:a.kind==='image'?-1:1)||(a.version||1)-(b.version||1)||a.file.localeCompare(b.file));
}
/** 보관함 합치기: 같은 파일은 앞의 정보(장면 연결 등)를 유지하되 비어 있는 칸만 채운다 */
export function mergeLibrary(...lists:(MediaItem[]|undefined|null)[]):MediaItem[]{
  const map=new Map<string,MediaItem>();
  for(const list of lists)for(const it of list||[]){
    const key=norm(it.file).toLowerCase();const prev=map.get(key);
    if(!prev){map.set(key,{...it,file:norm(it.file)});continue;}
    const merged:MediaItem={...prev};
    for(const [k,v] of Object.entries(it))if(merged[k]==null&&v!=null)merged[k]=v;
    if((prev.role==='extra'||prev.role==='audio')&&it.role!=='extra'&&it.role!=='audio')merged.role=it.role;
    map.set(key,merged);
  }
  return sortLibrary([...map.values()]);
}

/** 창작실 project.json → 편집 프로젝트(v2). composer_project.json이 없을 때(미디어가 덜 연결된 패키지) 쓴다.
 *  영상 장면에 동영상이 아직 없으면 기준 이미지로, 장면 미디어가 없으면 같은 장면 이름의 파일로 채운다. */
export function fromCreatorProject(cp:CreatorProject):{project:ComposerProject;skipped:string[];fallbacks:string[]}{
  const p=createProject(cp.brief?.title||'제목 없음');
  const ratio=cp.brief?.aspectRatio;
  if(ratio==='9:16'){p.output.width=1080;p.output.height=1920;}else if(ratio==='1:1'){p.output.width=1080;p.output.height=1080;}
  const library=libraryFromCreator(cp);p.media_library=library;
  const scenes=cp.scenes||[];const assets=cp.assets||[];
  const fileOf=(id?:string|null)=>{const a=id?assets.find(x=>x.id===id):undefined;return a?norm(a.relativePath):null;};
  const order=cp.assembly?.clips?.length?cp.assembly.clips:scenes.map(s=>({sceneId:s.id,durationSec:s.durationSec||DEFAULT_IMAGE_SECONDS,transition:cp.assembly?.transitionDefault}));
  const skipped:string[]=[];const fallbacks:string[]=[];
  let cursor=0;const items:SubtitleItem[]=[];
  for(const c of order){
    const s=scenes.find(x=>x.id===c.sceneId);if(!s)continue;
    let file=fileOf(s.assetId);
    const poster=fileOf(s.referenceImageAssetId);
    if(!file||!kindOfFile(file)||kindOfFile(file)==='audio'){
      const alt=library.find(m=>m.scene_id===s.id&&m.kind===(s.kind==='video'?'video':'image'))||library.find(m=>m.scene_id===s.id&&(m.kind==='image'||m.kind==='video'));
      file=alt?.file||null;if(file)fallbacks.push(s.id);
    }
    if(!file){skipped.push(s.id);continue;}
    const kind=kindOfFile(file) as 'image'|'video';
    const dur=Math.max(.5,Number(c.durationSec)||Number(s.durationSec)||DEFAULT_IMAGE_SECONDS);
    const t=c.transition||cp.assembly?.transitionDefault;const tr=t==='cut'?'none':t==='fade'?'fade':'crossfade';
    const clip:Clip={file,type:kind,label:s.title||'',scene_id:s.id,transition:{type:tr,duration:tr==='none'?0:Math.min(.5,dur/4)},motion:kind==='image'?'zoom_in':'none',motion_strength:.08};
    if(kind==='video'&&poster)clip.poster=poster;
    if(kind==='image')clip.duration=dur;else{clip.fit_duration=dur;clip.mute=true;}
    p.clips.push(clip);
    if(cp.assembly?.subtitleMode!=='none'&&s.narration?.trim())items.push({index:items.length+1,start:round(cursor+.2),end:round(cursor+dur-.2),text:s.narration.trim()});
    cursor+=dur;
  }
  p.subtitle.items=items;
  const music=fileOf(cp.assembly?.bgmAssetId)||library.find(m=>m.role==='bgm')?.file||null;
  if(music&&kindOfFile(music)==='audio')p.bgm={...p.bgm,file:music};
  return {project:p,skipped,fallbacks};
}

/** 열린 프로젝트에 보관함을 붙이고, 장면 클립에 장면 ID·기준 이미지를 채운다 (이미 있는 값은 그대로) */
export function attachLibrary(doc:ComposerProject,library:MediaItem[]):ComposerProject{
  const merged=mergeLibrary(doc.media_library,library);
  const byFile=new Map(merged.map(m=>[m.file.toLowerCase(),m]));
  const clips=doc.clips.map(c=>{
    const it=byFile.get(norm(c.file||'').toLowerCase());
    const sceneId=c.scene_id??it?.scene_id??null;
    const next:Clip={...c};
    if(sceneId&&!c.scene_id)next.scene_id=sceneId;
    if(c.type==='video'&&!c.poster&&sceneId){const poster=scenePoster({...doc,media_library:merged},sceneId);if(poster)next.poster=poster;}
    return next;
  });
  return {...doc,clips,media_library:merged};
}

/** 같은 장면의 다른 이미지·영상 (지금 쓰는 파일 제외) */
export function sceneAlternatives(doc:ComposerProject,clip:Clip):MediaItem[]{
  const lib=doc.media_library||[];
  const sid=clip.scene_id??lib.find(m=>m.file===clip.file)?.scene_id;
  if(!sid)return [];
  return lib.filter(m=>m.scene_id===sid&&(m.kind==='image'||m.kind==='video')&&m.file!==clip.file);
}
/** 장면 미디어 바꾸기: 화면에 보이는 길이는 유지하고, 종류에 맞게 길이 방식만 바꾼다 */
export function swapClipMedia(clip:Clip,item:{file:string;kind:MediaKind;duration?:number|null},currentDuration:number,posterFallback?:string|null):Clip{
  if(item.kind==='audio')return clip;
  const base:Clip={...clip,file:item.file,type:item.kind};
  if(item.kind==='image'){
    delete base.fit_duration;delete base.trim_start;delete base.trim_end;delete base.speed;delete base.source_duration;delete base.poster;
    return {...base,duration:round(currentDuration,2),fit_duration:null,motion:clip.type==='image'?clip.motion:'zoom_in',motion_strength:clip.type==='image'?clip.motion_strength:.08};
  }
  const poster=clip.type==='image'?clip.file:(clip.poster??posterFallback??null);
  return {...base,duration:null,fit_duration:round(currentDuration,2),trim_start:0,trim_end:null,speed:1,mute:clip.type==='video'?clip.mute:true,motion:'none',
    source_duration:item.duration!=null?round(item.duration):null,poster};
}
/** 영상 장면 앞에 기준 이미지를 정지 화면으로 넣는다 (이미지 → 영상으로 자연스럽게 이어짐) */
export function insertPosterBefore(doc:ComposerProject,index:number,seconds=2):ComposerProject{
  const clip=doc.clips[index];if(!clip||clip.type!=='video'||!clip.poster)return doc;
  const still:Clip={file:clip.poster,type:'image',duration:seconds,label:`${clip.label||'장면'} · 기준 이미지`,scene_id:clip.scene_id??null,motion:'zoom_in',motion_strength:.05,transition:clip.transition?{...clip.transition}:null};
  const clips=[...doc.clips];clips.splice(index,0,still);
  clips[index+1]={...clip,transition:{type:'crossfade',duration:.6}};
  return {...doc,clips};
}
/** 프로젝트에서 그 파일을 쓰고 있는 곳 */
export function mediaUsage(doc:ComposerProject,file:string):string[]{
  const f=norm(file).toLowerCase();const out:string[]=[];
  doc.clips.forEach((c,i)=>{if(norm(c.file||'').toLowerCase()===f)out.push(`장면 ${i+1}`);else if(c.poster&&norm(c.poster).toLowerCase()===f)out.push(`장면 ${i+1} 기준`);});
  if(doc.bgm.file&&norm(doc.bgm.file).toLowerCase()===f)out.push('배경음악');
  (doc.audio_cues||[]).forEach(c=>{if(norm(c.file).toLowerCase()===f)out.push(c.kind==='effect'?'효과음':'추가 음악');});
  return out;
}
export function libraryCounts(items:MediaItem[]){return {image:items.filter(m=>m.kind==='image').length,video:items.filter(m=>m.kind==='video').length,audio:items.filter(m=>m.kind==='audio').length};}
export function librarySummary(items:MediaItem[]):string{const c=libraryCounts(items);return [c.image&&`이미지 ${c.image}`,c.video&&`영상 ${c.video}`,c.audio&&`음악·소리 ${c.audio}`].filter(Boolean).join(' · ');}

// ── 소리 층 (배경음악 + 추가 소리) — 렌더·미리듣기·타임라인 공용 ──
export interface MusicLayer{key:string;file:string;label:string;kind:'bgm'|'music'|'effect';start:number;end:number;file_start:number;volume:number;loop:boolean;fade_in:number;fade_out:number;duck:boolean}
let cueSeq=0;
export function newCueId():string{cueSeq=(cueSeq+1)%1e6;return `cue_${Date.now().toString(36)}_${cueSeq.toString(36)}`;}
/** 추가 소리가 실제로 들리는 구간 (파일 길이를 모르고 반복도 아니면 영상 끝까지로 본다) */
export function cueSpan(cue:AudioCue,total:number):{start:number;end:number}{
  const start=Math.max(0,Number(cue.start)||0);
  let end:number;
  if(cue.end!=null&&Number(cue.end)>start)end=Number(cue.end);
  else if(!cue.loop&&Number(cue.duration)>0)end=start+Math.max(.05,Number(cue.duration)-(Number(cue.file_start)||0));
  else end=total;
  return {start,end:Math.max(start,Math.min(total,end))};
}
export function bgmSpan(b:Bgm,total:number):{start:number;end:number}{
  const start=Math.max(0,Number(b.start_offset)||0);
  const end=b.end!=null&&Number(b.end)>start?Math.min(total,Number(b.end)):total;
  return {start,end:Math.max(start,end)};
}
export function musicLayers(doc:ComposerProject,total=totalDuration(doc)):MusicLayer[]{
  const out:MusicLayer[]=[];const b=doc.bgm;
  if(b.file&&Number(b.volume??.3)>0){const s=bgmSpan(b,total);if(s.end>s.start)out.push({key:'bgm',file:b.file,label:baseName(b.file),kind:'bgm',start:s.start,end:s.end,file_start:Number(b.file_start)||0,volume:b.volume==null?.3:Number(b.volume),loop:b.loop!==false,fade_in:b.fade_in==null?1:Number(b.fade_in),fade_out:b.fade_out==null?2:Number(b.fade_out),duck:b.duck_under_voice!==false});}
  for(const c of doc.audio_cues||[]){
    if(!c.file||Number(c.volume??1)<=0)continue;const s=cueSpan(c,total);if(s.end-s.start<.05)continue;
    const music=c.kind!=='effect';
    out.push({key:c.id,file:c.file,label:c.label||baseName(c.file),kind:music?'music':'effect',start:s.start,end:s.end,file_start:Number(c.file_start)||0,volume:c.volume==null?(music?.25:1):Number(c.volume),loop:Boolean(c.loop),
      fade_in:c.fade_in==null?(music?1:0):Number(c.fade_in),fade_out:c.fade_out==null?(music?1.5:0):Number(c.fade_out),duck:c.duck_under_voice==null?music&&b.duck_under_voice!==false:Boolean(c.duck_under_voice)});
  }
  return out;
}
/** 지금 시각의 페이드 배율 (미리듣기용) */
export function layerFade(l:MusicLayer,t:number):number{
  if(t<l.start||t>=l.end)return 0;
  const len=l.end-l.start;const fi=Math.min(l.fade_in,len),fo=Math.min(l.fade_out,len);
  let k=1;if(fi>0)k=Math.min(k,(t-l.start)/fi);if(fo>0)k=Math.min(k,(l.end-t)/fo);
  return Math.max(0,Math.min(1,k));
}
/** 선택한 시각부터 다른 음악으로 바꾸기: 앞 배경음악은 그 시각에 끝나고(서서히 작아지며) 새 음악이 이어진다 */
export function switchMusicAt(doc:ComposerProject,at:number,item:{file:string;name?:string;duration?:number|null}):ComposerProject{
  const t=round(Math.max(0,at),2);
  const cues:AudioCue[]=[...(doc.audio_cues||[])];
  const next:ComposerProject={...doc,bgm:{...doc.bgm},audio_cues:cues};
  if(!next.bgm.file||t<=(Number(next.bgm.start_offset)||0)+.1){next.bgm.file=item.file;next.bgm.end=null;return next;}
  const total=totalDuration(doc);
  if(next.bgm.end==null||Number(next.bgm.end)>t)next.bgm.end=t;
  // 그 시각 뒤에 이미 걸쳐 있는 음악은 그 시각에서 끝낸다
  next.audio_cues=cues.map(c=>{if(c.kind==='effect')return c;const s=cueSpan(c,total);return s.start<t&&s.end>t?{...c,end:t}:c;});
  next.audio_cues.push({id:newCueId(),file:item.file,label:item.name||baseName(item.file),kind:'music',start:t,end:null,loop:true,volume:Number(doc.bgm.volume??.25),fade_in:1,fade_out:2,duck_under_voice:doc.bgm.duck_under_voice!==false,duration:item.duration??null});
  return next;
}

/** 직접 가져온 파일 → 보관함 항목 */
export function importedItems(items:{file:string;type:string;name:string;duration?:number|null}[]):MediaItem[]{
  return items.filter(i=>i.type==='image'||i.type==='video'||i.type==='audio').map(i=>{
    const n=parseAssetName(i.file);
    return {file:norm(i.file),kind:i.type as MediaKind,name:i.name,role:i.type==='audio'?(n.bgm!=null?'bgm':'audio'):'extra',version:n.version,source:'import',duration:i.duration??null};
  });
}
/** 보관함 항목 하나로 새 장면 클립 만들기 */
export function clipFromItem(doc:ComposerProject,item:MediaItem,duration?:number|null):Clip|null{
  if(item.kind==='audio')return null;
  const clip:Clip={file:item.file,type:item.kind,label:item.scene_title||item.name.replace(/\.[^.]+$/,''),scene_id:item.scene_id??null};
  if(item.kind==='image'){clip.duration=DEFAULT_IMAGE_SECONDS;clip.motion='zoom_in';clip.motion_strength=.08;}
  else{clip.motion='none';clip.mute=true;const d=duration??item.duration;if(d)clip.source_duration=round(d);
    const poster=scenePoster(doc,item.scene_id);if(poster)clip.poster=poster;}
  return clip;
}
/** 장면의 기준 이미지 후보 (영상 장면에서 쓰는 정지 화면) */
export function scenePoster(doc:ComposerProject,sceneId:string|null|undefined):string|null{
  if(!sceneId)return null;const lib=doc.media_library||[];
  return (lib.find(m=>m.scene_id===sceneId&&m.kind==='image'&&(m.role==='reference'||m.role==='scene'))||lib.find(m=>m.scene_id===sceneId&&m.kind==='image'))?.file||null;
}
