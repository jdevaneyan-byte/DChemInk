import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Ketcher depends on Node-flavoured CommonJS deps (`util`, `assert`) that
  // expect a global `process`. Provide a minimal shim so the browser bundle
  // doesn't throw a ReferenceError at runtime.
  define: {
    "process.env": {},
    global: "globalThis",
  },
  build: {
    // Without manualChunks, Vite emits one ~24 MB main chunk (Ketcher + Indigo
    // dominate). Split the heavy vendors so they're cacheable independently
    // and the app shell loads quickly.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/ketcher-")) return "ketcher";
          if (id.includes("node_modules/@rdkit/")) return "rdkit";
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/")
          ) {
            return "react-vendor";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500, // ~1.5 MB; Ketcher is naturally large
  },
});
