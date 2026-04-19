import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateExportJobs,
  describeExportJobState,
  isExportActionDisabled,
  shouldPollExportJob,
  type ExportJobState
} from "./export-jobs";

const baseJob = {
  completedAt: null,
  createdAt: "2026-04-18T00:00:00.000Z",
  errorMessage: null,
  fileId: "file-1",
  format: "png" as const,
  id: "job-1",
  outputAssetId: null,
  pageId: "page-1",
  requestedByUserId: "user-1",
  startedAt: null,
  status: "queued" as const,
  updatedAt: "2026-04-18T00:00:00.000Z"
};

test("export job helpers gate create access for share links and derive polling states", () => {
  assert.equal(canCreateExportJobs(null), true);
  assert.equal(canCreateExportJobs("share-token"), false);

  const queued: ExportJobState = {
    job: baseJob,
    status: "polling"
  };
  const running: ExportJobState = {
    job: {
      ...baseJob,
      startedAt: "2026-04-18T00:00:01.000Z",
      status: "running"
    },
    status: "polling"
  };
  const succeeded: ExportJobState = {
    job: {
      ...baseJob,
      completedAt: "2026-04-18T00:00:02.000Z",
      outputAssetId: "asset-1",
      startedAt: "2026-04-18T00:00:01.000Z",
      status: "succeeded"
    },
    status: "succeeded"
  };

  assert.equal(shouldPollExportJob(queued), true);
  assert.equal(shouldPollExportJob(running), true);
  assert.equal(shouldPollExportJob(succeeded), false);
  assert.equal(isExportActionDisabled({ job: null, status: "submitting" }), true);
  assert.equal(isExportActionDisabled(succeeded), false);
});

test("export job helpers describe queued, running, failed, and cancelled states", () => {
  assert.equal(
    describeExportJobState({
      job: baseJob,
      status: "polling"
    }),
    "Queued"
  );
  assert.equal(
    describeExportJobState({
      job: {
        ...baseJob,
        startedAt: "2026-04-18T00:00:01.000Z",
        status: "running"
      },
      status: "polling"
    }),
    "Running"
  );
  assert.equal(
    describeExportJobState({
      job: {
        ...baseJob,
        errorMessage: "render failed",
        startedAt: "2026-04-18T00:00:01.000Z",
        status: "failed"
      },
      message: "render failed",
      status: "failed"
    }),
    "render failed"
  );
  assert.equal(
    describeExportJobState({
      job: {
        ...baseJob,
        status: "cancelled"
      },
      message: "cancelled",
      status: "failed"
    }),
    "cancelled"
  );
});
