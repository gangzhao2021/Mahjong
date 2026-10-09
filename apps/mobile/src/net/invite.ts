/**
 * Friend-room invites: share a link to the server's /join/<code> page, and pick
 * up a room number from an opened link — sichuanmahjong://join/123456 in the
 * app, or ?room=123456 on the web version.
 */
import { useEffect, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';
import { SERVER_HTTP } from '../config';
import { getLocale, T } from '../strings';

export function inviteUrl(code: string): string {
  return `${SERVER_HTTP}/join/${code}?lang=${getLocale()}`;
}

/** The room number in an invite link, if it is one. */
export function roomFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?&]room=(\d{6})\b/) ?? url.match(/\/join\/(\d{6})\b/);
  return m ? m[1] : null;
}

/** Opens the system share sheet; on the web without one, copies the invite instead. Resolves to what happened. */
export async function shareInvite(code: string): Promise<'shared' | 'copied' | 'failed'> {
  const message = T.friend.inviteText(code, inviteUrl(code));
  try {
    if (Platform.OS !== 'web') {
      await Share.share({ message });
      return 'shared';
    }
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      await nav.share({ text: message });
      return 'shared';
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(message);
      return 'copied';
    }
  } catch {
    // Cancelled or blocked; fall through.
  }
  return 'failed';
}

/** A room number from the link that opened the app (or arrives while it runs), until `clear` is called. */
export function usePendingInvite(): { code: string | null; clear(): void } {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Linking.getInitialURL()
      .then((url) => live && setCode((c) => c ?? roomFromUrl(url)))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => {
      const room = roomFromUrl(url);
      if (room) setCode(room);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return {
    code,
    clear: () => {
      setCode(null);
      // On the web, drop ?room= so a refresh doesn't join again.
      if (Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]room=/.test(window.location.search)) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    },
  };
}
