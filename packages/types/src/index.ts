export const serviceNames = ["web", "api", "collab", "worker"] as const;

export type ServiceName = (typeof serviceNames)[number];

export interface ServiceDescriptor {
  name: ServiceName;
  summary: string;
}

export interface HealthStatus {
  service: Exclude<ServiceName, "web"> | "web";
  ok: boolean;
  details: Record<string, string>;
}
