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
    const options: ClaimOption[] = [];
    if (legal.hu) options.push('hu');
    if (legal.kong) options.push('kong');
    if (legal.pong) options.push('pong');
    options.push('pass');
    return <ClaimFan tile={stage.tile} tileWidth={tileWidth} options={options} suggested={claimHint?.type ?? null} onAct={(type) => onAct({ type })} onHint={onHint} />;
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

type ClaimOption = 'hu' | 'kong' | 'pong' | 'pass';

/** Colour per claim: win red, kong purple, pong orange; pass stays a quiet outline. */
const CLAIM_STYLE: Record<ClaimOption, { fill: string; edge: string; ink: string }> = {
  hu: { fill: '#e53935', edge: '#9a1b1b', ink: '#fff' },
  kong: { fill: '#7b4bc4', edge: '#4e2c86', ink: '#fff' },
  pong: { fill: '#ef8f1f', edge: '#a85d00', ink: '#fff' },
  pass: { fill: 'rgba(255,255,255,0.14)', edge: 'rgba(255,255,255,0.55)', ink: '#e8f5e9' },
};

const CLAIM_LABEL: Record<ClaimOption, () => string> = { hu: () => T.hu, kong: () => T.kong, pong: () => T.pong, pass: () => T.pass };

/** Size of the claim fan for a given hand tile width (the table keeps other things clear of it). */
export function claimFanSize(tileWidth: number): { button: number; radius: number; width: number } {
  const button = Math.round(Math.max(50, tileWidth * 1.15));
  const radius = Math.round(button * 1.3);
  return { button, radius, width: radius * 2 + button + 8 };
}

/**
 * The claim choices fanned out in a half circle around the tile on offer, so
 * every option is about the same reach. It floats above the hand (absolute),
 * so the table layout doesn't jump when a claim comes up.
 */
function ClaimFan({
  tile,
  tileWidth,
  options,
  suggested,
  onAct,
  onHint,
}: {
  tile: Tile;
  tileWidth: number;
  options: ClaimOption[];
  suggested: string | null;
  onAct(type: ClaimOption): void;
  onHint(): void;
}) {
  const { button, radius, width } = claimFanSize(tileWidth);
  const centerTile = Math.round(tileWidth * 0.85);
  const height = radius + button / 2 + centerTile * 1.4 * 0.5 + 12;
  const cx = width / 2;
  const cy = height - (centerTile * 1.36) / 2 - 4;
  // Spread over an arc from upper left (165°) to upper right (15°), so even two options form a fan.
  const angles = options.length === 1 ? [90] : options.map((_, i) => 165 - (150 * i) / (options.length - 1));
  return (
    <View style={[styles.fan, { width, height }]} pointerEvents="box-none">
      <View style={[styles.fanTile, { left: cx - centerTile / 2, top: cy - (centerTile * 1.36) / 2 }]}>
        <TileView tile={tile} width={centerTile} highlighted />
      </View>
      {options.map((option, i) => {
        const a = (angles[i] * Math.PI) / 180;
        const look = CLAIM_STYLE[option];
        const isSuggested = suggested === option;
        const size = option === 'pass' ? Math.round(button * 0.86) : button;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={CLAIM_LABEL[option]()}
            onPress={() => {
              playSfx('tap', 0.5);
              onAct(option);
            }}
            style={({ pressed }) => [
              styles.fanButton,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                left: cx + radius * Math.cos(a) - size / 2,
                top: cy - radius * Math.sin(a) - size / 2,
                backgroundColor: look.fill,
                borderColor: look.edge,
                borderWidth: option === 'pass' ? 2 : 0,
                borderBottomWidth: option === 'pass' ? 2 : 5,
              },
              isSuggested && styles.fanSuggested,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.fanText, { color: look.ink, fontSize: Math.round(size * (option === 'pass' ? 0.36 : 0.44)) }]}>{CLAIM_LABEL[option]()}</Text>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityLabel={T.hint} onPress={onHint} style={({ pressed }) => [styles.fanHint, pressed && styles.pressed]}>
        <Text style={styles.fanHintText}>💡</Text>
      </Pressable>
      {suggested && <Text style={styles.fanSuggestion}>{T.hintClaim(CLAIM_LABEL[suggested as ClaimOption]?.() ?? T.pass)}</Text>}
    </View>
  );
}

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
  fan: { position: 'absolute', right: 0, bottom: 0 },
  fanTile: { position: 'absolute' },
  fanButton: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fanSuggested: { shadowColor: '#ffd54f', shadowOpacity: 1, shadowRadius: 14, borderColor: '#ffd54f', borderWidth: 3 },
  fanText: { fontWeight: '900' },
  fanHint: { position: 'absolute', right: 0, top: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  fanHintText: { fontSize: 16 },
  fanSuggestion: { position: 'absolute', right: 40, top: 7, color: '#ffe082', fontSize: 13, fontWeight: '800' },
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
