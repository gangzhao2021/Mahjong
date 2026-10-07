/**
 * Crash reporting (PRD §50 Phase 6): uncaught JS errors and render crashes
 * are sent to the game server's /telemetry/errors endpoint. Reporting is
 * best-effort and must never throw or loop on its own failures.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { SERVER_HTTP } from '../config';

let token: string | null = null;
const lastSent = new Map<string, number>();

/** The current session, so reports can be tied to a player (optional). */
export function setCrashReportToken(t: string | null): void {
  token = t;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const message = `${e.name}: ${e.message}`.slice(0, 500);
    // The same error repeating (e.g. every frame) is reported once a minute.
    const now = Date.now();
    if (now - (lastSent.get(message) ?? 0) < 60_000) return;
    lastSent.set(message, now);
    void fetch(`${SERVER_HTTP}/telemetry/errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        message,
        stack: e.stack?.slice(0, 4000),
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version,
        context,
      }),
    }).catch(() => undefined);
  } catch {
    // Never let reporting fail loudly.
  }
}

let installed = false;

/** Hooks the runtime's global error handlers; the default behaviour (red box, crash) is kept. */
export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => reportError(e.error ?? e.message, { source: 'window.error' }));
    window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));
    return;
  }
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    reportError(error, { source: 'global', fatal: !!fatal });
    previous(error, fatal);
  });
}
