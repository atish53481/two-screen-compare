const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const playwrightModule = require('./playwright.js');
const comparisonEngine = playwrightModule.default || playwrightModule.comparisonEngine || playwrightModule;

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3001;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
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
    // Only the QA Vision dashboard itself may subscribe to live logs/mismatches
    cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] }
  });

  // Attach Socket.IO to the comparison engine
  comparisonEngine.setSocketIO(io);

  io.on('connection', (socket) => {
    console.log('✅ QA Vision client connected for real-time updates');
    socket.emit('status', { message: 'Real-time synchronization active' });
  });

  httpServer.listen(port, () => {
    console.log(`🚀 QA Vision AI Production Server running at http://${hostname}:${port}`);
    console.log('🔌 Socket.IO ready for real-time mismatch & log updates');
    console.log('🎮 Real Playwright synchronization enabled');
  });
});
