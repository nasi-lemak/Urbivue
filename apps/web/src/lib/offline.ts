import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

/**
 * Offline submission queue for field crews. Writes that fail with a network
 * error are stored in localStorage and replayed in order when connectivity
 * returns (browser 'online' event, a periodic retry, or a manual sync).
 *
 * Replay semantics: a network failure stops the flush (order preserved,
 * retried later); a 4xx response drops the item — the server has rejected
 * the payload and retrying can never succeed — and keeps its label so the
 * crew can redo the work online.
 */

const QUEUE_KEY = 'urbivue.queue';
const FAILED_KEY = 'urbivue.queue.failed';
const RETRY_MS = 60_000;

export interface QueuedRequest {
  id: string;
  path: string;
  method: string;
  body: string;
  label: string;
  queuedAt: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let flushing = false;

function read(key: string): QueuedRequest[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as QueuedRequest[];
  } catch {
    return [];
  }
}

function write(key: string, items: QueuedRequest[]): void {
  localStorage.setItem(key, JSON.stringify(items));
  listeners.forEach((l) => l());
}

export function queuedRequests(): QueuedRequest[] {
  return read(QUEUE_KEY);
}

export function failedRequests(): QueuedRequest[] {
  return read(FAILED_KEY);
}

export function enqueue(path: string, method: string, body: unknown, label: string): void {
  const items = read(QUEUE_KEY);
  items.push({
    id: crypto.randomUUID(),
    path,
    method,
    body: JSON.stringify(body),
    label,
    queuedAt: new Date().toISOString(),
  });
  write(QUEUE_KEY, items);
}

export function dismissFailed(id: string): void {
  write(
    FAILED_KEY,
    read(FAILED_KEY).filter((i) => i.id !== id),
  );
}

/** True for "the request never reached the server" errors. */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError) && err instanceof TypeError;
}

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let items = read(QUEUE_KEY);
    while (items.length > 0) {
      const item = items[0];
      try {
        await api(item.path, { method: item.method, body: item.body });
        items = items.slice(1);
        write(QUEUE_KEY, items);
      } catch (err) {
        if (isNetworkError(err)) return; // still offline — retry later
        // Server rejected it; move to the failed list and continue.
        write(FAILED_KEY, [
          ...read(FAILED_KEY),
          { ...item, label: `${item.label} — ${err instanceof Error ? err.message : 'rejected'}` },
        ]);
        items = items.slice(1);
        write(QUEUE_KEY, items);
      }
    }
  } finally {
    flushing = false;
  }
}

let started = false;
function startAutoFlush(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void flushQueue());
  setInterval(() => {
    if (read(QUEUE_KEY).length > 0) void flushQueue();
  }, RETRY_MS);
}

/** Live view of the queue for UI badges; also arms the auto-flush. */
export function useOfflineQueue(): {
  pending: QueuedRequest[];
  failed: QueuedRequest[];
  flush: () => Promise<void>;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    startAutoFlush();
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { pending: queuedRequests(), failed: failedRequests(), flush: flushQueue };
}

/** Cache GET responses for offline form rendering (e.g. templates). */
export async function cachedGet<T>(path: string): Promise<T> {
  const cacheKey = `urbivue.cache:${path}`;
  try {
    const fresh = await api<T>(path);
    localStorage.setItem(cacheKey, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as T;
    }
    throw err;
  }
}
