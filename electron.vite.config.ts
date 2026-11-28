import {defineConfig} from 'electron-vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
const pkg=JSON.parse(readFileSync('package.json','utf8')) as {version:string};
// 브랜드(고모/누니)는 빌드할 때 정한다. BRAND_ID=gomo 가 아니면 누니 편집실
const define={__BRAND_ID__:JSON.stringify(process.env.BRAND_ID==='gomo'?'gomo':'nuni'),__APP_VERSION__:JSON.stringify(pkg.version)};
export default defineConfig({
  main: {build:{outDir:'out/main'},define},
  preload: {build:{outDir:'out/preload'},define},
  renderer: {plugins:[react()],build:{outDir:'out/renderer'},define}
});
