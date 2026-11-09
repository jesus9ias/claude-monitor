/**
 * One classification of Claude Code tools, shared by the server (activity) and the UI (pipeline,
 * badges). Unknown tools fall into "other"; MCP tools are recognised by their `mcp__<server>__<tool>`
 * name, whatever the server.
 */
export type ToolCategory =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "mcp"
  | "skill"
  | "agent"
  | "web"
  | "planning"
  | "other";

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  "read",
  "search",
  "edit",
  "shell",
  "mcp",
  "skill",
  "agent",
  "web",
  "planning",
  "other",
];

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  read: "Read files",
  search: "Search",
  edit: "Write code",
  shell: "Shell",
  mcp: "MCP",
  skill: "Skill",
  agent: "Subagent",
  web: "Web",
  planning: "Planning",
  other: "Other tool",
};

const BY_NAME: Record<string, ToolCategory> = {
  Read: "read",
  NotebookRead: "read",
  LS: "read",
  Glob: "search",
  Grep: "search",
  ToolSearch: "search",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  BashOutput: "shell",
  KillShell: "shell",
  KillBash: "shell",
  PowerShell: "shell",
  Monitor: "shell",
  Skill: "skill",
  SlashCommand: "skill",
  Agent: "agent",
  Task: "agent",
  SendMessage: "agent",
  WebFetch: "web",
  WebSearch: "web",
  TodoWrite: "planning",
  TaskCreate: "planning",
  TaskUpdate: "planning",
  TaskList: "planning",
  TaskGet: "planning",
  EnterPlanMode: "planning",
  ExitPlanMode: "planning",
  AskUserQuestion: "planning",
};

export interface ToolRef {
  name: string;
  category: ToolCategory;
  /** For MCP tools: the server part of `mcp__<server>__<tool>`. */
  mcpServer?: string;
}

export function classifyTool(name: string): ToolRef {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const cut = rest.indexOf("__");
    return { name, category: "mcp", mcpServer: cut > 0 ? rest.slice(0, cut) : rest || undefined };
  }
  return { name, category: BY_NAME[name] ?? "other" };
}

/** True for tools that start a subagent, whose work shows up as a sidechain. */
export const isAgentTool = (name: string | undefined): boolean => name === "Agent" || name === "Task";
