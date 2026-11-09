import type { ReactNode } from "react";
import { TOOL_CATEGORY_LABEL, type Activity, type CategoryStats, type PipelineCall, type PipelineStats, type ToolCategory } from "@claude-monitor/shared";
import { formatDuration, formatInt, formatTime, formatTokens } from "../../../format";
import { blockById, type BlockId } from "./layout";

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

function Calls({ calls }: { calls: PipelineCall[] }) {
  if (!calls.length) return <p className="muted small">No calls yet in this session.</p>;
  return (
    <ul className="drawer-items">
      {calls.map((c, i) => (
        <li key={c.toolUseId ?? i}>
          <div className="pl-call">
            <span className={`node-status node-status-${c.status ?? "none"}`}>{c.status ?? "no result"}</span>
            <span className="tool-name">{c.name}</span>
            <span className="muted small">
              {formatTime(c.startedAt)}
              {c.durationMs !== undefined && ` · ${formatDuration(c.durationMs)}`}
              {c.agentId && " · subagent"}
            </span>
          </div>
          <div className="drawer-item-summary">{c.summary}</div>
        </li>
      ))}
    </ul>
  );
}

function Counts({ entries, unit }: { entries: [string, number][]; unit: string }) {
  if (!entries.length) return null;
  return (
    <table className="pl-counts">
      <tbody>
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([name, n]) => (
            <tr key={name}>
              <td className="ellipsis">{name}</td>
              <td className="num">
                {formatInt(n)} {unit}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function CategoryBody({ category, stats, activity, now }: { category: ToolCategory; stats: PipelineStats; activity: Activity; now: number }) {
  const c: CategoryStats = stats.categories[category];
  const current = activity.phase === "tool" && activity.tool?.category === category ? activity.tool : undefined;
  return (
    <>
      {current && (
        <p className="pl-current">
          Running <strong>{current.name}</strong>
          {current.mcpServer && ` on ${current.mcpServer}`} · {formatDuration(now - Date.parse(current.startedAt))}
        </p>
      )}
      <dl className="drawer-facts">
        <Fact label="Calls">{formatInt(c.calls)}</Fact>
        <Fact label="Errors">{formatInt(c.errors)}</Fact>
        {c.lastDurationMs !== undefined && <Fact label="Last call">{formatDuration(c.lastDurationMs)}</Fact>}
        {c.finished > 0 && <Fact label="Average">{formatDuration(c.totalDurationMs / c.finished)}</Fact>}
      </dl>
      {category === "mcp" ? (
        <>
          <h3>By server</h3>
          <table className="pl-counts">
            <tbody>
              {Object.entries(stats.mcpServers)
                .sort((a, b) => b[1].calls - a[1].calls)
                .map(([server, s]) => (
                  <tr key={server}>
                    <td>{server}</td>
                    <td className="num">
                      {s.calls} calls{s.errors ? ` · ${s.errors} err` : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : null}
      {category === "agent" && stats.agents.length > 0 && (
        <>
          <h3>Subagents</h3>
          <ul className="drawer-items">
            {stats.agents.map((a) => (
              <li key={a.agentId}>
                <div className="pl-call">
                  <span className={`node-status node-status-${a.status}`}>{a.status}</span>
                  <span className="tool-name">{a.type ?? "Subagent"}</span>
                  <span className="muted small">
                    {a.model?.replace(/^claude-/, "") ?? ""} · {formatTokens(a.tokens)} tok · {a.toolCalls} tools
                  </span>
                </div>
                {a.description && <div className="drawer-item-summary">{a.description}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>By tool</h3>
      <Counts entries={Object.entries(c.byTool)} unit="calls" />
      <h3>Recent calls</h3>
      <Calls calls={c.recent} />
    </>
  );
}

interface Props {
  block: BlockId;
  stats: PipelineStats | null;
  activity: Activity;
  now: number;
  onClose: () => void;
}

export function PipelineDrawer({ block, stats, activity, now, onClose }: Props) {
  const label = blockById.get(block)?.label ?? block;
  let body: ReactNode = <p className="muted">Loading…</p>;

  if (stats) {
    if (block.startsWith("cat:")) {
      body = <CategoryBody category={block.slice(4) as ToolCategory} stats={stats} activity={activity} now={now} />;
    } else if (block === "model") {
      const u = stats.model.usage;
      body = (
        <dl className="drawer-facts">
          {stats.model.name && <Fact label="Model">{stats.model.name}</Fact>}
          <Fact label="API messages">{formatInt(stats.model.messages)}</Fact>
          <Fact label="Thinking blocks">{formatInt(stats.model.thinkingBlocks)}</Fact>
          <Fact label="Text blocks">{formatInt(stats.model.textBlocks)}</Fact>
          <Fact label="Input">{formatInt(u.input)}</Fact>
          <Fact label="Output">{formatInt(u.output)}</Fact>
          <Fact label="Cache read">{formatInt(u.cacheRead)}</Fact>
          <Fact label="Cache write">{formatInt(u.cacheCreate)}</Fact>
        </dl>
      );
    } else if (block === "context") {
      body = (
        <>
          <dl className="drawer-facts">
            <Fact label="Current size">{formatInt(stats.context.tokens)} tokens</Fact>
            <Fact label="Window">{formatInt(stats.context.windowTokens)} tokens</Fact>
            <Fact label="Used">{Math.round((stats.context.tokens / Math.max(1, stats.context.windowTokens)) * 100)}%</Fact>
            <Fact label="Compactions">{formatInt(stats.context.compactions)}</Fact>
          </dl>
          <p className="note">Size is the prompt of the latest main-conversation message: input plus cache read and write.</p>
        </>
      );
    } else if (block === "router") {
      const rows = (Object.entries(stats.categories) as [ToolCategory, CategoryStats][])
        .filter(([, c]) => c.calls > 0)
        .map(([cat, c]): [string, number] => [TOOL_CATEGORY_LABEL[cat], c.calls]);
      body = (
        <>
          {activity.tool && (
            <p className="pl-current">
              Running <strong>{activity.tool.name}</strong> · {formatDuration(now - Date.parse(activity.tool.startedAt))}
            </p>
          )}
          <h3>Calls by category</h3>
          <Counts entries={rows} unit="calls" />
        </>
      );
    } else if (block === "you") {
      body = (
        <dl className="drawer-facts">
          <Fact label="Prompts">{formatInt(stats.prompts)}</Fact>
          <Fact label="Status">{activity.phase === "waiting_input" ? "Claude is waiting for you" : "Claude is working"}</Fact>
        </dl>
      );
    } else if (block === "output") {
      body = (
        <dl className="drawer-facts">
          <Fact label="Text blocks">{formatInt(stats.model.textBlocks)}</Fact>
          <Fact label="Output tokens">{formatInt(stats.model.usage.output)}</Fact>
        </dl>
      );
    } else if (block === "needs") {
      body = (
        <>
          <dl className="drawer-facts">
            <Fact label="Prompts">{formatInt(stats.permissionPrompts)}</Fact>
            <Fact label="Now">{activity.phase === "waiting_permission" ? "Waiting for your answer" : "Nothing pending"}</Fact>
          </dl>
          <p className="note">Counted from permission and question hooks. Needs the monitor's hooks installed.</p>
        </>
      );
    }
  }

  return (
    <aside className="drawer" aria-label={`${label} details`}>
      <div className="drawer-head">
        <h2>{label}</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {body}
    </aside>
  );
}
