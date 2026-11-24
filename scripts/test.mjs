import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const req=createRequire(import.meta.url);
let ts;try{ts=req('typescript');}catch{ts=req(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()+'/typescript');}
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
const projectFile=path.resolve('src/shared/project.ts');
const code=fs.readFileSync(projectFile,'utf8');
const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{exports:module.exports,module,require:()=>{throw Error('No runtime imports allowed here');},console,JSON,Math,Number,Array,String,Boolean,Date,RegExp,Object}, {filename:projectFile});
const p=module.exports;
let count=0;
function test(label,fn){fn();count++;process.stdout.write(`✓ ${label}\n`);}
test('v2 fresh project',()=>{const x=p.createProject('테스트');assert.equal(x.version,2);assert.equal(x.title,'테스트');assert.equal(x.clips.length,0);});
test('media clip duration',()=>{assert.equal(p.clipDuration({file:'a.png',type:'image',duration:5.5}),5.5);});
test('video trim respects speed',()=>{assert.equal(p.clipDuration({file:'a.mp4',type:'video',trim_start:2,trim_end:10,speed:2}),4);});
test('target duration override',()=>{assert.equal(p.clipDuration({file:'a.mp4',type:'video',trim_end:10,fit_duration:3}),3);});
test('timeline is contiguous',()=>{const x=p.createProject();x.clips=[{file:'a.png',type:'image',duration:4},{file:'b.png',type:'image',duration:6}];const t=p.timeline(x);assert.equal(t[1].start,4);assert.equal(p.totalDuration(x),10);});
test('SRT round trip',()=>{const original=[{index:1,start:0.25,end:3.7,text:'첫 번째 자막'},{index:2,start:3.9,end:8.2,text:'두 번째 줄'}];const output=p.fromSrt(p.toSrt(original));assert.equal(output.length,2);assert.equal(output[0].start,0.25);assert.equal(output[1].text,'두 번째 줄');});
test('normalize preserves unknown metadata',()=>{const x=p.normalizeProject({...p.createProject(),extra:{storyboard:'unchanged'}});assert.equal(x.extra.storyboard,'unchanged');});
test('normalize preserves clip effects',()=>{const x=p.createProject();x.clips=[{file:'a.png',type:'image',look:'warm',motion:'ken_burns'}];assert.equal(p.normalizeProject(x).clips[0].motion,'ken_burns');});
test('normalize rejects unknown version',()=>{assert.throws(()=>p.normalizeProject({version:99}),/지원되지/);});
test('normalize rejects invalid data',()=>{assert.throws(()=>p.normalizeProject(null),/올바른/);});
test('validProject warns without clips',()=>{assert.equal(p.validProject(p.createProject()).length,1);});
test('time formatting',()=>{assert.equal(p.fmt(65.5),'01:05.5');});
console.log(`\n${count} tests passed`);
