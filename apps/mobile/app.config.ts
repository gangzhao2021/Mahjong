import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with settings that depend on the environment.
 * Google Sign-In's native plugin needs the iOS URL scheme from the Google
 * Cloud console, so it is only added when EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is set.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  if (iosUrlScheme) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  return { ...config, name: config.name ?? '四川麻将', slug: config.slug ?? 'sichuan-mahjong', plugins };
};
