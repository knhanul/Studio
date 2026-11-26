import assert from 'node:assert/strict';
const p=__shared('project');const s=__shared('steps');
await test('five steps in order with single next label',()=>{assert.deepEqual(s.STEPS,['scenes','dubbing','subtitles','music','export']);const x=p.createProject();x.clips=[{file:'a.png',type:'image',duration:3}];const g=s.stepGuide(x,'scenes');assert.equal(g.ready,true);assert.equal(g.next,'dubbing');assert.equal(g.nextLabel,'다음: 더빙 녹음');assert.equal(s.stepGuide(x,'export').next,null);});
await test('scenes step blocks without clips',()=>{const g=s.stepGuide(p.createProject(),'scenes');assert.equal(g.ready,false);assert.ok(g.missing.length);});
await test('dubbing done when every cue has a take',()=>{let x=p.createProject();x.subtitle.items=[{index:1,start:0,end:1,text:'a'}];assert.equal(s.stepDone(x,'dubbing'),false);x=p.setTakeForCue(x,{file:'t.wav',subtitle:1});assert.equal(s.stepDone(x,'dubbing'),true);});
await test('subtitles step flags empty and inverted cues',()=>{const x=p.createProject();x.subtitle.items=[{index:1,start:2,end:1,text:''}];const g=s.stepGuide(x,'subtitles');assert.equal(g.ready,false);assert.equal(g.missing.length,2);});
