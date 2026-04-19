import {
  createPaintRecords as createSharedPaintRecords,
  flattenSceneInPaintOrder,
  getAbsoluteNodeBounds,
  getNodePath as getSharedNodePath,
  getPaintOrderNodeIds,
  getScopedPaintRecords as getSharedScopedPaintRecords,
  hydratePageDocument,
  isNodeWithinScope
} from "@openmirage/types";

import type { HydratedPageScene, PaintRecord } from "./types";

export { flattenSceneInPaintOrder, getAbsoluteNodeBounds, getPaintOrderNodeIds, hydratePageDocument, isNodeWithinScope };

export function createPaintRecords(scene: HydratedPageScene): PaintRecord[] {
  return createSharedPaintRecords(scene);
}

export function getScopedPaintRecords(
  records: PaintRecord[],
  scene: HydratedPageScene,
  scopeId: string | null
): PaintRecord[] {
  if (!scopeId) {
    return records;
  }

  return getSharedScopedPaintRecords(scene, scopeId);
}

export function getNodePaintRecord(
  records: PaintRecord[],
  nodeId: string
): PaintRecord | null {
  return records.find((record) => record.node.id === nodeId) ?? null;
}

export function getNodePath(
  scene: HydratedPageScene,
  nodeId: string
): string[] {
  return getSharedNodePath(scene, nodeId).map((node) => node.id);
}
