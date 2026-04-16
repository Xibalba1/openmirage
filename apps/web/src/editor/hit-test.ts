import { type PaintRecord, type Point, type ResizeHandle, type ResizeHandleHit } from "./types";

const HANDLE_SCREEN_SIZE = 10;

function rotatePoint(point: Point, center: Point, radians: number): Point {
  const translatedX = point.x - center.x;
  const translatedY = point.y - center.y;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: translatedX * cosine - translatedY * sine + center.x,
    y: translatedX * sine + translatedY * cosine + center.y
  };
}

function toLocalPoint(point: Point, record: PaintRecord): Point {
  const { node } = record;

  if (!node.rotation) {
    return {
      x: point.x - record.bounds.x,
      y: point.y - record.bounds.y
    };
  }

  const center = {
    x: record.bounds.x + record.bounds.width / 2,
    y: record.bounds.y + record.bounds.height / 2
  };
  const unrotated = rotatePoint(point, center, (-node.rotation * Math.PI) / 180);

  return {
    x: unrotated.x - record.bounds.x,
    y: unrotated.y - record.bounds.y
  };
}

function isPointInsideRecord(
  point: Point,
  record: PaintRecord,
  zoom: number
): boolean {
  const local = toLocalPoint(point, record);

  switch (record.node.type) {
    case "frame":
    case "group":
    case "rectangle":
    case "text":
    case "image":
      return (
        local.x >= 0 &&
        local.y >= 0 &&
        local.x <= record.bounds.width &&
        local.y <= record.bounds.height
      );
    case "ellipse": {
      const radiusX = record.bounds.width / 2;
      const radiusY = record.bounds.height / 2;

      if (radiusX <= 0 || radiusY <= 0) {
        return false;
      }

      const offsetX = local.x - radiusX;
      const offsetY = local.y - radiusY;
      return (offsetX * offsetX) / (radiusX * radiusX) + (offsetY * offsetY) / (radiusY * radiusY) <= 1;
    }
    case "line": {
      const x1 = record.absoluteX;
      const y1 = record.absoluteY;
      const x2 = record.absoluteX2 ?? x1;
      const y2 = record.absoluteY2 ?? y1;
      const deltaX = x2 - x1;
      const deltaY = y2 - y1;
      const lengthSquared = deltaX * deltaX + deltaY * deltaY;

      if (lengthSquared === 0) {
        return false;
      }

      const t = Math.max(
        0,
        Math.min(1, ((point.x - x1) * deltaX + (point.y - y1) * deltaY) / lengthSquared)
      );
      const projectionX = x1 + t * deltaX;
      const projectionY = y1 + t * deltaY;
      const distance = Math.hypot(point.x - projectionX, point.y - projectionY);
      const threshold = Math.max(record.node.stroke.width / 2, 6 / zoom);

      return distance <= threshold;
    }
  }
}

function getHandlePoints(record: PaintRecord): Array<{ handle: ResizeHandle; point: Point }> {
  if (record.node.type === "line") {
    return [
      {
        handle: "line-start",
        point: { x: record.absoluteX, y: record.absoluteY }
      },
      {
        handle: "line-end",
        point: {
          x: record.absoluteX2 ?? record.absoluteX,
          y: record.absoluteY2 ?? record.absoluteY
        }
      }
    ];
  }

  const { x, y, width, height } = record.bounds;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return [
    { handle: "nw", point: { x, y } },
    { handle: "n", point: { x: centerX, y } },
    { handle: "ne", point: { x: x + width, y } },
    { handle: "e", point: { x: x + width, y: centerY } },
    { handle: "se", point: { x: x + width, y: y + height } },
    { handle: "s", point: { x: centerX, y: y + height } },
    { handle: "sw", point: { x, y: y + height } },
    { handle: "w", point: { x, y: centerY } }
  ];
}

export function getResizeHandlePoints(record: PaintRecord): Array<{ handle: ResizeHandle; point: Point }> {
  return getHandlePoints(record);
}

export function hitTestResizeHandle(
  record: PaintRecord | null,
  point: Point,
  zoom: number
): ResizeHandleHit | null {
  if (!record) {
    return null;
  }

  const radius = (HANDLE_SCREEN_SIZE / zoom) / 2;

  for (const handlePoint of getHandlePoints(record)) {
    const distance = Math.hypot(point.x - handlePoint.point.x, point.y - handlePoint.point.y);

    if (distance <= radius + 1 / zoom) {
      return {
        handle: handlePoint.handle,
        nodeId: record.node.id
      };
    }
  }

  return null;
}

export function hitTestPaintRecords(
  records: PaintRecord[],
  point: Point,
  zoom = 1
): PaintRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (
      !record ||
      !record.selectable ||
      record.node.locked ||
      !record.node.visible
    ) {
      continue;
    }

    if (isPointInsideRecord(point, record, zoom)) {
      return record;
    }
  }

  return null;
}

export function selectPaintRecordsInMarquee(
  records: PaintRecord[],
  start: Point,
  end: Point
): string[] {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);

  return records
    .filter(
      (record) =>
        record.selectable &&
        record.node.visible &&
        !record.node.locked &&
        record.bounds.x >= minX &&
        record.bounds.y >= minY &&
        record.bounds.x + record.bounds.width <= maxX &&
        record.bounds.y + record.bounds.height <= maxY
    )
    .map((record) => record.node.id);
}
