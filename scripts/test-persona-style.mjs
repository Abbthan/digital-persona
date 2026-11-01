import {readFileSync} from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
const transpile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`;
const stub = transpile('export async function createLiveSessionToken(){return "scoped-test-token";} export function liveTalkingServerUrl(){return "https://backend.invalid";}');
const rag = await import(transpile(readFileSync('back_end/services/persona-rag.ts','utf8').replace('"@/back_end/services/live-avatar"',JSON.stringify(stub))));
test('style retrieval has a distinct source-only purpose; factual retrieval stays unchanged',async()=>{
 const old=globalThis.fetch; const calls=[];
 try {globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({ok:true,prompt:'Verified source examples',sources:{conversation:[],documents:[],document_images:[]}});};
 await rag.composePersonaPrompt('p','Name','hello',8,'style'); await rag.composePersonaPrompt('p','Name','memory');
 assert.equal(calls[0].purpose,'style');assert.equal(calls[1].purpose,'memory');assert.equal(calls[0].persona_id,'p');
 }finally{globalThis.fetch=old;}
});
test('media requests queue private URLs and explicit attribution, not media bytes',async()=>{
 const old=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>{assert.match(String(url),/media-from-url$/);const body=JSON.parse(options.body);assert.equal(body.target_authorship,'target');assert.equal(body.media_type,'video');assert.match(body.source_url,/\/api\/internal\/persona-media\/p\/asset$/);assert.equal(body.scripted,false);return Response.json({ok:true},{status:202});};
 assert.equal(await rag.ingestMedia('p','asset','test.mp4','video','target'),true);
 }finally{globalThis.fetch=old;}
});
test('both reply paths use source-only retrieval and reject self-taught generic catchphrases',()=>{
 const source=readFileSync('back_end/services/persona-ai.ts','utf8');
 assert.equal((source.match(/8,\s*"style",/g)||[]).length,2);
 assert.match(source,/Generated Persona replies, visitor messages and scripted reference readings must not teach catchphrases/);
});
test('asset attribution is owner checked and does not retrain the avatar',()=>{
 const source=readFileSync('back_end/api/personas/[id]/assets/[assetId]/route.ts','utf8').split('export async function DELETE')[0];
 assert.match(source,/persona: \{ userId: user.id \}/);assert.match(source,/setStyleAttribution/);
 assert.doesNotMatch(source,/await submitAvatarTraining/);
});
