import {contextBridge,ipcRenderer} from 'electron';
import type {ComposerProject,SubtitleItem,EngineEvent,EngineStatus,ProjectState} from '../shared/types';
export const api={
  project:{create:(title?:string):Promise<ProjectState>=>ipcRenderer.invoke('project:new',title),open:(path?:string):Promise<ProjectState|null>=>ipcRenderer.invoke('project:open',path),save:(p:ComposerProject):Promise<ProjectState>=>ipcRenderer.invoke('project:save',p),saveAs:(p:ComposerProject):Promise<ProjectState|null>=>ipcRenderer.invoke('project:saveAs',p),folder:():Promise<string>=>ipcRenderer.invoke('project:openFolder'),showFile:(file:string)=>ipcRenderer.invoke('project:showFile',file)},
  media:{import:():Promise<{file:string;type:string;name:string}[]>=>ipcRenderer.invoke('media:import'),urls:(paths:string[]):Promise<Record<string,string>>=>ipcRenderer.invoke('media:urls',paths)},
  subtitle:{saveSrt:(items:SubtitleItem[]):Promise<string|null>=>ipcRenderer.invoke('subtitle:saveSrt',items),importSrt:():Promise<string|null>=>ipcRenderer.invoke('subtitle:importSrt')},
  engine:{status:():Promise<EngineStatus>=>ipcRenderer.invoke('engine:config'),configure:(c:{repo:string;python:string}):Promise<EngineStatus>=>ipcRenderer.invoke('engine:configure',c),pickRepo:():Promise<string|null>=>ipcRenderer.invoke('engine:pickRepo'),pickPython:():Promise<string|null>=>ipcRenderer.invoke('engine:pickPython'),action:<T=unknown>(command:string,args:Record<string,unknown>={}):Promise<T>=>ipcRenderer.invoke('engine:action',command,args),onEvent:(fn:(v:EngineEvent)=>void)=>{const handler=(_e:Electron.IpcRendererEvent,v:EngineEvent)=>fn(v);ipcRenderer.on('engine:event',handler);return ()=>ipcRenderer.removeListener('engine:event',handler);}},
  info:():Promise<{version:string;projectDir:string;userData:string}>=>ipcRenderer.invoke('app:info')
};
contextBridge.exposeInMainWorld('compose',api);
