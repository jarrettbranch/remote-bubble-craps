import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? process.env.DOMAIN_NAME ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        authCallback: resolve(__dirname, "auth-callback.html")
      }
    }
  },
  server: {
    port: 5173
  },
  preview: {
    allowedHosts
  }
});
