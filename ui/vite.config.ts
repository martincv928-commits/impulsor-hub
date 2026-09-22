import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// M1 runs the FastAPI backend on :8000 and the UI dev server on :5173.
// The Tauri shell (Checkpoint F+) points its webview at the built assets;
// during development `npm run dev` + `uvicorn` is the fastest loop.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
