// Orphan reaper: sessions that no dashboard socket has watched for QA_VISION_ORPHAN_TIMEOUT_MS are closed
// through the normal closeSession path (run persisted). A connected socket, or a reconnect in time, prevents it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
process.env.QA_VISION_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qav-reaper-'));
process.env.QA_VISION_ORPHAN_TIMEOUT_MS = '2500';
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { openStore } = require('../../engine-dist/engine/store.js');
const { engine, DEV_URL, PROD_URL, sleep, runSuite } = require('./helpers');

const waitFor = async (fn, ms) => {
  for (const t = Date.now(); Date.now() - t < ms; ) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};

runSuite('Orphan reaper', async ({ check }) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  engine.setSocketIO(io);
  const open = (name) => engine.createSession(DEV_URL, PROD_URL, { projectName: name, startImmediately: false });
  const dial = () =>
    new Promise((resolve) => {
      const s = connect(url, { transports: ['websocket'], reconnection: false });
      s.on('connect', () => resolve(s));
    });

  // 1. Connected socket: never reaped, even well past the timeout
  const a = await open('reaper-watched');
  const sock = await dial();
  await sleep(4000);
  check('a connected socket keeps the session alive past the timeout', !!engine.getPhase(a));

  // 2. Reconnect within the timeout cancels the reap
  sock.close();
  await waitFor(() => io.engine.clientsCount === 0, 3000);
  await sleep(1200);
  const sock2 = await dial();
  await sleep(3500);
  check('a reconnect before the timeout cancels the reap', !!engine.getPhase(a));

  // 3. No sockets for the timeout: closed through closeSession, run persisted, reason logged
  sock2.close();
  const t0 = Date.now();
  const reaped = await waitFor(() => !engine.getPhase(a), 12000);
  const took = Date.now() - t0;
  check('no socket for the timeout closes the session', reaped, `${took}ms`);
  check('not reaped before the timeout elapsed', took >= 2000, `${took}ms`);
  const run = openStore().getRun(a);
  check('the reaped run is persisted', !!run);
  check('the reason is logged', !!run && run.logs.some((l) => /Session closed: no dashboard connected for/.test(l.action)));

  // 4. A session opened while nobody is connected is reaped too
  const b = await open('reaper-never-watched');
  check('session opened with no sockets is reaped', await waitFor(() => !engine.getPhase(b), 12000) && !!openStore().getRun(b));

  io.close();
  httpServer.close();
});
