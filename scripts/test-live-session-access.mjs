import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

function moduleUrl(source) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}
const stubs = moduleUrl(`
export async function getSession(){ return globalThis.__echoLiveAccess.session; }
export function resolveConnection(){ return {connectionString:'postgresql://test.invalid/test'}; }
export class Client {
 constructor(){ globalThis.__echoLiveAccess.clients++; }
 async connect(){ if(globalThis.__echoLiveAccess.fail) throw new Error('test database failure'); }
 async query(sql,values){ const f=globalThis.__echoLiveAccess; f.sql=sql; f.values=values; f.queries++; return {rows:f.rows}; }
 async end(){ globalThis.__echoLiveAccess.closed++; }
}`);
const limits = moduleUrl(readFileSync('back_end/services/limits.ts','utf8'));
const accessSource = readFileSync('back_end/services/live-session-access.ts','utf8')
  .replace('"pg"',JSON.stringify(stubs))
  .replace('"@/back_end/services/session"',JSON.stringify(stubs))
  .replace('"@/back_end/services/database-connection"',JSON.stringify(stubs))
  .replace('"@/back_end/services/limits"',JSON.stringify(limits));
const {getLiveSessionAccess} = await import(moduleUrl(accessSource));
const {readLiveSessionResponse} = await import(moduleUrl(readFileSync('shared/live-session-response.ts','utf8')));
function fixture(overrides={}) {
  globalThis.__echoLiveAccess = {session:{userId:'owner'},clients:0,closed:0,queries:0,rows:[{
    userId:'owner',emailVerified:true,subscriptionStatus:'active',subscriptionRenewsAt:new Date('2099-01-01'),
    id:'persona',status:'active',liveAvatarId:'persona_avatar',voiceRefTranscript:'test reference',
    ...overrides,
  }]};
  return globalThis.__echoLiveAccess;
}
test('live access uses one bounded ownership-checked query and closes its connection',async()=>{
  const f=fixture();
  const result=await getLiveSessionAccess('persona',{requireAvatar:true});
  assert.equal(result.ok,true);
  assert.equal(f.clients,1); assert.equal(f.queries,1); assert.equal(f.closed,1);
  assert.match(f.sql,/p\."userId" = u\.id AND p\.id = \$2/);
  assert.match(f.sql,/WHERE u\.id = \$1/);
  assert.deepEqual(f.values,['owner','persona']);
});
test('signed-out users do not open a database connection',async()=>{
  const f=fixture(); f.session={};
  assert.equal((await getLiveSessionAccess('persona')).status,401); assert.equal(f.clients,0);
});
test('unverified, missing and expired accounts remain rejected',async()=>{
  fixture({emailVerified:false}); assert.equal((await getLiveSessionAccess('persona')).status,401);
  const f=fixture(); f.rows=[]; assert.equal((await getLiveSessionAccess('persona')).status,401);
  fixture({subscriptionRenewsAt:new Date('2000-01-01')}); assert.equal((await getLiveSessionAccess('persona')).status,403);
});
test('missing/not-owned, unprepared and untrained personas remain rejected',async()=>{
  fixture({id:null}); assert.equal((await getLiveSessionAccess('someone-elses-persona')).status,404);
  fixture({status:'processing'}); assert.equal((await getLiveSessionAccess('persona')).status,409);
  fixture({liveAvatarId:null}); assert.equal((await getLiveSessionAccess('persona',{requireAvatar:true})).status,409);
});
test('closing remains possible after expiry or a training-state change, not without ownership',async()=>{
  const options={requirePaid:false,requireActive:false};
  fixture({subscriptionStatus:'expired',status:'processing'});
  assert.equal((await getLiveSessionAccess('persona',options)).ok,true);
  fixture({id:null,subscriptionStatus:'expired'});
  assert.equal((await getLiveSessionAccess('not-owned',options)).status,404);
});
test('persona input is bound, never interpolated into SQL',async()=>{
  const f=fixture({id:null}); const input="x' OR 1=1 --";
  assert.equal((await getLiveSessionAccess(input)).status,404);
  assert.equal(f.values[1],input); assert.equal(f.sql.includes(input),false);
});
test('database failure returns a retryable error and closes the client',async()=>{
  const f=fixture(); f.fail=true;
  const log=console.error; console.error=()=>{};
  try { assert.equal((await getLiveSessionAccess('persona')).status,503); }
  finally { console.error=log; }
  assert.equal(f.closed,1);
});
test('HTML gateway failures are not parsed or misreported as GPU timeouts',async()=>{
  await assert.rejects(readLiveSessionResponse(new Response('<!DOCTYPE html>1102',{status:503,headers:{'content-type':'text/html'}})),/website gateway.*503/i);
  await assert.rejects(readLiveSessionResponse(Response.json({error:'Persona not found.'},{status:404})),/Persona not found/);
  await assert.rejects(readLiveSessionResponse(new Response('broken',{headers:{'content-type':'application/json'}})),/invalid response/i);
  assert.deepEqual(await readLiveSessionResponse(Response.json({ok:true})),{ok:true});
});
test('failed connections clear the timer before displaying their real error',()=>{
  const source=readFileSync('front_end/components/dashboard/LiveTalkingAvatar.tsx','utf8');
  assert.match(source,/connect\(\)\.catch\([\s\S]*?clearTimeout\(timeoutId\)[\s\S]*?cancelled = true/);
});
