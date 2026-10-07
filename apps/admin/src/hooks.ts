import { useCallback, useEffect, useState } from 'react';
import { errorText } from './api';

/** Loads data, keeps the previous value while reloading, exposes errors. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(errorText(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** Runs a save action, reporting success or the server's validation problems. */
export function useSave(): { busy: boolean; message: { ok: boolean; text: string } | null; run: (fn: () => Promise<unknown>, okText?: string) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, okText = '已保存，新开的牌局立即生效') => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, run };
}
