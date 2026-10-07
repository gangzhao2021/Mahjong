import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'mahjong.deviceId';

/** Anonymous per-install identity (PRD Phase 1); becomes the guest account in Phase 3. */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing) return existing;
  } catch {
    // Storage unavailable (e.g. private browsing): fall through to a fresh id.
  }
  const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // Not persisted; the player simply gets a new identity next launch.
  }
  return id;
}
