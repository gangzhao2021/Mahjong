/** Session token storage: the OS keychain / keystore on devices, localStorage on web. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'mahjong.session';
const native = Platform.OS === 'ios' || Platform.OS === 'android';

export async function loadToken(): Promise<string | null> {
  try {
    return native ? await SecureStore.getItemAsync(KEY) : await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (native) {
      if (token) await SecureStore.setItemAsync(KEY, token);
      else await SecureStore.deleteItemAsync(KEY);
    } else if (token) {
      await AsyncStorage.setItem(KEY, token);
    } else {
      await AsyncStorage.removeItem(KEY);
    }
  } catch {
    // Not persisted: the player signs in again next launch.
  }
}
