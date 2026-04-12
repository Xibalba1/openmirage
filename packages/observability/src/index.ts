import { type ServiceName } from "@openmirage/types";

export interface ServiceLogger {
  info(message: string): void;
}

export function createServiceLogger(service: ServiceName): ServiceLogger {
  return {
    info(message: string) {
      console.log(`[${service}] ${message}`);
    }
  };
}
