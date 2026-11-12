import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Ports come from the repo-root `.env`, like the server's. Only CLAUDE_MONITOR_* variables are read.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, "CLAUDE_MONITOR_"), ...process.env };
  const target = `http://127.0.0.1:${Number(env.CLAUDE_MONITOR_PORT) || 4317}`;
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: Number(env.CLAUDE_MONITOR_WEB_PORT) || 5173,
      strictPort: true,
      proxy: { "/api": target, "/stream": target, "/event": target, "/statusline": target },
    },
    build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
  };
});
