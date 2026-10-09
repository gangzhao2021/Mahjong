/** Springs its children in (scale + fade) once when mounted; static if the system asks for reduced motion. */
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { getSettings } from '../settings';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => (reduceMotion = v))
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduceMotion = v));

export function PopIn({ children, style, from = 0.6, pointerEvents }: { children: ReactNode; style?: StyleProp<ViewStyle>; from?: number; pointerEvents?: 'none' | 'auto' }) {
  // The player's animation setting works like the system's reduce-motion switch.
  const [still] = useState(() => reduceMotion || !getSettings().animations);
  const [progress] = useState(() => new Animated.Value(still ? 1 : 0));
  useEffect(() => {
    if (still) return;
    Animated.spring(progress, { toValue: 1, friction: 6, tension: 140, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [progress, still]);
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}
