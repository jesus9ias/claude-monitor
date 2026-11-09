/**
 * The ONLY code that talks to Anthropic, and the only outbound traffic of this app. It runs only
 * when the person puts an OAuth token in `.env`. The token goes in the Authorization header and
 * nowhere else: not in errors, not in logs, not in what is returned.
 */
import type { Quota, QuotaWindow } from "@claude-monitor/shared";

const API = "https://api.anthropic.com";
const OAUTH_BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 10_000;
/** Inference with a subscription OAuth token is only accepted with Claude Code's system prompt. */
const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

export type FetchFn = typeof fetch;

export type QuotaReading = Pick<Quota, "fiveHour" | "sevenDay" | "sevenDayByModel">;

/** The token was refused, or lacks the scope this call needs. */
export class QuotaAuthError extends Error {
  constructor(readonly httpStatus: number) {
    super(httpStatus === 403 ? "token lacks the needed scope" : "token rejected");
  }
}

export class QuotaHttpError extends Error {
  constructor(readonly httpStatus: number) {
    super(`Anthropic answered ${httpStatus}`);
  }
}

const authHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "anthropic-beta": OAUTH_BETA,
  "content-type": "application/json",
});

async function call(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // Network errors can echo the request; only the kind of failure is kept.
    const name = err instanceof Error ? err.name : "Error";
    throw new Error(name === "TimeoutError" ? "Anthropic did not answer in time" : "could not reach Anthropic");
  }
  if (res.status === 401 || res.status === 403) throw new QuotaAuthError(res.status);
  return res;
}

/** GET /api/oauth/usage: what `/usage` in Claude Code shows. Free; needs the `user:profile` scope. */
export async function fetchUsage(token: string, fetchFn: FetchFn = fetch): Promise<QuotaReading> {
  const res = await call(fetchFn, `${API}/api/oauth/usage`, { method: "GET", headers: authHeaders(token) });
  if (!res.ok) throw new QuotaHttpError(res.status);
  return parseUsageBody(await res.json());
}

/** Utilization here is already a percentage; resets_at is an ISO date or null. */
export function parseUsageBody(body: unknown): QuotaReading {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const win = (v: unknown): QuotaWindow | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const w = v as Record<string, unknown>;
    if (typeof w.utilization !== "number" || !Number.isFinite(w.utilization)) return undefined;
    return { usedPct: w.utilization, resetsAt: typeof w.resets_at === "string" ? w.resets_at : undefined };
  };
  const byModel: Record<string, QuotaWindow> = {};
  for (const [key, label] of [
    ["seven_day_opus", "Opus"],
    ["seven_day_sonnet", "Sonnet"],
  ] as const) {
    const w = win(b[key]);
    if (w) byModel[label] = w;
  }
  return { fiveHour: win(b.five_hour), sevenDay: win(b.seven_day), sevenDayByModel: Object.keys(byModel).length ? byModel : undefined };
}

/**
 * A 1-token request to the cheapest model; the rate-limit headers carry the utilization. Works with
 * inference-only tokens (`claude setup-token`), at the price of a sliver of the 5-hour window.
 */
export async function probeQuota(token: string, model: string, fetchFn: FetchFn = fetch): Promise<QuotaReading> {
  const res = await call(fetchFn, `${API}/v1/messages`, {
    method: "POST",
    headers: { ...authHeaders(token), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      system: CLAUDE_CODE_SYSTEM,
      messages: [{ role: "user", content: "quota" }],
    }),
  });
  // A 429 still carries the headers, and is exactly when they matter most.
  const reading = parseRateLimitHeaders(res.headers);
  if (!res.ok && res.status !== 429) throw new QuotaHttpError(res.status);
  if (!reading.fiveHour && !reading.sevenDay) throw new Error("no rate-limit headers in the answer");
  return reading;
}

/** Header utilization is a fraction (0-1); reset is Unix seconds. */
export function parseRateLimitHeaders(headers: Headers): QuotaReading {
  const win = (claim: string): QuotaWindow | undefined => {
    const u = headers.get(`anthropic-ratelimit-unified-${claim}-utilization`);
    if (u === null || !Number.isFinite(Number(u))) return undefined;
    const reset = headers.get(`anthropic-ratelimit-unified-${claim}-reset`);
    const resetS = reset === null ? NaN : Number(reset);
    return {
      usedPct: Number(u) * 100,
      resetsAt: Number.isFinite(resetS) ? new Date(resetS * 1000).toISOString() : undefined,
    };
  };
  return { fiveHour: win("5h"), sevenDay: win("7d") };
}
