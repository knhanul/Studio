import {contextBridge,ipcRenderer,webUtils} from 'electron';
import type {ComposerProject,MediaItem,SubtitleItem,EngineStatus,FfmpegStatus,ProjectState,RecentProject,RenderEvent} from '../shared/types';
export const api={
  project:{
    create:(title?:string):Promise<ProjectState>=>ipcRenderer.invoke('project:new',title),
    open:(path?:string):Promise<ProjectState|null>=>ipcRenderer.invoke('project:open',path),
    openFolder:():Promise<ProjectState|null>=>ipcRenderer.invoke('project:openFolder'),
    openPath:(path:string):Promise<ProjectState>=>ipcRenderer.invoke('project:openPath',path),
    recent:():Promise<RecentProject[]>=>ipcRenderer.invoke('project:recent'),
    save:(p:ComposerProject):Promise<ProjectState>=>ipcRenderer.invoke('project:save',p),
    saveAs:(p:ComposerProject):Promise<ProjectState|null>=>ipcRenderer.invoke('project:saveAs',p),
    reveal:():Promise<string>=>ipcRenderer.invoke('project:reveal'),
    showFile:(file:string)=>ipcRenderer.invoke('project:showFile',file),
    /** 끌어다 놓은 파일·폴더의 실제 경로 */
    pathOf:(file:File):string=>webUtils.getPathForFile(file)
  },
  media:{
    import:(kind:'visual'|'audio'|'any'='any',multi=true):Promise<{file:string;type:string;name:string;duration?:number|null}[]>=>ipcRenderer.invoke('media:import',kind,multi),
    /** 작업 폴더를 다시 읽어 미디어 보관함 항목 (창작실 project.json + assets/ · media/ 파일) */
    library:():Promise<MediaItem[]>=>ipcRenderer.invoke('media:library'),
    urls:(paths:string[]):Promise<Record<string,string>>=>ipcRenderer.invoke('media:urls',paths),
    probe:(file:string):Promise<{duration:number|null;hasAudio:boolean}>=>ipcRenderer.invoke('media:probe',file)
  },
  take:{
    save:(cue:number|null,data:ArrayBuffer):Promise<string>=>ipcRenderer.invoke('take:save',cue,data),
    import:(cue:number):Promise<{file:string;duration:number|null}|null>=>ipcRenderer.invoke('take:import',cue)
  },
  subtitle:{saveSrt:(items:SubtitleItem[]):Promise<string|null>=>ipcRenderer.invoke('subtitle:saveSrt',items),importSrt:():Promise<string|null>=>ipcRenderer.invoke('subtitle:importSrt')},
  ffmpeg:{status:():Promise<FfmpegStatus>=>ipcRenderer.invoke('ffmpeg:status'),configure:(path:string):Promise<FfmpegStatus>=>ipcRenderer.invoke('ffmpeg:configure',path),pick:():Promise<string|null>=>ipcRenderer.invoke('ffmpeg:pick')},
  render:{
    start:(p:ComposerProject,draft:boolean):Promise<{output:string}>=>ipcRenderer.invoke('render:start',p,draft),
    cancel:():Promise<boolean>=>ipcRenderer.invoke('render:cancel'),
    open:(file:string)=>ipcRenderer.invoke('render:open',file),
    reveal:(file:string)=>ipcRenderer.invoke('render:reveal',file),
    url:(file:string):Promise<string>=>ipcRenderer.invoke('render:url',file),
    onEvent:(fn:(v:RenderEvent)=>void)=>{const h=(_e:Electron.IpcRendererEvent,v:RenderEvent)=>fn(v);ipcRenderer.on('render:event',h);return ()=>{ipcRenderer.removeListener('render:event',h);};}
  },
  engine:{status:():Promise<EngineStatus>=>ipcRenderer.invoke('engine:config'),configure:(c:{repo:string;python:string}):Promise<EngineStatus>=>ipcRenderer.invoke('engine:configure',c),pickRepo:():Promise<string|null>=>ipcRenderer.invoke('engine:pickRepo'),pickPython:():Promise<string|null>=>ipcRenderer.invoke('engine:pickPython'),action:<T=unknown>(command:string,args:Record<string,unknown>={}):Promise<T>=>ipcRenderer.invoke('engine:action',command,args)},
  info:():Promise<{version:string;projectDir:string;userData:string}>=>ipcRenderer.invoke('app:info')
};
contextBridge.exposeInMainWorld('compose',api);
