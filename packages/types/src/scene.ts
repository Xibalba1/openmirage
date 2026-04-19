import {
  type FrameNode,
  type GroupNode,
  type PageDocumentDto,
  type PageDto,
  type SceneGraphNode
} from "./index.js";

export const DEFAULT_PAGE_WIDTH = 1440;
export const DEFAULT_PAGE_HEIGHT = 1024;
export const DEFAULT_PAGE_BACKGROUND = "#ffffff";

export interface HydratedPageScene {
  background: string;
  document: PageDocumentDto;
  height: number;
  nodesById: Record<string, SceneGraphNode>;
  page: PageDto;
  rootNodeIds: string[];
  width: number;
}

export interface NodeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface FlattenedSceneNode {
  absoluteX: number;
  absoluteX2: number | null;
  absoluteY: number;
  absoluteY2: number | null;
  bounds: NodeBounds;
  node: SceneGraphNode;
}

export interface PaintRecord extends FlattenedSceneNode {
  isContainer: boolean;
  painted: boolean;
  selectable: boolean;
}

function cloneNode(node: SceneGraphNode): SceneGraphNode {
  if (node.type === "frame" || node.type === "group") {
    return {
      ...node,
      childIds: [...node.childIds]
    };
  }

  return { ...node };
}

function isContainerNode(node: SceneGraphNode): node is FrameNode | GroupNode {
  return node.type === "frame" || node.type === "group";
}

function sortNodeIds(
  nodeIds: string[],
  nodesById: Record<string, SceneGraphNode>
): string[] {
  return [...nodeIds].sort((leftId, rightId) => {
    const left = nodesById[leftId];
    const right = nodesById[rightId];

    if (!left || !right) {
      return 0;
    }

    if (left.zIndex !== right.zIndex) {
      return left.zIndex - right.zIndex;
    }

    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }

    return left.id.localeCompare(right.id);
  });
}

function sanitizeDocument(
  pageId: string,
  document: PageDocumentDto | null | undefined
): PageDocumentDto {
  const sourceNodes = document?.nodes ?? {};
  const sourceRoots = document?.rootNodeIds ?? [];
  const nodesById: Record<string, SceneGraphNode> = {};

  for (const [nodeId, nodeValue] of Object.entries(sourceNodes)) {
    if (!nodeValue || nodeValue.id !== nodeId || nodeValue.pageId !== pageId) {
      continue;
    }

    nodesById[nodeId] = cloneNode(nodeValue);
  }

  const inferredRoots: string[] = [];
  const childrenByParent = new Map<string, string[]>();

  for (const node of Object.values(nodesById)) {
    if (!node.parentId) {
      inferredRoots.push(node.id);
      continue;
    }

    const parent = nodesById[node.parentId];

    if (!parent || !isContainerNode(parent)) {
      inferredRoots.push(node.id);
      continue;
    }

    const siblings = childrenByParent.get(parent.id) ?? [];
    siblings.push(node.id);
    childrenByParent.set(parent.id, siblings);
  }

  for (const node of Object.values(nodesById)) {
    if (!isContainerNode(node)) {
      continue;
    }

    const declaredChildIds = node.childIds.filter((childId) => {
      const childNode = nodesById[childId];
      return childNode?.parentId === node.id;
    });
    const inferredChildIds = sortNodeIds(
      (childrenByParent.get(node.id) ?? []).filter(
        (childId) => !declaredChildIds.includes(childId)
      ),
      nodesById
    );

    node.childIds = [...declaredChildIds, ...inferredChildIds];
  }

  const declaredRootIds = sourceRoots.filter((nodeId) => {
    const node = nodesById[nodeId];
    return Boolean(node && !node.parentId);
  });
  const inferredRootIds = sortNodeIds(
    inferredRoots.filter((nodeId) => !declaredRootIds.includes(nodeId)),
    nodesById
  );

  return {
    nodes: nodesById,
    pageId,
    rootNodeIds: [...declaredRootIds, ...inferredRootIds]
  };
}

export function hydratePageDocument(
  page: PageDto,
  document: PageDocumentDto | null | undefined
): HydratedPageScene {
  const sanitizedDocument = sanitizeDocument(page.id, document);

  return {
    background: page.background ?? DEFAULT_PAGE_BACKGROUND,
    document: sanitizedDocument,
    height: page.height ?? DEFAULT_PAGE_HEIGHT,
    nodesById: sanitizedDocument.nodes,
    page,
    rootNodeIds: sanitizedDocument.rootNodeIds,
    width: page.width ?? DEFAULT_PAGE_WIDTH
  };
}

