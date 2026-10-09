import { chooseAction, chooseDiscard, chooseSwap } from '@mahjong/ai-play';
import { suitOf, type Action, type GameEvent, type HandView, type Seat, type Suit, type Tile as TileKind } from '@mahjong/engine';
import type { DistributiveOmit, TableSnapshot } from '@mahjong/protocol';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { updateSoundSettings, useSoundSettings, useTableSounds } from '../audio/sound';
import { ActionBar, Btn } from '../components/ActionBar';
import { BanterPicker, ChatPanel, SpeechBubbles } from '../components/Chat';
import { arrangeHand, PlayerHand, type HandTile } from '../components/PlayerHand';
import { PopIn } from '../components/PopIn';
import { ResultPanel } from '../components/ResultPanel';
import { Felt } from '../components/Felt';
import { InsightPanel, TileTracker } from '../components/Insight';
import { autoMove, updateAutoSettings, useAutoSettings, type AutoSettings } from '../game/autoActions';
import { Compass, ConcealedTiles, Melds, Pond, SeatCard, useCountdown } from '../components/TableParts';
import { Tile } from '../components/Tile';
import type { GameApi, TimedEvent } from '../net/useGame';
import { T, tableName } from '../strings';
import { markTipSeen, useTipPending, type TipId } from '../tips';

/** Position of a seat relative to the viewer: 0 bottom, 1 right, 2 top, 3 left (turn order is counter-clockwise). */
type Side = 0 | 1 | 2 | 3;

interface Callout {
  id: number;
  side: Side;
  text: string;
  /** 胡 / 自摸: bigger, golden and longer. */
  win: boolean;
}

interface Spotlight {
  id: number;
  side: Side;
  seat: Seat;
  tile: TileKind;
}

