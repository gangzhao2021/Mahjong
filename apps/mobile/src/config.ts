import { Platform } from 'react-native';

/**
 * Game server base URL. Override with EXPO_PUBLIC_SERVER_URL
 * (e.g. http://192.168.1.20:8787 when running on a physical phone).
 */
export const SERVER_HTTP: string = (
  process.env.EXPO_PUBLIC_SERVER_URL ??
  // The Android emulator reaches the host machine through 10.0.2.2.
  (Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787')
).replace(/\/$/, '');

export const SERVER_WS = `${SERVER_HTTP.replace(/^http/, 'ws')}/ws`;

/** Google Sign-In client ids from the Google Cloud console (unset = Google login unavailable). */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** China filing numbers shown in About (PRD Appendix D.1 / D.7); unset until filed. */
export const ICP_NUMBER = process.env.EXPO_PUBLIC_ICP;
export const APP_FILING_NUMBER = process.env.EXPO_PUBLIC_APP_FILING;
/** Age-appropriateness label (适龄提示); must match the official assessment for the store listing. */
export const AGE_RATING = process.env.EXPO_PUBLIC_AGE_RATING ?? '16+';
