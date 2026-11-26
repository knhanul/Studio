// 고모 편집실 단위 테스트: src/shared/*.ts 를 임시 폴더에 CommonJS로 변환한 뒤 scripts/tests/*.test.mjs 실행
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const req=createRequire(import.meta.url);
let ts;try{ts=req('typescript');}catch{ts=req(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()+'/typescript');}
const root=path.resolve('.');
const outDir=fs.mkdtempSync(path.join(os.tmpdir(),'gomo-studio-test-'));
const sharedDir=path.join(root,'src','shared');
for(const name of fs.readdirSync(sharedDir).filter(n=>n.endsWith('.ts'))){
  const code=fs.readFileSync(path.join(sharedDir,name),'utf8');
  const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  fs.writeFileSync(path.join(outDir,name.replace(/\.ts$/,'.js')),js);
}
globalThis.__shared=(name)=>req(path.join(outDir,name+'.js'));
let count=0,failed=0;
globalThis.test=async(label,fn)=>{try{await fn();count++;process.stdout.write(`✓ ${label}\n`);}catch(e){failed++;process.stdout.write(`✗ ${label}\n  ${e&&e.stack||e}\n`);}};
const testDir=path.join(root,'scripts','tests');
for(const name of fs.readdirSync(testDir).filter(n=>n.endsWith('.test.mjs')).sort()){
  process.stdout.write(`\n# ${name}\n`);
  await import(pathToFileURL(path.join(testDir,name)).href);
}
fs.rmSync(outDir,{recursive:true,force:true});
console.log(`\n${count} tests passed${failed?`, ${failed} failed`:''}`);
if(failed)process.exit(1);
// 기존 Python 브리지 테스트 (Python이 있을 때만)
const py=['python','python3','py'].find(cmd=>spawnSync(cmd,['--version'],{stdio:'ignore',shell:false}).status===0);
if(!py){console.log('\n(Python이 없어 engine/tests Python 테스트는 건너뜀)');}
else{const r=spawnSync(py,['-m','unittest','discover','-s','engine/tests','-v'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
