import { type ServiceDescriptor, serviceNames } from "@openmirage/types";

export const webShell: ServiceDescriptor = {
  name: "web",
  summary: "Placeholder browser shell for the monorepo bootstrap slice."
};

export function describeWebShell(): string {
  return `${webShell.name} depends on ${serviceNames.join(", ")} contracts`;
}
