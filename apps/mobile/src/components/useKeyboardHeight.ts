import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** How far the on-screen keyboard reaches up from the bottom of the screen, 0 while it is hidden. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // iOS announces the keyboard early enough to move with it; Android only has the "did" events.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // Android leaves the navigation bar out of the height it reports.
  return height > 0 && Platform.OS === 'android' ? height + insets.bottom : height;
}
