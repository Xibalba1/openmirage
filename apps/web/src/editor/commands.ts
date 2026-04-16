import {
  type CreateNodeCommand,
  type DeleteNodeCommand,
  type EditorCommand,
  type FrameNode,
  type GroupNode,
  type GroupNodesCommand,
  type LineNode,
  type MoveNodeCommand,
  type NodeGeometryUpdate,
  type PageDocumentDto,
  type ReorderNodeCommand,
  type ResizeNodeCommand,
  type SceneGraphNode,
  type UngroupNodeCommand,
  type UpdateNodeCommand
} from "@openmirage/types";
import { type NodeBounds, type Point } from "./types";

const IMMUTABLE_NODE_KEYS = new Set(["id", "type", "pageId", "parentId", "childIds"]);

function cloneNode(node: SceneGraphNode): SceneGraphNode {
  if (node.type === "frame" || node.type === "group") {
    return {
      ...node,
      childIds: [...node.childIds]
    };
  }

  return { ...node };
}

function cloneDocument(document: PageDocumentDto): PageDocumentDto {
  const nodes: Record<string, SceneGraphNode> = {};

  for (const [nodeId, node] of Object.entries(document.nodes)) {
    nodes[nodeId] = cloneNode(node);
  }

  return {
    nodes,
    pageId: document.pageId,
    rootNodeIds: [...document.rootNodeIds]
  };
}

export function isContainerNode(node: SceneGraphNode | null | undefined): node is FrameNode | GroupNode {
  return node?.type === "frame" || node?.type === "group";
}

function clampDimension(value: number): number {
  return Math.max(1, Number.isFinite(value) ? value : 1);
}

function cloneIds(ids: string[]): string[] {
  return [...ids];
}

function insertAtIndex(ids: string[], value: string, index: number | null): string[] {
  const next = cloneIds(ids);
  const safeIndex =
    index === null ? next.length : Math.max(0, Math.min(index, next.length));

  next.splice(safeIndex, 0, value);
  return next;
}

function removeIds(ids: string[], values: Set<string>): string[] {
  return ids.filter((id) => !values.has(id));
}

function getOrderedSiblingIds(
  document: PageDocumentDto,
  parentId: string | null
): string[] {
  if (!parentId) {
    return cloneIds(document.rootNodeIds);
  }

  const parent = document.nodes[parentId];
  return isContainerNode(parent) ? cloneIds(parent.childIds) : [];
}

function setOrderedSiblingIds(
  document: PageDocumentDto,
  parentId: string | null,
  childIds: string[]
): void {
  if (!parentId) {
    document.rootNodeIds = childIds;
    return;
  }

  const parent = document.nodes[parentId];

  if (isContainerNode(parent)) {
    parent.childIds = childIds;
  }
}

function normalizeSiblingZIndices(document: PageDocumentDto, parentId: string | null): void {
  const ids = getOrderedSiblingIds(document, parentId);

  ids.forEach((nodeId, index) => {
    const node = document.nodes[nodeId];

    if (!node) {
      return;
    }

    node.zIndex = index;
  });
}

function touchNode(node: SceneGraphNode): void {
  node.updatedAt = new Date().toISOString();
}

function normalizeDocumentZIndices(document: PageDocumentDto): void {
  normalizeSiblingZIndices(document, null);

  for (const node of Object.values(document.nodes)) {
    if (!isContainerNode(node)) {
      continue;
    }

    normalizeSiblingZIndices(document, node.id);
  }
}

function getAncestorIds(document: PageDocumentDto, nodeId: string): string[] {
  const ancestorIds: string[] = [];
  let current = document.nodes[nodeId];
  const seen = new Set<string>();

  while (current?.parentId) {
    if (seen.has(current.parentId)) {
      break;
    }

    seen.add(current.parentId);
    ancestorIds.push(current.parentId);
    current = document.nodes[current.parentId];
  }

  return ancestorIds;
}

function hasLockedAncestorOrSelf(document: PageDocumentDto, nodeId: string): boolean {
  const node = document.nodes[nodeId];

  if (!node) {
    return true;
  }

  if (node.locked) {
    return true;
  }

  return getAncestorIds(document, nodeId).some((ancestorId) => document.nodes[ancestorId]?.locked);
}

function isVisibilityOrLockOnlyPatch(patch: Partial<SceneGraphNode>): boolean {
  const keys = Object.keys(patch);

  return keys.length > 0 && keys.every((key) => key === "locked" || key === "visible");
}

