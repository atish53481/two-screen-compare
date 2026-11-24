// Background AI analysis must merge only `ai` into the stored run and must not run twice.
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.QA_VISION_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-ai-'));
const { engine, DEV_URL, PROD_URL, runSuite } = require('./helpers');
const { openStore } = require('../../engine-dist/engine/store.js');

runSuite('AI background merge', async ({ check }) => {
  const prompts = [];
  engine.aiProviderFactory = () => ({
    name: 'fake', model: 'fake-1',
    complete: async (system, user) => {
      prompts.push(user);
      await new Promise((r) => setTimeout(r, 600));
      return JSON.stringify({ results: [{ id: 'f1', explanation: 'e', observedFacts: ['a'], hypotheses: ['b'], proposedClassification: 'MATCH' }] });
    },
  });
  const id = await engine.createSession(DEV_URL, PROD_URL, { projectName: 'ai-race' });
  const s = engine.getSession(id);
  s.mismatches.push({ id: 'f1', fingerprint: 'fp-f1', type: 'Text', component: 'h1', devValue: 'a', prodValue: 'b', severity: 'low', description: 'd', classification: 'POTENTIAL_DEFECT', confidence: 0.8, page: '/', timestamp: '', firstSeen: '', lastSeen: '', occurrences: 1 });
  await engine.closeSession(id); // archives; AI starts in background
  const m = await engine.markExpected({ runId: id }, 'f1', true, 'race');
  check('runId mark-expected succeeds while AI is running', m.ok);
  await engine.aiPending;
  const run = openStore(path.join(process.env.QA_VISION_DATA_DIR, 'qa-vision.db')).getRun(id);
  const f = run.mismatches.find((x) => x.id === 'f1');
  check('AI result stored', f.ai && f.ai.status === 'ok', JSON.stringify(f.ai));
  check('mark made during AI run survives', f.classification === 'EXPECTED_DIFFERENCE', f.classification);
  check('AI proposal did not change classification', f.ai.proposedClassification === 'MATCH' && f.classification !== 'MATCH');
  check('one analysis pass only (batches of 10, no repeat)', prompts.length === Math.ceil(run.mismatches.length / 10), prompts.length + ' calls for ' + run.mismatches.length + ' findings');
  engine.aiProviderFactory = () => null;
});
