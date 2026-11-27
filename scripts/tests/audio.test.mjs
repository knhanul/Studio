import assert from 'node:assert/strict';
const a=__shared('audio');
const sr=8000;
const tone=(sec,amp)=>{const x=new Float32Array(Math.round(sec*sr));for(let i=0;i<x.length;i++)x[i]=amp*Math.sin(i/sr*2*Math.PI*220);return x;};
await test('WAV header and length',()=>{const s=new Float32Array([0,.5,-.5,1,-1]);const buf=a.encodeWav(s,sr);const v=new DataView(buf);assert.equal(buf.byteLength,44+10);assert.equal(String.fromCharCode(...new Uint8Array(buf,0,4)),'RIFF');assert.equal(v.getUint32(24,true),sr);assert.equal(v.getInt16(44+6,true),32767);assert.equal(v.getInt16(44+8,true),-32768);});
await test('mergeChunks concatenates',()=>{assert.equal(a.mergeChunks([new Float32Array(3),new Float32Array(2)]).length,5);});
await test('voice bounds skip leading/trailing silence',()=>{const s=a.mergeChunks([new Float32Array(sr),tone(1,.3),new Float32Array(sr/2)]);const b=a.detectVoiceBounds(s,sr,{margin:0});assert.ok(Math.abs(b.start-1)<.03,`start ${b.start}`);assert.ok(Math.abs(b.end-2)<.03,`end ${b.end}`);});
await test('voice bounds null for silence',()=>{assert.equal(a.detectVoiceBounds(new Float32Array(sr),sr),null);});
await test('levels',()=>{assert.equal(a.rmsDb(new Float32Array(10)),-90);assert.ok(Math.abs(a.peakDb(tone(.1,.5))-(-6.02))<.1);assert.equal(a.meterFraction(0),1);assert.equal(a.meterFraction(-90),0);});
await test('waveform peaks',()=>{const w=a.waveformPeaks(a.mergeChunks([new Float32Array(100),tone(.1,.8)]),4);assert.equal(w.length,4);assert.ok(w[3]>.7);});
await test('continuous take: pause after speech splits, short breath or silence before speech does not',()=>{
  const dt=.1;let s=a.pauseStart();const feed=(db,n)=>{const out=[];for(let i=0;i<n;i++){const r=a.pauseStep(s,db,dt);s=r.state;if(r.split!=null)out.push(+r.split.toFixed(2));}return out;};
  assert.deepEqual(feed(-60,15),[],'silence before speaking never splits');
  assert.deepEqual(feed(-20,20),[]);assert.deepEqual(feed(-60,5),[],'0.5s breath is not a pause');assert.deepEqual(feed(-20,10),[]);
  assert.deepEqual(feed(-60,12),[5.3],'1s pause → split shortly after pause start');
  assert.deepEqual(feed(-60,30),[],'after a split, silence alone does not split again');
  assert.deepEqual(feed(-41,5).concat(feed(-20,3)),[],'middle level is neither speech nor pause');});
await test('split recorded samples at marks',()=>{const s=new Float32Array(10).map((_,i)=>i);const parts=a.splitAtMarks(s,[0,3,7,10]);assert.deepEqual(parts.map(p=>[...p]),[[0,1,2],[3,4,5,6],[7,8,9]]);assert.equal(a.splitAtMarks(s,[0,12]).length,1);});
