import {
  PROTOCOL_VERSION,
  STREAM_MESSAGE_TYPES,
  type GitInfo,
  type Graph,
  type PipelineStats,
  type ProcessInfo,
  type Quota,
  type QuotaAttributionRow,
  type QuotaSample,
  type ServerMeta,
  type Session,
  type SessionDetail,
  type Stats,
  type StatsRange,
  type StreamMessage,
} from "@claude-monitor/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

const sessionUrl = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;

export const api = {
  meta: () => request<ServerMeta>("/api/meta"),
  sessions: () => request<Session[]>("/api/sessions"),
  session: (id: string, before?: string) => request<SessionDetail>(`${sessionUrl(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  graph: (id: string, group: boolean) => request<Graph>(`${sessionUrl(id)}/graph${group ? "" : "?group=0"}`),
  pipeline: (id: string) => request<PipelineStats>(`${sessionUrl(id)}/pipeline`),
  git: (id: string) => request<GitInfo>(`${sessionUrl(id)}/git`),
  stats: (range: StatsRange) => request<Stats>(`/api/stats?range=${range}`),
  processes: () => request<ProcessInfo[]>("/api/processes"),
  quota: () => request<Quota>("/api/quota"),
  quotaHistory: (days: number) => request<QuotaSample[]>(`/api/quota/history?days=${days}`),
  quotaAttribution: (since: string) => request<QuotaAttributionRow[]>(`/api/quota/attribution?since=${encodeURIComponent(since)}`),
  refreshQuota: () => request<Quota>("/api/quota/refresh", { method: "POST" }),
};

type Listener = (message: StreamMessage) => void;
type ConnectionListener = () => void;

const listeners = new Set<Listener>();
const reconnectListeners = new Set<ConnectionListener>();
let source: EventSource | null = null;
let lostConnection = false;

/** A UI built for another protocol would misread the stream: reload, at most once a minute. */
function checkVersion(version: number): void {
  if (version === PROTOCOL_VERSION) return;
  const key = "claude-monitor:reloaded-for-protocol";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key)) || 0;
    if (Date.now() - last > 60_000) sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: still reload, the guard just won't hold.
  }
  if (Date.now() - last > 60_000) window.location.reload();
}

function connect(): void {
  if (source) return;
  source = new EventSource("/stream");
  for (const type of STREAM_MESSAGE_TYPES) {
    source.addEventListener(type, (e) => {
      const message = JSON.parse((e as MessageEvent<string>).data) as StreamMessage;
      if (message.type === "hello") checkVersion(message.version);
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
