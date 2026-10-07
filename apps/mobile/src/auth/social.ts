/**
 * Platform sign-in SDKs. Each returns the credential the server verifies,
 * or null if the player cancelled. Native-only SDKs are loaded lazily so the
 * app still runs in Expo Go and on web, where they report "unavailable".
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config';

export class SignInUnavailable extends Error {}

export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<{ identityToken: string; authorizationCode: string | null } | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    if (!credential.identityToken) return null;
    return { identityToken: credential.identityToken, authorizationCode: credential.authorizationCode };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

export async function signInWithGoogle(): Promise<{ idToken: string } | null> {
  if (Platform.OS === 'web' || !GOOGLE_WEB_CLIENT_ID) throw new SignInUnavailable();
  let google: typeof import('@react-native-google-signin/google-signin');
  try {
    google = await import('@react-native-google-signin/google-signin');
  } catch {
    // Native module missing (Expo Go): needs a development build.
    throw new SignInUnavailable();
  }
  const { GoogleSignin, isSuccessResponse } = google;
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response) || !response.data.idToken) return null;
  return { idToken: response.data.idToken };
}

/** WeChat login needs the WeChat Open SDK in a development / release build (China build). */
export async function signInWithWechat(): Promise<{ code: string } | null> {
  throw new SignInUnavailable();
}
