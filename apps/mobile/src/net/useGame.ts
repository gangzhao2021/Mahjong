/**
 * Connection to the authoritative game server. The client only renders the
 * server's per-seat view and sends intents; it never decides game outcomes.
 */
import type { Action, GameEvent, Seat } from '@mahjong/engine';
import {
  PROTOCOL_VERSION,
  type AccountSummary,
  type BanterLevel,
  type ChatCatalog,
  type ChatEntry,
  type ChatRejection,
  type ClientMessage,
  type DistributiveOmit,
  type GameOptions,
  type GameSummary,
  type RankResult,
  type ServerMessage,
  type StartRejection,
  type StickerId,
  type TableSnapshot,
} from '@mahjong/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { SERVER_WS } from '../config';
import { getLocale } from '../strings';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** A chat entry plus when it arrived on this device (0 = history from a snapshot). */
export interface LocalChatEntry extends ChatEntry {
  localAt: number;
}

export interface TimedEvent {
  id: number;
  at: number;
  event: GameEvent;
}

export interface GameState {
  status: ConnectionStatus;
  playerId: string | null;
  table: TableSnapshot | null;
  /** Local clock time when `table` arrived (for the countdown). */
  receivedAt: number;
  /** Recent events with an increasing id and arrival time, for callouts and sounds. */
  events: TimedEvent[];
  error: string | null;
  /** Table chat, oldest first. */
  chat: LocalChatEntry[];
  catalog: ChatCatalog | null;
  banterLevel: BanterLevel;
  chatRejected: { reason: ChatRejection; at: number } | null;
  account: AccountSummary | null;
  /** Latest coin settlement of a hand. */
  lastWallet: { amount: number; requested: number; handIndex: number; gameTotal: number; gameId: string | null } | null;
  /** Rank change after the last ranked game. */
  lastRank: RankResult | null;
  startRejected: { reason: StartRejection; detail?: string; at: number } | null;
  /** Result of a game that finished while the player was away (PRD §14.1). */
  pendingResult: GameSummary | null;
  /** Result of the game just finished. */
  gameSummary: GameSummary | null;
  notice: { kind: 'minorTimeLimit' | 'guestTrialOver'; endsAt: number; at: number } | null;
  /** Ids of AI lines this player reported. */
  reported: number[];
  /** Why the server last took the player out of a game, if not by choice. */
  leftReason: 'minorTimeLimit' | 'guestTrialOver' | null;
}

export interface GameApi extends GameState {
  startGame(options?: GameOptions): void;
  act(action: DistributiveOmit<Action, 'seat'>): void;
  setAutoPlay(on: boolean): void;
  setFastPace(on: boolean): void;
  skipToResults(): void;
  nextHand(): void;
  leaveGame(): void;
  clearError(): void;
  sendChat(text: string, target: Seat | 'table'): void;
  sendQuickPhrase(id: string): void;
  sendSticker(id: StickerId): void;
  setBanter(level: BanterLevel): void;
  /** Report an AI line as inappropriate (Appendix C). */
  reportLine(entryId: number): void;
  /** Replace the account after an HTTP update (profile, reward, real-name…). */
  setAccount(account: AccountSummary): void;
  dismissPendingResult(): void;
  dismissGameSummary(): void;
}

const MAX_EVENTS = 30;

/**
 * @param token session token; no connection is made while it is null.
 * @param onUnauthorized called when the server rejects the session.
 */
