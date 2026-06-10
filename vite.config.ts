import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sceneverseProfile = (
  process.env.SCENEVERSE_PROFILE ??
  process.env.VITE_SCENEVERSE_PROFILE ??
  "cloud"
).toLowerCase();
const profileProxyTarget =
  sceneverseProfile === "cloud"
    ? (process.env.CLOUD_VITE_SCENEVERSE_BACKEND_PROXY_TARGET ?? "http://18.207.53.115")
    : (process.env.LOCAL_VITE_SCENEVERSE_BACKEND_PROXY_TARGET ?? "http://localhost:8000");
const backendProxyTarget =
  process.env.VITE_SCENEVERSE_BACKEND_PROXY_TARGET ?? profileProxyTarget;

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
