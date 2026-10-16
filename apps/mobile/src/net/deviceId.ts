import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

const KEY = 'mahjong.deviceId';

/**
 * Anonymous per-install identity (PRD Phase 1); becomes the guest account in Phase 3. It is the
 * guest's only credential, so it comes from the platform's secure random source, not Math.random.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing) return existing;
  } catch {
    // Storage unavailable (e.g. private browsing): fall through to a fresh id.
  }
  const id = `d_${randomUUID().replace(/-/g, '')}`;
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // Not persisted; the player simply gets a new identity next launch.
  }
  return id;
}
