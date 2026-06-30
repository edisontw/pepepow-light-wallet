import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  base: "/wallet/",
  plugins: [react(), wasm(), nodePolyfills()],
  define: { global: "globalThis" },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    target: "esnext",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          i18n: ["i18next", "react-i18next"],
          qrcode: ["qrcode"]
        }
      }
    }
  },
  resolve: { preserveSymlinks: true }
})