function sanitizePatch(patch: Partial<SceneGraphNode>): Partial<SceneGraphNode> {
  const nextPatch: Partial<SceneGraphNode> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (IMMUTABLE_NODE_KEYS.has(key)) {
      continue;
    }

    (nextPatch as Record<string, unknown>)[key] = value;
  }

  return nextPatch;
}

export function collectDescendantIds(
  document: PageDocumentDto,
  nodeId: string,
  target = new Set<string>()
): Set<string> {
  if (target.has(nodeId)) {
    return target;
  }

  const node = document.nodes[nodeId];

  if (!node) {
    return target;
  }

  target.add(nodeId);

  if (!isContainerNode(node)) {
    return target;
  }

  for (const childId of node.childIds) {
    collectDescendantIds(document, childId, target);
  }

  return target;
}

export function getTopLevelNodeIds(
  document: PageDocumentDto,
  nodeIds: string[]
): string[] {
  const nodeIdSet = new Set(nodeIds);

  return nodeIds.filter((nodeId) =>
    !getAncestorIds(document, nodeId).some((ancestorId) => nodeIdSet.has(ancestorId))
  );
}

export function isNodeWithinScope(
  document: PageDocumentDto,
  nodeId: string,
  scopeId: string | null
): boolean {
  if (!scopeId) {
    return true;
  }

  if (nodeId === scopeId) {
    return true;
  }

  return getAncestorIds(document, nodeId).includes(scopeId);
}

export function getNodeAbsolutePosition(
  document: PageDocumentDto,
  nodeId: string
): Point | null {
  const node = document.nodes[nodeId];

  if (!node) {
    return null;
  }

  if (!node.parentId) {
    return { x: node.x, y: node.y };
  }

  const parentPosition = getNodeAbsolutePosition(document, node.parentId);

  if (!parentPosition) {
    return { x: node.x, y: node.y };
  }

  return {
    x: parentPosition.x + node.x,
    y: parentPosition.y + node.y
  };
}

export function getNodeBounds(
  document: PageDocumentDto,
  nodeId: string
): NodeBounds | null {
  const node = document.nodes[nodeId];

  if (!node) {
    return null;
  }

  const absolute = getNodeAbsolutePosition(document, nodeId);

  if (!absolute) {
    return null;
  }

  if (node.type === "line") {
    const x1 = absolute.x;
    const y1 = absolute.y;
    const x2 = absolute.x - node.x + node.x2;
    const y2 = absolute.y - node.y + node.y2;

    return {
      height: Math.max(1, Math.abs(y2 - y1)),
      width: Math.max(1, Math.abs(x2 - x1)),
      x: Math.min(x1, x2),
      y: Math.min(y1, y2)
    };
  }

  if (node.type === "group") {
    const childBounds = node.childIds
      .map((childId) => getNodeBounds(document, childId))
      .filter((value): value is NodeBounds => value !== null);

    if (childBounds.length === 0) {
      return {
        height: clampDimension(node.height),
        width: clampDimension(node.width),
        x: absolute.x,
        y: absolute.y
      };
    }

    const minX = Math.min(...childBounds.map((bounds) => bounds.x));
    const minY = Math.min(...childBounds.map((bounds) => bounds.y));
    const maxX = Math.max(...childBounds.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...childBounds.map((bounds) => bounds.y + bounds.height));

    return {
      height: clampDimension(maxY - minY),
      width: clampDimension(maxX - minX),
      x: minX,
      y: minY
    };
  }

  return {
    height: clampDimension(node.height),
    width: clampDimension(node.width),
    x: absolute.x,
    y: absolute.y
  };
}

function updateLineDimensions(node: LineNode): void {
  node.width = Math.max(1, Math.abs(node.x2 - node.x));
  node.height = Math.max(1, Math.abs(node.y2 - node.y));
}

