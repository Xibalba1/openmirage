import { createSessionContract } from "@openmirage/auth";
import { createServiceLogger } from "@openmirage/observability";
import { type HealthStatus } from "@openmirage/types";

export function createCollabPlaceholder(): HealthStatus {
  const logger = createServiceLogger("collab");
  const session = createSessionContract();

  logger.info("collab placeholder initialized");

  return {
    service: "collab",
    ok: true,
    details: {
      websocketPath: "/collab",
      authMode: session.mode
    }
  };
}
