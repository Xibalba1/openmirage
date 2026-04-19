import { type ExportJobDto } from "@openmirage/types";

export type ExportJobState =
  | { job: ExportJobDto | null; message?: string; status: "idle" }
  | { job: ExportJobDto | null; status: "submitting" }
  | { job: ExportJobDto; status: "polling" }
  | { job: ExportJobDto; status: "succeeded" }
  | { job: ExportJobDto | null; message: string; status: "failed" };

export function canCreateExportJobs(shareToken: string | null): boolean {
  return !shareToken;
}

export function isTerminalExportJobStatus(
  status: ExportJobDto["status"]
): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

export function shouldPollExportJob(state: ExportJobState): boolean {
  return (
    (state.status === "polling" || state.status === "submitting") &&
    state.job !== null &&
    !isTerminalExportJobStatus(state.job.status)
  );
}

export function describeExportJobState(state: ExportJobState): string | null {
  if (state.status === "idle") {
    return state.message ?? null;
  }

  if (state.status === "submitting") {
    return "Submitting export job...";
  }

  if (state.status === "failed") {
    return state.message;
  }

  if (state.status === "polling") {
    if (state.job.status === "queued") {
      return "Queued";
    }

    if (state.job.status === "running") {
      return "Running";
    }
  }

  if (state.status === "succeeded") {
    return "Succeeded";
  }

  if (state.job.status === "failed") {
    return state.job.errorMessage ?? "Failed";
  }

  if (state.job.status === "cancelled") {
    return "Cancelled";
  }

  return null;
}

export function isExportActionDisabled(state: ExportJobState): boolean {
  return state.status === "submitting" || shouldPollExportJob(state);
}
