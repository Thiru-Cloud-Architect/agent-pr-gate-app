import { cpSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        org: resolve(root, "org.html"),
      },
    },
  },
  plugins: [
    {
      name: "copy-org-sample",
      closeBundle() {
        const destination = resolve(root, "dist/data")
        mkdirSync(destination, { recursive: true })
        cpSync(resolve(root, "data"), destination, { recursive: true })
      },
    },
  ],
  resolve: {
    alias: {
      "@src": resolve(root, "../src"),
    },
  },
})
