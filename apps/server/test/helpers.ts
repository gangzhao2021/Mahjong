import { chooseAction } from '@mahjong/ai-play';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type TableSnapshot } from '@mahjong/protocol';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { SmsSender } from '../src/accounts/providers';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { createModerator, loadDialogueConfig, type DialogueConfig, type Region } from '../src/dialogueConfig';
import type { EconomyConfig } from '../src/economy/config';
import { AdminAuth, type AdminAuthConfig } from '../src/admin/auth';
import { LiveConfig } from '../src/admin/liveConfig';
import { buildHttp, type IdentityVerifiers } from '../src/http';
import { NoLlm, type LlmProvider } from '../src/llm/provider';
import { Lobby } from '../src/lobby';
import { createServices, type Services } from '../src/services';
import { MemoryHandLogStore } from '../src/store';

export const FAST: ServerConfig = {
  ...DEFAULT_CONFIG,
  timers: { swapMs: 40, dingqueMs: 40, discardMs: 40, claimMs: 40, nextHandMs: 30, nextHandAutoPlayMs: 10 },
  autoPlayDelayMs: 0,
  ai: { minDelayMs: 0, maxDelayMs: 2, beginnerExtraMs: 1 },
};

export interface TestServer {
  /** WebSocket URL. */
  url: string;
  /** HTTP base URL. */
  http: string;
  lobby: Lobby;
  hands: MemoryHandLogStore;
  services: Services;
  close(): Promise<void>;
}

export interface TestServerOptions {
  llm?: LlmProvider;
  dialogue?: DialogueConfig;
  region?: Region;
  economy?: EconomyConfig;
  now?: () => Date;
  verifiers?: IdentityVerifiers;
  sms?: SmsSender;
  admin?: AdminAuthConfig;
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** Fake identity checks: the "token" is the subject, prefixed to prove it went through the verifier. */
export const FAKE_VERIFIERS: IdentityVerifiers = {
  apple: async (t) => `apple-${t}`,
  google: async (t) => `google-${t}`,
  wechat: async (c) => `wechat-${c}`,
};

export async function startServer(config = FAST, options: TestServerOptions = {}): Promise<TestServer> {
  const hands = new MemoryHandLogStore();
  let seed = 1;
  const region = options.region ?? 'global';
  const dialogue = options.dialogue ?? loadDialogueConfig(region);
  const db = await openDb({ dataDir: null });
  const services = createServices({
    region,
    db,
    dataDir: null,
    env: { SESSION_SECRET: 'test-secret-test-secret-test-secret!!' },
    economy: options.economy,
    now: options.now,
    sms: options.sms,
  });
  const moderator = createModerator(dialogue);
  const lobby = new Lobby({
    config,
    dialogue,
    llm: options.llm ?? new NoLlm(),
    moderator,
    hands,
    services,
    seed: () => seed++ * 7919,
  });
  const liveConfig = new LiveConfig(db, { region, economy: services.economy, dialogue, server: config, llm: options.llm ?? new NoLlm() });
  await liveConfig.load();
  const app = buildHttp(services, lobby, moderator, {
    verifiers: options.verifiers ?? FAKE_VERIFIERS,
    admin: { auth: options.admin ? new AdminAuth(db, options.admin, () => (options.now?.() ?? new Date()).getTime()) : null, config: liveConfig, secureCookies: false },
  });
  await app.ready();
  const wss = new WebSocketServer({ server: app.server, path: '/ws' });
  wss.on('connection', (s) => lobby.handleConnection(s));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const server: TestServer = {
    url: `ws://127.0.0.1:${port}/ws`,
    http: `http://127.0.0.1:${port}`,
    lobby,
    hands,
    services,
    close: async () => {
      lobby.closeAll();
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
      await app.close();
      await Promise.all([...lobby.settling]);
      await db.close();
    },
  };
  servers.push(server);
  return server;
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** Small JSON client for the HTTP API. */
export async function api<T = Record<string, any>>(server: TestServer, method: string, path: string, body?: unknown, token?: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${server.http}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

export async function guestLogin(server: TestServer, deviceId: string): Promise<string> {
  const res = await api<{ token: string }>(server, 'POST', '/auth/guest', { deviceId });
  if (res.status !== 200) throw new Error(`guest login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export class Client {
  readonly messages: ServerMessage[] = [];
  /** Messages before this index have been handed out by `next`. */
  private consumed = 0;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  onMessage: ((m: ServerMessage) => void) | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      const index = this.messages.push(m) - 1;
      this.onMessage?.(m);
      const waiter = this.waiters.find((w) => w.pred(m));
      if (waiter) {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        this.consumed = Math.max(this.consumed, index + 1);
        waiter.resolve(m);
      }
    });
  }

  private server: TestServer | null = null;

  static async connect(server: TestServer): Promise<Client> {
    const ws = new WebSocket(server.url);
    await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
    const client = new Client(ws);
    client.server = server;
    return client;
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  /** The next matching message, including ones that arrived since the last `next` returned. */
  next<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 20_000): Promise<T> {
    for (let i = this.consumed; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (pred(m)) {
        this.consumed = i + 1;
        return Promise.resolve(m);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for message; last: ${JSON.stringify(this.messages.slice(-3)).slice(0, 600)}`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  /** Logs in as a guest over HTTP, then says hello on the socket. */
  async hello(deviceId = 'device-test-1'): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    return this.helloWithToken(await guestLogin(this.server!, deviceId));
  }

  helloWithToken(token: string): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    const welcome = this.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    this.send({ type: 'hello', token, protocol: PROTOCOL_VERSION });
    return welcome;
  }

  close(): void {
    this.ws.close();
  }
}


export type TableMsg = Extract<ServerMessage, { type: 'table' }>;
export const isTable = (m: ServerMessage): m is TableMsg => m.type === 'table';
export const gameOver = (m: ServerMessage): m is TableMsg => isTable(m) && m.table.gameOver;

/** A bot "human" that answers every decision with the expert policy. */
export function playAsBot(client: Client): void {
  const acted = new Set<string>();
  const rng = Math.random;
  client.onMessage = (m) => {
    if (!isTable(m)) return;
    const t: TableSnapshot = m.table;
    if (t.view.phase === 'ended' && !t.gameOver) {
      client.send({ type: 'nextHand' });
      return;
    }
    const key = `${t.handIndex}:${t.view.version}`;
    if (acted.has(key)) return;
    const action = chooseAction(t.view, 'expert', rng);
    if (!action) return;
    acted.add(key);
    const { seat: _seat, ...rest } = action;
    client.send({ type: 'action', action: rest, version: t.view.version });
  };
}

