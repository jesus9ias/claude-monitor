import os from "node:os";
import path from "node:path";

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.CLAUDE_MONITOR_PORT ?? 4317);

const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");

export const PROJECTS_DIR = process.env.CLAUDE_MONITOR_PROJECTS_DIR ?? path.join(claudeDir, "projects");
export const SESSIONS_DIR = process.env.CLAUDE_MONITOR_SESSIONS_DIR ?? path.join(claudeDir, "sessions");
