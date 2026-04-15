import { type PaintRecord, type Point } from "./types";

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
      x: point.x - record.absoluteX,
      y: point.y - record.absoluteY
    };
  }

  const center = {
    x: record.absoluteX + node.width / 2,
    y: record.absoluteY + node.height / 2
  };
  const unrotated = rotatePoint(point, center, (-node.rotation * Math.PI) / 180);

  return {
    x: unrotated.x - record.absoluteX,
    y: unrotated.y - record.absoluteY
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
    case "rectangle":
    case "text":
    case "image":
      return (
        local.x >= 0 &&
        local.y >= 0 &&
        local.x <= record.node.width &&
        local.y <= record.node.height
      );
    case "ellipse": {
      const radiusX = record.node.width / 2;
      const radiusY = record.node.height / 2;

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
    case "group":
      return false;
  }
}

export function hitTestPaintRecords(
  records: PaintRecord[],
  point: Point,
  zoom = 1
): PaintRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (!record || !record.selectable || record.node.locked || !record.node.visible) {
      continue;
    }

    if (isPointInsideRecord(point, record, zoom)) {
      return record;
    }
  }

  return null;
}

