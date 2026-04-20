import { type WorkspaceDetailDto } from "@openmirage/types";

const activeWorkspaceStorageKey = "openmirage.activeWorkspaceId";

function readStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures so route navigation still works.
  }
}

function removeStorageValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage write failures so route navigation still works.
  }
}

export function readStoredActiveWorkspaceId(): string | null {
  const value = readStorageValue(activeWorkspaceStorageKey);

  return value && value.trim() ? value : null;
}

export function writeStoredActiveWorkspaceId(workspaceId: string) {
  const trimmedWorkspaceId = workspaceId.trim();

  if (!trimmedWorkspaceId) {
    removeStorageValue(activeWorkspaceStorageKey);
    return;
  }

  writeStorageValue(activeWorkspaceStorageKey, trimmedWorkspaceId);
}

export function clearStoredActiveWorkspaceId() {
  removeStorageValue(activeWorkspaceStorageKey);
}

export function resolveActiveWorkspace(
  workspaces: WorkspaceDetailDto[],
  preferredWorkspaceId: string | null
): WorkspaceDetailDto | null {
  if (workspaces.length === 0) {
    return null;
  }

  if (preferredWorkspaceId) {
    const preferredWorkspace =
      workspaces.find((workspace) => workspace.id === preferredWorkspaceId) ??
      null;

    if (preferredWorkspace) {
      return preferredWorkspace;
    }
  }

  return workspaces[0] ?? null;
}
