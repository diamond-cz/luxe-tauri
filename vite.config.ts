import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, "/");
  if (!normalized.includes("/node_modules/")) return undefined;
  if (
    normalized.includes("/node_modules/react/") ||
    normalized.includes("/node_modules/react-dom/") ||
    normalized.includes("/node_modules/scheduler/")
  ) {
    return "vendor-react";
  }
  if (normalized.includes("/node_modules/react-router")) return "vendor-router";
  if (
    normalized.includes("/node_modules/@fluentui/") ||
    normalized.includes("/node_modules/@griffel/") ||
    normalized.includes("/node_modules/tabster/") ||
    normalized.includes("/node_modules/keyborg/") ||
    normalized.includes("/node_modules/@floating-ui/")
  ) {
    return "vendor-fluent";
  }
  if (normalized.includes("/node_modules/@tauri-apps/")) return "vendor-tauri";
  if (normalized.includes("/node_modules/@dnd-kit/")) return "vendor-dnd";
  if (normalized.includes("/node_modules/i18next/") || normalized.includes("/node_modules/react-i18next/")) return "vendor-i18n";
  if (normalized.includes("/node_modules/zustand/") || normalized.includes("/node_modules/immer/")) return "vendor-state";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome105"
        : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
