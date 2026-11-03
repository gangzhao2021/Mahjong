/**
 * Table felt: a radial light in the middle fading to a darker edge, the way
 * a lamp lights a real mahjong table. Used behind every full screen.
 * The felt reaches the screen edges; its children stay inside the safe area
 * (clear of the notch, Dynamic Island and home indicator).
 */
import { createContext, useContext, useId, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useKeyboardHeight } from './useKeyboardHeight';

export const FELT = '#1f6b47';

/** How far the nearest Felt's content sits inside the screen edges, so overlays can still cover the whole screen. */
const FeltInset = createContext<EdgeInsets>({ top: 0, right: 0, bottom: 0, left: 0 });

/** Style for a dimmed overlay: it covers the whole screen, while what's on it stays inside the safe area and above the keyboard. */
export function useOverlayEdges(padding = 0): ViewStyle {
  const insets = useSafeAreaInsets();
  const felt = useContext(FeltInset);
  const keyboard = useKeyboardHeight();
  return {
    top: -felt.top,
    right: -felt.right,
    bottom: -felt.bottom,
    left: -felt.left,
    paddingTop: padding + insets.top,
    paddingRight: padding + insets.right,
    paddingBottom: padding + Math.max(insets.bottom, keyboard),
    paddingLeft: padding + insets.left,
  };
}

export function Felt({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const id = `felt${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  return (
    <View style={styles.root}>
      {/* Sized in numbers: on native a percentage size can resolve against a padded parent's content box, or keep its old value after a rotation. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg key={`${window.width}x${window.height}`} width={window.width} height={window.height} preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={id} cx="50%" cy="45%" rx="70%" ry="75%">
              <Stop offset="0" stopColor="#2c8a5c" />
              <Stop offset="0.55" stopColor="#1f6b47" />
              <Stop offset="1" stopColor="#0f3f29" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={window.width} height={window.height} fill={`url(#${id})`} />
        </Svg>
      </View>
      <View style={[styles.fill, { paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left }]}>
        <FeltInset.Provider value={insets}>
          <View style={[styles.fill, style]}>{children}</View>
        </FeltInset.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FELT, overflow: 'hidden' },
  fill: { flex: 1 },
});