export function GameScreen({ game, onNewGame }: { game: GameApi & { table: TableSnapshot }; onNewGame(): void }) {
  const { table, receivedAt } = game;
  const view = table.view;
  const me = view.players[view.seat];
  const window = useWindowDimensions();
  // Big screens (desktop browsers, tablets) get the phone layout scaled up as a whole, so tiles,
  // seats, buttons and text keep their proportions instead of shrinking into the corners.
  const scale = Math.max(1, Math.min(window.width / DESIGN_WIDTH, window.height / DESIGN_HEIGHT));
  const width = window.width / scale;
  const height = window.height / scale;
  const smallTile = Math.max(16, Math.min(30, Math.floor(height / 18)));
  const seatAt = (side: Side) => ((view.seat + side) % 4) as Seat;
  const sideOf = (seat: Seat) => ((seat - view.seat + 4) % 4) as Side;

  const countdown = useCountdown(table.timer, receivedAt);
  const [selection, setSelection] = useState<{ handKey: string; tiles: HandTile[] }>({ handKey: '', tiles: [] });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Messages from the other seats since the chat panel was last open.
  const [chatSeenId, setChatSeenId] = useState(() => game.chat.at(-1)?.id ?? -1);
  const latestChatId = game.chat.at(-1)?.id ?? -1;
  const showChat = (open: boolean) => {
    setChatSeenId(latestChatId);
    setChatOpen(open);
  };
  const unreadChat = chatOpen ? 0 : game.chat.filter((e) => e.id > chatSeenId && e.seat !== view.seat).length;
  const { callouts, spotlight } = useTableMoments(game.events, sideOf, view);
  useTableSounds(game.events, game.chat, view.seat);
  const sound = useSoundSettings();
  const muted = !sound.effects && !sound.music;

  const stage = view.stage;
  const activeSeat: Seat | null = stage.kind === 'turn' ? stage.seat : null;
  const lastDiscarder: Seat | null = stage.kind === 'claim' ? stage.discarder : null;
  const iWon = me.won !== null;
  const drawn = stage.kind === 'turn' && stage.seat === view.seat ? stage.drawn : null;
  // Size my tiles so the seat card, melds (drawn at 3/4 size) and the whole hand fit on one row.
  const meldTiles = me.melds.reduce((n, m) => n + (m.type === 'pong' ? 3 : 4), 0);
  const handSlots = me.handCount + (drawn !== null ? 0.4 : 0) + meldTiles * 0.75 + me.melds.length * 0.2 + 0.5;
  const handTile = Math.max(24, Math.min(54, Math.floor((width - 24 - MY_SEAT_WIDTH) / handSlots)));

  // Selections only make sense for the hand they were made on.
  const handKey = `${table.handIndex}:${view.phase}:${(me.hand ?? []).join(',')}`;
  // Swap three starts with the expert's pick already selected; the player can confirm or change it.
  const selected = selection.handKey === handKey ? selection.tiles : swapSuggestion(view, me.hand ?? [], drawn, me.voidSuit);

  const [hovered, setHovered] = useState<HandTile | null>(null);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const auto = useAutoSettings();
  // Shortcut moves, at most one per view version, after a short beat so the player sees what happened.
  const autoActed = useRef(-1);
  const shortcut = table.autoPlay || me.won ? null : autoMove(view, auto);
  useEffect(() => {
    if (!shortcut || autoActed.current === view.version) return;
    const timer = setTimeout(() => {
      autoActed.current = view.version;
      game.act(shortcut);
    }, 500);
    return () => clearTimeout(timer);
  }, [shortcut, view.version, game]);
  // The AI's recommendation for the claim in front of me, kept only for that view.
  const [claimHint, setClaimHint] = useState<{ version: number; action: DistributiveOmit<Action, 'seat'> } | null>(null);
  const myDiscard = stage.kind === 'turn' && stage.seat === view.seat && !!view.legal.discard;
  // A tile can leave the hand while the pointer is still "on" it (no leave event when it unmounts).
  const hoveredTile = hovered && (me.hand ?? []).includes(hovered.tile) ? hovered.tile : null;
  const focusTile = myDiscard ? (hoveredTile ?? (selected.length === 1 ? selected[0].tile : null)) : null;
  const onHint = () => {
    if (myDiscard) {
      const pick = chooseDiscard(view, 'expert', () => 0.5);
      const arranged = arrangeHand(me.hand ?? [], drawn, me.voidSuit);
      const items = arranged.drawn ? [...arranged.main, arranged.drawn] : arranged.main;
      const item = items.find((i) => i.tile === pick);
      if (item) setSelection({ handKey, tiles: [item] });
      return;
    }
    const action = chooseAction(view, 'expert', () => 0.5);
    if (action) {
      const { seat: _seat, ...intent } = action;
      setClaimHint({ version: view.version, action: intent as DistributiveOmit<Action, 'seat'> });
    }
  };

  const onSelect = (item: HandTile) => {
    let next: HandTile[];
    if (selected.some((s) => s.key === item.key)) next = selected.filter((s) => s.key !== item.key);
    else if (view.phase === 'swap') next = [...selected.filter((s) => suitOf(s.tile) === suitOf(item.tile)), item].slice(-3);
    else next = [item];
    setSelection({ handKey, tiles: next });
  };
  const myTurnTimer = table.timer && table.timer.kind !== 'nextHand' ? countdown : null;
  const timeRunningOut = myTurnTimer !== null && myTurnTimer <= 5 && !table.autoPlay;
  const tip = useTipPending(table.autoPlay ? null : tipFor(view));
  const tipId = tip ? tipFor(view) : null;
  // Once a hand has ended its scores are already part of the game totals.
  const scoreOf = (seat: Seat) => table.totals[seat] + (view.phase === 'ended' ? 0 : view.scores[seat]);
  // Settlement arrives after the table snapshot; prefer the newer wallet total for this game.
  const gameCoins = game.lastWallet?.gameId === table.gameId ? game.lastWallet.gameTotal : table.coinChange;

  const backTile = Math.round(smallTile * 0.8);
  const opponent = (side: Side) => {
    const seat = seatAt(side);
    const p = view.players[seat];
    const card = (
      <SeatCard
        info={table.seats[seat]}
        score={scoreOf(seat)}
        voidSuit={p.voidSuit}
        dealer={view.dealer === seat}
        active={activeSeat === seat}
        win={p.won}
        handCount={p.handCount}
      />
    );
    // Face-down tiles sit between the player and the centre of the table.
    const backs = p.hand ? null : <ConcealedTiles count={p.handCount} width={side === 2 ? backTile : Math.round(backTile * 0.75)} vertical={side !== 2} />;
    const revealed = p.hand && (
      <View style={styles.revealed}>
        {p.hand.map((t, i) => (
          <Tile key={i} tile={t} width={smallTile} />
        ))}
      </View>
    );
    if (side === 2) {
      // Melds go under the backs so the top row never pushes the hand info off screen.
      return (
        <View style={[styles.opponent, styles.row, styles.shrink]}>
          {card}
          <View style={[styles.opponent, styles.shrink]}>
            {backs}
            <Melds melds={p.melds} tileWidth={Math.round(smallTile * 0.85)} />
            {revealed}
          </View>
        </View>
      );
    }
    const info = (
      <View style={[styles.opponent, styles.column]}>
        {card}
        <Melds melds={p.melds} tileWidth={smallTile} />
        {revealed}
      </View>
    );
    return (
      <View style={styles.sideSeat}>
        {side === 3 ? info : backs}
        {side === 3 ? backs : info}
      </View>
    );
  };
  const windOf = (side: Side) => T.winds[(seatAt(side) - view.dealer + 4) % 4];

  return (
    <Felt>
      <View style={[styles.stage, { width, height, transform: [{ scale }] }]}>
      {/* Top row: menu, opposite player, hand info */}
      <View style={styles.topRow}>
        <View style={styles.menu}>
          <Btn label={T.leave} onPress={() => (table.gameOver ? game.leaveGame() : setConfirmLeave(true))} />
          <Btn label={T.autoPlay} primary={table.autoPlay} onPress={() => game.setAutoPlay(!table.autoPlay)} />
          <Btn label={`💬 ${T.chat}${unreadChat ? ` · ${unreadChat}` : ''}`} primary={unreadChat > 0} onPress={() => showChat(true)} />
          <Btn label={`${muted ? '🔇' : '🔊'} ${T.soundLabel(!muted)}`} onPress={() => updateSoundSettings({ effects: muted, music: muted })} />
          <Btn label={`🀄 ${T.tracker}`} primary={trackerOpen} onPress={() => setTrackerOpen(!trackerOpen)} />
          <Btn label={`⚡ ${T.autoMenu}`} primary={auto.win || auto.noClaims || auto.tsumogiri} onPress={() => setAutoOpen(!autoOpen)} />
        </View>
        <View style={styles.topSeat}>{opponent(2)}</View>
        <View style={styles.stake}>
          <Text style={styles.handInfo}>{T.hand(table.handIndex, table.handsPerGame)}</Text>
          <Text style={styles.handInfo}>
            {tableName(table.stake)}
            {table.stake.inviteCode ? ` ${T.inviteCode} ${table.stake.inviteCode}` : ''} · {table.stake.multiplier ? T.baseScoreN(table.stake.baseScore) : T.noCoins}
          </Text>
          {table.stake.multiplier > 0 && <Text style={styles.coinLine}>{T.gameCoins(gameCoins)}</Text>}
        </View>
      </View>

      {/* Middle: side players and the four ponds around the centre */}
      <View style={styles.middle}>
        {opponent(3)}
        <View style={styles.center}>
          <Pond side={2} discards={view.players[seatAt(2)].discards} tileWidth={smallTile} perLine={POND_ROW} lastDiscard={lastDiscarder === seatAt(2)} />
          <View style={styles.centerRow}>
            <Pond side={3} discards={view.players[seatAt(3)].discards} tileWidth={smallTile} perLine={POND_COLUMN} lastDiscard={lastDiscarder === seatAt(3)} />
            <Compass
              winds={([0, 1, 2, 3] as Side[]).map(windOf)}
              active={activeSeat !== null ? sideOf(activeSeat) : null}
              wallCount={`${T.wall} ${view.wallCount}`}
              timer={myTurnTimer}
            />
            <Pond side={1} discards={view.players[seatAt(1)].discards} tileWidth={smallTile} perLine={POND_COLUMN} lastDiscard={lastDiscarder === seatAt(1)} />
          </View>
          <Pond side={0} discards={me.discards} tileWidth={smallTile} perLine={POND_ROW} lastDiscard={lastDiscarder === view.seat} />
        </View>
        {opponent(1)}
      </View>

      {/* Bottom: my seat */}
      <View style={styles.bottom}>
        {/* Bottom padding leaves room for selected tiles, which lift into this area */}
        <View style={[styles.bottomBar, { paddingBottom: Math.round(handTile * 0.35) }]}>
        <InsightPanel view={view} focus={focusTile} tileWidth={Math.round(handTile * 0.55)} />
        <View style={styles.actions}>
          {tipId && <CoachTip key={tipId} id={tipId} />}
          {timeRunningOut && (
            <PopIn key={`warn${myTurnTimer}`} from={1.15} style={styles.warning}>
              <Text style={styles.warningText}>⏰ {T.timeoutWarning(myTurnTimer)}</Text>
            </PopIn>
          )}
          {!table.autoPlay && (
            <ActionBar
              view={view}
              selectedTiles={selected.map((s) => s.tile)}
              tileWidth={handTile}
              onAct={(a) => game.act(a)}
              onHint={onHint}
              claimHint={claimHint?.version === view.version ? claimHint.action : null}
            />
          )}
        </View>
        </View>
        <View style={styles.myRow}>
          <View style={styles.mySeat}>
            <SeatCard
              info={table.seats[view.seat]}
              score={scoreOf(view.seat)}
              voidSuit={me.voidSuit}
              dealer={view.dealer === view.seat}
              active={activeSeat === view.seat}
              win={me.won}
              handCount={me.handCount}
            />
          </View>
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
            onHover={setHovered}
          />
        </View>
      </View>

      <SpeechBubbles chat={game.chat} catalog={game.catalog} positionOf={(seat) => BUBBLE_POSITION[sideOf(seat)]} />

      {/* The tile just discarded, shown large next to the player who let it go */}
      {spotlight && (
        <PopIn key={`spot${spotlight.id}`} pointerEvents="none" from={1.6} style={[styles.spotlight, SPOTLIGHT_POSITION[spotlight.side]]}>
          <Tile tile={spotlight.tile} width={Math.round(smallTile * 1.5)} highlighted />
          <Text style={styles.spotlightText}>{T.discardedBy(table.seats[spotlight.seat].name)}</Text>
        </PopIn>
      )}

      {callouts.map((c) => (
        <PopIn key={c.id} pointerEvents="none" from={0.3} style={[styles.callout, c.win && styles.calloutWin, CALLOUT_POSITION[c.side]]}>
          <Text style={[styles.calloutText, c.win && styles.calloutWinText]}>{c.text}</Text>
        </PopIn>
      ))}

      {table.autoPlay && (
        // Sits where the action buttons would be (they are hidden while auto-playing), clear of the discards.
        <Pressable style={[styles.banner, { bottom: Math.round(handTile * 1.4) + 14 }]} onPress={() => game.setAutoPlay(false)}>
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
            onReport={game.reportLine}
            reported={game.reported}
            onClose={() => showChat(false)}
          />
          <View style={styles.chatBanter}>
            <BanterPicker level={game.banterLevel} onChange={game.setBanter} />
          </View>
        </View>
      )}

      {trackerOpen && <TileTracker view={view} onClose={() => setTrackerOpen(false)} />}
      {autoOpen && <AutoMenu auto={auto} onClose={() => setAutoOpen(false)} />}

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
    </Felt>
  );
}

