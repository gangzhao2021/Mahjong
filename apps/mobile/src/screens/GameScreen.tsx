import { suitOf, type GameEvent, type Seat, type Tile as TileKind } from '@mahjong/engine';
import type { TableSnapshot } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ActionBar, Btn } from '../components/ActionBar';
import { BanterPicker, ChatPanel, SpeechBubbles } from '../components/Chat';
import { PlayerHand, type HandTile } from '../components/PlayerHand';
import { ResultPanel } from '../components/ResultPanel';
import { Melds, Pond, SeatCard, useCountdown } from '../components/TableParts';
import { Tile } from '../components/Tile';
import type { GameApi, TimedEvent } from '../net/useGame';
import { T } from '../strings';

/** Position of a seat relative to the viewer: 0 bottom, 1 right, 2 top, 3 left (turn order is counter-clockwise). */
type Side = 0 | 1 | 2 | 3;

interface Callout {
  id: number;
  side: Side;
  text: string;
}

export function GameScreen({ game, onNewGame }: { game: GameApi & { table: TableSnapshot }; onNewGame(): void }) {
  const { table, receivedAt } = game;
  const view = table.view;
  const me = view.players[view.seat];
  const { width, height } = useWindowDimensions();
  const handTile = Math.max(24, Math.min(54, Math.floor((width - 80) / 17)));
  const smallTile = Math.max(16, Math.min(30, Math.floor(height / 16)));
  const seatAt = (side: Side) => ((view.seat + side) % 4) as Seat;
  const sideOf = (seat: Seat) => ((seat - view.seat + 4) % 4) as Side;

  const countdown = useCountdown(table.timer, receivedAt);
  const [selection, setSelection] = useState<{ handKey: string; tiles: HandTile[] }>({ handKey: '', tiles: [] });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const callouts = useCallouts(game.events, sideOf);

  // Selections only make sense for the hand they were made on.
  const handKey = `${table.handIndex}:${view.phase}:${(me.hand ?? []).join(',')}`;
  const selected = selection.handKey === handKey ? selection.tiles : [];

  const onSelect = (item: HandTile) => {
    let next: HandTile[];
    if (selected.some((s) => s.key === item.key)) next = selected.filter((s) => s.key !== item.key);
    else if (view.phase === 'swap') next = [...selected.filter((s) => suitOf(s.tile) === suitOf(item.tile)), item].slice(-3);
    else next = [item];
    setSelection({ handKey, tiles: next });
  };

  const stage = view.stage;
  const activeSeat: Seat | null = stage.kind === 'turn' ? stage.seat : null;
  const lastDiscarder: Seat | null = stage.kind === 'claim' ? stage.discarder : null;
  const iWon = me.won !== null;
  const drawn = stage.kind === 'turn' && stage.seat === view.seat ? stage.drawn : null;
  const myTurnTimer = table.timer && table.timer.kind !== 'nextHand' ? countdown : null;
  // Once a hand has ended its scores are already part of the game totals.
  const scoreOf = (seat: Seat) => table.totals[seat] + (view.phase === 'ended' ? 0 : view.scores[seat]);
  // Settlement arrives after the table snapshot; prefer the newer wallet total for this game.
  const gameCoins = game.lastWallet?.gameId === table.gameId ? game.lastWallet.gameTotal : table.coinChange;

  const opponent = (side: Side) => {
    const seat = seatAt(side);
    const p = view.players[seat];
    return (
      <View style={[styles.opponent, side === 2 ? styles.row : styles.column]}>
        <SeatCard
          info={table.seats[seat]}
          score={scoreOf(seat)}
          voidSuit={p.voidSuit}
          dealer={view.dealer === seat}
          active={activeSeat === seat}
          won={!!p.won}
          handCount={p.handCount}
        />
        <Melds melds={p.melds} tileWidth={smallTile} />
        {p.hand && (
          <View style={styles.revealed}>
            {p.hand.map((t, i) => (
              <Tile key={i} tile={t} width={smallTile} />
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.felt}>
      {/* Top row: menu, opposite player, hand info */}
      <View style={styles.topRow}>
        <View style={styles.menu}>
          <Btn label={T.leave} onPress={() => (table.gameOver ? game.leaveGame() : setConfirmLeave(true))} />
          <Btn label={T.autoPlay} primary={table.autoPlay} onPress={() => game.setAutoPlay(!table.autoPlay)} />
          <Btn label={`💬 ${T.chat}`} onPress={() => setChatOpen(true)} />
        </View>
        {opponent(2)}
        <View style={styles.stake}>
          <Text style={styles.handInfo}>{T.hand(table.handIndex, table.handsPerGame)}</Text>
          <Text style={styles.handInfo}>
            {table.stake.name}
            {table.stake.inviteCode ? ` ${T.inviteCode} ${table.stake.inviteCode}` : ''} · {table.stake.multiplier ? T.baseScoreN(table.stake.baseScore) : T.noCoins}
          </Text>
          {table.stake.multiplier > 0 && <Text style={styles.coinLine}>{T.gameCoins(gameCoins)}</Text>}
        </View>
      </View>

      {/* Middle: side players and the four ponds around the centre */}
      <View style={styles.middle}>
        {opponent(3)}
        <View style={styles.center}>
          <Pond discards={view.players[seatAt(2)].discards} tileWidth={smallTile} perRow={12} lastDiscard={lastDiscarder === seatAt(2)} />
          <View style={styles.centerRow}>
            <Pond discards={view.players[seatAt(3)].discards} tileWidth={smallTile} perRow={6} lastDiscard={lastDiscarder === seatAt(3)} />
            <View style={styles.centerBox}>
              <Text style={styles.wall}>
                {T.wall} {view.wallCount}
              </Text>
              {myTurnTimer !== null && (
                <Text style={[styles.timer, myTurnTimer <= 5 && styles.timerLow]}>{myTurnTimer}</Text>
              )}
              {view.swapDirection && view.phase === 'dingque' && (
                <Text style={styles.centerNote}>{T.swapDirection[view.swapDirection]}</Text>
              )}
            </View>
            <Pond discards={view.players[seatAt(1)].discards} tileWidth={smallTile} perRow={6} lastDiscard={lastDiscarder === seatAt(1)} />
          </View>
          <Pond discards={me.discards} tileWidth={smallTile} perRow={12} lastDiscard={lastDiscarder === view.seat} />
        </View>
        {opponent(1)}
      </View>

      {/* Bottom: my seat */}
      <View style={styles.bottom}>
        <View style={styles.actions}>
          {!table.autoPlay && (
            <ActionBar view={view} selectedTiles={selected.map((s) => s.tile)} tileWidth={handTile} onAct={(a) => game.act(a)} />
          )}
        </View>
        <View style={styles.myRow}>
          <SeatCard
            info={table.seats[view.seat]}
            score={scoreOf(view.seat)}
            voidSuit={me.voidSuit}
            dealer={view.dealer === view.seat}
            active={activeSeat === view.seat}
            won={iWon}
            handCount={me.handCount}
          />
          <Melds melds={me.melds} tileWidth={Math.round(handTile * 0.75)} />
          <PlayerHand
            hand={me.hand ?? []}
            drawn={drawn}
            voidSuit={me.voidSuit}
            tileWidth={handTile}
            discardable={table.autoPlay || iWon ? null : (view.legal.discard ?? null)}
            selected={selected.map((s) => s.key)}
            onSelect={onSelect}
            onDiscard={(tile: TileKind) => game.act({ type: 'discard', tile })}
          />
        </View>
      </View>

      <SpeechBubbles chat={game.chat} catalog={game.catalog} positionOf={(seat) => BUBBLE_POSITION[sideOf(seat)]} />

      {callouts.map((c) => (
        <View key={c.id} pointerEvents="none" style={[styles.callout, CALLOUT_POSITION[c.side]]}>
          <Text style={styles.calloutText}>{c.text}</Text>
        </View>
      ))}

      {table.autoPlay && (
        <Pressable style={styles.banner} onPress={() => game.setAutoPlay(false)}>
          <Text style={styles.bannerText}>{T.autoPlayOn}</Text>
        </Pressable>
      )}

      {iWon && view.phase === 'play' && !table.fastForward && (
        <View style={styles.skip}>
          <Btn label={T.skipToResults} primary onPress={game.skipToResults} />
        </View>
      )}

      {view.phase === 'ended' && view.result && (
        <ResultPanel
          table={table}
          result={view.result}
          countdown={table.timer?.kind === 'nextHand' ? countdown : null}
          gameCoins={gameCoins}
          handCoins={
            game.lastWallet && game.lastWallet.gameId === table.gameId && game.lastWallet.handIndex === table.handIndex ? game.lastWallet.amount : null
          }
          onNextHand={game.nextHand}
          onNewGame={onNewGame}
          onHome={game.leaveGame}
        />
      )}

      {chatOpen && (
        <View style={styles.chatLayer}>
          <ChatPanel
            chat={game.chat}
            catalog={game.catalog}
            seats={table.seats}
            mySeat={view.seat}
            onSend={game.sendChat}
            onQuickPhrase={game.sendQuickPhrase}
            onSticker={game.sendSticker}
            onClose={() => setChatOpen(false)}
          />
          <View style={styles.chatBanter}>
            <BanterPicker level={game.banterLevel} onChange={game.setBanter} />
          </View>
        </View>
      )}

      {confirmLeave && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{T.leaveConfirmTitle}</Text>
            <Text style={styles.modalBody}>{T.leaveConfirmBody}</Text>
            <View style={styles.modalButtons}>
              <Btn label={T.cancel} onPress={() => setConfirmLeave(false)} />
              <Btn
                label={T.confirm}
                danger
                onPress={() => {
                  setConfirmLeave(false);
                  game.leaveGame();
                }}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Short "碰! / 杠! / 胡!" bubbles next to the seat that acted, shown for CALLOUT_MS after arrival. */
function useCallouts(events: TimedEvent[], sideOf: (seat: Seat) => Side): Callout[] {
  const [now, setNow] = useState(() => Date.now());
  const visible = events.filter((e) => e.at + CALLOUT_MS > now && calloutText(e.event) !== null);
  const nextExpiry = visible.length ? Math.min(...visible.map((e) => e.at + CALLOUT_MS)) : null;

  useEffect(() => {
    if (nextExpiry === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [nextExpiry]);

  return visible.map(({ id, event }) => {
    const seat = event.type === 'win' ? event.win.seat : (event as { seat: Seat }).seat;
    return { id, side: sideOf(seat), text: calloutText(event)! };
  });
}

const CALLOUT_MS = 1300;

function calloutText(e: GameEvent): string | null {
  switch (e.type) {
    case 'pong':
      return `${T.pong}!`;
    case 'kong':
      return `${T.kong}!`;
    case 'kongRobbed':
      return '被抢杠!';
    case 'win':
      return e.win.selfDraw ? `${T.zimo}!` : `${T.hu}!`;
    default:
      return null;
  }
}

/** Where each seat's speech bubble appears. */
const BUBBLE_POSITION = {
  0: { left: 150, bottom: 120 },
  1: { right: 190, top: '26%' },
  2: { top: 56, left: '56%' },
  3: { left: 190, top: '26%' },
} as const;

const CALLOUT_POSITION = {
  0: { bottom: '32%', alignSelf: 'center' },
  1: { right: '24%', top: '40%' },
  2: { top: '18%', alignSelf: 'center' },
  3: { left: '24%', top: '40%' },
} as const;

const styles = StyleSheet.create({
  // userSelect: keep swipes on web from selecting tile text.
  felt: { flex: 1, backgroundColor: '#1f6b47', paddingHorizontal: 12, paddingVertical: 6, userSelect: 'none' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', minHeight: 48 },
  menu: { flexDirection: 'row', gap: 6 },
  handInfo: { color: '#c8e6c9', fontSize: 12 },
  stake: { alignItems: 'flex-end', marginTop: 4 },
  coinLine: { color: '#ffe082', fontSize: 12, fontWeight: '700' },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  opponent: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  column: { flexDirection: 'column', maxWidth: 170 },
  revealed: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 260 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  centerBox: {
    width: 86,
    height: 70,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wall: { color: '#c8e6c9', fontSize: 12 },
  timer: { color: '#fff', fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerLow: { color: '#ffab91' },
  centerNote: { color: '#fff59d', fontSize: 11, textAlign: 'center' },
  bottom: { gap: 4 },
  actions: { alignItems: 'flex-end', minHeight: 48, justifyContent: 'flex-end' },
  myRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  callout: {
    position: 'absolute',
    backgroundColor: 'rgba(183,28,28,0.92)',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 18,
  },
  calloutText: { color: '#fff', fontSize: 26, fontWeight: '900' },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
  },
  bannerText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skip: { position: 'absolute', alignSelf: 'center', bottom: '30%' },
  chatLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  chatBanter: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 8,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: { backgroundColor: '#fff', borderRadius: 14, padding: 18, width: 340, maxWidth: '90%', gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalBody: { color: '#455a64' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
});
