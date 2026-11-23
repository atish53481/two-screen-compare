// Shared helpers for the end-to-end suites. Suites drive the real engine with headless
// Chromium against the sample apps (started by tests/run-e2e.js).
process.env.QA_VISION_HEADLESS = process.env.QA_VISION_HEADLESS || '1';

const engine = require('../../playwright.js').default;

const DEV_URL = process.env.QA_DEV_URL || 'http://localhost:3002';
const PROD_URL = process.env.QA_PROD_URL || 'http://localhost:3003';
// Credentials accepted by the bundled sample apps (fixtures, not real secrets)
const SAMPLE_EMAIL = 'test@acme.com';
const SAMPLE_PASSWORD = 'password123';

function createReporter(suite) {
  const results = [];
  console.log(`\n▶ ${suite}`);
  return {
    check(name, ok, extra = '') {
      results.push(Boolean(ok));
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
    },
    finish() {
      const failed = results.filter((x) => !x).length;
      console.log(`  ${results.length - failed}/${results.length} checks passed`);
      return failed;
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the session's action queue has drained (replays + comparisons done). */
async function idle(session, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    await session.actionQueue;
    await sleep(400);
    if (session.pendingActions === 0) {
      await session.actionQueue;
      return;
    }
  }
}

async function waitForLoginForm(session) {
  await session.devPage.waitForSelector('[data-testid="login-email"]');
  await session.prodPage.waitForSelector('[data-testid="login-email"]');
}

/** Run a suite body, always closing browsers, and exit with a status code. */
function runSuite(name, body) {
  const reporter = createReporter(name);
  body(reporter)
    .then(async () => {
      await engine.closeAllSessions().catch(() => {});
      process.exit(reporter.finish() ? 1 : 0);
    })
    .catch(async (err) => {
      console.error(`  CRASH  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`);
      await engine.closeAllSessions().catch(() => {});
      process.exit(2);
    });
}

module.exports = { engine, DEV_URL, PROD_URL, SAMPLE_EMAIL, SAMPLE_PASSWORD, sleep, idle, waitForLoginForm, runSuite };
