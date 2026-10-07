import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { DEFAULT_CONFIG } from './config';
import { Lobby } from './lobby';
import { FileHandLogStore, FilePlayerStore } from './store';

const config = DEFAULT_CONFIG;
const lobby = new Lobby({
  config,
  hands: new FileHandLogStore(config.dataDir),
  players: new FilePlayerStore(config.dataDir),
});

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
wss.on('connection', (socket) => lobby.handleConnection(socket));

http.listen(config.port, () => {
  console.log(`Mahjong server listening on ws://localhost:${config.port} (data: ${config.dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    lobby.closeAll();
    wss.close();
    http.close(() => process.exit(0));
  });
}