export function useGame(token: string | null, onUnauthorized: () => void): GameApi {
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  }, [onUnauthorized]);
  const [state, setState] = useState<GameState>({
    status: 'connecting',
    playerId: null,
    table: null,
    receivedAt: 0,
    events: [],
    error: null,
    chat: [],
    catalog: null,
    banterLevel: 'spicy',
    chatRejected: null,
    account: null,
    lastWallet: null,
    lastRank: null,
    startRejected: null,
    pendingResult: null,
    gameSummary: null,
    notice: null,
    leftReason: null,
    reported: [],
  });
  const socket = useRef<WebSocket | null>(null);
  const tableRef = useRef<TableSnapshot | null>(null);
  const eventId = useRef(0);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    const connect = () => {
      if (disposed) return;
      setState((s) => ({ ...s, status: s.status === 'online' ? 'connecting' : s.status }));
      const ws = new WebSocket(SERVER_WS);
      socket.current = ws;

      ws.onopen = () => {
        backoff = 1000;
        ws.send(JSON.stringify({ type: 'hello', token, protocol: PROTOCOL_VERSION, locale: getLocale() } satisfies ClientMessage));
      };
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as ServerMessage;
        } catch {
          return; // A malformed frame is dropped rather than crashing the table.
        }
        switch (msg.type) {
          case 'welcome':
            setState((s) => ({
              ...s,
              status: 'online',
              playerId: msg.playerId,
              table: msg.inGame ? s.table : null,
              catalog: msg.catalog,
              banterLevel: msg.banterLevel,
              account: msg.account,
            }));
            if (!msg.inGame) tableRef.current = null;
            break;
          case 'table':
            tableRef.current = msg.table;
            const at = Date.now();
            setState((s) => ({
              ...s,
              table: msg.table,
              receivedAt: at,
              events: [...s.events, ...msg.events.map((event) => ({ id: ++eventId.current, at, event }))].slice(-MAX_EVENTS),
              chat: mergeChat(s.chat, msg.table.chat, msg.table.gameId !== s.table?.gameId, 0),
            }));
            break;
          case 'left':
            tableRef.current = null;
            setState((s) => ({
              ...s,
              table: null,
              events: [],
              chat: [],
              leftReason: msg.reason === 'minorTimeLimit' || msg.reason === 'guestTrialOver' ? msg.reason : null,
            }));
            break;
          case 'rank':
            setState((s) => ({ ...s, lastRank: msg.result, account: s.account ? { ...s.account, rank: msg.result.after } : s.account }));
            break;
          case 'wallet':
            setState((s) => ({
              ...s,
              account: s.account ? { ...s.account, balance: msg.balance } : s.account,
              lastWallet: msg.change ? { ...msg.change, gameId: tableRef.current?.gameId ?? null } : s.lastWallet,
            }));
            break;
          case 'startRejected':
            setState((s) => ({ ...s, startRejected: { reason: msg.reason, detail: msg.detail, at: Date.now() } }));
            break;
          case 'pendingResult':
            setState((s) => ({ ...s, pendingResult: msg.summary }));
            break;
          case 'gameSummary':
            setState((s) => ({ ...s, gameSummary: msg.summary }));
            break;
          case 'notice':
            setState((s) => ({ ...s, notice: { kind: msg.kind, endsAt: msg.endsAt, at: Date.now() } }));
            break;
          case 'chat':
            setState((s) => ({ ...s, chat: mergeChat(s.chat, [msg.entry], false, Date.now()) }));
            break;
          case 'chatRejected':
            setState((s) => ({ ...s, chatRejected: { reason: msg.reason, at: Date.now() } }));
            break;
          case 'banter':
            setState((s) => ({ ...s, banterLevel: msg.level }));
            break;
          case 'lineReported':
            setState((s) => ({ ...s, reported: [...s.reported, msg.entryId] }));
            break;
          case 'error':
            if (msg.code === 'unauthorized') {
              disposed = true;
              ws.close();
              unauthorized.current();
              return;
            }
            setState((s) => ({ ...s, error: msg.message }));
            break;
        }
      };
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
        if (disposed) return;
        setState((s) => ({ ...s, status: 'offline' }));
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 8000);
      };
    };

    connect();
    // Coming back to the foreground: reconnect now instead of waiting out the backoff.
    const appState = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || disposed || socket.current) return;
      clearTimeout(retry);
      backoff = 1000;
      connect();
    });
    return () => {
      disposed = true;
      appState.remove();
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [token]);

  const send = useCallback((m: ClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  return {
    ...state,
    startGame: useCallback((options) => send({ type: 'startGame', options }), [send]),
    act: useCallback(
      (action) => {
        const table = tableRef.current;
        if (table) send({ type: 'action', action, version: table.view.version });
      },
      [send],
    ),
    setAutoPlay: useCallback((on) => send({ type: 'setAutoPlay', on }), [send]),
    setFastPace: useCallback((on) => send({ type: 'setFastPace', on }), [send]),
    skipToResults: useCallback(() => send({ type: 'skipToResults' }), [send]),
    nextHand: useCallback(() => send({ type: 'nextHand' }), [send]),
    leaveGame: useCallback(() => send({ type: 'leaveGame' }), [send]),
    clearError: useCallback(() => setState((s) => ({ ...s, error: null })), []),
    sendChat: useCallback((text, target) => send({ type: 'chat', text, target }), [send]),
    sendQuickPhrase: useCallback((id) => send({ type: 'quickPhrase', id }), [send]),
    sendSticker: useCallback((id) => send({ type: 'sticker', id }), [send]),
    setBanter: useCallback((level) => send({ type: 'setBanter', level }), [send]),
    reportLine: useCallback((entryId) => send({ type: 'reportLine', entryId }), [send]),
    setAccount: useCallback((account) => setState((s) => ({ ...s, account, banterLevel: account.banterLevel })), []),
    dismissPendingResult: useCallback(() => setState((s) => ({ ...s, pendingResult: null })), []),
    dismissGameSummary: useCallback(() => setState((s) => ({ ...s, gameSummary: null })), []),
  };
}

const MAX_CHAT = 60;

/** Merges chat entries by id (snapshots resend recent history after reconnects). */
function mergeChat(current: LocalChatEntry[], incoming: ChatEntry[], reset: boolean, localAt: number): LocalChatEntry[] {
  const byId = new Map((reset ? [] : current).map((e) => [e.id, e]));
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, { ...e, localAt });
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_CHAT);
}
