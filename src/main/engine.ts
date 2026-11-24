import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface,Interface} from 'node:readline';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {app,BrowserWindow} from 'electron';
import type {EngineStatus} from '../shared/types';
export interface EngineConfig{repo:string;python:string}
export class EngineController {
  private process:ChildProcessWithoutNullStreams|null=null;
  private reader:Interface|null=null;
  private serial=0;
  private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(err:Error)=>void;timer:NodeJS.Timeout}>();
  private config:EngineConfig={repo:'',python:''};
  constructor(private getWindow:()=>BrowserWindow|null){}
  setConfig(c:EngineConfig){this.close();this.config=c;}
  getConfig(){return {...this.config};}
  status():EngineStatus{const {repo,python}=this.config;const okay=existsSync(path.join(repo,'composer','schema.py'))&&existsSync(python);return {connected:Boolean(this.process&&!this.process.killed),repo,python,message:okay?'기존 Python 엔진 폴더 연결 준비됨':'dubbing 저장소 경로와 그 가상환경 Python 경로를 지정하세요.'};}
  private ensure(){
    const {repo,python}=this.config;
    if(!existsSync(path.join(repo,'composer','schema.py')))throw new Error('기존 dubbing 폴더에 composer/schema.py가 없습니다.');
    if(!existsSync(python))throw new Error('Python 실행 파일을 찾을 수 없습니다. dubbing/.venv/Scripts/python.exe를 선택하세요.');
    if(this.process&&this.process.exitCode===null&&!this.process.killed)return;
    const entry=app.isPackaged?path.join(process.resourcesPath,'engine','bridge.py'):path.join(app.getAppPath(),'engine','bridge.py');
    this.process=spawn(python,['-u',entry],{cwd:repo,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.process.stderr.setEncoding('utf8');this.process.stderr.on('data',(msg:string)=>this.getWindow()?.webContents.send('engine:log',String(msg).slice(0,3000)));
    this.reader=createInterface({input:this.process.stdout});
    this.reader.on('line',line=>{try{const m=JSON.parse(line) as {id?:number;ok?:boolean;result?:unknown;error?:string;event?:string};if(m.event){this.getWindow()?.webContents.send('engine:event',m);return;}if(typeof m.id==='number'){const pending=this.pending.get(m.id);if(!pending)return;this.pending.delete(m.id);clearTimeout(pending.timer);if(m.ok)pending.resolve(m.result);else pending.reject(new Error(m.error||'Python 작업 실패'));}}catch{/* invalid stdout ignored */}});
    this.process.on('exit',(code)=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(`Python 엔진 종료 (코드 ${code})`));}this.pending.clear();this.process=null;this.getWindow()?.webContents.send('engine:event',{event:'disconnected',message:'Python 엔진이 종료되었습니다.'});});
    this.process.on('error',(err)=>{this.getWindow()?.webContents.send('engine:event',{event:'error',message:err.message});});
  }
  async request(action:string,args:Record<string,unknown>={},timeoutMs=120000):Promise<unknown>{
    this.ensure();if(!this.process)throw new Error('엔진 프로세스 시작 실패');
    const id=++this.serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${action} 응답 시간 초과`));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.process!.stdin.write(JSON.stringify({id,action,args})+'\n','utf8');});
  }
  close(){this.reader?.close();this.reader=null;this.process?.kill();this.process=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('엔진 재시작'));}this.pending.clear();}
}