function flattenNode(
  scene: HydratedPageScene,
  nodeId: string,
  parentX: number,
  parentY: number,
  records: FlattenedSceneNode[]
): NodeBounds | null {
  const node = scene.nodesById[nodeId];

  if (!node || !node.visible) {
    return null;
  }

  const absoluteX = parentX + node.x;
  const absoluteY = parentY + node.y;

  if (node.type === "frame") {
    const bounds: NodeBounds = {
      height: Math.max(1, node.height),
      width: Math.max(1, node.width),
      x: absoluteX,
      y: absoluteY
    };

    records.push({
      absoluteX,
      absoluteX2: null,
      absoluteY,
      absoluteY2: null,
      bounds,
      node
    });

    for (const childId of node.childIds) {
      flattenNode(scene, childId, absoluteX, absoluteY, records);
    }

    return bounds;
  }

  if (node.type === "group") {
    const childBounds = node.childIds
      .map((childId) => flattenNode(scene, childId, absoluteX, absoluteY, records))
      .filter((value): value is NodeBounds => value !== null);
    const bounds =
      childBounds.length === 0
        ? {
            height: Math.max(1, node.height),
            width: Math.max(1, node.width),
            x: absoluteX,
            y: absoluteY
          }
        : {
            height: Math.max(
              1,
              Math.max(...childBounds.map((child) => child.y + child.height)) -
                Math.min(...childBounds.map((child) => child.y))
            ),
            width: Math.max(
              1,
              Math.max(...childBounds.map((child) => child.x + child.width)) -
                Math.min(...childBounds.map((child) => child.x))
            ),
            x: Math.min(...childBounds.map((child) => child.x)),
            y: Math.min(...childBounds.map((child) => child.y))
          };

    records.push({
      absoluteX,
      absoluteX2: null,
      absoluteY,
      absoluteY2: null,
      bounds,
      node
    });

    return bounds;
  }

  if (node.type === "line") {
    const absoluteX2 = parentX + node.x2;
    const absoluteY2 = parentY + node.y2;
    const bounds: NodeBounds = {
      height: Math.max(1, Math.abs(absoluteY2 - absoluteY)),
      width: Math.max(1, Math.abs(absoluteX2 - absoluteX)),
      x: Math.min(absoluteX, absoluteX2),
      y: Math.min(absoluteY, absoluteY2)
    };

    records.push({
      absoluteX,
      absoluteX2,
      absoluteY,
      absoluteY2,
      bounds,
      node
    });

    return bounds;
  }

  const bounds: NodeBounds = {
    height: Math.max(1, node.height),
    width: Math.max(1, node.width),
    x: absoluteX,
    y: absoluteY
  };

  records.push({
    absoluteX,
    absoluteX2: null,
    absoluteY,
    absoluteY2: null,
    bounds,
    node
  });

  return bounds;
}

export function flattenSceneInPaintOrder(
  scene: HydratedPageScene
): FlattenedSceneNode[] {
  const records: FlattenedSceneNode[] = [];

  for (const nodeId of scene.rootNodeIds) {
    flattenNode(scene, nodeId, 0, 0, records);
  }

  return records;
}

export function createPaintRecords(scene: HydratedPageScene): PaintRecord[] {
  return flattenSceneInPaintOrder(scene).map((record) => ({
    ...record,
    isContainer:
      record.node.type === "frame" || record.node.type === "group",
    painted: record.node.type !== "group",
    selectable: !record.node.locked
  }));
}

export function getPaintOrderNodeIds(scene: HydratedPageScene): string[] {
  return flattenSceneInPaintOrder(scene).map((record) => record.node.id);
}

export function getNodePaintRecord(
  scene: HydratedPageScene,
  nodeId: string
): PaintRecord | null {
  return createPaintRecords(scene).find((record) => record.node.id === nodeId) ?? null;
}

export function getNodePath(
  scene: HydratedPageScene,
  nodeId: string
): SceneGraphNode[] {
  const path: SceneGraphNode[] = [];
  let current = scene.nodesById[nodeId];

  while (current) {
    path.unshift(current);
    current = current.parentId ? scene.nodesById[current.parentId] : undefined;
  }

  return path;
}

export function isNodeWithinScope(
  scene: HydratedPageScene,
  nodeId: string,
  scopeId: string | null
): boolean {
  if (!scopeId) {
    return true;
  }

  return getNodePath(scene, nodeId).some((node) => node.id === scopeId);
}

export function getScopedPaintRecords(
  scene: HydratedPageScene,
  scopeId: string | null
): PaintRecord[] {
  return createPaintRecords(scene).filter((record) =>
    isNodeWithinScope(scene, record.node.id, scopeId)
  );
}

export function getAbsoluteNodeBounds(
  scene: HydratedPageScene,
  nodeId: string
): NodeBounds | null {
  return getNodePaintRecord(scene, nodeId)?.bounds ?? null;
}