/** The three shortcut switches, dropped down under the menu. */
function AutoMenu({ auto, onClose }: { auto: AutoSettings; onClose(): void }) {
  const row = (key: keyof AutoSettings, label: string) => (
    <View style={styles.autoRow}>
      <Switch value={auto[key]} onValueChange={(v) => updateAutoSettings({ [key]: v })} />
      <Text style={styles.autoLabel}>{label}</Text>
    </View>
  );
  return (
    <Pressable style={styles.autoBackdrop} onPress={onClose} accessibilityRole="button">
      <Pressable style={styles.autoMenu} onPress={() => undefined}>
        {row('win', T.autoWin)}
        {row('noClaims', T.autoNoClaims)}
        {row('tsumogiri', T.autoTsumogiri)}
      </Pressable>
    </Pressable>
  );
}

/** Which first-time tip fits the decision in front of the player, if any. */
function tipFor(view: HandView): TipId | null {
  const legal = view.legal;
  const me = view.players[view.seat];
  if (legal.swapSuits) return 'swap';
  if (legal.dingque) return 'dingque';
  const stage = view.stage;
  if ((stage.kind === 'claim' || stage.kind === 'robKong') && stage.myOptions && !stage.responded) return legal.hu ? 'win' : 'claim';
  if (stage.kind === 'turn' && stage.seat === view.seat && legal.discard) {
    if (legal.zimo) return 'win';
    const hand = me.hand ?? [];
    const voidFirst = me.voidSuit !== null && legal.discard.every((t) => suitOf(t) === me.voidSuit) && hand.some((t) => suitOf(t) !== me.voidSuit);
    return voidFirst ? 'voidFirst' : 'discard';
  }
  return null;
}

