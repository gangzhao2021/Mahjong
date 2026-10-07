/**
 * Connection to the authoritative game server. The client only renders the
 * server's per-seat view and sends intents; it never decides game outcomes.
 */
import type { Action, GameEvent } from '@mahjong/engine';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type DistributiveOmit,
  type GameOptions,
  type ServerMessage,
  type TableSnapshot,
} from '@mahjong/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SERVER_URL } from '../config';
import { getDeviceId } from './deviceId';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

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
}

export interface GameApi extends GameState {
  startGame(options?: GameOptions): void;
  act(action: DistributiveOmit<Action, 'seat'>): void;
  setAutoPlay(on: boolean): void;
  skipToResults(): void;
  nextHand(): void;
  leaveGame(): void;
  clearError(): void;
}

const MAX_EVENTS = 30;

export function useGame(): GameApi {
  const [state, setState] = useState<GameState>({
    status: 'connecting',
    playerId: null,
    table: null,
    receivedAt: 0,
    events: [],
    error: null,
  });
  const socket = useRef<WebSocket | null>(null);
  const tableRef = useRef<TableSnapshot | null>(null);
  const eventId = useRef(0);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    const connect = async () => {
      const deviceId = await getDeviceId();
      if (disposed) return;
      setState((s) => ({ ...s, status: s.status === 'online' ? 'connecting' : s.status }));
      const ws = new WebSocket(SERVER_URL);
      socket.current = ws;

      ws.onopen = () => {
        backoff = 1000;
        ws.send(JSON.stringify({ type: 'hello', deviceId, protocol: PROTOCOL_VERSION } satisfies ClientMessage));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        switch (msg.type) {
          case 'welcome':
            setState((s) => ({ ...s, status: 'online', playerId: msg.playerId, table: msg.inGame ? s.table : null }));
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
            }));
            break;
          case 'left':
            tableRef.current = null;
            setState((s) => ({ ...s, table: null, events: [] }));
            break;
          case 'error':
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

    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);

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
    skipToResults: useCallback(() => send({ type: 'skipToResults' }), [send]),
    nextHand: useCallback(() => send({ type: 'nextHand' }), [send]),
    leaveGame: useCallback(() => send({ type: 'leaveGame' }), [send]),
    clearError: useCallback(() => setState((s) => ({ ...s, error: null })), []),
  };
}
