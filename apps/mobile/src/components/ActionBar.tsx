/** Context buttons above the hand: swap, dingque, claims, self-draw, kong, discard. */
import { suitOf, type Action, type HandView, type Suit, type Tile } from '@mahjong/engine';
import type { DistributiveOmit } from '@mahjong/protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { playSfx } from '../audio/sound';
import { SUIT_NAMES, T, TILE_SUITS } from '../strings';
import { Tile as TileView } from './Tile';

type Intent = DistributiveOmit<Action, 'seat'>;

interface Props {
  view: HandView;
  selectedTiles: Tile[];
  tileWidth: number;
  onAct(action: Intent): void;
  /** Ask for the AI's pick (discard) or recommendation (claim). */
  onHint(): void;
  /** The AI's recommendation for the current claim, once asked for. */
  claimHint: Intent | null;
}

export function ActionBar({ view, selectedTiles, tileWidth, onAct, onHint, claimHint }: Props) {
  const legal = view.legal;
  const me = view.players[view.seat];
  const stage = view.stage;

  if (view.phase === 'swap') {
    if (!legal.swapSuits) return <Hint text={T.swapWaiting} />;
    const valid =
      selectedTiles.length === 3 &&
      selectedTiles.every((t) => suitOf(t) === suitOf(selectedTiles[0])) &&
      legal.swapSuits.includes(suitOf(selectedTiles[0]));
    return (
      <Bar>
        <Hint text={T.swapHint} />
        <Btn label={T.swapConfirm} primary={valid} disabled={!valid} onPress={() => onAct({ type: 'swap', tiles: selectedTiles })} />
      </Bar>
    );
  }

  if (view.phase === 'dingque') {
    if (!legal.dingque) return <Hint text={T.dingqueWaiting} />;
    const hand = me.hand ?? [];
    const counts = [0, 1, 2].map((s) => hand.filter((t) => suitOf(t) === s).length);
    const suggested = counts.indexOf(Math.min(...counts));
    return (
      <Bar>
        {/* Which way the swapped tiles just went, so the player knows who has them */}
        <Hint text={view.swapDirection ? `${T.swapDirection[view.swapDirection]} · ${T.dingqueHint}` : T.dingqueHint} />
        {([0, 1, 2] as Suit[]).map((suit) => (
          <Btn key={suit} label={`${T.voidSuit(SUIT_NAMES[suit])} (${counts[suit]})`} primary={suit === suggested} onPress={() => onAct({ type: 'dingque', suit })} />
        ))}
      </Bar>
    );
  }

  if ((stage.kind === 'claim' || stage.kind === 'robKong') && stage.myOptions && !stage.responded) {
    return (
      <Bar>
        {claimHint ? <Hint text={T.hintClaim(INTENT_LABEL[claimHint.type]?.() ?? T.pass)} /> : <Btn label={T.hint} onPress={onHint} />}
        <TileView tile={stage.tile} width={tileWidth * 0.8} highlighted />
        {legal.hu && <Btn label={T.hu} big danger onPress={() => onAct({ type: 'hu' })} />}
        {legal.kong && <Btn label={T.kong} big primary={claimHint?.type === 'kong'} onPress={() => onAct({ type: 'kong' })} />}
        {legal.pong && <Btn label={T.pong} big primary={claimHint?.type === 'pong'} onPress={() => onAct({ type: 'pong' })} />}
        <Btn label={T.pass} primary={claimHint?.type === 'pass'} onPress={() => onAct({ type: 'pass' })} />
      </Bar>
    );
  }

  if (stage.kind === 'turn' && stage.seat === view.seat && legal.discard) {
    const selected = selectedTiles.length === 1 ? selectedTiles[0] : null;
    const voidFirst = me.voidSuit !== null && legal.discard.every((t) => suitOf(t) === me.voidSuit) && (me.hand ?? []).some((t) => suitOf(t) !== me.voidSuit);
    return (
      <Bar>
        <Hint text={voidFirst ? T.voidFirst : T.discardHint} />
        <Btn label={T.hint} onPress={onHint} />
        {legal.zimo && <Btn label={T.zimo} big danger onPress={() => onAct({ type: 'zimo' })} />}
        {legal.selfKong?.map((tile) => (
          <Btn key={tile} label={`${T.kong} ${T.tileShort((tile % 9) + 1, TILE_SUITS[suitOf(tile)])}`} onPress={() => onAct({ type: 'selfKong', tile })} />
        ))}
        {selected !== null && legal.discard.includes(selected) && (
          <Btn label={T.discard} primary onPress={() => onAct({ type: 'discard', tile: selected })} />
        )}
      </Bar>
    );
  }
  return null;
}

const INTENT_LABEL: Partial<Record<Intent['type'], () => string>> = {
  hu: () => T.hu,
  kong: () => T.kong,
  pong: () => T.pong,
  pass: () => T.pass,
};

function Bar({ children }: { children: React.ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
}

function Hint({ text }: { text: string }) {
  return <Text style={styles.hint}>{text}</Text>;
}

interface BtnProps {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  big?: boolean;
}

export function Btn({ label, onPress, disabled, primary, danger, big }: BtnProps) {
  return (
    <Pressable
      onPress={() => {
        playSfx('tap', 0.5);
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        primary && styles.primary,
        danger && styles.danger,
        big && styles.big,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.btnText, big && styles.bigText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  hint: { color: '#e8f5e9', fontSize: 13, marginRight: 4 },
  btn: {
    minWidth: 52,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#eceff1',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderColor: '#90a4ae',
  },
  primary: { backgroundColor: '#ffd54f', borderColor: '#c49000' },
  danger: { backgroundColor: '#ef5350', borderColor: '#a31515' },
  big: { minWidth: 64, minHeight: 48 },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ translateY: 2 }] },
  btnText: { fontSize: 15, fontWeight: '800', color: '#263238' },
  bigText: { fontSize: 20 },
});
