import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? process.env.DOMAIN_NAME ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  preview: {
    allowedHosts
  }
});
