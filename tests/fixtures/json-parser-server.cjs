// Disposable parser fixture: loopback only, no database, credentials or .env.
// No uncaughtException handler: decoder regressions must fail the child process.
const express = require('express');
const { once } = require('node:events');
const app = express();
app.use(express.json({ limit: '50mb' })); // Keep aligned with server.js.
app.post('/echo', (req, res) => res.json({ body: req.body }));
app.post('/wait-for-end', async (req, res) => {
  process.send({ parsed: true });
  if (!req.readableEnded) await once(req, 'end');
  res.json({ body: req.body });
});
app.get('/healthz', (req, res) => res.json({ ready: true }));
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ type: err.type }));
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', message => {
  if (message === 'stop') {
    server.close(() => process.disconnect());
    server.closeAllConnections();
  }
});
