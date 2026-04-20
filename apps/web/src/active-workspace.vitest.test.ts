import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  resolveActiveWorkspace,
  writeStoredActiveWorkspaceId
} from "./active-workspace";
import { type WorkspaceDetailDto } from "@openmirage/types";
import { describe, expect, it, vi } from "vitest";

const workspaces = [
  {
    createdAt: "2026-04-18T00:00:00.000Z",
    deletedAt: null,
    id: "workspace-1",
    membershipId: "membership-1",
    name: "OpenMirage Dev",
    role: "owner",
    slug: "openmirage-dev",
    updatedAt: "2026-04-18T00:00:00.000Z"
  },
  {
    createdAt: "2026-04-18T00:00:00.000Z",
    deletedAt: null,
    id: "workspace-2",
    membershipId: "membership-2",
    name: "Client Workspace",
    role: "editor",
    slug: "client-workspace",
    updatedAt: "2026-04-18T00:00:00.000Z"
  }
] satisfies WorkspaceDetailDto[];

describe("active workspace storage", () => {
  it("reads and writes the stored active workspace id", () => {
    expect(readStoredActiveWorkspaceId()).toBeNull();

    writeStoredActiveWorkspaceId("workspace-2");

    expect(readStoredActiveWorkspaceId()).toBe("workspace-2");
  });

  it("clears stored state when given a blank workspace id", () => {
    writeStoredActiveWorkspaceId("workspace-1");
    writeStoredActiveWorkspaceId("   ");

    expect(readStoredActiveWorkspaceId()).toBeNull();
  });

  it("clears the stored active workspace id explicitly", () => {
    writeStoredActiveWorkspaceId("workspace-1");
    clearStoredActiveWorkspaceId();

    expect(readStoredActiveWorkspaceId()).toBeNull();
  });

  it("returns null when browser storage reads fail", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });

    expect(readStoredActiveWorkspaceId()).toBeNull();
    getItemSpy.mockRestore();
  });
});

describe("resolveActiveWorkspace", () => {
  it("returns the preferred workspace when it exists", () => {
    expect(resolveActiveWorkspace([...workspaces], "workspace-2")).toEqual(
      workspaces[1]
    );
  });

  it("falls back to the first available workspace when the preferred one is missing", () => {
    expect(resolveActiveWorkspace([...workspaces], "missing-workspace")).toEqual(
      workspaces[0]
    );
  });

  it("returns null when there are no accessible workspaces", () => {
    expect(resolveActiveWorkspace([], "workspace-1")).toBeNull();
  });
});
