/**
 * Traditional tile faces: Dots (筒) as rings in the classic arrangements,
 * Bamboo (条) as jointed sticks with a bird on the one, Characters (万) as
 * the Chinese numeral over a red 萬. Drawn as vectors so they stay crisp at
 * every size. English players also get a small index digit on Characters.
 */
import { rankOf, suitOf, type Tile } from '@mahjong/engine';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { getLocale, RANK_NAMES_ZH } from '../strings';

const BLUE = '#1d4f9a';
const GREEN = '#1e7a3c';
const RED = '#b3261e';
const FACE = '#fbf7ec';
const INK = '#1d2b5a';

/** Face drawing area: 60 × 82 units (the tile's 1 : 1.36 shape). */
const VIEWBOX = '0 0 60 82';

type Dot = [x: number, y: number, color: string];

const DOTS: Record<number, { r: number; dots: Dot[] }> = {
  2: { r: 11, dots: [[30, 23, GREEN], [30, 59, BLUE]] },
  3: { r: 9, dots: [[15, 17, BLUE], [30, 41, RED], [45, 65, GREEN]] },
  4: { r: 10, dots: [[18, 24, BLUE], [42, 24, GREEN], [18, 58, GREEN], [42, 58, BLUE]] },
  5: { r: 9, dots: [[16, 18, BLUE], [44, 18, GREEN], [30, 41, RED], [16, 64, GREEN], [44, 64, BLUE]] },
  6: { r: 8, dots: [[19, 15, GREEN], [41, 15, GREEN], [19, 45, RED], [41, 45, RED], [19, 67, RED], [41, 67, RED]] },
  7: {
    r: 7,
    dots: [[14, 11, GREEN], [30, 21, GREEN], [46, 31, GREEN], [19, 52, RED], [41, 52, RED], [19, 70, RED], [41, 70, RED]],
  },
  8: {
    r: 7.5,
    dots: [[19, 12, BLUE], [41, 12, BLUE], [19, 31, BLUE], [41, 31, BLUE], [19, 51, BLUE], [41, 51, BLUE], [19, 70, BLUE], [41, 70, BLUE]],
  },
  9: {
    r: 7,
    dots: [[14, 16, BLUE], [30, 16, BLUE], [46, 16, BLUE], [14, 41, RED], [30, 41, RED], [46, 41, RED], [14, 66, GREEN], [30, 66, GREEN], [46, 66, GREEN]],
  },
};

function Ring({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill={color} />
      <Circle cx={x} cy={y} r={r * 0.62} fill={FACE} />
      <Circle cx={x} cy={y} r={r * 0.3} fill={color} />
    </G>
  );
}

function DotsFace({ rank }: { rank: number }) {
  if (rank === 1) {
    // The big ornate one.
    return (
      <G>
        <Circle cx={30} cy={41} r={22} fill={GREEN} />
        <Circle cx={30} cy={41} r={18} fill={FACE} />
        <Circle cx={30} cy={41} r={15} fill={RED} />
        <Circle cx={30} cy={41} r={10} fill={FACE} />
        <Circle cx={30} cy={41} r={6} fill={BLUE} />
        <Circle cx={30} cy={41} r={2.5} fill={FACE} />
      </G>
    );
  }
  const { r, dots } = DOTS[rank];
  return (
    <G>
      {dots.map(([x, y, c], i) => (
        <Ring key={i} x={x} y={y} r={r} color={c} />
      ))}
    </G>
  );
}

type Stick = [x: number, y: number, color: string];