function normalizeGroupNode(
  document: PageDocumentDto,
  nodeId: string,
  parentAbsolute: Point
): NodeBounds | null {
  const node = document.nodes[nodeId];

  if (!node) {
    return null;
  }

  if (node.type === "line") {
    updateLineDimensions(node);
  }

  if (!isContainerNode(node)) {
    return getNodeBounds(document, nodeId);
  }

  const currentAbsolute = {
    x: parentAbsolute.x + node.x,
    y: parentAbsolute.y + node.y
  };

  if (node.type === "frame") {
    for (const childId of node.childIds) {
      normalizeGroupNode(document, childId, currentAbsolute);
    }

    return {
      height: clampDimension(node.height),
      width: clampDimension(node.width),
      x: currentAbsolute.x,
      y: currentAbsolute.y
    };
  }

  const childBounds = node.childIds
    .map((childId) => normalizeGroupNode(document, childId, currentAbsolute))
    .filter((value): value is NodeBounds => value !== null);

  if (childBounds.length === 0) {
    node.width = clampDimension(node.width);
    node.height = clampDimension(node.height);

    return {
      height: node.height,
      width: node.width,
      x: currentAbsolute.x,
      y: currentAbsolute.y
    };
  }

  const minX = Math.min(...childBounds.map((bounds) => bounds.x));
  const minY = Math.min(...childBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...childBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...childBounds.map((bounds) => bounds.y + bounds.height));
  const shiftX = currentAbsolute.x - minX;
  const shiftY = currentAbsolute.y - minY;

  for (const childId of node.childIds) {
    const child = document.nodes[childId];

    if (!child) {
      continue;
    }

    child.x += shiftX;
    child.y += shiftY;
  }

  node.x = minX - parentAbsolute.x;
  node.y = minY - parentAbsolute.y;
  node.width = clampDimension(maxX - minX);
  node.height = clampDimension(maxY - minY);

  return {
    height: node.height,
    width: node.width,
    x: minX,
    y: minY
  };
}

function normalizeGroups(document: PageDocumentDto): void {
  for (const rootNodeId of document.rootNodeIds) {
    normalizeGroupNode(document, rootNodeId, { x: 0, y: 0 });
  }
}

function applyGeometryUpdate(document: PageDocumentDto, update: NodeGeometryUpdate): void {
  const node = document.nodes[update.nodeId];

  if (!node) {
    return;
  }

  node.x = update.x;
  node.y = update.y;
  node.width = clampDimension(update.width);
  node.height = clampDimension(update.height);
  touchNode(node);

  if (node.type === "line") {
    node.x2 = update.x2 ?? node.x2;
    node.y2 = update.y2 ?? node.y2;
    updateLineDimensions(node);
  }
}

function canMutateNode(
  document: PageDocumentDto,
  nodeId: string,
  command: EditorCommand
): boolean {
  if (command.type === "update-node" && isVisibilityOrLockOnlyPatch(command.patch)) {
    return Boolean(document.nodes[nodeId]);
  }

  return !hasLockedAncestorOrSelf(document, nodeId);
}

function canMutateParent(document: PageDocumentDto, parentId: string | null): boolean {
  if (!parentId) {
    return true;
  }

  const parent = document.nodes[parentId];

  return Boolean(parent && isContainerNode(parent) && !hasLockedAncestorOrSelf(document, parentId));
}

