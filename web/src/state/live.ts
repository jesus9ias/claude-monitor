/**
 * App-wide live state: the session list and the quota, kept current from the stream. Pages read it
 * with useLive instead of each fetching and subscribing on its own. Page-specific data (events,
 * graph, series) stays in the page.
 */
import { useSyncExternalStore } from "react";
import type { Quota, ServerMeta, Session } from "@claude-monitor/shared";
import { api, subscribe } from "../api";

export interface LiveState {
  sessions: Session[] | null;
  sessionsError: string | null;
  quota: Quota | null;
  meta: ServerMeta | null;
}

let state: LiveState = { sessions: null, sessionsError: null, quota: null, meta: null };
const watchers = new Set<() => void>();
let started = false;

function set(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const w of watchers) w();
}

const byRecent = (a: Session, b: Session): number => b.lastEventAt.localeCompare(a.lastEventAt);

function upsert(session: Session): void {
  if (!state.sessions) return;
  set({ sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)].sort(byRecent) });
}

function loadAll(): void {
  api
    .sessions()
    .then((sessions) => set({ sessions, sessionsError: null }))
    .catch(() => set({ sessionsError: "Can't reach the monitor server." }));
  api.quota().then((quota) => set({ quota })).catch(() => undefined);
  api.meta().then((meta) => set({ meta })).catch(() => undefined);
}

function start(): void {
  if (started) return;
  started = true;
  loadAll();
  subscribe((message) => {
    switch (message.type) {
      case "session_updated":
        upsert(message.session);
        break;
      case "activity_changed": {
        const current = state.sessions?.find((s) => s.id === message.sessionId);
        if (current) upsert({ ...current, activity: message.activity });
        break;
      }
      case "quota_updated":
        set({ quota: message.quota });
        break;
      default:
        break;
    }
  }, loadAll);
}

function watch(w: () => void): () => void {
  watchers.add(w);
  return () => watchers.delete(w);
}

/** The selector must return something stable (a field, an item), not a new object each call. */
export function useLive<T>(selector: (s: LiveState) => T): T {
  start();
  return useSyncExternalStore(watch, () => selector(state));
}

export const useSession = (id: string): Session | undefined => useLive((s) => s.sessions?.find((x) => x.id === id));
