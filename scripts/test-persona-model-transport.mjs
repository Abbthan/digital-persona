import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const output=ts.transpileModule(readFileSync('back_end/services/persona-model-transport.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {fetchPersonaModel}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const init={method:'POST',headers:{Authorization:'Bearer isolated-test'},body:JSON.stringify({model:'same-model',instructions:'same persona rules',input:'same grounded context',max_output_tokens:180})};
test('working Responses providers remain unchanged',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return Response.json({output_text:'yes'});};const response=await fetchPersonaModel('https://provider.invalid/v1/responses',init);assert.equal((await response.json()).output_text,'yes');assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
test('channel/endpoint fallback preserves host, model, credentials and exact context',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;if(calls===1)return Response.json({error:{message:'No available channel for the current group.'}},{status:503});assert.equal(String(url),'https://provider.invalid/v1/chat/completions');assert.deepEqual(options.headers,init.headers);const body=JSON.parse(options.body);assert.equal(body.model,'same-model');assert.equal(body.max_completion_tokens,180);assert.deepEqual(body.messages,[{role:'system',content:'same persona rules'},{role:'user',content:'same grounded context'}]);return Response.json({choices:[{message:{content:'Four.'}}]});};const response=await fetchPersonaModel('https://provider.invalid/v1/responses',init);assert.equal((await response.json()).output_text,'Four.');assert.equal(calls,2);}finally{globalThis.fetch=old;}
});
test('authentication failures and ordinary outages do not switch protocols',async()=>{
 const old=globalThis.fetch;
 try{for(const status of [401,403,429,503]){let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'Unavailable'}},{status});};assert.equal((await fetchPersonaModel('https://provider.invalid/v1/responses',init)).status,status);assert.equal(calls,1);}}finally{globalThis.fetch=old;}
});
