const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFindings, redactForAi, buildPrompt, providerFromEnv } = require('../../engine-dist/engine/ai.js');

const SENS = /pass|pwd|secret|token|otp|cvv|cvc|card.?num|cc-|ssn|pin\b/i;
const mk = (id, extra = {}) => ({
  id, type: 'Text', component: 'h1', devValue: 'a', prodValue: 'b', severity: 'low',
  description: 'differs', classification: 'POTENTIAL_DEFECT', confidence: 0.8,
  page: '/home', stepIds: ['s1'], fingerprint: 'fp' + id, timestamp: '', firstSeen: '', lastSeen: '', occurrences: 1,
  devScreenshotPath: 'C:/x/dev.png', ...extra,
});
const opts = { timeoutMs: 1000, maxFindings: 40, batchSize: 10 };
const fake = (fn) => ({ name: 'fake', model: 'fake-1', complete: async (s, u, sig) => fn(s, u, sig) });

test('no provider -> unavailable, no throw', async () => {
  const m = await analyzeFindings([mk('1')], null, opts);
  assert.equal(m.get('1').status, 'unavailable');
});

test('provider timeout leaves findings intact', async () => {
  const input = [mk('1')];
  const clone = JSON.parse(JSON.stringify(input));
  const p = fake(() => new Promise(() => {}));
  const m = await analyzeFindings(input, p, { ...opts, timeoutMs: 50 });
  assert.equal(m.get('1').status, 'error');
  assert.deepEqual(input, clone);
});

test('malformed JSON -> error', async () => {
  const m = await analyzeFindings([mk('1')], fake(async () => 'not json {'), opts);
  assert.equal(m.get('1').status, 'error');
});

test('AI proposed classification is advisory', async () => {
  const input = [mk('1')];
  const p = fake(async () => JSON.stringify({ results: [{ id: '1', explanation: 'e', observedFacts: ['f'], hypotheses: ['h'], suggestedInvestigation: [], additionalTests: [], proposedClassification: 'EXPECTED_DIFFERENCE', confidence: 0.4 }] }));
  const m = await analyzeFindings(input, p, opts);
  assert.equal(m.get('1').status, 'ok');
  assert.equal(m.get('1').proposedClassification, 'EXPECTED_DIFFERENCE');
  assert.equal(input[0].classification, 'POTENTIAL_DEFECT');
  assert.equal(input[0].ai, undefined);
});

test('invalid proposedClassification dropped', async () => {
  const p = fake(async () => '```json\n' + JSON.stringify({ results: [{ id: '1', explanation: 'e', proposedClassification: 'DELETE_ALL' }] }) + '\n```');
  const m = await analyzeFindings([mk('1')], p, opts);
  assert.equal(m.get('1').status, 'ok');
  assert.equal(m.get('1').proposedClassification, undefined);
});

test('redactForAi strips sensitive values', () => {
  const f = mk('1', { devValue: 'mail test@acme.com', prodValue: 'abcdef1234567890XYZ', description: 'id 123456789012 [redacted] 3f2b8c1e-1111-2222-3333-444455556666', page: '/p?token=abc&x=1' });
  const out = JSON.stringify(redactForAi(f, SENS));
  assert.ok(!out.includes('test@acme.com'));
  assert.ok(!out.includes('abcdef1234567890XYZ'));
  assert.ok(!out.includes('123456789012'));
  assert.ok(!out.includes('dev.png'));
  assert.ok(!out.includes('token=abc'));
  assert.ok(out.includes('<redacted>'));
});

test('prompt system text requires facts vs hypotheses', () => {
  const { system } = buildPrompt([{ id: '1' }]);
  assert.match(system, /observed facts/i);
  assert.match(system, /hypotheses/i);
  assert.match(system, /never suggest deploying/i);
});

test('providerFromEnv', () => {
  assert.equal(providerFromEnv({}), null);
  assert.equal(providerFromEnv({ QA_VISION_AI_PROVIDER: 'anthropic' }), null);
  assert.equal(providerFromEnv({ QA_VISION_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).model, 'claude-opus-5-5');
  assert.equal(providerFromEnv({ QA_VISION_AI_PROVIDER: 'openai-compatible', QA_VISION_AI_BASE_URL: 'https://x/v1', QA_VISION_AI_API_KEY: 'k', QA_VISION_AI_MODEL: 'grok' }).name, 'openai-compatible');
});

test('redactForAi removes secrets in header/JSON/fragment shapes', () => {
  const cases = [
    ['{"password":"hunter2"}', 'hunter2'],
    ['Authorization: Bearer abc123xyz', 'abc123xyz'],
    ['Cookie: sid=s3cr3tval', 's3cr3tval'],
    ['x-api-key: shortkey9', 'shortkey9'],
    ['see /cb#access=zzz111', 'zzz111'],
  ];
  for (const [text, secret] of cases) {
    const out = JSON.stringify(redactForAi(mk('1', { devValue: text, description: text }), SENS));
    assert.ok(!out.includes(secret), `${secret} leaked from ${text}: ${out}`);
  }
});

test('long and numerous reply strings are capped', async () => {
  const big = 'x'.repeat(5000);
  const p = fake(async () => JSON.stringify({ results: [{ id: '1', explanation: big, observedFacts: Array(30).fill(big) }] }));
  const a = (await analyzeFindings([mk('1')], p, opts)).get('1');
  assert.equal(a.explanation.length, 2000);
  assert.equal(a.observedFacts.length, 10);
  assert.equal(a.observedFacts[0].length, 500);
});
