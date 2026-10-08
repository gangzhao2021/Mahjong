/**
 * Load test: N bot players each play full games at human-like pace against a
 * running server, while the script measures how quickly the server answers
 * (HTTP /health round-trip, a proxy for event-loop delay) and its memory.
 *
 *   pnpm --filter @mahjong/server loadtest -- --tables 200 --seconds 120 --url http://localhost:8787
 *
 * The server must allow that many sign-ins from one address: start it with
 * AUTH_RATE_LIMIT set above --tables.
 */
import { chooseAction } from '@mahjong/ai-play';
import { createRng } from '@mahjong/engine';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@mahjong/protocol';
import { WebSocket } from 'ws';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const TABLES = Number(args.get('tables') ?? 50);
const SECONDS = Number(args.get('seconds') ?? 60);
const URL = (args.get('url') ?? 'http://localhost:8787').replace(/\/$/, '');
/** Human think time per decision. */
const THINK_MS: [number, number] = [800, 2500];

const rng = createRng(42);
const stats = { decisions: 0, hands: 0, games: 0, errors: 0, disconnects: 0, actionLatency: [] as number[] };

async function bot(i: number): Promise<WebSocket> {
  const res = await fetch(`${URL}/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: `loadtest-${i}-${Date.now()}` }) });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  const ws = new WebSocket(`${URL.replace(/^http/, 'ws')}/ws`);
  const send = (m: ClientMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  let actedVersion = -1;
  let sentAt = 0;
  ws.on('open', () => send({ type: 'hello', token, protocol: PROTOCOL_VERSION }));
  ws.on('close', () => stats.disconnects++);
  ws.on('error', () => stats.errors++);
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as ServerMessage;
    if (m.type === 'welcome') send({ type: 'startGame', options: { tableId: 'practice' } });
    else if (m.type === 'error') stats.errors++;
    else if (m.type === 'table') {
      const t = m.table;
      if (sentAt && t.view.version > actedVersion) {
        stats.actionLatency.push(performance.now() - sentAt);
        sentAt = 0;
      }
      if (t.gameOver) {
        stats.games++;
        setTimeout(() => send({ type: 'startGame', options: { tableId: 'practice' } }), 1000);
        return;
      }
      if (t.view.phase === 'ended') {
        stats.hands++;
        setTimeout(() => send({ type: 'nextHand' }), 1500);
        return;
      }
      if (!Object.keys(t.view.legal).length || actedVersion === t.view.version) return;
      actedVersion = t.view.version;
      const version = t.view.version;
      const delay = THINK_MS[0] + rng() * (THINK_MS[1] - THINK_MS[0]);
      setTimeout(() => {
        const action = chooseAction(t.view, 'intermediate', rng);
        if (!action) return;
        const { seat: _seat, ...intent } = action;
        stats.decisions++;
        sentAt = performance.now();
        send({ type: 'action', action: intent, version });
      }, delay);
    }
  });
  return ws;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

console.log(`Load test: ${TABLES} tables for ${SECONDS}s against ${URL}`);
const sockets: WebSocket[] = [];
const rampStart = Date.now();
for (let i = 0; i < TABLES; i += 50) {
  const batch = await Promise.allSettled(Array.from({ length: Math.min(50, TABLES - i) }, (_, k) => bot(i + k)));
  for (const r of batch) {
    if (r.status === 'fulfilled') sockets.push(r.value);
    else if (++stats.errors <= 3) console.error('bot:', r.reason instanceof Error ? r.reason.message : r.reason);
  }
}
console.log(`Ramp-up: ${sockets.length} tables in ${((Date.now() - rampStart) / 1000).toFixed(1)}s; measuring from now`);
// Measure the steady state only.
Object.assign(stats, { decisions: 0, hands: 0, games: 0, actionLatency: [] });

const health: number[] = [];
const probe = setInterval(async () => {
  const start = performance.now();
  try {
    await fetch(`${URL}/health`);
    health.push(performance.now() - start);
  } catch {
    stats.errors++;
  }
}, 250);

const started = Date.now();
const report = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`${s}s  decisions ${stats.decisions}  hands ${stats.hands}  /health p50 ${pct(health, 50).toFixed(1)} ms p99 ${pct(health, 99).toFixed(1)} ms`);
}, 10_000);

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(probe);
clearInterval(report);
for (const ws of sockets) ws.close();

console.log('\nResult');
console.log(`  tables              ${TABLES}`);
console.log(`  player decisions    ${stats.decisions} (${(stats.decisions / SECONDS).toFixed(1)}/s)`);
console.log(`  hands finished      ${stats.hands}`);
console.log(`  /health latency     p50 ${pct(health, 50).toFixed(1)} ms, p99 ${pct(health, 99).toFixed(1)} ms, max ${Math.max(0, ...health).toFixed(1)} ms`);
console.log(`  action → new table  p50 ${pct(stats.actionLatency, 50).toFixed(1)} ms, p99 ${pct(stats.actionLatency, 99).toFixed(1)} ms`);
console.log(`  errors              ${stats.errors}, unexpected disconnects ${stats.disconnects - TABLES < 0 ? 0 : stats.disconnects - TABLES}`);
process.exit(0);
