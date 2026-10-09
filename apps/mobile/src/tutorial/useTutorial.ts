/**
 * Runs a lesson and exposes it with the same shape as the live game hook,
 * so the real GameScreen renders the tutorial table unchanged.
 */
import { viewFor, type GameEvent, type HandState, type Seat } from '@mahjong/engine';
import type { SeatInfo, TableSnapshot } from '@mahjong/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameApi, LocalChatEntry, TimedEvent } from '../net/useGame';
import { getLocale, tr } from '../strings';
import { type Intent, type Lesson } from './lessons';
import { autoPlay, tryPlayerMove } from './runner';

const SEATS: { zh: SeatInfo; en: SeatInfo }[] = [
  { zh: { seat: 0, name: '我', avatar: '🙂', isHuman: true }, en: { seat: 0, name: 'Me', avatar: '🙂', isHuman: true } },
  {
    zh: { seat: 1, name: '黄叔', avatar: '🐨', isHuman: false, personality: '热心' },
    en: { seat: 1, name: 'Uncle Huang', avatar: '🐨', isHuman: false, personality: 'Kind' },
  },
  {
    zh: { seat: 2, name: '小美', avatar: '🐰', isHuman: false, personality: '话痨' },
    en: { seat: 2, name: 'Mei', avatar: '🐰', isHuman: false, personality: 'Chatty' },
  },
  {
    zh: { seat: 3, name: '阿强', avatar: '🐯', isHuman: false, personality: '嘴炮' },
    en: { seat: 3, name: 'Qiang', avatar: '🐯', isHuman: false, personality: 'Trash talker' },
  },
];

/** Pause between opponent moves so the player can follow them. */
const MOVE_DELAY_MS = 650;

export interface TutorialState {
  game: GameApi & { table: TableSnapshot };
  stepIndex: number;
  /** Shown after a wrong move. */
  hint: string | null;
  /** Opponents are moving. */
  busy: boolean;
  done: boolean;
  next(): void;
}

export function useTutorial(lesson: Lesson, onExit: () => void): TutorialState {
  const [initial] = useState<HandState>(() => lesson.setup());
  const [hand, setHandState] = useState<HandState>(initial);
  // The latest hand for event handlers and timers; always updated together with the state.
  const handRef = useRef(initial);
  const setHand = useCallback((s: HandState) => {
    handRef.current = s;
    setHandState(s);
  }, []);
  const [stepIndex, setStepIndex] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<TimedEvent[]>([]);
  const [chat, setChat] = useState<LocalChatEntry[]>([]);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const ids = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pushEvents = useCallback((evs: GameEvent[]) => {
    const at = Date.now();
    setEvents((cur) => [...cur, ...evs.map((event) => ({ id: ids.current++, at, event }))].slice(-30));
  }, []);

  /** Plays opponents' moves one by one, then calls `done`. */
  const runOpponents = useCallback(
    (from: HandState, done: () => void) => {
      const steps = autoPlay(from);
      if (!steps.length) return done();
      setBusy(true);
      steps.forEach((t, i) => {
        timers.current.push(
          setTimeout(() => {
            setHand(t.state);
            setReceivedAt(Date.now());
            pushEvents(t.events);
            if (i === steps.length - 1) {
              setBusy(false);
              done();
            }
          }, (i + 1) * MOVE_DELAY_MS),
        );
      });
    },
    [pushEvents, setHand],
  );

  // Lines the characters say when a step begins.
  const step = lesson.steps[stepIndex];
  useEffect(() => {
    if (!step?.say) return;
    const lines = step.say;
    lines.forEach((line, i) => {
      timers.current.push(
        setTimeout(() => {
          const id = ids.current++;
          setChat((cur) => [...cur, { id, seat: line.seat as Seat, kind: 'ai', text: tr(line.text), sticker: null, target: 'table', at: Date.now(), localAt: Date.now() }]);
        }, 300 + i * 1300),
      );
    });
  }, [step]);

  useEffect(() => {
    if (lesson.autoPlayFirst) runOpponents(handRef.current, () => undefined);
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [lesson, runOpponents]);

  const done = stepIndex >= lesson.steps.length;

  const act = useCallback(
    (intent: Intent) => {
      if (busy || !step?.expect) return;
      const t = tryPlayerMove(handRef.current, step, intent);
      if (!t) {
        setHint(step.hint ? tr(step.hint) : null);
        return;
      }
      setHint(null);
      setHand(t.state);
      setReceivedAt(Date.now());
      pushEvents(t.events);
      const advance = () => setStepIndex((i) => i + 1);
      if (step.thenAutoPlay) runOpponents(t.state, advance);
      else advance();
    },
    [busy, step, pushEvents, runOpponents, setHand],
  );

  const next = useCallback(() => {
    if (!busy && step && !step.expect) setStepIndex((i) => i + 1);
  }, [busy, step]);

  const table: TableSnapshot = {
    gameId: `tutorial-${lesson.id}`,
    handIndex: 0,
    handsPerGame: 1,
    mySeat: 0,
    seats: SEATS.map((s) => s[getLocale()]),
    totals: [0, 0, 0, 0],
    view: viewFor(hand, 0),
    timer: null,
    autoPlay: false,
    // The tutorial ends the lesson instead of fast-forwarding.
    fastForward: true,
    fastPace: false,
    // Scripted lessons are not dealt from a seed.
    deal: { commitment: '', seed: null, salt: null },
    gameOver: false,
    chat,
    stake: { kind: 'private', name: '新手教程', baseScore: 1, multiplier: 0 },
    coinChange: 0,
  };

  const noop = () => undefined;
  const game: GameApi & { table: TableSnapshot } = {
    status: 'online',
    playerId: 'tutorial',
    table,
    receivedAt,
    events,
    error: null,
    chat,
    catalog: null,
    banterLevel: 'mild',
    chatRejected: null,
    account: null,
    lastWallet: null,
    lastRank: null,
    commitments: {},
    rewards: null,
    startRejected: null,
    pendingResult: null,
    gameSummary: null,
    notice: null,
    leftReason: null,
    reported: [],
    startGame: noop,
    act,
    setAutoPlay: noop,
    setFastPace: noop,
    skipToResults: noop,
    nextHand: noop,
    leaveGame: onExit,
    clearError: noop,
    sendChat: noop,
    sendQuickPhrase: noop,
    sendSticker: noop,
    setBanter: noop,
    reportLine: noop,
    setAccount: noop,
    dismissPendingResult: noop,
    dismissGameSummary: noop,
  };

  return { game, stepIndex, hint, busy, done, next };
}
