import {app,BrowserWindow,dialog,ipcMain,protocol,net,shell} from 'electron';
import {readFile,writeFile,mkdir,copyFile,stat,readdir} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {EngineController,EngineConfig} from './engine';
import {createProject,normalizeProject,toSrt} from '../shared/project';
import type {ComposerProject,ProjectState,SubtitleItem} from '../shared/types';

protocol.registerSchemesAsPrivileged([{scheme:'gomo-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win:BrowserWindow|null=null;
let currentPath='';
const mediaMap=new Map<string,string>();
let config:EngineConfig={repo:'',python:''};
const engine=new EngineController(()=>win);
const configPath=()=>path.join(app.getPath('userData'),'engine-settings.json');
function dir(){return currentPath?path.dirname(currentPath):app.getPath('documents');}
function ensureProject(){if(!currentPath)throw new Error('프로젝트를 먼저 열어 주세요.');return currentPath;}
async function atomicWrite(file:string,text:string){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+randomUUID();await writeFile(tmp,text,'utf8');const fs=await import('node:fs/promises');await fs.rename(tmp,file);}
async function save(data:ComposerProject,target=currentPath):Promise<ProjectState>{if(!target)throw new Error('저장 경로가 없습니다.');const doc=normalizeProject(data);if(doc.version!==2)throw new Error('v1 프로젝트는 구버전에서 v2로 변환 후 저장하세요.');await atomicWrite(target,JSON.stringify(doc,null,2));currentPath=target;return {path:target,data:doc,updatedAt:new Date().toISOString()};}
function remapMedia(data:ComposerProject,oldBase:string,newBase:string){const rel=(s?:string|null)=>s?path.relative(newBase,path.resolve(oldBase,s)).replace(/\\/g,'/'):s;return {...data,clips:data.clips.map(c=>({...c,file:rel(c.file)||c.file})),bgm:{...data.bgm,file:rel(data.bgm.file)},subtitle:{...data.subtitle,file:rel(data.subtitle.file)},dubbing:{...data.dubbing,takes:data.dubbing.takes.map(t=>({...t,file:rel(t.file)||t.file}))}};}
function mediaUrl(file:string){if(!file)return '';const resolved=path.resolve(dir(),file);if(!existsSync(resolved))return '';const ext=path.extname(resolved).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.bmp','.mp4','.mov','.webm','.m4v','.mp3','.wav','.m4a','.ogg','.flac'].includes(ext))return '';const id=randomUUID();mediaMap.set(id,resolved);return `gomo-media://media/${id}`;}
function isSafeDoc(p:unknown):p is ComposerProject {return Boolean(p&&typeof p==='object'&&Array.isArray((p as ComposerProject).clips));}

function registerIpc(){
 ipcMain.handle('project:new',async (_e,title?:string)=>{const id=randomUUID();const file=path.join(app.getPath('userData'),'projects',id,'project.json');return save(createProject(title||'제목 없음'),file);});
 ipcMain.handle('project:open',async(_e,fileArg?:string):Promise<ProjectState|null>=>{let file=fileArg;if(!file){const r=await dialog.showOpenDialog(win!,{properties:['openFile'],filters:[{name:'Video Composer JSON',extensions:['json']}]});if(r.canceled)return null;file=r.filePaths[0];}const doc=normalizeProject(JSON.parse(await readFile(file!,'utf8')));if(doc.version!==2)throw new Error('프로젝트 v1은 기존 영상 합성기에서 v2로 마이그레이션한 다음 여세요.');currentPath=file!;return {path:file!,data:doc,updatedAt:new Date().toISOString()};});
 ipcMain.handle('project:save',async(_e,data:ComposerProject)=>save(data));
 ipcMain.handle('project:saveAs',async(_e,data:ComposerProject)=>{ensureProject();const r=await dialog.showSaveDialog(win!,{defaultPath:path.join(app.getPath('documents'),path.basename(currentPath)),filters:[{name:'Video Composer JSON',extensions:['json']}]});if(r.canceled||!r.filePath)return null;const doc=remapMedia(data,dir(),path.dirname(r.filePath));return save(doc,r.filePath);});
 ipcMain.handle('project:current',()=>currentPath);
 ipcMain.handle('media:import',async()=>{ensureProject();const res=await dialog.showOpenDialog(win!,{properties:['multiSelections','openFile'],filters:[{name:'미디어',extensions:['png','jpg','jpeg','webp','bmp','gif','mp4','mov','webm','m4v','mp3','wav','m4a','flac','ogg','srt','vtt']}]});if(res.canceled)return [];const results:{file:string;type:string;name:string}[]=[];const used=new Set((await readdir(path.join(dir(),'media')).catch(()=>[])).map(s=>s.toLowerCase()));await mkdir(path.join(dir(),'media'),{recursive:true});for(const src of res.filePaths){const name=path.basename(src);const ext=path.extname(name).toLowerCase();let dest=name;let num=2;while(used.has(dest.toLowerCase())){dest=path.basename(name,ext)+`_${num++}`+ext;}used.add(dest.toLowerCase());const copied=path.join(dir(),'media',dest);if(path.resolve(src)!==path.resolve(copied))await copyFile(src,copied);results.push({file:`media/${dest}`,type:['.png','.jpg','.jpeg','.webp','.bmp','.gif'].includes(ext)?'image':['.mp4','.mov','.webm','.m4v'].includes(ext)?'video':['.srt','.vtt'].includes(ext)?'subtitle':'audio',name:dest});}return results;});
 ipcMain.handle('media:urls',(_e,files:string[])=>{const out:Record<string,string>={};for(const file of files){out[file]=mediaUrl(file);}return out;});
 ipcMain.handle('subtitle:saveSrt',async(_e,items:SubtitleItem[])=>{const r=await dialog.showSaveDialog(win!,{defaultPath:path.join(dir(),'captions.srt'),filters:[{name:'SubRip',extensions:['srt']}]});if(r.canceled||!r.filePath)return null;await writeFile(r.filePath,toSrt(items),'utf8');return r.filePath;});
 ipcMain.handle('subtitle:importSrt',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openFile'],filters:[{name:'SubRip',extensions:['srt']}]});if(r.canceled)return null;return readFile(r.filePaths[0],'utf8');});
 ipcMain.handle('project:openFolder',()=>shell.openPath(dir()));
 ipcMain.handle('project:showFile',(_e,file:string)=>{if(!file)return;shell.showItemInFolder(path.resolve(dir(),file));});
 ipcMain.handle('engine:configure',async(_e,settings:EngineConfig)=>{config=settings;await atomicWrite(configPath(),JSON.stringify(config,null,2));engine.setConfig(config);return engine.status();});
 ipcMain.handle('engine:config',()=>engine.status());
 ipcMain.handle('engine:pickRepo',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('engine:pickPython',async()=>{const r=await dialog.showOpenDialog(win!,{properties:['openFile'],filters:[{name:'Python',extensions:['exe']},{name:'모든 파일',extensions:['*']}]});return r.canceled?null:r.filePaths[0];});
 ipcMain.handle('engine:action',async(_e,action:string,args:Record<string,unknown>={})=>{if(!['ping','devices','validate','record_start','record_stop','record_level','render','cancel'].includes(action))throw new Error('허용되지 않은 엔진 명령');return engine.request(action,{...args,base_dir:dir()},action==='render'?24*3600*1000:120000);});
 ipcMain.handle('app:info',()=>({version:app.getVersion(),projectDir:dir(),userData:app.getPath('userData')}));
}
function createWindow(){win=new BrowserWindow({width:1536,height:950,minWidth:1080,minHeight:680,backgroundColor:'#111317',title:'고모 편집실',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'../preload/index.js'),nodeIntegration:false,contextIsolation:true,sandbox:false}});win.on('closed',()=>win=null);if(!app.isPackaged&&process.env.ELECTRON_RENDERER_URL){void win.loadURL(process.env.ELECTRON_RENDERER_URL);win.webContents.openDevTools({mode:'detach'});}else void win.loadFile(path.join(__dirname,'../renderer/index.html'));}
app.whenReady().then(async()=>{
 try{config=JSON.parse(readFileSync(configPath(),'utf8')) as EngineConfig;}catch{config={repo:'',python:''};}engine.setConfig(config);
 protocol.handle('gomo-media',async request=>{const id=new URL(request.url).pathname.split('/').filter(Boolean)[0];const file=mediaMap.get(id);if(!file||!existsSync(file))return new Response('Missing', {status:404});return net.fetch(pathToFileURL(file).toString());});
 registerIpc();createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
});
app.on('before-quit',()=>engine.close());app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
