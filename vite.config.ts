import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const HUB_URL = "http://localhost:3000"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // The Interchange hub (interchange/, `bin/dev`) serves the API and the
    // auth cookie; proxying keeps both on this origin in development.
    proxy: {
      "/api": {
        target: HUB_URL,
        // better-auth rejects a sign-in whose Origin is not the hub's own
        // (INVALID_ORIGIN), so present proxied requests as same-origin.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (proxyReq.getHeader("origin")) {
              proxyReq.setHeader("origin", HUB_URL)
            }
          })
        },
      },
    },
  },
  preview: {
    allowedHosts: process.env.RAILWAY_PUBLIC_DOMAIN
      ? [process.env.RAILWAY_PUBLIC_DOMAIN]
      : [],
    proxy: {
      "/api": process.env.HUB_URL ?? HUB_URL,
    },
  },
})
