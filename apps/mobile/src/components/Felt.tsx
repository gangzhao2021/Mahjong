/**
 * Table felt: a radial light in the middle fading to a darker edge, the way
 * a lamp lights a real mahjong table. Used behind every full screen.
 */
import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export const FELT = '#1f6b47';

export function Felt({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const id = `felt${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[styles.root, style]}>
      {/* A plain wrapper: on native, 100% inside a padded parent means its content box, leaving a gap at the edges. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={id} cx="50%" cy="45%" rx="70%" ry="75%">
              <Stop offset="0" stopColor="#2c8a5c" />
              <Stop offset="0.55" stopColor="#1f6b47" />
              <Stop offset="1" stopColor="#0f3f29" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FELT, overflow: 'hidden' },
});
