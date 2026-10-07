import path from 'node:path';
import { WebSocketServer } from 'ws';
import { AdminAuth, adminConfigFromEnv } from './admin/auth';
import { LiveConfig } from './admin/liveConfig';
import { DEFAULT_CONFIG } from './config';
import { openDb } from './db/db';
import { createLlmProvider, createModerator, loadDialogueConfig } from './dialogueConfig';
import { buildHttp } from './http';
import { Lobby } from './lobby';
import { createServices } from './services';
import { FileHandLogStore } from './store';

const config = DEFAULT_CONFIG;
const dialogue = loadDialogueConfig();
const llm = createLlmProvider(dialogue);
const moderator = createModerator(dialogue);
const db = await openDb({ databaseUrl: process.env.DATABASE_URL, dataDir: path.join(config.dataDir, 'pglite') });
const services = createServices({ region: dialogue.region, db, dataDir: config.dataDir });
const lobby = new Lobby({ config, dialogue, llm, moderator, hands: new FileHandLogStore(config.dataDir), services });

// Admin-edited settings override the JSON defaults (PRD §34–§38).
const liveConfig = new LiveConfig(db, { region: dialogue.region, economy: services.economy, dialogue, server: config, llm });
await liveConfig.load();
const adminConfig = adminConfigFromEnv(process.env);
if (!adminConfig) console.warn('Admin dashboard disabled: set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET (pnpm --filter @mahjong/server admin:setup).');

const app = buildHttp(services, lobby, moderator, {
  admin: { auth: adminConfig ? new AdminAuth(db, adminConfig) : null, config: liveConfig, secureCookies: process.env.NODE_ENV === 'production' },
  trustProxy: process.env.TRUST_PROXY === '1',
});
await app.ready();
const wss = new WebSocketServer({ server: app.server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (socket) => lobby.handleConnection(socket));

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Region: ${dialogue.region}; dialogue provider: ${llm.name}; database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite'}`);
console.log(`Mahjong server on http://localhost:${config.port} (WebSocket /ws)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    lobby.closeAll();
    wss.close();
    await app.close();
    await db.close();
    process.exit(0);
  });
}
