import { defineConfig } from "vite";

const api = process.env.WEB_API_TARGET || "http://127.0.0.1:8000";
const port = Number(process.env.WEB_PORT || 5173);
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api))
  throw new Error("Loopback API required");
const proxy = {
  "/api": { target: api, changeOrigin: true },
  "/health": { target: api, changeOrigin: true },
  "/local-storage/wardrobe-assets/": {
    target: "http://localhost:9000",
    changeOrigin: true,
    rewrite: (path) => path.replace("/local-storage", ""),
  },
};
export default defineConfig({
  server: { host: "127.0.0.1", port, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port, strictPort: true, proxy },
});