/** A first-time coaching card above the hand; counts as seen once dismissed or once its moment has passed. */
function CoachTip({ id }: { id: TipId }) {
  useEffect(() => () => markTipSeen(id), [id]);
  return (
    <PopIn from={0.9} style={styles.tip}>
      <Text style={styles.tipText}>💡 {T.tips[id]}</Text>
      <Btn label={T.tips.gotIt} onPress={() => markTipSeen(id)} />
    </PopIn>
  );
}

/**
 * Short-lived table moments: "碰! / 杠! / 胡!" bubbles next to the seat that acted,
 * and a spotlight on the latest discard (kept up while others may still claim it).
 */
function useTableMoments(events: TimedEvent[], sideOf: (seat: Seat) => Side, view: HandView): { callouts: Callout[]; spotlight: Spotlight | null } {
  const [now, setNow] = useState(() => Date.now());
  const shownFor = (e: GameEvent) => (e.type === 'discard' ? SPOTLIGHT_MS : e.type === 'win' ? WIN_CALLOUT_MS : CALLOUT_MS);
  const fresh = events.filter((e) => e.at + shownFor(e.event) > now && (e.event.type === 'discard' || calloutText(e.event) !== null));
  const nextExpiry = fresh.length ? Math.min(...fresh.map((e) => e.at + shownFor(e.event))) : null;

  useEffect(() => {
    if (nextExpiry === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [nextExpiry]);

  const callouts = fresh
    .filter((e) => e.event.type !== 'discard')
    .map(({ id, event }) => {
      const seat = event.type === 'win' ? event.win.seat : (event as { seat: Seat }).seat;
      return { id, side: sideOf(seat), text: calloutText(event)!, win: event.type === 'win' };
    });

  // Only the newest discard, and only until the next action, unless the claim window is still open.
  const last = [...events].reverse().find((e) => e.event.type === 'discard' || e.event.type === 'draw' || e.event.type === 'pong' || e.event.type === 'kong');
  let spotlight: Spotlight | null = null;
  if (last?.event.type === 'discard') {
    const claimOpen = view.stage.kind === 'claim' && view.stage.discarder === last.event.seat;
    if (claimOpen || last.at + SPOTLIGHT_MS > now) {
      spotlight = { id: last.id, side: sideOf(last.event.seat), seat: last.event.seat, tile: last.event.tile };
    }
  }
  return { callouts, spotlight };
}

const CALLOUT_MS = 1300;
const WIN_CALLOUT_MS = 2400;
const SPOTLIGHT_MS = 1500;

function calloutText(e: GameEvent): string | null {
  switch (e.type) {
    case 'pong':
      return `${T.pong}!`;
    case 'kong':
      return `${T.kong}!`;
    case 'kongRobbed':
      return T.robbed;
    case 'win':
      return e.win.selfDraw ? `${T.zimo}!` : `${T.hu}!`;
    default:
      return null;
  }
}

/** Screen size the table is laid out at; bigger screens scale it up. Roomier than a phone so desktops don't feel cramped. */
const DESIGN_WIDTH = 1200;
const DESIGN_HEIGHT = 560;
/** Discards per line: across for the top and bottom ponds, down for the side ponds (about the compass's height). */
const POND_ROW = 12;
const POND_COLUMN = 5;
/** Room kept for my seat card left of the hand. */
const MY_SEAT_WIDTH = 190;

/** Where each seat's speech bubble appears. */
const BUBBLE_POSITION = {
  0: { left: 150, bottom: 120 },
  1: { right: 190, top: '26%' },
  2: { top: 56, left: '56%' },
  3: { left: 190, top: '26%' },
} as const;

/** Between the discarder's pond and the compass. */
const SPOTLIGHT_POSITION = {
  0: { bottom: '20%', alignSelf: 'center' },
  1: { right: '26%', top: '36%' },
  2: { top: '10%', alignSelf: 'center' },
  3: { left: '26%', top: '36%' },
} as const;

const CALLOUT_POSITION = {
  0: { bottom: '32%', alignSelf: 'center' },
  1: { right: '24%', top: '40%' },
  2: { top: '18%', alignSelf: 'center' },
  3: { left: '24%', top: '40%' },
} as const;

const styles = StyleSheet.create({
  // userSelect: keep swipes on web from selecting tile text.
  stage: { paddingHorizontal: 12, paddingVertical: 6, userSelect: 'none', transformOrigin: 'top left' },
  sideSeat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', minHeight: 48 },
  menu: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  topSeat: { flex: 1, alignItems: 'center', minWidth: 0 },
  handInfo: { color: '#c8e6c9', fontSize: 12 },
  stake: { alignItems: 'flex-end', marginTop: 4, flexShrink: 0 },
  coinLine: { color: '#ffe082', fontSize: 12, fontWeight: '700' },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  opponent: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  column: { flexDirection: 'column', maxWidth: 170 },
  revealed: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 260 },
  shrink: { flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottom: { gap: 4 },
  autoBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingTop: 54, paddingLeft: 12 },
  autoMenu: { alignSelf: 'flex-start', backgroundColor: 'rgba(10,40,26,0.95)', borderRadius: 14, padding: 12, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  autoLabel: { color: '#e8f5e9', fontSize: 14, fontWeight: '700' },
  bottomBar: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, minHeight: 48 },
  actions: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', gap: 6 },
  warning: { backgroundColor: '#c62828', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  warningText: { color: '#fff', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 560,
    backgroundColor: '#fff8e1',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ffca28',
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
  },
  tipText: { flexShrink: 1, color: '#4e342e', fontSize: 14, fontWeight: '700' },
  myRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  mySeat: { maxWidth: MY_SEAT_WIDTH - 10, flexShrink: 0 },
  callout: {
    position: 'absolute',
    backgroundColor: 'rgba(183,28,28,0.92)',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 18,
  },
  calloutText: { color: '#fff', fontSize: 26, fontWeight: '900' },
  calloutWin: {
    backgroundColor: '#ffb300',
    borderWidth: 3,
    borderColor: '#fff3c4',
    paddingHorizontal: 26,
    paddingVertical: 8,
    borderRadius: 26,
    shadowColor: '#ffd54f',
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  calloutWinText: { color: '#5d1a00', fontSize: 40 },
  spotlight: {
    position: 'absolute',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  spotlightText: { color: '#ffe082', fontSize: 12, fontWeight: '800' },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
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

/** The tiles an expert would swap away, as hand items (empty outside the swap decision). */
function swapSuggestion(view: HandView, hand: TileKind[], drawn: TileKind | null, voidSuit: Suit | null): HandTile[] {
  if (view.phase !== 'swap' || !view.legal.swapSuits?.length) return [];
  const pick = chooseSwap(view, 'expert', () => 0.5);
  const arranged = arrangeHand(hand, drawn, voidSuit);
  const items = arranged.drawn ? [...arranged.main, arranged.drawn] : arranged.main;
  return items.filter((item) => {
    const i = pick.indexOf(item.tile);
    if (i < 0) return false;
    pick.splice(i, 1);
    return true;
  });
}
