import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with settings that depend on the environment.
 * Google Sign-In's native plugin needs the iOS URL scheme from the Google
 * Cloud console, so it is only added when EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is set.
 * The China build is a separate app (PRD §41.1): its own bundle ID, and no Google services.
 * APP_ID sets the bundle ID / package when it is not the one in app.json.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  const china = process.env.EXPO_PUBLIC_REGION === 'china';
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  if (iosUrlScheme && !china) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  const appId = process.env.APP_ID ?? `${config.ios?.bundleIdentifier}${china ? '.cn' : ''}`;
  return {
    ...config,
    name: config.name ?? '四川麻将',
    slug: config.slug ?? 'sichuan-mahjong',
    plugins,
    ios: { ...config.ios, bundleIdentifier: appId },
    android: { ...config.android, package: appId },
  };
};
