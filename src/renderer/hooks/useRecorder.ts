import {useCallback,useEffect,useRef,useState} from 'react';
import {mergeChunks,peakDb,rmsDb} from '../../shared/audio';

export interface MicDevice{id:string;label:string}
/** 오디오 스레드에서 마이크 소리를 2048샘플씩 모아 보낸다 (frame = 오디오 시계 위치) */
const WORKLET=`class GomoRecorder extends AudioWorkletProcessor{constructor(){super();this.buf=new Float32Array(2048);this.n=0;this.at=0;}
process(inputs){const ch=inputs[0]&&inputs[0][0];if(ch){for(let i=0;i<ch.length;i++){if(this.n===0)this.at=currentFrame+i;this.buf[this.n++]=ch[i];
if(this.n===this.buf.length){this.port.postMessage({data:this.buf,frame:this.at},[this.buf.buffer]);this.buf=new Float32Array(2048);this.n=0;}}}return true;}}
registerProcessor('gomo-recorder',GomoRecorder);`;
/** 브라우저(Electron) 마이크로 바로 녹음: 장치 선택 · 실시간 입력 레벨 · PCM 수집 (Python 불필요) */
export function useRecorder(){
  const [devices,setDevices]=useState<MicDevice[]>([]);
  const [deviceId,setDeviceId]=useState<string>(()=>localStorage.getItem('studio-mic')||'');
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [level,setLevel]=useState(-90);
  const [recording,setRecording]=useState(false);
  const ctxRef=useRef<AudioContext|null>(null);const streamRef=useRef<MediaStream|null>(null);
  const chunks=useRef<Float32Array[]>([]);const totalRef=useRef(0);const startFrame=useRef(0);const recent=useRef<{data:Float32Array;frame:number}[]>([]);
  /** 녹음 중 조각마다 불림 (크기 dB, 조각 길이, 지금까지 샘플 수) — 연속 녹음의 쉼 감지용 */
  const chunkListener=useRef<((db:number,length:number,total:number,sampleRate:number)=>void)|null>(null);const recRef=useRef(false);const peakRef=useRef(-90);const startedAt=useRef(0);
  const close=useCallback(()=>{streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;void ctxRef.current?.close().catch(()=>{});ctxRef.current=null;setReady(false);setLevel(-90);},[]);
  const refreshDevices=useCallback(async()=>{try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');setDevices(list.map((d,i)=>({id:d.deviceId,label:d.label||`마이크 ${i+1}`})));}catch{setDevices([]);}},[]);
  /** 마이크 소리 조각 받기 (frame: 이 조각 첫 샘플의 오디오 시계 위치) */
  const onData=useCallback((data:Float32Array,frame:number,sr:number)=>{
    const p=peakDb(data);peakRef.current=Math.max(p,peakRef.current-1.5);
    recent.current.push({data,frame});if(recent.current.length>4)recent.current.shift();
    if(recRef.current)take(data,frame,sr);
  },[]);// eslint-disable-line react-hooks/exhaustive-deps
  /** 녹음 시작 위치(startFrame)부터만 모은다 — 화면과 녹음을 샘플 단위로 맞추기 위해 */
  const take=(data:Float32Array,frame:number,sr:number)=>{
    const from=Math.max(0,startFrame.current-frame);if(from>=data.length)return;
    const part=from?data.subarray(from):data;const copy=new Float32Array(part);
    chunks.current.push(copy);totalRef.current+=copy.length;chunkListener.current?.(rmsDb(copy),copy.length,totalRef.current,sr);
  };
  const open=useCallback(async(id=deviceId)=>{
    close();setError('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id&&id!=='default'?{exact:id}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
      const ctx=new AudioContext({sampleRate:48000});const src=ctx.createMediaStreamSource(stream);
      const mute=ctx.createGain();mute.gain.value=0;mute.connect(ctx.destination);
      // 녹음은 별도 오디오 스레드(AudioWorklet)에서 모은다 — 화면이 바빠도 소리가 끊기지 않게. 안 되면 예전 방식(ScriptProcessor)
      let worklet=false;
      try{
        if(ctx.audioWorklet){
          const url=URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'}));
          await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
          const node=new AudioWorkletNode(ctx,'gomo-recorder',{numberOfInputs:1,numberOfOutputs:1,channelCount:1,channelCountMode:'explicit'});
          node.port.onmessage=e=>{const m=e.data as {data:Float32Array;frame:number};onData(m.data,m.frame,ctx.sampleRate);};
          src.connect(node);node.connect(mute);worklet=true;
        }
      }catch{worklet=false;}
      if(!worklet){
        const proc=ctx.createScriptProcessor(4096,1,1);let frame=0;
        proc.onaudioprocess=e=>{const d=e.inputBuffer.getChannelData(0);onData(new Float32Array(d),frame,ctx.sampleRate);frame+=d.length;};
        src.connect(proc);proc.connect(mute);
      }
      streamRef.current=stream;ctxRef.current=ctx;setReady(true);await refreshDevices();
      const label=stream.getAudioTracks()[0]?.getSettings().deviceId;if(label&&!id)setDeviceId(label);
      return true;
    }catch(e){setError(e instanceof Error&&e.name==='NotAllowedError'?'마이크 사용이 막혀 있어요. Windows 설정 › 개인 정보 › 마이크에서 앱 접근을 켜 주세요.':e instanceof Error&&e.name==='NotFoundError'?'연결된 마이크를 찾지 못했어요.':`마이크를 열지 못했어요: ${e instanceof Error?e.message:String(e)}`);close();return false;}
  },[deviceId,close,refreshDevices,onData]);
  const choose=useCallback((id:string)=>{setDeviceId(id);localStorage.setItem('studio-mic',id);void open(id);},[open]);
  useEffect(()=>{if(!ready)return;let raf=0;let last=0;const tick=(now:number)=>{if(now-last>60){setLevel(peakRef.current);last=now;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[ready]);
  useEffect(()=>{void refreshDevices();const h=()=>void refreshDevices();navigator.mediaDevices?.addEventListener?.('devicechange',h);return()=>{navigator.mediaDevices?.removeEventListener?.('devicechange',h);close();};},[refreshDevices,close]);
  /** 지금 이 순간부터 녹음 (오디오 시계 기준 — 이미 받아 둔 조각 중 이 시각 뒤 부분도 넣는다) */
  const start=useCallback(()=>{chunks.current=[];totalRef.current=0;const ctx=ctxRef.current;const sr=ctx?.sampleRate||48000;
    startFrame.current=ctx?Math.round(ctx.currentTime*sr):0;recRef.current=true;startedAt.current=performance.now();
    for(const c of recent.current)take(c.data,c.frame,sr);setRecording(true);},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const stop=useCallback(():{samples:Float32Array;sampleRate:number}=>{recRef.current=false;setRecording(false);const samples=mergeChunks(chunks.current);chunks.current=[];return {samples,sampleRate:ctxRef.current?.sampleRate||48000};},[]);
  const elapsed=useCallback(()=>recRef.current?(performance.now()-startedAt.current)/1000:0,[]);
  /** 카운트다운 소리 */
  const beep=useCallback((high=false)=>{const ctx=ctxRef.current;if(!ctx)return;const o=ctx.createOscillator();const g=ctx.createGain();o.frequency.value=high?1320:880;g.gain.setValueAtTime(.12,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.12);o.connect(g).connect(ctx.destination);o.start();o.stop(ctx.currentTime+.13);},[]);
  const sampleCount=useCallback(()=>totalRef.current,[]);
  const setChunkListener=useCallback((fn:((db:number,length:number,total:number,sampleRate:number)=>void)|null)=>{chunkListener.current=fn;},[]);
  return {devices,deviceId,choose,ready,open,close,error,level,recording,start,stop,elapsed,beep,sampleCount,setChunkListener};
}
