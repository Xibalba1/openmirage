export type ServiceEnvName = "api" | "collab" | "web" | "worker";

export interface ServiceEnvShape {
  service: ServiceEnvName;
  sessionCookieName: string;
}

export function readServiceEnv(service: ServiceEnvName): ServiceEnvShape {
  return {
    service,
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "openmirage_session"
  };
}
