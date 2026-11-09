/**
 * Browser notifications when the quota left drops to a threshold. Once per window, threshold and
 * reset: a notification shown for "5h at 20%" is not shown again until that window resets.
 */
import { useEffect } from "react";
import { dueAlerts } from "@claude-monitor/shared";
import { useLive } from "./live";

const STORE_KEY = "claude-monitor:quota-alerts-sent";

function loadSent(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSent(sent: Set<string>): void {
  try {
    // Keep it small: only the latest keys matter.
    localStorage.setItem(STORE_KEY, JSON.stringify([...sent].slice(-50)));
  } catch {
    // Storage blocked: alerts may repeat after a reload, nothing worse.
  }
}

export const notificationsSupported = (): boolean => typeof Notification !== "undefined";

/** Mount once, at the app root. */
export function useQuotaAlerts(): void {
  const quota = useLive((s) => s.quota);
  const thresholds = useLive((s) => s.meta?.quotaAlerts);

  useEffect(() => {
    if (!quota || quota.status !== "ok" || !thresholds?.length) return;
    if (!notificationsSupported() || Notification.permission !== "granted") return;
    const sent = loadSent();
    const due = dueAlerts(quota, thresholds, sent);
    if (!due.length) return;
    for (const alert of due) {
      try {
        new Notification(alert.title, { body: alert.body, tag: alert.key });
      } catch {
        // Some browsers only allow notifications from a service worker. Nothing to do.
      }
      sent.add(alert.key);
    }
    saveSent(sent);
  }, [quota, thresholds]);
}
