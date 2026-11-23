// Unit tests for the engine's pure helpers (no browsers needed).   npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTargetUrl, mapDevUrlToProd, compileIgnoreRules } = require('../../playwright.js');

test('validateTargetUrl accepts http/https and normalizes', () => {
  assert.deepEqual(validateTargetUrl('http://localhost:3002'), { ok: true, url: 'http://localhost:3002/' });
  assert.equal(validateTargetUrl(' https://dev.example.com/app ').ok, true);
});

test('validateTargetUrl rejects unsafe targets', () => {
  for (const bad of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com',
    'http://169.254.169.254/latest/meta-data',
    'http://169.254.1.1/',
    'http://metadata.google.internal/',
    'http://user:pw@example.com/',
    'not a url',
    '',
  ]) {
    assert.equal(validateTargetUrl(bad).ok, false, `should reject ${bad}`);
  }
});

test('validateTargetUrl honours QA_VISION_ALLOWED_HOSTS', () => {
  const prev = process.env.QA_VISION_ALLOWED_HOSTS;
  process.env.QA_VISION_ALLOWED_HOSTS = 'example.com, localhost';
  try {
    assert.equal(validateTargetUrl('https://dev.example.com').ok, true);
    assert.equal(validateTargetUrl('http://localhost:3003').ok, true);
    assert.equal(validateTargetUrl('https://evil.com').ok, false);
    assert.equal(validateTargetUrl('https://notexample.com').ok, false);
  } finally {
    if (prev === undefined) delete process.env.QA_VISION_ALLOWED_HOSTS;
    else process.env.QA_VISION_ALLOWED_HOSTS = prev;
  }
});

test('mapDevUrlToProd maps path, query and hash onto the PROD base', () => {
  assert.equal(
    mapDevUrlToProd('http://localhost:3002/users?page=2#top', 'http://localhost:3002', 'http://localhost:3003'),
    'http://localhost:3003/users?page=2#top'
  );
  assert.equal(
    mapDevUrlToProd('https://dev.example.com/app/reports', 'https://dev.example.com/app', 'https://www.example.com/app'),
    'https://www.example.com/app/reports'
  );
  assert.equal(
    mapDevUrlToProd('https://example.com/dev/x', 'https://example.com/dev', 'https://example.com/prod'),
    'https://example.com/prod/x'
  );
});

test('mapDevUrlToProd refuses URLs outside the DEV base (never sends PROD elsewhere)', () => {
  assert.equal(mapDevUrlToProd('https://evil.com/', 'http://localhost:3002', 'http://localhost:3003'), null);
  assert.equal(mapDevUrlToProd('https://example.com/devtools', 'https://example.com/dev', 'https://example.com/prod'), null);
  assert.equal(mapDevUrlToProd('garbage', 'http://localhost:3002', 'http://localhost:3003'), null);
});

test('ignore rules: timestamp / session-id / numbers normalize values', () => {
  const r = compileIgnoreRules(['timestamp', 'session-id', 'numbers']);
  assert.equal(r.active, true);
  assert.equal(r.normalize('Updated 2026-11-23T10:15:00Z'), r.normalize('Updated 2025-01-01T00:00:00Z'));
  assert.equal(r.normalize('id 3f2b8c1e-1111-4a2b-9c3d-abcdefabcdef'), r.normalize('id 00000000-2222-4a2b-9c3d-123456789012'));
  assert.equal(r.normalize('1,250 users'), r.normalize('1,248 users'));
  assert.notEqual(r.normalize('Active users'), r.normalize('Inactive users'));
});

test('ignore rules: regex normalizes, text excludes, no rules = inactive', () => {
  const r = compileIgnoreRules(['regex:v\\d+\\.\\d+', 'text:environment', 'Beta banner']);
  assert.equal(r.normalize('Release v1.2'), r.normalize('Release v3.4'));
  assert.equal(r.exclude({ component: 'banner', devValue: 'DEVELOPMENT ENVIRONMENT', prodValue: 'PRODUCTION ENVIRONMENT' }), 'text:environment');
  assert.equal(r.exclude({ component: 'Beta banner', devValue: 'x', prodValue: 'y' }), 'text:beta banner');
  assert.equal(r.exclude({ component: 'Login', devValue: 'a', prodValue: 'b' }), null);
  assert.equal(compileIgnoreRules([]).active, false);
  assert.doesNotThrow(() => compileIgnoreRules(['regex:(unclosed']));
});
