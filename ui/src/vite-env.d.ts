/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_AGENT_TOKEN?: string;
  readonly VITE_CLOUD_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
