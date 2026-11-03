import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

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
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
    return () => subscription.remove();
  }, []);
}
