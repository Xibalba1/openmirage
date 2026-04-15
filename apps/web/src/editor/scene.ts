import {
  type FrameNode,
  type GroupNode,
  type PageDocumentDto,
  type PageDto,
  type SceneGraphNode
} from "@openmirage/types";
import {
  DEFAULT_PAGE_BACKGROUND,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  type FlattenedSceneNode,
  type HydratedPageScene,
  type PaintRecord
} from "./types";

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

function sortNodeIds(nodeIds: string[], nodesById: Record<string, SceneGraphNode>): string[] {
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
): void {
  const node = scene.nodesById[nodeId];

  if (!node || !node.visible) {
    return;
  }

  const absoluteX = parentX + node.x;
  const absoluteY = parentY + node.y;
  const record: FlattenedSceneNode = {
    absoluteX,
    absoluteX2: node.type === "line" ? parentX + node.x2 : null,
    absoluteY,
    absoluteY2: node.type === "line" ? parentY + node.y2 : null,
    node
  };

  if (node.type === "frame") {
    records.push(record);
    for (const childId of node.childIds) {
      flattenNode(scene, childId, absoluteX, absoluteY, records);
    }
    return;
  }

  if (node.type === "group") {
    for (const childId of node.childIds) {
      flattenNode(scene, childId, absoluteX, absoluteY, records);
    }
    return;
  }

  records.push(record);
}

export function flattenSceneInPaintOrder(scene: HydratedPageScene): FlattenedSceneNode[] {
  const orderedRootIds = sortNodeIds(scene.rootNodeIds, scene.nodesById);
  const records: FlattenedSceneNode[] = [];

  for (const rootNodeId of orderedRootIds) {
    flattenNode(scene, rootNodeId, 0, 0, records);
  }

  return records;
}

export function createPaintRecords(scene: HydratedPageScene): PaintRecord[] {
  return flattenSceneInPaintOrder(scene).map((record) => ({
    ...record,
    selectable: !record.node.locked
  }));
}

