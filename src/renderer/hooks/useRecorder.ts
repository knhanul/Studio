import {useCallback,useEffect,useRef,useState} from 'react';
import {mergeChunks,peakDb} from '../../shared/audio';

export interface MicDevice{id:string;label:string}
/** 브라우저(Electron) 마이크로 바로 녹음: 장치 선택 · 실시간 입력 레벨 · PCM 수집 (Python 불필요) */
export function useRecorder(){
  const [devices,setDevices]=useState<MicDevice[]>([]);
  const [deviceId,setDeviceId]=useState<string>(()=>localStorage.getItem('studio-mic')||'');
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [level,setLevel]=useState(-90);
  const [recording,setRecording]=useState(false);
  const ctxRef=useRef<AudioContext|null>(null);const streamRef=useRef<MediaStream|null>(null);
  const chunks=useRef<Float32Array[]>([]);const recRef=useRef(false);const peakRef=useRef(-90);const startedAt=useRef(0);
  const close=useCallback(()=>{streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;void ctxRef.current?.close().catch(()=>{});ctxRef.current=null;setReady(false);setLevel(-90);},[]);
  const refreshDevices=useCallback(async()=>{try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');setDevices(list.map((d,i)=>({id:d.deviceId,label:d.label||`마이크 ${i+1}`})));}catch{setDevices([]);}},[]);
  const open=useCallback(async(id=deviceId)=>{
    close();setError('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id&&id!=='default'?{exact:id}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
      const ctx=new AudioContext({sampleRate:48000});const src=ctx.createMediaStreamSource(stream);
      const proc=ctx.createScriptProcessor(4096,1,1);const mute=ctx.createGain();mute.gain.value=0;
      proc.onaudioprocess=e=>{const data=e.inputBuffer.getChannelData(0);const p=peakDb(data);peakRef.current=Math.max(p,peakRef.current-1.5);if(recRef.current)chunks.current.push(new Float32Array(data));};
      src.connect(proc);proc.connect(mute);mute.connect(ctx.destination);
      streamRef.current=stream;ctxRef.current=ctx;setReady(true);await refreshDevices();
      const label=stream.getAudioTracks()[0]?.getSettings().deviceId;if(label&&!id)setDeviceId(label);
      return true;
    }catch(e){setError(e instanceof Error&&e.name==='NotAllowedError'?'마이크 사용이 막혀 있어요. Windows 설정 › 개인 정보 › 마이크에서 앱 접근을 켜 주세요.':e instanceof Error&&e.name==='NotFoundError'?'연결된 마이크를 찾지 못했어요.':`마이크를 열지 못했어요: ${e instanceof Error?e.message:String(e)}`);close();return false;}
  },[deviceId,close,refreshDevices]);
  const choose=useCallback((id:string)=>{setDeviceId(id);localStorage.setItem('studio-mic',id);void open(id);},[open]);
  useEffect(()=>{if(!ready)return;let raf=0;let last=0;const tick=(now:number)=>{if(now-last>60){setLevel(peakRef.current);last=now;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[ready]);
  useEffect(()=>{void refreshDevices();const h=()=>void refreshDevices();navigator.mediaDevices?.addEventListener?.('devicechange',h);return()=>{navigator.mediaDevices?.removeEventListener?.('devicechange',h);close();};},[refreshDevices,close]);
  const start=useCallback(()=>{chunks.current=[];recRef.current=true;startedAt.current=performance.now();setRecording(true);},[]);
  const stop=useCallback(():{samples:Float32Array;sampleRate:number}=>{recRef.current=false;setRecording(false);const samples=mergeChunks(chunks.current);chunks.current=[];return {samples,sampleRate:ctxRef.current?.sampleRate||48000};},[]);
  const elapsed=useCallback(()=>recRef.current?(performance.now()-startedAt.current)/1000:0,[]);
  /** 카운트다운 소리 */
  const beep=useCallback((high=false)=>{const ctx=ctxRef.current;if(!ctx)return;const o=ctx.createOscillator();const g=ctx.createGain();o.frequency.value=high?1320:880;g.gain.setValueAtTime(.12,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.12);o.connect(g).connect(ctx.destination);o.start();o.stop(ctx.currentTime+.13);},[]);
  return {devices,deviceId,choose,ready,open,close,error,level,recording,start,stop,elapsed,beep};
}
