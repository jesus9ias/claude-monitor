import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, connectionState, subscribe, watchConnection, type ConnectionState } from "../api";
import { useLive } from "../state/live";
import { Icon, type IconName } from "./Icon";
import { QuotaChip, QuotaIndicator } from "./QuotaIndicator";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Stream connected",
  reconnecting: "Reconnecting…",
};

function useProcessCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const load = (): void => {
      api
        .processes()
        .then((list) => setCount(list.length))
        .catch(() => undefined);
    };
    load();
    return subscribe((message) => {
      if (message.type === "process_changed") setCount(message.processes.length);
    }, load);
  }, []);
  return count;
}

const useConnection = (): ConnectionState => useSyncExternalStore(watchConnection, connectionState);

interface Destination {
  to: string;
  label: string;
  icon: IconName;
  /** Sessions stays selected inside a session view. */
  match: (path: string) => boolean;
}

const DESTINATIONS: Destination[] = [
  { to: "/", label: "Sessions", icon: "sessions", match: (p) => p === "/" || p.startsWith("/sessions/") },
  { to: "/processes", label: "Processes", icon: "processes", match: (p) => p.startsWith("/processes") },
  { to: "/quota", label: "Quota", icon: "quota", match: (p) => p.startsWith("/quota") },
];

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">
        <Icon name="pulse" />
      </span>
      <span className="brand-name">Claude Monitor</span>
    </Link>
  );
}

/**
 * The app shell's navigation: a glass side menu from 768 px up (brand, destinations with live
 * counts, compact quota card, stream state); below that a phone header and a bottom tab bar.
 */
export function SideNav() {
  const { pathname } = useLocation();
  const live = useLive((s) => s.sessions)?.filter((s) => s.status === "active").length;
  const processes = useProcessCount();
  const connection = useConnection();

  const counts: Record<string, JSX.Element | null> = {
    "/": live ? <span className="chip chip-good nav-count">{live} live</span> : null,
    "/processes": processes !== null ? <span className="nav-count muted">{processes}</span> : null,
    "/quota": null,
  };

  return (
    <>
      <aside className="side glass" aria-label="App">
        <Brand />
        <nav className="side-nav" aria-label="Main">
          {DESTINATIONS.map((d) => (
            <Link key={d.to} to={d.to} aria-current={d.match(pathname) ? "page" : undefined} className="side-link">
              <Icon name={d.icon} />
              <span className="side-label">{d.label}</span>
              {counts[d.to]}
            </Link>
          ))}
        </nav>
        <QuotaIndicator />
        <div className={`stream stream-${connection}`} role="status">
          <span className={`dot ${connection === "connected" ? "dot-live" : "dot-off"}`} aria-hidden="true" />
          {CONNECTION_LABEL[connection]}
        </div>
      </aside>

      <header className="phone-head">
        <Brand />
        <span className={`dot ${connection === "connected" ? "dot-live" : "dot-off"}`} role="img" aria-label={CONNECTION_LABEL[connection]} />
        <QuotaChip />
      </header>

      <nav className="tabbar glass" aria-label="Main">
        {DESTINATIONS.map((d) => (
          <Link key={d.to} to={d.to} aria-current={d.match(pathname) ? "page" : undefined} className="tabbar-link">
            <Icon name={d.icon} />
            {d.label}
            {d.to === "/" && live ? <span className="tabbar-badge">{live}</span> : null}
          </Link>
        ))}
      </nav>
    </>
  );
}
