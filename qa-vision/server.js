const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const playwrightModule = require('./playwright.js');
const comparisonEngine = playwrightModule.default || playwrightModule.comparisonEngine || playwrightModule;

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.QA_VISION_HOST || '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// DNS-rebinding guard: only loopback names (or the explicitly configured QA_VISION_HOST) may be used in the Host header.
function hostAllowed(hostHeader) {
  if (!hostHeader) return false;
  let name;
  try {
    name = new URL('http://' + hostHeader).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Loopback names are always allowed, so the dashboard stays reachable on this machine
  // even when QA_VISION_HOST opens it to a trusted network.
  if (LOOPBACK_HOSTS.has(name)) return true;
  const configured = process.env.QA_VISION_HOST && process.env.QA_VISION_HOST.toLowerCase().replace(/^\[|\]$/g, '');
  return !!configured && name.replace(/^\[|\]$/g, '') === configured;
}
const port = Number(process.env.QA_VISION_PORT) || 3001;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('forbidden: unexpected Host header');
      return;
    }
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(httpServer, {
    path: '/socket.io',
    allowRequest: (req, cb) => cb(null, hostAllowed(req.headers.host)),
    // Only the QA Vision dashboard itself may subscribe to live logs/mismatches
    cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://${hostname}:${port}`] }
  });

  // Attach Socket.IO to the comparison engine
  comparisonEngine.setSocketIO(io);

  io.on('connection', (socket) => {
    console.log('✅ QA Vision client connected for real-time updates');
    socket.emit('status', { message: 'Real-time synchronization active' });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`🚀 QA Vision AI Production Server running at http://${hostname}:${port}`);
    console.log('🔌 Socket.IO ready for real-time mismatch & log updates');
    console.log('🎮 Real Playwright synchronization enabled');
  });
});
