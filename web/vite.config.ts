import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = "http://127.0.0.1:4317";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": target, "/stream": target, "/event": target },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
});