const STICKS: Record<number, { len: number; w: number; sticks: Stick[] }> = {
  2: { len: 28, w: 8, sticks: [[30, 23, GREEN], [30, 59, GREEN]] },
  3: { len: 28, w: 8, sticks: [[30, 23, GREEN], [18, 59, GREEN], [42, 59, GREEN]] },
  4: { len: 28, w: 8, sticks: [[18, 23, GREEN], [42, 23, BLUE], [18, 59, BLUE], [42, 59, GREEN]] },
  5: { len: 26, w: 7, sticks: [[14, 22, GREEN], [46, 22, BLUE], [30, 41, RED], [14, 60, BLUE], [46, 60, GREEN]] },
  6: { len: 28, w: 7, sticks: [[15, 23, GREEN], [30, 23, GREEN], [45, 23, GREEN], [15, 59, BLUE], [30, 59, BLUE], [45, 59, BLUE]] },
  7: {
    len: 20,
    w: 7,
    sticks: [[30, 14, RED], [15, 42, GREEN], [30, 42, GREEN], [45, 42, GREEN], [15, 67, BLUE], [30, 67, BLUE], [45, 67, BLUE]],
  },
  8: {
    len: 28,
    w: 6,
    sticks: [[12, 23, GREEN], [24, 23, GREEN], [36, 23, GREEN], [48, 23, GREEN], [12, 59, BLUE], [24, 59, BLUE], [36, 59, BLUE], [48, 59, BLUE]],
  },
  9: {
    len: 20,
    w: 7,
    sticks: [[15, 16, GREEN], [30, 16, RED], [45, 16, BLUE], [15, 41, GREEN], [30, 41, RED], [45, 41, BLUE], [15, 66, GREEN], [30, 66, RED], [45, 66, BLUE]],
  },
};

function StickShape({ x, y, len, w, color }: { x: number; y: number; len: number; w: number; color: string }) {
  const top = y - len / 2;
  return (
    <G>
      <Rect x={x - w / 2} y={top} width={w} height={len} rx={w / 2} fill={color} />
      {/* Bamboo joints */}
      <Line x1={x - w / 2} y1={y} x2={x + w / 2} y2={y} stroke={FACE} strokeWidth={1.4} />
      <Line x1={x} y1={top + 2.5} x2={x} y2={top + len - 2.5} stroke={FACE} strokeWidth={0.9} strokeOpacity={0.55} />
    </G>
  );
}

function BambooFace({ rank }: { rank: number }) {
  if (rank === 1) {
    // The one of bamboo is traditionally a bird.
    return (
      <G>
        <Path d="M30 50 L18 76 M30 50 L30 78 M30 50 L42 76" stroke={RED} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={18} cy={75} r={3.5} fill={BLUE} />
        <Circle cx={30} cy={77} r={3.5} fill={BLUE} />
        <Circle cx={42} cy={75} r={3.5} fill={BLUE} />
        <Ellipse cx={30} cy={40} rx={12} ry={15} fill={GREEN} />
        <Path d="M22 36 Q30 46 38 36" stroke={FACE} strokeWidth={1.6} fill="none" />
        <Circle cx={30} cy={19} r={7} fill={GREEN} />
        <Circle cx={32} cy={18} r={1.8} fill={FACE} />
        <Path d="M36.5 19 L43 21 L36.5 23 Z" fill={RED} />
        <Path d="M27 12 L25 6 M30 11.5 L30 5 M33 12 L35 6" stroke={RED} strokeWidth={1.6} strokeLinecap="round" />
      </G>
    );
  }
  const { len, w, sticks } = STICKS[rank];
  return (
    <G>
      {sticks.map(([x, y, c], i) => (
        <StickShape key={i} x={x} y={y} len={len} w={w} color={c} />
      ))}
    </G>
  );
}

function TileFaceView({ tile, width, height }: { tile: Tile; width: number; height: number }) {
  const suit = suitOf(tile);
  const rank = rankOf(tile);
  if (suit === 0) {
    // Characters: Chinese numeral over a red 萬.
    const english = getLocale() === 'en';
    return (
      <View style={[styles.chars, { width, height }]}>
        <Text style={[styles.numeral, { fontSize: Math.round(width * 0.44), lineHeight: Math.round(width * 0.5) }]}>{RANK_NAMES_ZH[rank - 1]}</Text>
        <Text style={[styles.wan, { fontSize: Math.round(width * 0.42), lineHeight: Math.round(width * 0.48) }]}>萬</Text>
        {english && width >= 34 && <Text style={[styles.index, { fontSize: Math.max(7, Math.round(width * 0.2)) }]}>{rank}</Text>}
      </View>
    );
  }
  return (
    <Svg width={width} height={height} viewBox={VIEWBOX}>
      {suit === 2 ? <DotsFace rank={rank} /> : <BambooFace rank={rank} />}
    </Svg>
  );
}

export const TileFace = memo(TileFaceView);

const styles = StyleSheet.create({
  chars: { alignItems: 'center', justifyContent: 'center' },
  numeral: { color: INK, fontWeight: '900', includeFontPadding: false },
  wan: { color: RED, fontWeight: '900', includeFontPadding: false },
  index: { position: 'absolute', top: 1, left: 3, color: INK, fontWeight: '700' },
});
