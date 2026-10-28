import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureCompanion } from './companion-bootstrap.ts';

test('companion data uses a private application root and preserves previous pet settings', () => {
  const root=mkdtempSync(join(tmpdir(),'dsh-codex-bootstrap-'));
  const values=new Map<string,string>([['appData',root]]);
  const previous={home:process.env.DSH_HOME,data:process.env.DSH_CODEX_PET_DATA,
    profile:process.env.DSH_CODEX_PET_PROFILE,companion:process.env.DSH_PET_COMPANION};
  const app={getPath:(name:string)=>values.get(name)!,setPath:(name:string,value:string)=>{values.set(name,value);},setName:()=>{}};
  delete process.env.DSH_CODEX_PET_DATA;
  try {
    configureCompanion(app);
    const data=join(root,'DSH Codex Pet','data');
    assert.equal(process.env.DSH_HOME,data);
    assert.equal(app.getPath('userData'),join(root,'DSH Codex Pet','chromium'));
    assert.equal(app.getPath('sessionData'),app.getPath('userData'));
    assert.equal(existsSync(app.getPath('sessionData')),true);
    const config=join(data,'dsh-pet','main-config.jsonc');
    const parsed=JSON.parse(readFileSync(config,'utf8'));
    assert.equal(parsed.pets[0].display,'desktop');
    assert.equal(parsed.pets[0].whisperEnabled,true);
    writeFileSync(config,'{"pets":[],"custom":"preserve me"}\n');
    configureCompanion(app);
    assert.equal(readFileSync(config,'utf8'),'{"pets":[],"custom":"preserve me"}\n');
  } finally {
    for (const [name,value] of Object.entries({DSH_HOME:previous.home,DSH_CODEX_PET_DATA:previous.data,
      DSH_CODEX_PET_PROFILE:previous.profile,DSH_PET_COMPANION:previous.companion})) {
      if (value===undefined) delete process.env[name]; else process.env[name]=value;
    }
  }
});
