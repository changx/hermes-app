import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
test('Electron: Settings adds/lists/removes independent connections, reports live state, preserves peer tabs and restores encrypted slots', {skip:!process.env.HERMES_TEST_ELECTRON,timeout:90000},async()=>{
  const root = new URL('..',import.meta.url).pathname,folder = await mkdtemp(join(tmpdir(),'hermes-connections-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const bundle = await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,
      plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const tabsForTest=()=>tabs; export const settingsForTest=()=>settingsWindow;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),bundle.outputFiles[0].text);
    await cp(new URL('./fixtures/connections-native.cjs',import.meta.url),join(folder,'harness.cjs'));
    const output = execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:70000,maxBuffer:3e6,env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
    console.log(output);assert.match(output,/CONNECTIONS_NATIVE_OK/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
