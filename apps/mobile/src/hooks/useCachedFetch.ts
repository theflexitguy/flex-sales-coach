import { useState, useEffect, useCallback, useRef } from "react";
import { AppState } from "react-native";

/**
 * In-memory cache shared across all useCachedFetch instances.
 * Data persists as long as the app is alive — clears on full restart.
 */
const cache = new Map<string, { data: unknown; timestamp: number }>();

/** Default stale time: 60 seconds. Data older than this triggers a background refetch. */
const DEFAULT_STALE_MS = 60_000;

interface UseCachedFetchOptions {
  /** Time in ms before cached data is considered stale. Default 60s. */
  staleTime?: number;
  /** Skip fetching entirely (e.g., when a required param is missing). */
  skip?: boolean;
}

interface UseCachedFetchResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: UseCachedFetchOptions
): UseCachedFetchResult<T> {
  const staleTime = options?.staleTime ?? DEFAULT_STALE_MS;
  const skip = options?.skip ?? false;

  const cached = cache.get(key) as { data: T; timestamp: number } | undefined;

  const [data, setData] = useState<T | null>(cached?.data ?? null);
  const [loading, setLoading] = useState(!cached && !skip);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(
    async (isRefresh: boolean) => {
      if (skip) return;
      if (isRefresh) setRefreshing(true);

      try {
        const result = await fetcher();
        cache.set(key, { data: result, timestamp: Date.now() });
        if (mountedRef.current) {
          setData(result);
          setError(null);
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Fetch failed");
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, fetcher, skip]
  );

  // Initial load + stale check
  useEffect(() => {
    if (skip) return;

    if (cached) {
      const isStale = Date.now() - cached.timestamp > staleTime;
      if (isStale) {
        // Show stale data immediately, refresh in background
        fetchData(true);
      }
    } else {
      fetchData(false);
    }
  }, [key, skip]);

  // Refetch when app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && !skip) {
        const entry = cache.get(key);
        if (!entry || Date.now() - entry.timestamp > staleTime) {
          fetchData(true);
        }
      }
    });
    return () => subscription.remove();
  }, [key, staleTime, skip, fetchData]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { data, loading, refreshing, error, refresh };
}

/** Invalidate a specific cache key so the next render refetches. */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** Invalidate all cache keys matching a prefix. */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
