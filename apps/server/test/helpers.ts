import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@mahjong/protocol';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config';
import { createModerator, loadDialogueConfig, type DialogueConfig } from '../src/dialogueConfig';
import { NoLlm, type LlmProvider } from '../src/llm/provider';
import { Lobby } from '../src/lobby';
import { MemoryHandLogStore, MemoryPlayerStore } from '../src/store';

export const FAST: ServerConfig = {
  ...DEFAULT_CONFIG,
  timers: { swapMs: 40, dingqueMs: 40, discardMs: 40, claimMs: 40, nextHandMs: 30, nextHandAutoPlayMs: 10 },
  autoPlayDelayMs: 0,
  ai: { minDelayMs: 0, maxDelayMs: 2, beginnerExtraMs: 1 },
};

export interface TestServer {
  url: string;
  lobby: Lobby;
  hands: MemoryHandLogStore;
  close(): Promise<void>;
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

export async function startServer(config = FAST, options: { llm?: LlmProvider; dialogue?: DialogueConfig } = {}): Promise<TestServer> {
  const hands = new MemoryHandLogStore();
  let seed = 1;
  const dialogue = options.dialogue ?? loadDialogueConfig('global');
  const lobby = new Lobby({
    config,
    dialogue,
    llm: options.llm ?? new NoLlm(),
    moderator: createModerator(dialogue),
    hands,
    players: new MemoryPlayerStore(),
    seed: () => seed++ * 7919,
  });
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (s) => lobby.handleConnection(s));
  await new Promise<void>((r) => http.listen(0, r));
  const server: TestServer = {
    url: `ws://localhost:${(http.address() as AddressInfo).port}`,
    lobby,
    hands,
    close: async () => {
      lobby.closeAll();
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => http.close(r));
    },
  };
  servers.push(server);
  return server;
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

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
    return new Client(ws);
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

  async hello(deviceId = 'device-test-1'): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    const welcome = this.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    this.send({ type: 'hello', deviceId, protocol: PROTOCOL_VERSION });
    return welcome;
  }

  close(): void {
    this.ws.close();
  }
}


export type TableMsg = Extract<ServerMessage, { type: 'table' }>;
export const isTable = (m: ServerMessage): m is TableMsg => m.type === 'table';
export const gameOver = (m: ServerMessage): m is TableMsg => isTable(m) && m.table.gameOver;
