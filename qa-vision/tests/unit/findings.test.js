const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, classifyFinding } = require('../../engine-dist/engine/findings.js');

test('explicit classification wins', () => {
  assert.deepEqual(classifyFinding({ type: 'Safety', classification: 'SKIPPED_BY_SAFETY_POLICY' }, new Set(), 'x'),
    { classification: 'SKIPPED_BY_SAFETY_POLICY', confidence: 1, ruleApplied: null });
});
test('expected fingerprint marks EXPECTED_DIFFERENCE with provenance', () => {
  const r = classifyFinding({ type: 'Text' }, new Set(['fp1']), 'fp1');
  assert.equal(r.classification, 'EXPECTED_DIFFERENCE'); assert.equal(r.ruleApplied, 'expected:fp1');
});
test('content difference defaults to POTENTIAL_DEFECT', () => {
  assert.equal(classifyFinding({ type: 'CSS' }, new Set(), 'z').classification, 'POTENTIAL_DEFECT');
});
test('confidence by category', () => {
  assert.equal(classifyFinding({ type: 'Text' }, new Set(), 'z').confidence, 0.9);
  assert.equal(classifyFinding({ type: 'Layout' }, new Set(), 'z').confidence, 0.75);
  assert.equal(classifyFinding({ type: 'Visual' }, new Set(), 'z').confidence, 0.6);
});
test('fingerprint is stable and includes property', () => {
  const a = fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'color' });
  assert.equal(a, fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'color' }));
  assert.notEqual(a, fingerprint('/', { type: 'CSS', component: 'btn', devValue: 'red', prodValue: 'blue', property: 'background-color' }));
});
