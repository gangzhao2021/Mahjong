/** Springs its children in (scale + fade) once when mounted; static if the system asks for reduced motion. */
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => (reduceMotion = v))
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduceMotion = v));

export function PopIn({ children, style, from = 0.6, pointerEvents }: { children: ReactNode; style?: StyleProp<ViewStyle>; from?: number; pointerEvents?: 'none' | 'auto' }) {
  const [progress] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(progress, { toValue: 1, friction: 6, tension: 140, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [progress]);
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}