function applyCreateNode(document: PageDocumentDto, command: CreateNodeCommand): PageDocumentDto {
  if (command.node.pageId !== command.pageId || document.nodes[command.node.id]) {
    return document;
  }

  if (!canMutateParent(document, command.parentId)) {
    return document;
  }

  if (command.parentId) {
    const parent = document.nodes[command.parentId];

    if (!isContainerNode(parent)) {
      return document;
    }
  }

  const nextDocument = cloneDocument(document);
  const node = cloneNode(command.node);
  node.parentId = command.parentId;

  if (node.type === "line") {
    updateLineDimensions(node);
  }

  nextDocument.nodes[node.id] = node;
  touchNode(node);
  setOrderedSiblingIds(
    nextDocument,
    command.parentId,
    insertAtIndex(getOrderedSiblingIds(nextDocument, command.parentId), node.id, command.index)
  );
  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyUpdateNode(document: PageDocumentDto, command: UpdateNodeCommand): PageDocumentDto {
  const node = document.nodes[command.nodeId];

  if (!node || node.pageId !== command.pageId || !canMutateNode(document, command.nodeId, command)) {
    return document;
  }

  const patch = sanitizePatch(command.patch);

  if (Object.keys(patch).length === 0) {
    return document;
  }

  const nextDocument = cloneDocument(document);
  const nextNode = nextDocument.nodes[command.nodeId];

  if (!nextNode) {
    return document;
  }

  Object.assign(nextNode, patch);
  touchNode(nextNode);

  if (nextNode.type === "line") {
    updateLineDimensions(nextNode);
  }

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyMoveNode(document: PageDocumentDto, command: MoveNodeCommand): PageDocumentDto {
  if (
    command.updates.length === 0 ||
    command.updates.some((update) => {
      const node = document.nodes[update.nodeId];
      return !node || node.pageId !== command.pageId || !canMutateNode(document, update.nodeId, command);
    })
  ) {
    return document;
  }

  const nextDocument = cloneDocument(document);

  for (const update of command.updates) {
    applyGeometryUpdate(nextDocument, update);
  }

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyResizeNode(document: PageDocumentDto, command: ResizeNodeCommand): PageDocumentDto {
  if (
    command.updates.length === 0 ||
    !document.nodes[command.nodeId] ||
    document.nodes[command.nodeId]?.pageId !== command.pageId ||
    command.updates.some((update) => {
      const node = document.nodes[update.nodeId];
      return !node || !canMutateNode(document, update.nodeId, command);
    })
  ) {
    return document;
  }

  const nextDocument = cloneDocument(document);

  for (const update of command.updates) {
    applyGeometryUpdate(nextDocument, update);
  }

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyReorderNode(document: PageDocumentDto, command: ReorderNodeCommand): PageDocumentDto {
  const node = document.nodes[command.nodeId];

  if (
    !node ||
    node.pageId !== command.pageId ||
    node.parentId !== command.parentId ||
    !canMutateNode(document, command.nodeId, command)
  ) {
    return document;
  }

  const currentIds = getOrderedSiblingIds(document, command.parentId);
  const currentIndex = currentIds.indexOf(command.nodeId);

  if (currentIndex === -1 || currentIndex === command.index) {
    return document;
  }

  const nextDocument = cloneDocument(document);
  const nextIds = getOrderedSiblingIds(nextDocument, command.parentId).filter(
    (nodeId) => nodeId !== command.nodeId
  );
  const safeIndex = Math.max(0, Math.min(command.index, nextIds.length));

  nextIds.splice(safeIndex, 0, command.nodeId);
  setOrderedSiblingIds(nextDocument, command.parentId, nextIds);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyDeleteNode(document: PageDocumentDto, command: DeleteNodeCommand): PageDocumentDto {
  const topLevelIds = getTopLevelNodeIds(document, command.nodeIds).filter((nodeId) => {
    const node = document.nodes[nodeId];
    return Boolean(node && node.pageId === command.pageId && canMutateNode(document, nodeId, command));
  });

  if (topLevelIds.length === 0) {
    return document;
  }

  const nextDocument = cloneDocument(document);

  for (const nodeId of topLevelIds) {
    const node = nextDocument.nodes[nodeId];

    if (!node) {
      continue;
    }

    const descendants = collectDescendantIds(nextDocument, nodeId);
    const siblingIds = removeIds(getOrderedSiblingIds(nextDocument, node.parentId), descendants);
    setOrderedSiblingIds(nextDocument, node.parentId, siblingIds);

    for (const descendantId of descendants) {
      delete nextDocument.nodes[descendantId];
    }
  }

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyGroupNodes(document: PageDocumentDto, command: GroupNodesCommand): PageDocumentDto {
  const topLevelIds = getTopLevelNodeIds(document, command.nodeIds);

  if (
    topLevelIds.length < 2 ||
    command.group.pageId !== command.pageId ||
    document.nodes[command.group.id]
  ) {
    return document;
  }

  const nodes = topLevelIds
    .map((nodeId) => document.nodes[nodeId] ?? null)
    .filter((value): value is SceneGraphNode => value !== null);

  if (nodes.length !== topLevelIds.length) {
    return document;
  }

  const sharedParentId = nodes[0]?.parentId ?? null;

  if (
    nodes.some((node) => node.pageId !== command.pageId || node.parentId !== sharedParentId) ||
    topLevelIds.some((nodeId) => hasLockedAncestorOrSelf(document, nodeId)) ||
    !canMutateParent(document, sharedParentId)
  ) {
    return document;
  }

  const siblingIds = getOrderedSiblingIds(document, sharedParentId);
  const orderedSelectedIds = siblingIds.filter((nodeId) => topLevelIds.includes(nodeId));
  const selectedBounds = orderedSelectedIds
    .map((nodeId) => getNodeBounds(document, nodeId))
    .filter((value): value is NodeBounds => value !== null);

  if (selectedBounds.length !== orderedSelectedIds.length) {
    return document;
  }

  const minX = Math.min(...selectedBounds.map((bounds) => bounds.x));
  const minY = Math.min(...selectedBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...selectedBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...selectedBounds.map((bounds) => bounds.y + bounds.height));
  const groupParentAbsolute = sharedParentId
    ? getNodeAbsolutePosition(document, sharedParentId) ?? { x: 0, y: 0 }
    : { x: 0, y: 0 };
  const nextDocument = cloneDocument(document);
  const selectedSet = new Set(orderedSelectedIds);
  const nextSiblingIds = removeIds(getOrderedSiblingIds(nextDocument, sharedParentId), selectedSet);
  const insertionIndex =
    command.index === null
      ? Math.max(...orderedSelectedIds.map((nodeId) => siblingIds.indexOf(nodeId)))
      : command.index;
  const groupNode: GroupNode = {
    ...command.group,
    childIds: orderedSelectedIds,
    height: clampDimension(maxY - minY),
    parentId: sharedParentId,
    width: clampDimension(maxX - minX),
    x: minX - groupParentAbsolute.x,
    y: minY - groupParentAbsolute.y
  };

  nextDocument.nodes[groupNode.id] = groupNode;
  touchNode(groupNode);
  setOrderedSiblingIds(nextDocument, sharedParentId, insertAtIndex(nextSiblingIds, groupNode.id, insertionIndex));

  for (const childId of orderedSelectedIds) {
    const child = nextDocument.nodes[childId];
    const absolutePosition = getNodeAbsolutePosition(document, childId);

    if (!child || !absolutePosition) {
      continue;
    }

    child.parentId = groupNode.id;
    child.x = absolutePosition.x - minX;
    child.y = absolutePosition.y - minY;
    touchNode(child);
  }

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

function applyUngroupNode(document: PageDocumentDto, command: UngroupNodeCommand): PageDocumentDto {
  const node = document.nodes[command.nodeId];

  if (
    !node ||
    node.pageId !== command.pageId ||
    node.type !== "group" ||
    hasLockedAncestorOrSelf(document, command.nodeId)
  ) {
    return document;
  }

  const parentAbsolute = node.parentId
    ? getNodeAbsolutePosition(document, node.parentId) ?? { x: 0, y: 0 }
    : { x: 0, y: 0 };
  const nextDocument = cloneDocument(document);
  const nextGroup = nextDocument.nodes[command.nodeId];

  if (!nextGroup || nextGroup.type !== "group") {
    return document;
  }

  const siblingIds = getOrderedSiblingIds(nextDocument, nextGroup.parentId);
  const groupIndex = siblingIds.indexOf(nextGroup.id);
  const withoutGroup = siblingIds.filter((nodeId) => nodeId !== nextGroup.id);
  const promotedIds = cloneIds(nextGroup.childIds);

  setOrderedSiblingIds(
    nextDocument,
    nextGroup.parentId,
    [
      ...withoutGroup.slice(0, Math.max(0, groupIndex)),
      ...promotedIds,
      ...withoutGroup.slice(Math.max(0, groupIndex))
    ]
  );

  for (const childId of promotedIds) {
    const child = nextDocument.nodes[childId];
    const absolutePosition = getNodeAbsolutePosition(document, childId);

    if (!child || !absolutePosition) {
      continue;
    }

    child.parentId = nextGroup.parentId;
    child.x = absolutePosition.x - parentAbsolute.x;
    child.y = absolutePosition.y - parentAbsolute.y;
    touchNode(child);
  }

  delete nextDocument.nodes[nextGroup.id];

  normalizeGroups(nextDocument);
  normalizeDocumentZIndices(nextDocument);
  return nextDocument;
}

export function applyEditorCommand(
  document: PageDocumentDto,
  command: EditorCommand
): PageDocumentDto {
  if (document.pageId !== command.pageId) {
    return document;
  }

  switch (command.type) {
    case "create-node":
      return applyCreateNode(document, command);
    case "update-node":
      return applyUpdateNode(document, command);
    case "delete-node":
      return applyDeleteNode(document, command);
    case "move-node":
      return applyMoveNode(document, command);
    case "resize-node":
      return applyResizeNode(document, command);
    case "reorder-node":
      return applyReorderNode(document, command);
    case "group-nodes":
      return applyGroupNodes(document, command);
    case "ungroup-node":
      return applyUngroupNode(document, command);
  }

  return document;
}
