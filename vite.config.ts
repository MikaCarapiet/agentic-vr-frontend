import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendProxyTarget =
  process.env.VITE_SCENEVERSE_BACKEND_PROXY_TARGET ?? "http://18.207.53.115";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/backend": {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend/, ""),
      },
    },
  },
});
