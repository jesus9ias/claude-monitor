/**
 * The subscription's 5-hour and weekly usage. Two feeds, whichever is fresher wins:
 *   - pull: Anthropic, with the OAuth token from `.env` (`usage` endpoint, or the `probe` fallback);
 *   - push: the statusline command, which Claude Code feeds with `rate_limits` (CLI sessions only).
 */
import type { Quota } from "@claude-monitor/shared";
import type { Bus } from "../bus.js";
import type { QuotaSourceSetting } from "../config.js";
import { fetchUsage, probeQuota, QuotaAuthError, type FetchFn, type QuotaReading } from "../infra/anthropic.js";

const CHECK_EVERY_MS = 30_000;
/** Idle sessions barely move the windows, so poll less. */
const IDLE_FACTOR = 4;

export interface QuotaStore {
  addQuotaSample(quota: Quota): void;
  latestQuota(): Quota | undefined;
}

export interface QuotaDeps {
  token?: string;
  source: QuotaSourceSetting;
  intervalMs: number;
  probeModel: string;
  bus: Bus;
  store?: QuotaStore;
  fetchFn?: FetchFn;
  isActive?: () => boolean;
  now?: () => number;
}

export class QuotaService {
  private quota: Quota;
  private mode: "usage" | "probe" | null;
  private lastAttempt = 0;
  private inFlight: Promise<Quota> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: QuotaDeps) {
    this.mode = !deps.token || deps.source === "off" ? null : deps.source === "probe" ? "probe" : "usage";
    const last = deps.store?.latestQuota();
    this.quota = last ?? { status: "not_configured" };
  }

  /** True when this service can pull from Anthropic. */
  get configured(): boolean {
    return this.mode !== null;
  }

  current(): Quota {
    return this.quota;
  }

  start(): void {
    if (!this.mode || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      const now = this.now();
      const every = this.deps.isActive?.() ? this.deps.intervalMs : this.deps.intervalMs * IDLE_FACTOR;
      if (now - this.lastAttempt >= every) void this.refresh();
    }, CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Overlapping calls share one request. */
  refresh(): Promise<Quota> {
    this.inFlight ??= this.pull().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  fromStatusline(reading: QuotaReading): void {
    this.set({ status: "ok", source: "statusline", fetchedAt: new Date(this.now()).toISOString(), ...reading });
  }

  private async pull(): Promise<Quota> {
    const token = this.deps.token;
    if (!this.mode || !token) return this.quota;
    this.lastAttempt = this.now();
    const mode = this.mode;
    try {
      const reading = mode === "usage" ? await fetchUsage(token, this.deps.fetchFn) : await probeQuota(token, this.deps.probeModel, this.deps.fetchFn);
      this.set({ status: "ok", source: mode, fetchedAt: new Date(this.now()).toISOString(), ...reading });
    } catch (err) {
      if (err instanceof QuotaAuthError && err.httpStatus === 403 && mode === "usage" && this.deps.source === "auto") {
        console.log("Quota: the token cannot read /api/oauth/usage (no user:profile scope). Falling back to probe.");
        this.mode = "probe";
        return this.pull();
      }
      const message = err instanceof Error ? err.message : "unknown error";
      console.error(`Quota refresh failed: ${message}`);
      this.set({ ...this.quota, status: "error", error: message });
    }
    return this.quota;
  }

  private set(next: Quota): void {
    this.quota = next;
    if (next.status === "ok") this.deps.store?.addQuotaSample(next);
    this.deps.bus.emit({ type: "quota_changed", quota: next });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
