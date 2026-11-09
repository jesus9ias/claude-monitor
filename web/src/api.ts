import type { GitInfo, ProcessInfo, Session, SessionDetail, Stats, StatsRange, StreamMessage } from "@claude-monitor/shared";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export const api = {
  sessions: () => get<Session[]>("/api/sessions"),
  session: (id: string, before?: string) =>
    get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  stats: (range: StatsRange) => get<Stats>(`/api/stats?range=${range}`),
  git: (id: string) => get<GitInfo>(`/api/sessions/${encodeURIComponent(id)}/git`),
  processes: () => get<ProcessInfo[]>("/api/processes"),
};

type Listener = (message: StreamMessage) => void;
type ConnectionListener = () => void;

const listeners = new Set<Listener>();
const reconnectListeners = new Set<ConnectionListener>();
let source: EventSource | null = null;
let lostConnection = false;

function connect(): void {
  if (source) return;
  source = new EventSource("/stream");
  for (const type of ["session_updated", "event_added", "process_changed"] as const) {
    source.addEventListener(type, (e) => {
      const message = JSON.parse((e as MessageEvent<string>).data) as StreamMessage;
      for (const listener of listeners) listener(message);
    });
  }
  source.onerror = () => {
    lostConnection = true;
  };
  source.onopen = () => {
    if (lostConnection) {
      lostConnection = false;
      for (const listener of reconnectListeners) listener();
    }
  };
}

/** Shared stream. `onReconnect` fires after an outage, when a page should refetch what it missed. */
export function subscribe(listener: Listener, onReconnect?: ConnectionListener): () => void {
  connect();
  listeners.add(listener);
  if (onReconnect) reconnectListeners.add(onReconnect);
  return () => {
    listeners.delete(listener);
    if (onReconnect) reconnectListeners.delete(onReconnect);
  };
}
