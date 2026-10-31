import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
function moduleUrl(source) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}
const languageUrl = moduleUrl(readFileSync('shared/stt-language.ts','utf8'));
const language = await import(languageUrl);
const speech = await import(moduleUrl(readFileSync('back_end/services/livetalking.ts','utf8').replace('"@/shared/stt-language"',JSON.stringify(languageUrl))));
test('auto routing extends, rather than replaces, all existing manual choices', () => {
  for (const value of ['auto','mandarin','wu','english']) assert.equal(language.normalizeSttLanguagePreference(value),value);
  assert.equal(language.normalizeSttLanguagePreference(null),'auto');
  assert.equal(language.isSpokenLanguageVariant('shanghainese'),true);
  assert.equal(language.isSpokenLanguageVariant('unknown'),false);
});
test('speech bridge retains manual selections and accepts old and new GPU responses', async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.LIVETALKING_SERVER_URL;
  const oldSecret = process.env.LIVETALKING_SESSION_SECRET;
  process.env.LIVETALKING_SERVER_URL = 'https://test.invalid';
  process.env.LIVETALKING_SESSION_SECRET = 'isolated-test-secret-not-a-real-credential';
  try {
    for (const dialect of ['english','wu','mandarin','auto']) {
      globalThis.fetch = async (_url,options) => {
        assert.equal(options.body.get('dialect'),dialect);
        return Response.json({code:0,data:{text:'Test'}});
      };
      const result = await speech.transcribeVoiceClip('test-persona',new File(['audio'],'clip.wav'),dialect);
      assert.equal(result.spokenVariant,dialect === 'auto' ? 'mandarin' : dialect);
      assert.equal(result.variantConfidence,null);
    }
    globalThis.fetch = async () => Response.json({code:0,data:{text:'侬好',spoken_variant:'shanghainese',variant_confidence:0.93}});
    assert.deepEqual(await speech.transcribeVoiceClip('test-persona',new File(['audio'],'clip.wav'),'auto'),{text:'侬好',spokenVariant:'shanghainese',variantConfidence:0.93});
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.LIVETALKING_SERVER_URL; else process.env.LIVETALKING_SERVER_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.LIVETALKING_SESSION_SECRET; else process.env.LIVETALKING_SESSION_SECRET = oldSecret;
  }
});
