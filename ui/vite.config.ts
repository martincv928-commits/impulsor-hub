import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// M1 runs the FastAPI backend on :8000 and the UI dev server on :5173.
// The Tauri shell (Checkpoint F+) points its webview at the built assets;
// during development `npm run dev` + `uvicorn` is the fastest loop.
// BUILD_BASE_PATH overrides the base path for static hosting under a
// subpath (e.g. a GitHub Pages project site at /<repo>/). Defaults to
// "/" so the dev server and the Tauri desktop build are unaffected.
export default defineConfig({
  plugins: [react()],
  base: process.env.BUILD_BASE_PATH || "/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
