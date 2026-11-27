// Unit tests for the engine's pure helpers (no browsers needed).   npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTargetUrl, mapDevUrlToProd, onSharedOutsideHost, compileIgnoreRules } = require('../../playwright.js');

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

test('mapDevUrlToProd keeps exact path (no forced trailing slash) and carries clientId from base', () => {
  assert.equal(
    mapDevUrlToProd(
      'https://appalpha.bruin.com/sdwan-dashboard',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937',
      'https://app.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://app.bruin.com/sdwan-dashboard?clientId=86937'
  );
  assert.equal(
    mapDevUrlToProd(
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937',
      'https://app.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://app.bruin.com/sdwan-dashboard?clientId=86937'
  );
});

test('mapDevUrlToProd maps same-origin SSO callbacks and refuses unrelated outside paths', () => {
  assert.equal(
    mapDevUrlToProd(
      'https://appalpha.bruin.com/signin-kinde?code=abc',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937',
      'https://app.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://app.bruin.com/signin-kinde?code=abc&clientId=86937'
  );
  assert.equal(mapDevUrlToProd('https://evil.com/', 'http://localhost:3002', 'http://localhost:3003'), null);
  assert.equal(mapDevUrlToProd('https://example.com/devtools', 'https://example.com/dev', 'https://example.com/prod'), null);
  assert.equal(mapDevUrlToProd('garbage', 'http://localhost:3002', 'http://localhost:3003'), null);
});

test('mergeBaseQuery fills missing profile query params on the same origin', () => {
  const { mergeBaseQuery } = require('../../playwright.js');
  assert.equal(
    mergeBaseQuery(
      'https://appalpha.bruin.com/sdwan-dashboard',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937'
  );
  assert.equal(
    mergeBaseQuery(
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937&x=1',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937&x=1'
  );
  assert.equal(
    mergeBaseQuery('https://other.com/x', 'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937'),
    'https://other.com/x'
  );
});

test('mergeBaseQuery replaces clientId=0 placeholder with profile clientId', () => {
  const { mergeBaseQuery } = require('../../playwright.js');
  assert.equal(
    mergeBaseQuery(
      'https://appalpha.bruin.com/piab-dashboard?clientId=0',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://appalpha.bruin.com/piab-dashboard?clientId=86937'
  );
});

test('mapDevUrlToProd maps sibling SPA routes when bases share the same path', () => {
  assert.equal(
    mapDevUrlToProd(
      'https://appalpha.bruin.com/piab-dashboard?clientId=86937',
      'https://appalpha.bruin.com/sdwan-dashboard?clientId=86937',
      'https://app.bruin.com/sdwan-dashboard?clientId=86937'
    ),
    'https://app.bruin.com/piab-dashboard?clientId=86937'
  );
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

test('onSharedOutsideHost: both apps on the same SSO host count as aligned', () => {
  const dev = 'https://appalpha.bruin.com/dashboard';
  const prod = 'https://app.bruin.com/dashboard';
  assert.equal(
    onSharedOutsideHost('https://auth.bruin.com/auth/cx/login?psid=a1', 'https://auth.bruin.com/auth/cx/login?psid=b2', dev, prod),
    true
  );
  // Different outside hosts, PROD still on its base, or DEV inside its base: not shared
  assert.equal(onSharedOutsideHost('https://auth.bruin.com/x', 'https://login.other.com/x', dev, prod), false);
  assert.equal(onSharedOutsideHost('https://auth.bruin.com/x', 'https://app.bruin.com/dashboard', dev, prod), false);
  assert.equal(onSharedOutsideHost('https://appalpha.bruin.com/dashboard/a', 'https://appalpha.bruin.com/dashboard/a', dev, prod), false);
  assert.equal(onSharedOutsideHost('about:blank', 'about:blank', dev, prod), false);
});

test('urlForAddressBar keeps the full URL (query + fragment) and masks only credential values', () => {
  const { urlForAddressBar } = require('../../playwright.js');
  const authorize =
    'https://login.example.com/oauth2/authorize?client_id=abc-123&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid%20profile&state=xyz';
  assert.equal(urlForAddressBar(authorize), authorize);
  assert.equal(urlForAddressBar('https://app.example.com/cb?code=SECRET&state=xyz'), 'https://app.example.com/cb?code=***&state=xyz');
  assert.equal(
    urlForAddressBar('https://app.example.com/#access_token=TOK&token_type=Bearer&expires_in=3600'),
    'https://app.example.com/#access_token=***&token_type=Bearer&expires_in=3600'
  );
  assert.equal(urlForAddressBar('https://user:pw@app.example.com/x?a=1#section-2'), 'https://app.example.com/x?a=1#section-2');
  assert.equal(urlForAddressBar('not a url'), '(invalid url)');
});
