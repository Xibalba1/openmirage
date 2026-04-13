import { readWebEnv } from "@openmirage/config-env";

declare global {
  interface Window {
    __OPENMIRAGE_RUNTIME__?: Record<string, string | undefined>;
  }
}

export function readRuntimeWebEnv() {
  return readWebEnv({
    ...import.meta.env,
    ...(window.__OPENMIRAGE_RUNTIME__ ?? {})
  });
}
