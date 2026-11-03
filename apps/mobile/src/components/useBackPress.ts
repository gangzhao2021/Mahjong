import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Handles the Android back button while mounted; return true once it is dealt with.
 * The most recently mounted handler goes first, so a dialog closes before the screen under it reacts.
 */
export function useBackPress(handler: () => boolean) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    // BackHandler logs an error on the web and does nothing on iOS.
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
    return () => subscription.remove();
  }, []);
}
