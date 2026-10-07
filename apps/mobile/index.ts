import { registerRootComponent } from 'expo';

import { createElement } from 'react';
import App from './App';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { installCrashHandlers } from './src/net/crash';

installCrashHandlers();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(() => createElement(ErrorBoundary, null, createElement(App)));
