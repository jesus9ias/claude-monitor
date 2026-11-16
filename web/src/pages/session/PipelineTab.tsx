import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PHASE_LABEL,
  TOOL_CATEGORY_LABEL,
  type Activity,
  type Phase,
  type PipelineStats,
  type ReplayStep,
  type ToolCategory,
} from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { CATEGORY_ICON, Icon } from "../../components/Icon";
import { formatDuration, formatTime, useNow } from "../../format";
import { CATEGORY_ORDER, visualFor, type BlockId } from "./pipeline/layout";
import { PipelineDiagram } from "./pipeline/PipelineDiagram";
import { PipelineDrawer } from "./pipeline/PipelineDrawer";
import { useSessionContext } from "./SessionLayout";

const REFRESH_MS = 1000;
const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];
const DEFAULT_SPEED: Speed = 4;
/** At 4x a step is held 350 ms to 2 s; slower speeds stretch both bounds. */
const HOLD_MIN_AT_4X = 350;
const HOLD_MAX_AT_4X = 2000;

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

const PHASE_TONE: Record<Phase, string> = {
  requesting: "model",
  thinking: "model",
  writing: "model",
  tool: "tool",
  waiting_permission: "warn",
  waiting_input: "idle",
  compacting: "context",
  ended: "idle",
};

const stepLabel = (s: ReplayStep): string => (s.tool ? `${TOOL_CATEGORY_LABEL[s.tool.category]}: ${s.tool.name}` : PHASE_LABEL[s.phase]);

interface Replay {
  steps: ReplayStep[];
  index: number;
  playing: boolean;
  speed: Speed;
}

/** The last turn's tool calls per category, with the time spent until the next step. */
function lastTurnByCategory(steps: ReplayStep[]): { category: ToolCategory; calls: number; ms: number }[] {
  const out = new Map<ToolCategory, { calls: number; ms: number }>();
  steps.forEach((s, i) => {
    if (s.phase !== "tool" || !s.tool) return;
    const next = steps[i + 1];
    const ms = next ? Math.max(0, Date.parse(next.ts) - Date.parse(s.ts)) : 0;
    const cur = out.get(s.tool.category) ?? { calls: 0, ms: 0 };
    out.set(s.tool.category, { calls: cur.calls + 1, ms: cur.ms + ms });
  });
  return CATEGORY_ORDER.map((category) => ({ category, ...(out.get(category) ?? { calls: 0, ms: 0 }) }));
}

