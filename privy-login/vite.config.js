import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Builds the Privy login island into the office's static folder:
//   public/office/privy/kult-privy.js (+ lazily loaded chunks)
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: { "process.env.NODE_ENV": JSON.stringify("production"), global: "globalThis" },
  build: {
    outDir: fileURLToPath(new URL("../public/office/privy", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    lib: { entry: fileURLToPath(new URL("./main.js", import.meta.url)), formats: ["es"], fileName: () => "kult-privy.js" },
    rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } }
  }
});
