import {
  type CreateNodeCommand,
  type NodeGeometryUpdate,
  type PageDocumentDto,
  type SceneGraphNodeType
} from "@openmirage/types";
import {
  collectDescendantIds,
  getNodeAbsolutePosition,
  getNodeBounds,
  getTopLevelNodeIds,
  isContainerNode
} from "./commands";
import { type NodeBounds, type PaintRecord, type Point, type ResizeHandle } from "./types";

const DEFAULT_TEXT_STYLE = {
  color: { alpha: 1, hex: "#132c35" },
  fontFamily: "IBM Plex Sans",
  fontSize: 20,
  fontWeight: 500,
  lineHeight: 28,
  textAlign: "left" as const
};

export function createEmptyDocument(pageId: string): PageDocumentDto {
  return {
    nodes: {},
    pageId,
    rootNodeIds: []
  };
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function getNodeDepth(document: PageDocumentDto, nodeId: string): number {
  let depth = 0;
  let current = document.nodes[nodeId];

  while (current?.parentId) {
    depth += 1;
    current = document.nodes[current.parentId];
  }

  return depth;
}

export function createNodeCommandForInsert(input: {
  pageId: string;
  parentAbsolutePosition: Point;
  parentId: string | null;
  point: Point;
  type: Exclude<SceneGraphNodeType, "group" | "image">;
}): CreateNodeCommand {
  const id = crypto.randomUUID();
  const timestamp = createTimestamp();
  const localX = input.point.x - input.parentAbsolutePosition.x;
  const localY = input.point.y - input.parentAbsolutePosition.y;

  switch (input.type) {
    case "frame":
      return {
        index: null,
        node: {
          background: {
            color: { alpha: 1, hex: "#fbf8f2" }
          },
          childIds: [],
          clipsContent: false,
          cornerRadius: 18,
          createdAt: timestamp,
          height: 360,
          id,
          locked: false,
          name: "Frame",
          opacity: 1,
          pageId: input.pageId,
          parentId: input.parentId,
          rotation: 0,
          stroke: {
            color: { alpha: 1, hex: "#c8d3dc" },
            width: 1
          },
          type: "frame",
          updatedAt: timestamp,
          visible: true,
          width: 480,
          x: localX - 240,
          y: localY - 180,
          zIndex: 0
        },
        pageId: input.pageId,
        parentId: input.parentId,
        type: "create-node"
      };
    case "rectangle":
      return {
        index: null,
        node: {
          cornerRadius: 14,
          createdAt: timestamp,
          fill: {
            color: { alpha: 1, hex: "#f5a24a" }
          },
          height: 120,
          id,
          locked: false,
          name: "Rectangle",
          opacity: 1,
          pageId: input.pageId,
          parentId: input.parentId,
          rotation: 0,
          shadow: null,
          stroke: null,
          type: "rectangle",
          updatedAt: timestamp,
          visible: true,
          width: 180,
          x: localX - 90,
          y: localY - 60,
          zIndex: 0
        },
        pageId: input.pageId,
        parentId: input.parentId,
        type: "create-node"
      };
    case "ellipse":
      return {
        index: null,
        node: {
          createdAt: timestamp,
          fill: {
            color: { alpha: 1, hex: "#5fabc0" }
          },
          height: 140,
          id,
          locked: false,
          name: "Ellipse",
          opacity: 1,
          pageId: input.pageId,
          parentId: input.parentId,
          rotation: 0,
          shadow: null,
          stroke: null,
          type: "ellipse",
          updatedAt: timestamp,
          visible: true,
          width: 140,
          x: localX - 70,
          y: localY - 70,
          zIndex: 0
        },
        pageId: input.pageId,
        parentId: input.parentId,
        type: "create-node"
      };
    case "line":
      return {
        index: null,
        node: {
          createdAt: timestamp,
          height: 2,
          id,
          locked: false,
          name: "Line",
          opacity: 1,
          pageId: input.pageId,
          parentId: input.parentId,
          rotation: 0,
          stroke: {
            color: { alpha: 1, hex: "#132c35" },
            width: 2
          },
          type: "line",
          updatedAt: timestamp,
          visible: true,
          width: 160,
          x: localX - 80,
          x2: localX + 80,
          y: localY,
          y2: localY,
          zIndex: 0
        },
        pageId: input.pageId,
        parentId: input.parentId,
        type: "create-node"
      };
    case "text":
      return {
        index: null,
        node: {
          content: "Text",
          createdAt: timestamp,
          height: 36,
          id,
          locked: false,
          name: "Text",
          opacity: 1,
          pageId: input.pageId,
          parentId: input.parentId,
          rotation: 0,
          typography: DEFAULT_TEXT_STYLE,
          type: "text",
          updatedAt: timestamp,
          visible: true,
          width: 220,
          x: localX - 110,
          y: localY - 18,
          zIndex: 0
        },
        pageId: input.pageId,
        parentId: input.parentId,
        type: "create-node"
      };
  }
}

export function deriveMoveUpdates(
  document: PageDocumentDto,
  selectedIds: string[],
  delta: Point
): NodeGeometryUpdate[] {
  const topLevelIds = getTopLevelNodeIds(document, selectedIds);
  const updates: NodeGeometryUpdate[] = [];

  for (const nodeId of topLevelIds) {
    const node = document.nodes[nodeId];

    if (!node) {
      continue;
    }

    const update: NodeGeometryUpdate = {
      height: node.height,
      nodeId,
      width: node.width,
      x: node.x + delta.x,
      y: node.y + delta.y
    };

    if (node.type === "line") {
      update.x2 = node.x2 + delta.x;
      update.y2 = node.y2 + delta.y;
    }

    updates.push(update);
  }

  return updates;
}

function clampBounds(bounds: NodeBounds): NodeBounds {
  return {
    height: Math.max(1, bounds.height),
    width: Math.max(1, bounds.width),
    x: bounds.x,
    y: bounds.y
  };
}

export function deriveResizedBounds(
  originalBounds: NodeBounds,
  handle: ResizeHandle,
  point: Point
): NodeBounds {
  if (handle === "line-start" || handle === "line-end") {
    return originalBounds;
  }

  let left = originalBounds.x;
  let top = originalBounds.y;
  let right = originalBounds.x + originalBounds.width;
  let bottom = originalBounds.y + originalBounds.height;

  if (handle.includes("w")) {
    left = Math.min(point.x, right - 1);
  }

  if (handle.includes("e")) {
    right = Math.max(point.x, left + 1);
  }

  if (handle.includes("n")) {
    top = Math.min(point.y, bottom - 1);
  }

  if (handle.includes("s")) {
    bottom = Math.max(point.y, top + 1);
  }

  return clampBounds({
    height: bottom - top,
    width: right - left,
    x: left,
    y: top
  });
}

function buildNodeResizeUpdate(
  document: PageDocumentDto,
  record: PaintRecord,
  handle: ResizeHandle,
  point: Point
): NodeGeometryUpdate[] {
  const node = document.nodes[record.node.id];

  if (!node) {
    return [];
  }

  if (node.type === "line") {
    const parentAbsolute = {
      x: record.absoluteX - node.x,
      y: record.absoluteY - node.y
    };
    const startPoint = { x: record.absoluteX, y: record.absoluteY };
    const endPoint = {
      x: record.absoluteX2 ?? record.absoluteX,
      y: record.absoluteY2 ?? record.absoluteY
    };
    const nextStart = handle === "line-start" ? point : startPoint;
    const nextEnd = handle === "line-end" ? point : endPoint;

    return [
      {
        height: Math.max(1, Math.abs(nextEnd.y - nextStart.y)),
        nodeId: node.id,
        width: Math.max(1, Math.abs(nextEnd.x - nextStart.x)),
        x: nextStart.x - parentAbsolute.x,
        x2: nextEnd.x - parentAbsolute.x,
        y: nextStart.y - parentAbsolute.y,
        y2: nextEnd.y - parentAbsolute.y
      }
    ];
  }

  const nextBounds = deriveResizedBounds(record.bounds, handle, point);
  const parentAbsolute = {
    x: record.absoluteX - node.x,
    y: record.absoluteY - node.y
  };

  if (node.type !== "group") {
    return [
      {
        height: nextBounds.height,
        nodeId: node.id,
        width: nextBounds.width,
        x: nextBounds.x - parentAbsolute.x,
        y: nextBounds.y - parentAbsolute.y
      }
    ];
  }

  const originalBounds = getNodeBounds(document, node.id);

  if (!originalBounds) {
    return [];
  }

  const scaleX = nextBounds.width / Math.max(1, originalBounds.width);
  const scaleY = nextBounds.height / Math.max(1, originalBounds.height);
  const descendantIds = Array.from(collectDescendantIds(document, node.id)).filter(
    (descendantId) => descendantId !== node.id
  );
  const orderedDescendantIds = descendantIds.sort(
    (left, right) => getNodeDepth(document, left) - getNodeDepth(document, right)
  );
  const absolutePositions = new Map<string, Point>();
  const absoluteBounds = new Map<string, NodeBounds>();
  const updates: NodeGeometryUpdate[] = [
    {
      height: nextBounds.height,
      nodeId: node.id,
      width: nextBounds.width,
      x: nextBounds.x - parentAbsolute.x,
      y: nextBounds.y - parentAbsolute.y
    }
  ];

  absolutePositions.set(node.id, { x: nextBounds.x, y: nextBounds.y });
  absoluteBounds.set(node.id, nextBounds);

  for (const descendantId of orderedDescendantIds) {
    const descendant = document.nodes[descendantId];
    const descendantBounds = getNodeBounds(document, descendantId);
    const descendantAbsolute = getNodeAbsolutePosition(document, descendantId);

    if (!descendant || !descendantBounds || !descendantAbsolute) {
      continue;
    }

    const parentId = descendant.parentId;
    const nextParentAbsolute =
      (parentId ? absolutePositions.get(parentId) : null) ??
      (parentId ? getNodeAbsolutePosition(document, parentId) : null) ??
      { x: 0, y: 0 };
    const nextAbsoluteX =
      nextBounds.x + (descendantBounds.x - originalBounds.x) * scaleX;
    const nextAbsoluteY =
      nextBounds.y + (descendantBounds.y - originalBounds.y) * scaleY;
    const nextWidth = descendantBounds.width * scaleX;
    const nextHeight = descendantBounds.height * scaleY;

    if (descendant.type === "line") {
      const endAbsolute = {
        x:
          nextBounds.x +
          ((descendantAbsolute.x - descendant.x + descendant.x2) - originalBounds.x) * scaleX,
        y:
          nextBounds.y +
          ((descendantAbsolute.y - descendant.y + descendant.y2) - originalBounds.y) * scaleY
      };

      updates.push({
        height: Math.max(1, Math.abs(endAbsolute.y - nextAbsoluteY)),
        nodeId: descendantId,
        width: Math.max(1, Math.abs(endAbsolute.x - nextAbsoluteX)),
        x: nextAbsoluteX - nextParentAbsolute.x,
        x2: endAbsolute.x - nextParentAbsolute.x,
        y: nextAbsoluteY - nextParentAbsolute.y,
        y2: endAbsolute.y - nextParentAbsolute.y
      });
      absolutePositions.set(descendantId, {
        x: nextAbsoluteX,
        y: nextAbsoluteY
      });
      absoluteBounds.set(descendantId, {
        height: Math.max(1, Math.abs(endAbsolute.y - nextAbsoluteY)),
        width: Math.max(1, Math.abs(endAbsolute.x - nextAbsoluteX)),
        x: Math.min(nextAbsoluteX, endAbsolute.x),
        y: Math.min(nextAbsoluteY, endAbsolute.y)
      });
      continue;
    }

    updates.push({
      height: nextHeight,
      nodeId: descendantId,
      width: nextWidth,
      x: nextAbsoluteX - nextParentAbsolute.x,
      y: nextAbsoluteY - nextParentAbsolute.y
    });
    absolutePositions.set(descendantId, {
      x: nextAbsoluteX,
      y: nextAbsoluteY
    });
    absoluteBounds.set(descendantId, {
      height: nextHeight,
      width: nextWidth,
      x: nextAbsoluteX,
      y: nextAbsoluteY
    });
  }

  return updates;
}

export function deriveResizeUpdates(
  document: PageDocumentDto,
  record: PaintRecord,
  handle: ResizeHandle,
  point: Point
): NodeGeometryUpdate[] {
  return buildNodeResizeUpdate(document, record, handle, point);
}

export function getContainerInsertionTarget(input: {
  activeScopeId: string | null;
  document: PageDocumentDto;
  primarySelectionId: string | null;
}): string | null {
  if (input.activeScopeId && isContainerNode(input.document.nodes[input.activeScopeId])) {
    return input.activeScopeId;
  }

  if (input.primarySelectionId && isContainerNode(input.document.nodes[input.primarySelectionId])) {
    return input.primarySelectionId;
  }

  return null;
}
