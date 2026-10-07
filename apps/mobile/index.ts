import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import App from './App';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useLocale } from './src/i18n';
import { installCrashHandlers } from './src/net/crash';

installCrashHandlers();

/** Waits for the language, and remounts the app when it changes so every screen picks up the new text. */
function Root() {
  const locale = useLocale();
  if (!locale) return null;
  return createElement(ErrorBoundary, null, createElement(App, { key: locale }));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// it also sets up the environment for Expo Go and native builds alike.
registerRootComponent(Root);
