import { readServiceEnv } from "@openmirage/config-env";

export interface SessionContract {
  mode: "magic-link-session";
  sessionCookieName: string;
}

export function createSessionContract(): SessionContract {
  const env = readServiceEnv("api");

  return {
    mode: "magic-link-session",
    sessionCookieName: env.sessionCookieName
  };
}