function Transport({ replay, setReplay, onLive }: { replay: Replay; setReplay: (r: Replay) => void; onLive: () => void }) {
  const { steps, index, playing, speed } = replay;
  const last = steps.length - 1;
  const at = last > 0 ? (index / last) * 100 : 0;
  const go = (i: number) => setReplay({ ...replay, index: Math.max(0, Math.min(last, i)) });
  return (
    <div className="transport control">
      <div className="transport-buttons">
        <button className="btn btn-icon" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step">
          <Icon name="previous" size={16} />
        </button>
        <button
          className="btn btn-icon btn-primary"
          onClick={() => setReplay({ ...replay, playing: !playing, index: !playing && index >= last ? 0 : index })}
          aria-label={playing ? "Pause replay" : "Play replay"}
        >
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button className="btn btn-icon" onClick={() => go(index + 1)} disabled={index >= last} aria-label="Next step">
          <Icon name="next" size={16} />
        </button>
      </div>
      <div className="timeline-bar">
        <div className="tl-track" role="group" aria-label="Replay steps">
          <div className="tl-fill" style={{ width: `${at}%` }} />
          {steps.map((s, i) => (
            <button
              key={i}
              className={`tl-tick tone-${PHASE_TONE[s.phase]} ${i === index ? "is-current" : ""}`}
              style={{ left: `${last > 0 ? (i / last) * 100 : 0}%`, ...(steps.length > 60 ? { width: 3, marginLeft: -1.5 } : {}) }}
              onClick={() => go(i)}
              aria-label={`Step ${i + 1}: ${stepLabel(s)}`}
              aria-current={i === index ? "step" : undefined}
            />
          ))}
        </div>
        <div className="tl-labels muted small">
          <span>{formatTime(steps[0]!.ts)}</span>
          <span className="tl-legend">
            <span className="lg lg-model" /> model <span className="lg lg-tool" /> tool <span className="lg lg-warn" /> input
          </span>
          <span>{formatTime(steps[last]!.ts)}</span>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setReplay({ ...replay, speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <button className="btn" onClick={onLive}>
        Back to live
      </button>
    </div>
  );
}

export function PipelineTab() {
  const { session } = useSessionContext();
  const id = session.id;
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<BlockId | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
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

  // While playing, advance with the real gaps scaled by the speed and clamped; pause on the last step.
  useEffect(() => {
    if (!replay?.playing) return;
    const { steps, index, speed } = replay;
    if (index >= steps.length - 1) {
      setReplay({ ...replay, playing: false });
      return;
    }
    const scale = DEFAULT_SPEED / speed;
    const gap = (Date.parse(steps[index + 1]!.ts) - Date.parse(steps[index]!.ts)) / speed;
    const delay = Math.min(HOLD_MAX_AT_4X * scale, Math.max(HOLD_MIN_AT_4X * scale, gap));
    timer.current = setTimeout(() => setReplay({ ...replay, index: index + 1 }), delay);
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
  const byCategory = useMemo(() => lastTurnByCategory(stats?.lastTurn ?? []), [stats]);
  const turnCalls = byCategory.reduce((n, c) => n + c.calls, 0);
  const maxCalls = Math.max(0, ...byCategory.map((c) => c.calls));

  return (
    <div className="pipeline-layout">
      <section className="card pipeline">
        <div className="flow-bar">
          <span className="pl-status" aria-live="polite">
            {replay ? <span className="chip chip-accent">Replay</span> : session.status === "active" && <span className="chip chip-good">Live</span>}
            <strong>{activity.tool ? `${TOOL_CATEGORY_LABEL[activity.tool.category]}: ${activity.tool.name}` : PHASE_LABEL[activity.phase]}</strong>
            {activity.tool?.mcpServer && ` on ${activity.tool.mcpServer}`}
            {replay
              ? ` · step ${replay.index + 1} of ${replay.steps.length} · ${formatTime(activity.since)}`
              : activity.phase !== "ended" && ` · ${formatDuration(now - Date.parse(activity.tool?.startedAt ?? activity.since))}`}
            {activity.agents.length > 0 && ` · ${activity.agents.length} subagent${activity.agents.length === 1 ? "" : "s"} running`}
          </span>
          {!replay && (
            <button
              className="btn"
              disabled={!canReplay}
              onClick={() => stats && setReplay({ steps: stats.lastTurn, index: 0, playing: true, speed: DEFAULT_SPEED })}
              title={canReplay ? "Play the last turn" : "Available when the session is not active"}
            >
              <Icon name="play" size={16} />
              Replay last turn
            </button>
          )}
        </div>
        {failed && !stats && <p className="error">The pipeline numbers could not be loaded.</p>}
        <div className="pipeline-wrap">
          <div className="pl-scroll well">
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
        {replay && <Transport replay={replay} setReplay={setReplay} onLive={() => setReplay(null)} />}
        <p className="note">
          Phases are exact at block boundaries; the moving tokens between them are a simulation. Click a block for its details.
        </p>
      </section>

      <section className="card last-turn">
        <div className="chart-head">
          <h2>Last turn by category</h2>
          <span className="muted small">
            {turnCalls} {turnCalls === 1 ? "call" : "calls"}
          </span>
        </div>
        {turnCalls === 0 && <p className="empty">No tool calls in the last turn.</p>}
        <ul className="cat-bars">
          {byCategory.map((c) => (
            <li key={c.category} className={c.calls === 0 ? "is-unused" : undefined}>
              <Icon name={CATEGORY_ICON[c.category]} size={16} />
              <span>{c.category === "agent" ? "Subagents" : TOOL_CATEGORY_LABEL[c.category]}</span>
              <span className="hbar">
                <span style={{ width: `${maxCalls ? (c.calls / maxCalls) * 100 : 0}%`, background: "var(--ember)" }} />
              </span>
              <strong>
                {c.calls}
                {c.ms > 0 && <span className="muted"> {formatDuration(c.ms)}</span>}
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
