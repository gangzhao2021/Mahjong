import { Platform } from 'react-native';

/**
 * Game server WebSocket URL. Override with EXPO_PUBLIC_SERVER_URL
 * (e.g. ws://192.168.1.20:8787 when running on a physical phone).
 */
export const SERVER_URL: string =
  process.env.EXPO_PUBLIC_SERVER_URL ??
  // The Android emulator reaches the host machine through 10.0.2.2.
  (Platform.OS === 'android' ? 'ws://10.0.2.2:8787' : 'ws://localhost:8787');
