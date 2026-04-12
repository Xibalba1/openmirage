import { readWebEnv } from "@openmirage/config-env";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = readWebEnv(loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: env.port
    }
  };
});
