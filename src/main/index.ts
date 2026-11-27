import {app,BrowserWindow,dialog,ipcMain,protocol,session,shell} from 'electron';
import {readFile,writeFile,mkdir,copyFile,readdir,rename,stat} from 'node:fs/promises';
import {createReadStream,existsSync,readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {EngineController,EngineConfig} from './engine';
import {probeLead,probeMedia,renderProject,resolveFfmpeg} from './ffmpeg';
import {createProject,fromCreatorHandoff,fromSrt,isCreatorHandoff,normalizeProject,toSrt} from '../shared/project';
import {attachLibrary,fromCreatorProject,packageBgm,isCreatorProject,libraryFromCreator,libraryFromFiles,librarySummary,type CreatorProject} from '../shared/media';
import type {ComposerProject,FfmpegStatus,MediaItem,ProjectState,RecentProject,RenderEvent,SubtitleItem} from '../shared/types';

protocol.registerSchemesAsPrivileged([{scheme:'gomo-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,bypassCSP:true}}]);
let win:BrowserWindow|null=null;
let currentPath='';
const mediaMap=new Map<string,string>();
let config:EngineConfig={repo:'',python:''};
let settings:{ffmpeg:string}={ffmpeg:''};
let ffmpegStatus:FfmpegStatus|null=null;
let renderAbort:AbortController|null=null;
const engine=new EngineController(()=>win);
const IMAGE=['png','jpg','jpeg','webp','bmp','gif'],VIDEO=['mp4','mov','webm','m4v','mkv'],AUDIO=['mp3','wav','m4a','flac','ogg','aac'];
const configPath=()=>path.join(app.getPath('userData'),'engine-settings.json');
const settingsPath=()=>path.join(app.getPath('userData'),'studio-settings.json');
const recentPath=()=>path.join(app.getPath('userData'),'recent-projects.json');
function dir(){return currentPath?path.dirname(currentPath):app.getPath('documents');}
function ensureProject(){if(!currentPath)throw new Error('프로젝트를 먼저 열어 주세요.');return currentPath;}
const extOf=(f:string)=>path.extname(f).slice(1).toLowerCase();
const kindOf=(f:string)=>IMAGE.includes(extOf(f))?'image':VIDEO.includes(extOf(f))?'video':AUDIO.includes(extOf(f))?'audio':['srt','vtt'].includes(extOf(f))?'subtitle':'other';
async function atomicWrite(file:string,text:string|Buffer){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+randomUUID();await writeFile(tmp,text);await rename(tmp,file);}
function ffmpeg(){if(!ffmpegStatus)ffmpegStatus=resolveFfmpeg(settings.ffmpeg);return ffmpegStatus;}

async function readRecent():Promise<RecentProject[]>{try{const list=JSON.parse(await readFile(recentPath(),'utf8')) as RecentProject[];return Array.isArray(list)?list.filter(r=>r&&typeof r.path==='string'):[];}catch{return [];}}
async function remember(file:string,title:string){const list=(await readRecent()).filter(r=>path.resolve(r.path)!==path.resolve(file));list.unshift({path:file,title,openedAt:new Date().toISOString()});await atomicWrite(recentPath(),JSON.stringify(list.slice(0,12),null,2)).catch(()=>{});}

async function save(data:ComposerProject,target=currentPath):Promise<ProjectState>{if(!target)throw new Error('저장 경로가 없습니다.');const doc=normalizeProject(data);if(doc.version!==2)throw new Error('v1 프로젝트는 구버전에서 v2로 변환 후 저장하세요.');await atomicWrite(target,JSON.stringify(doc,null,2));currentPath=target;await remember(target,doc.title);return {path:target,data:doc,updatedAt:new Date().toISOString()};}
function remapMedia(data:ComposerProject,oldBase:string,newBase:string){const rel=(s?:string|null)=>s?path.relative(newBase,path.resolve(oldBase,s)).replace(/\\/g,'/'):s;return {...data,clips:data.clips.map(c=>({...c,file:rel(c.file)||c.file,...(c.poster?{poster:rel(c.poster)}:{})})),bgm:{...data.bgm,file:rel(data.bgm.file)},
  ...(data.audio_cues?{audio_cues:data.audio_cues.map(c=>({...c,file:rel(c.file)||c.file}))}:{}),...(data.media_library?{media_library:data.media_library.map(m=>({...m,file:rel(m.file)||m.file}))}:{}),subtitle:{...data.subtitle,file:rel(data.subtitle.file)},dubbing:{...data.dubbing,takes:data.dubbing.takes.map(t=>({...t,file:rel(t.file)||t.file}))}};}
function mediaUrl(file:string){if(!file)return '';const resolved=path.resolve(dir(),file);if(!existsSync(resolved))return '';if(!['image','video','audio'].includes(kindOf(resolved)))return '';const id=randomUUID();mediaMap.set(id,resolved);return `gomo-media://media/${id}`;}

/** 영상 클립의 원본 길이를 FFmpeg로 채운다 (없을 때만) */
async function fillVideoDurations(doc:ComposerProject,base:string):Promise<ComposerProject>{
  const st=ffmpeg();if(!st.ok)return doc;
  for(const c of doc.clips){if(c.type!=='video'||(typeof c.source_duration==='number'&&c.source_duration>0))continue;const f=path.resolve(base,c.file);if(!existsSync(f))continue;const info=await probeMedia(st.path,f);if(info.duration)c.source_duration=Math.round(info.duration*1000)/1000;}
  return doc;
}
/** 자막 항목이 비어 있으면 같은 폴더의 SRT(subtitle.file 또는 captions.srt)를 읽는다 */
async function fillSubtitles(doc:ComposerProject,base:string):Promise<boolean>{
  if(doc.subtitle.items?.length)return false;
  for(const name of [doc.subtitle.file,'captions.srt'].filter(Boolean) as string[]){const f=path.resolve(base,name);if(existsSync(f)){const items=fromSrt(await readFile(f,'utf8'));if(items.length){doc.subtitle.items=items;return true;}}}
  return false;
}
/** 창작실 project.json (creator.project.v1) — 이미지·영상·기준 이미지·여러 배경음악 정보가 모두 들어 있다 */
async function readCreator(folder:string):Promise<CreatorProject|null>{
  const f=path.join(folder,'project.json');if(!existsSync(f))return null;
  try{const raw=JSON.parse((await readFile(f,'utf8')).replace(/^\uFEFF/,''));return isCreatorProject(raw)?raw:null;}catch{return null;}
}
/** 폴더 안 미디어 파일 (assets/ · media/ 아래, 최대 3단계) */
async function scanMedia(base:string):Promise<string[]>{
  const out:string[]=[];
  const walk=async(rel:string,depth:number)=>{if(depth>3||out.length>2000)return;let entries;try{entries=await readdir(path.join(base,rel),{withFileTypes:true});}catch{return;}
    for(const e of entries){const r=rel?`${rel}/${e.name}`:e.name;if(e.isDirectory())await walk(r,depth+1);else if(['image','video','audio'].includes(kindOf(e.name)))out.push(r);}};
  for(const top of ['assets','media'])await walk(top,1);
  return out;
}
/** 미디어 보관함: 창작실 project.json 정보 + 폴더에 실제로 있는 파일 (없어진 파일은 뺀다) */
async function buildLibrary(base:string,doc?:ComposerProject):Promise<MediaItem[]>{
  const creator=await readCreator(base);
  const scenes=creator?.scenes||doc?.clips.filter(c=>c.scene_id).map(c=>({id:String(c.scene_id),title:c.label}))||[];
  const fromCreator=creator?libraryFromCreator(creator):[];
  const files=libraryFromFiles(await scanMedia(base),scenes);
  return [...fromCreator,...files].filter(m=>existsSync(path.resolve(base,m.file)));
}
async function withLibrary(doc:ComposerProject,base:string):Promise<ComposerProject>{
  const kept=(doc.media_library||[]).filter(m=>existsSync(path.resolve(base,m.file)));
  return attachLibrary({...doc,media_library:kept},await buildLibrary(base,doc));
}
const libraryNote=(d:ComposerProject)=>{const t=librarySummary(d.media_library||[]);return t?` 미디어 보관함: ${t}.`:'';};
async function openJson(file:string):Promise<ProjectState>{
  const raw=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
  if(isCreatorHandoff(raw)||isCreatorProject(raw))return openFolder(path.dirname(file));
  let doc=normalizeProject(raw);if(doc.version!==2)throw new Error('프로젝트 v1은 기존 영상 합성기에서 v2로 마이그레이션한 다음 여세요.');
  const base=path.dirname(file);const loadedSrt=await fillSubtitles(doc,base);await fillVideoDurations(doc,base);
  // 편집실에서 처음 여는 창작실 패키지인가 (편집실이 저장하면 media_library 가 생긴다)
  const firstOpen=!Array.isArray((raw as {media_library?:unknown}).media_library);
  doc=await withLibrary(doc,base);
  const notes:string[]=[];if(loadedSrt)notes.push('자막 파일(SRT)을 함께 불러왔어요.');
  if(firstOpen&&!doc.bgm.file){
    const creator=await readCreator(base);const music=packageBgm(doc.media_library||[],creator);
    if(music&&existsSync(path.resolve(base,music))){doc={...doc,bgm:{...doc.bgm,file:music}};notes.push(`창작실에서 고른 배경음악이 없어, 만들어 둔 음악 「${path.basename(music)}」을(를) 배경음악으로 넣었어요. 배경음악 단계에서 바꿀 수 있어요.`);}
  }
  currentPath=file;await remember(file,doc.title);
  if(firstOpen&&doc.bgm.file&&!raw.bgm?.file)await save(doc,file);
  return {path:file,data:doc,updatedAt:new Date().toISOString(),notice:notes.join(' ')||undefined};
}
/** 고모 창작실 제작 패키지 폴더 열기 */
async function openFolder(folder:string):Promise<ProjectState>{
  const composer=path.join(folder,'composer_project.json');
  if(existsSync(composer)){const s=await openJson(composer);return {...s,notice:`고모 창작실 작품 「${s.data.title}」을(를) 불러왔어요.${libraryNote(s.data)}${s.notice?' '+s.notice:''}`};}
  const creator=await readCreator(folder);
  if(creator){
    const {project,skipped,fallbacks}=fromCreatorProject(creator);
    if(!project.clips.length)throw new Error('창작실 패키지에 이미지·영상이 있는 장면이 없어요. 창작실 미디어 보관함에서 장면 미디어를 먼저 만들어 주세요.');
    await fillSubtitles(project,folder);await fillVideoDurations(project,folder);
    const doc=await withLibrary(project,folder);
    const s=await save(doc,composer);
    const extra=[fallbacks.length?`미디어가 연결되지 않은 장면 ${fallbacks.length}개는 같은 장면의 파일로 채웠어요.`:'',skipped.length?`미디어가 없는 장면 ${skipped.length}개(${skipped.slice(0,4).join(', ')})는 빠졌어요.`:''].filter(Boolean).join(' ');
    return {...s,data:doc,notice:`고모 창작실 작품 「${doc.title}」을(를) 편집 프로젝트로 바꿨어요.${libraryNote(doc)}${extra?' '+extra:''}`};
  }
  const handoffFile=path.join(folder,'gomo-handoff.json');
  if(existsSync(handoffFile)){
    const raw=JSON.parse((await readFile(handoffFile,'utf8')).replace(/^\uFEFF/,''));
    if(!isCreatorHandoff(raw))throw new Error('gomo-handoff.json 형식을 읽을 수 없어요.');
    let doc=fromCreatorHandoff(raw);
    if(!doc.clips.length)throw new Error('창작실 패키지에 이미지·영상이 연결된 장면이 없어요. 창작실 미디어 보관함에서 장면 미디어를 먼저 연결해 주세요.');
    await fillSubtitles(doc,folder);await fillVideoDurations(doc,folder);doc=await withLibrary(doc,folder);
    const s=await save(doc,composer);return {...s,notice:`고모 창작실 패키지를 편집 프로젝트로 바꿔 composer_project.json으로 저장했어요.${libraryNote(doc)}`};
  }
  const jsons=(await readdir(folder).catch(()=>[] as string[])).filter(n=>/^(project|.*composer.*)\.json$/i.test(n));
  for(const n of jsons){try{return await openJson(path.join(folder,n));}catch{/* 다음 후보 */}}
  throw new Error('이 폴더에서 고모 창작실 패키지(composer_project.json · project.json · gomo-handoff.json)를 찾지 못했어요.');
}
async function openAny(target:string):Promise<ProjectState>{const s=await stat(target);return s.isDirectory()?openFolder(target):openJson(target);}
async function uniqueName(folder:string,base:string,ext:string){await mkdir(folder,{recursive:true});const used=new Set((await readdir(folder)).map(s=>s.toLowerCase()));let n=1;while(used.has(`${base}${n}.${ext}`.toLowerCase()))n++;return `${base}${n}.${ext}`;}
function send(ev:RenderEvent){win?.webContents.send('render:event',ev);}

function registerIpc(){
  ipcMain.handle('project:new',async (_e,title?:string)=>{const file=path.join(app.getPath('userData'),'projects',randomUUID(),'project.json');return save(createProject(title||'제목 없음'),file);});
  ipcMain.handle('project:open',async(_e,fileArg?:string):Promise<ProjectState|null>=>{let file=fileArg;if(!file){const r=await dialog.showOpenDialog(win!,{title:'프로젝트 파일 열기',properties:['openFile'],filters:[{name:'편집 프로젝트 (JSON)',extensions:['json']}]});if(r.canceled)return null;file=r.filePaths[0];}return openAny(file!);});
  ipcMain.handle('project:openFolder',async():Promise<ProjectState|null>=>{const r=await dialog.showOpenDialog(win!,{title:'고모 창작실 제작 패키지 폴더 선택',properties:['openDirectory']});if(r.canceled)return null;return openFolder(r.filePaths[0]);});
  ipcMain.handle('project:openPath',async(_e,target:string)=>openAny(target));
  ipcMain.handle('project:recent',async()=>(await readRecent()).filter(r=>existsSync(r.path)));
  ipcMain.handle('project:save',async(_e,data:ComposerProject)=>save(data));
  ipcMain.handle('project:saveAs',async(_e,data:ComposerProject)=>{ensureProject();const r=await dialog.showSaveDialog(win!,{defaultPath:path.join(app.getPath('documents'),path.basename(currentPath)),filters:[{name:'편집 프로젝트 (JSON)',extensions:['json']}]});if(r.canceled||!r.filePath)return null;const doc=remapMedia(data,dir(),path.dirname(r.filePath));return save(doc,r.filePath);});
  ipcMain.handle('project:reveal',()=>shell.openPath(dir()));
  ipcMain.handle('project:showFile',(_e,file:string)=>{if(!file)return;shell.showItemInFolder(path.resolve(dir(),file));});
  ipcMain.handle('media:import',async(_e,kind:'visual'|'audio'|'any'='any',multi=true)=>{
    ensureProject();
    const ext=kind==='visual'?[...IMAGE,...VIDEO]:kind==='audio'?AUDIO:[...IMAGE,...VIDEO,...AUDIO];
    const res=await dialog.showOpenDialog(win!,{properties:multi?['multiSelections','openFile']:['openFile'],filters:[{name:kind==='audio'?'오디오':kind==='visual'?'이미지·영상':'미디어',extensions:ext}]});
    if(res.canceled)return [];
    const results:{file:string;type:string;name:string;duration?:number|null}[]=[];
    const mediaDir=path.join(dir(),'media');await mkdir(mediaDir,{recursive:true});
    const used=new Set((await readdir(mediaDir)).map(s=>s.toLowerCase()));
    for(const src of res.filePaths){
      const name=path.basename(src);const e=path.extname(name);let dest=name;let num=2;
      const inside=path.resolve(src).toLowerCase().startsWith(path.resolve(dir()).toLowerCase()+path.sep);
      let rel:string;
      if(inside)rel=path.relative(dir(),src).replace(/\\/g,'/'); // 이미 프로젝트 폴더 안 파일은 복사하지 않음
      else{while(used.has(dest.toLowerCase()))dest=path.basename(name,e)+`_${num++}`+e;used.add(dest.toLowerCase());await copyFile(src,path.join(mediaDir,dest));rel=`media/${dest}`;}
      const type=kindOf(src);let duration:number|null=null;
      if((type==='video'||type==='audio')&&ffmpeg().ok)duration=(await probeMedia(ffmpeg().path,path.resolve(dir(),rel))).duration;
      results.push({file:rel,type,name:path.basename(rel),duration});
    }
    return results;
  });
  ipcMain.handle('media:urls',(_e,files:string[])=>{const out:Record<string,string>={};for(const file of files){out[file]=mediaUrl(file);}return out;});
  ipcMain.handle('media:library',async()=>{ensureProject();return buildLibrary(dir());});
  ipcMain.handle('media:probe',async(_e,file:string)=>{const st=ffmpeg();if(!st.ok)return {duration:null,hasAudio:false,lead:0};const f=path.resolve(dir(),file);const info=await probeMedia(st.path,f);
    return {...info,lead:kindOf(f)==='video'?await probeLead(st.path,f):0};});
  ipcMain.handle('take:save',async(_e,cue:number|null,data:ArrayBuffer)=>{ensureProject();const folder=path.join(dir(),'takes');const name=await uniqueName(folder,cue?`line_${String(cue).padStart(4,'0')}_v`:'free_v','wav');await writeFile(path.join(folder,name),Buffer.from(data));return `takes/${name}`;});
  ipcMain.handle('take:import',async(_e,cue:number)=>{ensureProject();const r=await dialog.showOpenDialog(win!,{title:'녹음해 둔 음성 파일 선택',properties:['openFile'],filters:[{name:'오디오',extensions:AUDIO}]});if(r.canceled)return null;const src=r.filePaths[0];const folder=path.join(dir(),'takes');const name=await uniqueName(folder,`line_${String(cue).padStart(4,'0')}_file_v`,extOf(src)||'wav');await copyFile(src,path.join(folder,name));const rel=`takes/${name}`;const duration=ffmpeg().ok?(await probeMedia(ffmpeg().path,path.join(folder,name))).duration:null;return {file:rel,duration};});
  ipcMain.handle('subtitle:saveSrt',async(_e,items:SubtitleItem[])=>{const r=await dialog.showSaveDialog(win!,{defaultPath:path.join(dir(),'captions.srt'),filters:[{name:'SubRip',extensions:['srt']}]});if(r.canceled||!r.filePath)return null;await writeFile(r.filePath,toSrt(items),'utf8');return r.filePath;});
  ipcMain.handle('subtitle:importSrt',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openFile'],filters:[{name:'SubRip',extensions:['srt']}]});if(r.canceled)return null;return readFile(r.filePaths[0],'utf8');});
  ipcMain.handle('ffmpeg:status',()=>{ffmpegStatus=resolveFfmpeg(settings.ffmpeg);return ffmpegStatus;});
  ipcMain.handle('ffmpeg:configure',async(_e,custom:string)=>{settings={...settings,ffmpeg:custom||''};await atomicWrite(settingsPath(),JSON.stringify(settings,null,2));ffmpegStatus=resolveFfmpeg(settings.ffmpeg);return ffmpegStatus;});
  ipcMain.handle('ffmpeg:pick',async()=>{const r=await dialog.showOpenDialog(win!,{title:'ffmpeg.exe 선택',properties:['openFile'],filters:[{name:'FFmpeg',extensions:process.platform==='win32'?['exe']:['*']}]});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('render:start',async(_e,data:ComposerProject,draft:boolean)=>{
    const file=ensureProject();if(renderAbort)throw new Error('이미 영상을 만들고 있어요.');
    const st=ffmpeg();if(!st.ok)throw new Error(st.message);
    const base=path.dirname(file);const doc=normalizeProject(data);
    const outName=draft?'preview_gomo.mp4':(String(doc.output.file||'output.mp4').trim()||'output.mp4');
    const output=path.resolve(base,outName);if(!output.startsWith(path.resolve(base)+path.sep))throw new Error('출력 파일은 프로젝트 폴더 안이어야 해요.');
    renderAbort=new AbortController();const signal=renderAbort.signal;
    send({phase:'progress',progress:0,message:'준비 중'});
    void renderProject(doc,{ffmpeg:st.path,baseDir:base,output,draft,signal,onProgress:(progress,message)=>send({phase:'progress',progress,message})})
      .then(r=>send({phase:'done',progress:1,message:`완료 · ${Math.round(r.duration*10)/10}초 · ${(r.bytes/1048576).toFixed(1)}MB${r.ignored.length?` · 아직 지원하지 않아 뺀 효과: ${r.ignored.join(', ')}`:''}`,output:r.output}))
      .catch((e:Error)=>send(signal.aborted?{phase:'cancelled',progress:0,message:'만들기를 취소했어요.'}:{phase:'error',progress:0,message:e.message}))
      .finally(()=>{renderAbort=null;});
    return {output};
  });
  ipcMain.handle('render:cancel',()=>{renderAbort?.abort();return true;});
  ipcMain.handle('render:open',(_e,file:string)=>shell.openPath(file));
  ipcMain.handle('render:reveal',(_e,file:string)=>shell.showItemInFolder(file));
  ipcMain.handle('render:url',(_e,file:string)=>{if(!existsSync(file))return '';const id=randomUUID();mediaMap.set(id,file);return `gomo-media://media/${id}`;});
  // 기존 영상 합성기 Python 엔진 (선택 기능 — 고급 설정)
  ipcMain.handle('engine:configure',async(_e,c:EngineConfig)=>{config=c;await atomicWrite(configPath(),JSON.stringify(config,null,2));engine.setConfig(config);return engine.status();});
  ipcMain.handle('engine:config',()=>engine.status());
  ipcMain.handle('engine:pickRepo',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('engine:pickPython',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openFile'],filters:[{name:'Python',extensions:['exe']},{name:'모든 파일',extensions:['*']}]});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('engine:action',async(_e,action:string,args:Record<string,unknown>={})=>{if(!['ping','devices','validate','render','cancel'].includes(action))throw new Error('허용되지 않은 엔진 명령');return engine.request(action,{...args,base_dir:dir(),project_path:currentPath},action==='render'?24*3600*1000:120000);});
  ipcMain.handle('app:info',()=>({version:app.getVersion(),projectDir:dir(),userData:app.getPath('userData')}));
}
const MIME:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',
  mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',ogg:'audio/ogg'};
/** 미디어 파일 응답 — Range 요청(206)을 지원해야 <video>가 원하는 위치로 이동(seek)할 수 있다 */
async function serveFile(file:string,range:string|null):Promise<Response>{
  const size=(await stat(file)).size;const type=MIME[extOf(file)]||'application/octet-stream';
  const m=range?/bytes=(\d*)-(\d*)/.exec(range):null;
  if(!m||(!m[1]&&!m[2])){const body=Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;return new Response(body,{status:200,headers:{'Content-Type':type,'Content-Length':String(size),'Accept-Ranges':'bytes'}});}
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));let end=m[1]&&m[2]?Number(m[2]):size-1;end=Math.min(end,size-1);
  if(start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  const body=Readable.toWeb(createReadStream(file,{start,end})) as unknown as ReadableStream;
  return new Response(body,{status:206,headers:{'Content-Type':type,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes'}});
}
function createWindow(){win=new BrowserWindow({width:1536,height:950,minWidth:1180,minHeight:720,backgroundColor:'#F8FAFC',title:'고모 편집실',icon:path.join(__dirname,'../../resources/app.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'../preload/index.js'),nodeIntegration:false,contextIsolation:true,sandbox:false}});win.on('closed',()=>win=null);if(!app.isPackaged&&process.env.ELECTRON_RENDERER_URL){void win.loadURL(process.env.ELECTRON_RENDERER_URL);}else void win.loadFile(path.join(__dirname,'../renderer/index.html'));}
app.whenReady().then(async()=>{
  try{config=JSON.parse(readFileSync(configPath(),'utf8')) as EngineConfig;}catch{config={repo:'',python:''};}engine.setConfig(config);
  try{settings={ffmpeg:'',...JSON.parse(readFileSync(settingsPath(),'utf8'))};}catch{settings={ffmpeg:''};}
  // 마이크 녹음 허용 (이 앱 화면에서만)
  session.defaultSession.setPermissionRequestHandler((_wc,permission,cb)=>cb(permission==='media'));
  session.defaultSession.setPermissionCheckHandler((_wc,permission)=>permission==='media');
  protocol.handle('gomo-media',async request=>{const id=new URL(request.url).pathname.split('/').filter(Boolean)[0];const file=mediaMap.get(id);if(!file||!existsSync(file))return new Response('Missing',{status:404});return serveFile(file,request.headers.get('range'));});
  registerIpc();createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
});
app.on('before-quit',()=>{renderAbort?.abort();engine.close();});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
