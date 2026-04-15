import { type SceneGraphNode } from "@openmirage/types";
import { type PaintRecord, type ViewportState } from "./types";

function applyOpacity(ctx: CanvasRenderingContext2D, opacity: number): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
}

function applyRotation(
  ctx: CanvasRenderingContext2D,
  node: SceneGraphNode,
  x: number,
  y: number,
  render: () => void
): void {
  if (!node.rotation) {
    render();
    return;
  }

  const centerX = x + node.width / 2;
  const centerY = y + node.height / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((node.rotation * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);
  render();
  ctx.restore();
}

function strokeAndFillRect(
  ctx: CanvasRenderingContext2D,
  record: PaintRecord
): void {
  const { node } = record;

  if (node.type !== "frame" && node.type !== "rectangle") {
    return;
  }

  const x = record.absoluteX;
  const y = record.absoluteY;
  const radius = node.type === "frame" ? node.cornerRadius : node.cornerRadius;

  applyRotation(ctx, node, x, y, () => {
    ctx.beginPath();
    ctx.roundRect(x, y, node.width, node.height, radius);

    if (node.type === "frame" && node.background) {
      ctx.fillStyle = node.background.color.hex;
      ctx.fill();
    }

    if (node.type === "rectangle" && node.fill) {
      ctx.fillStyle = node.fill.color.hex;
      ctx.fill();
    }

    if (node.type === "frame" && node.stroke) {
      ctx.lineWidth = node.stroke.width;
      ctx.strokeStyle = node.stroke.color.hex;
      ctx.stroke();
    }

    if (node.type === "rectangle" && node.stroke) {
      ctx.lineWidth = node.stroke.width;
      ctx.strokeStyle = node.stroke.color.hex;
      ctx.stroke();
    }
  });
}

function drawEllipse(ctx: CanvasRenderingContext2D, record: PaintRecord): void {
  const { node } = record;

  if (node.type !== "ellipse") {
    return;
  }

  const x = record.absoluteX + node.width / 2;
  const y = record.absoluteY + node.height / 2;

  applyRotation(ctx, node, record.absoluteX, record.absoluteY, () => {
    ctx.beginPath();
    ctx.ellipse(x, y, node.width / 2, node.height / 2, 0, 0, Math.PI * 2);

    if (node.fill) {
      ctx.fillStyle = node.fill.color.hex;
      ctx.fill();
    }

    if (node.stroke) {
      ctx.lineWidth = node.stroke.width;
      ctx.strokeStyle = node.stroke.color.hex;
      ctx.stroke();
    }
  });
}

function drawLine(ctx: CanvasRenderingContext2D, record: PaintRecord): void {
  const { node } = record;

  if (node.type !== "line") {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(record.absoluteX, record.absoluteY);
  ctx.lineTo(record.absoluteX2 ?? record.absoluteX, record.absoluteY2 ?? record.absoluteY);
  ctx.lineWidth = node.stroke.width;
  ctx.strokeStyle = node.stroke.color.hex;
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, record: PaintRecord): void {
  const { node } = record;

  if (node.type !== "text") {
    return;
  }

  applyRotation(ctx, node, record.absoluteX, record.absoluteY, () => {
    ctx.fillStyle = node.typography.color.hex;
    ctx.font = `${node.typography.fontWeight} ${node.typography.fontSize}px ${node.typography.fontFamily}`;
    ctx.textAlign = node.typography.textAlign === "justify" ? "left" : node.typography.textAlign;
    ctx.textBaseline = "top";
    ctx.fillText(node.content, record.absoluteX, record.absoluteY, node.width);
  });
}

function drawImagePlaceholder(
  ctx: CanvasRenderingContext2D,
  record: PaintRecord
): void {
  const { node } = record;

  if (node.type !== "image") {
    return;
  }

  applyRotation(ctx, node, record.absoluteX, record.absoluteY, () => {
    ctx.fillStyle = "#e8eef4";
    ctx.strokeStyle = "#5fabc0";
    ctx.lineWidth = 2;
    ctx.fillRect(record.absoluteX, record.absoluteY, node.width, node.height);
    ctx.strokeRect(record.absoluteX, record.absoluteY, node.width, node.height);
    ctx.beginPath();
    ctx.moveTo(record.absoluteX + 12, record.absoluteY + node.height - 12);
    ctx.lineTo(record.absoluteX + node.width / 2, record.absoluteY + 18);
    ctx.lineTo(record.absoluteX + node.width - 12, record.absoluteY + node.height - 22);
    ctx.stroke();
  });
}

export function renderSceneToCanvas(
  canvas: HTMLCanvasElement,
  viewport: ViewportState,
  page: {
    background: string;
    height: number;
    width: number;
  },
  records: PaintRecord[],
  overlay: {
    hoveredId: string | null;
    selectedIds: string[];
  }
): void {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return;
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const targetWidth = Math.max(1, Math.floor(cssWidth * devicePixelRatio));
  const targetHeight = Math.max(1, Math.floor(cssHeight * devicePixelRatio));

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "rgba(6, 13, 18, 0.74)";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.save();
  ctx.translate(viewport.panX, viewport.panY);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.strokeStyle = "rgba(15, 30, 39, 0.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, page.width, page.height);

  for (const record of records) {
    ctx.save();
    applyOpacity(ctx, record.node.opacity);

    switch (record.node.type) {
      case "frame":
      case "rectangle":
        strokeAndFillRect(ctx, record);
        break;
      case "ellipse":
        drawEllipse(ctx, record);
        break;
      case "line":
        drawLine(ctx, record);
        break;
      case "text":
        drawText(ctx, record);
        break;
      case "image":
        drawImagePlaceholder(ctx, record);
        break;
      case "group":
        break;
    }

    ctx.restore();
  }

  for (const record of records) {
    if (
      record.node.id !== overlay.hoveredId &&
      !overlay.selectedIds.includes(record.node.id)
    ) {
      continue;
    }

    if (record.node.type === "line") {
      continue;
    }

    ctx.save();
    ctx.strokeStyle = overlay.selectedIds.includes(record.node.id)
      ? "#f5a24a"
      : "#5fabc0";
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.setLineDash(overlay.selectedIds.includes(record.node.id) ? [] : [6 / viewport.zoom, 4 / viewport.zoom]);
    ctx.strokeRect(
      record.absoluteX,
      record.absoluteY,
      record.node.width,
      record.node.height
    );
    ctx.restore();
  }

  ctx.restore();
}

