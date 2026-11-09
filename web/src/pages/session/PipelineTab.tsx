import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHASE_LABEL, TOOL_CATEGORY_LABEL, type Activity, type PipelineStats, type ReplayStep } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { formatDuration, formatTime, useNow } from "../../format";
import { visualFor, type BlockId } from "./pipeline/layout";
import { PipelineDiagram } from "./pipeline/PipelineDiagram";
import { PipelineDrawer } from "./pipeline/PipelineDrawer";
import { useSessionContext } from "./SessionLayout";

const REFRESH_MS = 1000;
const REPLAY_SPEED = 4;
const REPLAY_MIN_MS = 350;
const REPLAY_MAX_MS = 2000;

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = (): void => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** A replay step, shaped as the live activity the diagram already understands. */
function stepActivity(steps: ReplayStep[], index: number): Activity {
  const step = steps[index]!;
  const previous = steps[index - 1];
  return {
    phase: step.phase,
    since: step.ts,
    tool: step.tool ? { ...step.tool, startedAt: step.ts } : undefined,
    agents: [],
    source: previous?.phase === "tool" ? "replay:after_tool" : "replay",
  };
}

export function PipelineTab() {
  const { session } = useSessionContext();
  const id = session.id;
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<BlockId | null>(null);
  const [replay, setReplay] = useState<{ steps: ReplayStep[]; index: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const now = useNow();

  const load = useCallback(() => {
    api
      .pipeline(id)
      .then((s) => {
        setStats(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [id]);

  // Counters follow new events, debounced; the phase itself comes live through the session.
  useEffect(() => {
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((message) => {
      if (message.type !== "event_added" || message.event.sessionId !== id) return;
      pending ??= setTimeout(() => {
        pending = null;
        load();
      }, REFRESH_MS);
    }, load);
    return () => {
      unsubscribe();
      if (pending) clearTimeout(pending);
    };
  }, [id, load]);

  // Advance the replay with gaps scaled down, and clamped so it neither crawls nor flickers.
  useEffect(() => {
    if (!replay) return;
    const { steps, index } = replay;
    if (index >= steps.length - 1) {
      timer.current = setTimeout(() => setReplay(null), REPLAY_MAX_MS);
    } else {
      const gap = (Date.parse(steps[index + 1]!.ts) - Date.parse(steps[index]!.ts)) / REPLAY_SPEED;
      const delay = Math.min(REPLAY_MAX_MS, Math.max(REPLAY_MIN_MS, gap));
      timer.current = setTimeout(() => setReplay({ steps, index: index + 1 }), delay);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [replay]);

  // A live session takes over from a replay as soon as it does something.
  useEffect(() => {
    if (session.status === "active") setReplay(null);
  }, [session.status]);

  const activity: Activity = replay ? stepActivity(replay.steps, replay.index) : session.activity;
  const visual = useMemo(() => visualFor(activity), [activity.phase, activity.source, activity.tool?.category, activity.agents.length]);
  const canReplay = Boolean(stats?.lastTurn.length) && session.status !== "active";

  const status = (
    <>
      <strong>{activity.tool ? `${TOOL_CATEGORY_LABEL[activity.tool.category]}: ${activity.tool.name}` : PHASE_LABEL[activity.phase]}</strong>
      {activity.tool?.mcpServer && ` on ${activity.tool.mcpServer}`}
      {replay
        ? ` · step ${replay.index + 1} of ${replay.steps.length} · ${formatTime(activity.since)}`
        : activity.phase !== "ended" && ` · ${formatDuration(now - Date.parse(activity.tool?.startedAt ?? activity.since))}`}
      {activity.agents.length > 0 && ` · ${activity.agents.length} subagent${activity.agents.length === 1 ? "" : "s"} running`}
    </>
  );

  return (
    <section className="card pipeline">
      <div className="flow-bar">
        <span className="pl-status" aria-live="polite">
          {replay && <span className="pl-replay-tag">Replay</span>}
          {status}
        </span>
        <div className="flow-actions">
          {replay ? (
            <button className="ghost" onClick={() => setReplay(null)}>
              Stop replay
            </button>
          ) : (
            <button className="ghost" disabled={!canReplay} onClick={() => stats && setReplay({ steps: stats.lastTurn, index: 0 })} title={canReplay ? "Play the last turn at 4x" : "Available when the session is not active"}>
              Replay last turn
            </button>
          )}
        </div>
      </div>
      {failed && !stats && <p className="error">The pipeline numbers could not be loaded.</p>}
      <div className="pipeline-wrap">
        <div className="pl-scroll">
          <PipelineDiagram
            visual={visual}
            stats={stats}
            selected={selected}
            onSelect={(b) => setSelected((cur) => (cur === b ? null : b))}
            mcpServer={activity.tool?.mcpServer}
            reducedMotion={reducedMotion}
          />
        </div>
        {selected && <PipelineDrawer block={selected} stats={stats} activity={activity} now={now} onClose={() => setSelected(null)} />}
      </div>
      <p className="note">
        Phases are exact at block boundaries; the moving tokens between them are a simulation. Click a block for its details.
      </p>
    </section>
  );
}
