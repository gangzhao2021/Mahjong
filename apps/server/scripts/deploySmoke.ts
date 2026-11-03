/**
 * Checks a running deployment end to end: signs in, plays a real two-hand coin
 * game over WebSocket, restarts the server mid-game (if told how), and confirms
 * the game resumes and that coins, ledger and hand history all add up.
 *
 *   pnpm --filter @mahjong/server smoke:deploy --url https://api.example.com
 *   pnpm --filter @mahjong/server smoke:deploy --restart "docker compose restart server"
 *
 * Creates one guest account and deletes it at the end. Exits non-zero on any failure.
 */
import { chooseAction } from '@mahjong/ai-play';
import { createRng } from '@mahjong/engine';
import { PROTOCOL_VERSION, type AccountSummary, type ClientMessage, type ServerMessage } from '@mahjong/protocol';
import { execSync } from 'node:child_process';
import { WebSocket } from 'ws';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const URL = (args.get('url') ?? 'http://localhost:8787').replace(/\/$/, '');
const RESTART = args.get('restart');
const TIMEOUT_MS = Number(args.get('timeout') ?? 600) * 1000;

const rng = createRng(1);
const step = (text: string) => console.log(`ok  ${text}`);
function fail(text: string): never {
  console.error(`FAIL ${text}`);
  process.exit(1);
}

async function http<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${URL}${path}`, { ...init, headers });
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as T) : (undefined as T);
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${URL}/health/ready`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail('server did not become ready within 2 minutes');
}

interface Outcome {
  gameOver: boolean;
  /** The WebSocket dropped before the game ended. */
  dropped: boolean;
}

/** Plays until the game is over, or (with `stopAtHand`) until that hand has been reached. */
function play(token: string, start: boolean, stopAtHand: number | null): Promise<Outcome> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${URL.replace(/^http/, 'ws')}/ws`);
    const send = (m: ClientMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    let acted = -1;
    let done = false;
    const finish = (gameOver: boolean, dropped: boolean) => {
      if (done) return;
      done = true;
      ws.close();
      resolve({ gameOver, dropped });
    };
    ws.on('open', () => send({ type: 'hello', token, protocol: PROTOCOL_VERSION }));
    ws.on('close', () => finish(false, true));
    ws.on('error', () => finish(false, true));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      if (m.type === 'welcome') {
        if (start) send({ type: 'startGame', options: { private: { baseScore: 10, handsPerGame: 2 } } });
        else if (!m.inGame) fail('the game was not there after reconnecting');
        send({ type: 'setFastPace', on: true });
      } else if (m.type === 'error' && m.code !== 'illegalAction') fail(`server error: ${m.code} ${m.message}`);
      else if (m.type === 'startRejected') fail(`game rejected: ${m.reason}`);
      else if (m.type === 'table') {
        const t = m.table;
        if (t.gameOver) return finish(true, false);
        if (stopAtHand !== null && t.handIndex >= stopAtHand && t.view.phase !== 'ended') return finish(false, false);
        if (t.view.phase === 'ended') return void send({ type: 'nextHand' });
        if (!Object.keys(t.view.legal).length || acted === t.view.version) return;
        acted = t.view.version;
        const action = chooseAction(t.view, 'intermediate', rng);
        if (!action) return;
        const { seat: _seat, ...intent } = action;
        send({ type: 'action', action: intent, version: t.view.version });
      }
    });
  });
}

const timer = setTimeout(() => fail(`not finished after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);

await waitReady();
step('/health/ready');
for (const page of ['/config', '/legal/privacy', '/legal/terms', '/legal/sdks']) await http(page);
step('config and legal pages');

const deviceId = `deploy-smoke-${Date.now()}`;
const { token, account } = await http<{ token: string; account: AccountSummary }>('/auth/guest', { method: 'POST', body: JSON.stringify({ deviceId }) });
step(`guest sign-in, ${account.balance} coins`);

let result: Outcome;
if (RESTART) {
  const first = await play(token, true, 1);
  if (first.dropped) fail('connection lost during the first hand');
  step('played a hand with coins at stake');
  execSync(RESTART, { stdio: 'inherit' });
  await waitReady();
  step('restarted the server mid-game');
  result = await play(token, false, null);
  step('the game resumed after the restart');
} else {
  result = await play(token, true, null);
}
if (!result.gameOver) fail('connection lost before the game ended');
step('game finished');

interface Ledger {
  entries: { amount: number; type: string; ref: string | null }[];
}
interface Hand {
  gameId: string;
  handIndex: number;
  mySeat: number;
  deltas: number[];
}
// A hand with no net change writes no ledger row, so compare against the history, hand by hand.
const settlementProblem = (hands: Hand[], ledger: Ledger): string | null => {
  if (hands.length !== 2) return `expected 2 hands in the history, found ${hands.length}`;
  const rows = ledger.entries.filter((e) => e.type === 'handSettlement');
  const expected = hands.filter((h) => h.deltas[h.mySeat] !== 0);
  for (const h of expected) {
    const row = rows.filter((e) => e.ref === `${h.gameId}:${h.handIndex}`);
    if (row.length !== 1 || row[0].amount !== h.deltas[h.mySeat]) return `hand ${h.handIndex} won or lost ${h.deltas[h.mySeat]}, ledger has ${JSON.stringify(row)}`;
  }
  return rows.length === expected.length ? null : `${rows.length} settlements for ${expected.length} hands with a result`;
};
// The last hand settles just after the final table goes out.
let hands: Hand[] = [];
let ledger: Ledger = { entries: [] };
let problem: string | null = 'not read yet';
for (let i = 0; i < 30 && problem; i++) {
  if (i) await new Promise((r) => setTimeout(r, 1000));
  hands = (await http<{ hands: Hand[] }>('/history', {}, token)).hands;
  ledger = await http<Ledger>('/ledger?limit=200', {}, token);
  problem = settlementProblem(hands, ledger);
}
if (problem) fail(problem);
const after = (await http<{ account: AccountSummary }>('/account', {}, token)).account;
const sum = ledger.entries.reduce((acc, e) => acc + e.amount, 0);
if (sum !== after.balance) fail(`ledger adds up to ${sum}, balance is ${after.balance}`);
step(`each hand with a result settled once; ledger matches the balance (${after.balance} coins)`);

await http(`/history/${hands[0].gameId}/${hands[0].handIndex}`, {}, token);
step('hand history and replay');

const { relations } = await http<{ relations: unknown[] }>('/relationships', {}, token);
if (!relations.length) fail('no AI memory was written');
step(`AI memory (${relations.length} characters)`);

await http('/account', { method: 'DELETE' }, token);
step('account deleted');
clearTimeout(timer);
console.log('All checks passed.');
process.exit(0);
