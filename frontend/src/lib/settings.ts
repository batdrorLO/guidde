import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type SettingKey = 'days' | 'minTenure';

/**
 * The CSM's scoring settings (analysis period, minimum tenure) live in the URL like the
 * list filters do, so they survive a refresh and a link reproduces the exact view.
 * The values are passed straight to the API, which validates them and does all the
 * scoring; an absent value means "server default".
 */
export function useScoringSettings() {
  const [params, setParams] = useSearchParams();
  const days = params.get('days') ?? '';
  const minTenure = params.get('minTenure') ?? '';

  /** Just the settings, as a query string ("" when both are defaults). */
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (days) q.set('days', days);
    if (minTenure) q.set('minTenure', minTenure);
    return q.toString();
  }, [days, minTenure]);

  const update = useCallback(
    (values: Partial<Record<SettingKey, string | undefined>>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(values)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  /** An in-app link that keeps the current settings. */
  const link = useCallback((path: string) => (query ? `${path}?${query}` : path), [query]);

  return { days, minTenure, query, update, link };
}
