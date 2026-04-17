import {
  type AuthContext,
  canWriteMembershipRole,
  createEditorAccess,
  type EditorAccessDto
} from "@openmirage/types";

export function findWorkspaceRole(
  authContext: AuthContext,
  workspaceId: string
): AuthContext["memberships"][number]["role"] | null {
  return (
    authContext.memberships.find(
      (membership) => membership.workspaceId === workspaceId
    )?.role ?? null
  );
}

export function hasWorkspaceMembership(
  authContext: AuthContext,
  workspaceId: string
): boolean {
  return findWorkspaceRole(authContext, workspaceId) !== null;
}

export function hasWritableWorkspaceAccess(
  authContext: AuthContext,
  workspaceId: string
): boolean {
  return canWriteMembershipRole(findWorkspaceRole(authContext, workspaceId));
}

export function getWorkspaceEditorAccess(
  authContext: AuthContext,
  workspaceId: string
): EditorAccessDto | null {
  const role = findWorkspaceRole(authContext, workspaceId);

  if (!role) {
    return null;
  }

  return createEditorAccess({
    role,
    source: "membership"
  });
}
