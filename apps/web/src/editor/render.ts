import { type SceneGraphNode } from "@openmirage/types";
import { getResizeHandlePoints } from "./hit-test";
import { type PaintRecord, type Point, type ViewportState } from "./types";

function applyOpacity(ctx: CanvasRenderingContext2D, opacity: number): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.max(
    0,
    Math.min(radius, Math.min(width, height) / 2)
  );
  const roundedContext = ctx as CanvasRenderingContext2D & {
    roundRect?: (
      x: number,
      y: number,
      w: number,
      h: number,
      radii?: number | number[]
    ) => void;
  };

  if (typeof roundedContext.roundRect === "function") {
    roundedContext.roundRect(x, y, width, height, safeRadius);
    return;
  }

  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height
  );
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
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
    traceRoundedRect(ctx, x, y, node.width, node.height, radius);

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

function drawResolvedImage(
  ctx: CanvasRenderingContext2D,
  record: PaintRecord,
  image: CanvasImageSource
): void {
  const { node } = record;

  if (node.type !== "image") {
    return;
  }

  const imageWidth =
    "naturalWidth" in image && typeof image.naturalWidth === "number"
      ? image.naturalWidth
      : "videoWidth" in image && typeof image.videoWidth === "number"
        ? image.videoWidth
        : "width" in image && typeof image.width === "number"
          ? image.width
          : node.width;
  const imageHeight =
    "naturalHeight" in image && typeof image.naturalHeight === "number"
      ? image.naturalHeight
      : "videoHeight" in image && typeof image.videoHeight === "number"
        ? image.videoHeight
        : "height" in image && typeof image.height === "number"
          ? image.height
          : node.height;

  applyRotation(ctx, node, record.absoluteX, record.absoluteY, () => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(record.absoluteX, record.absoluteY, node.width, node.height);
    ctx.clip();

    if (node.fitMode === "fill" || imageWidth <= 0 || imageHeight <= 0) {
      ctx.drawImage(image, record.absoluteX, record.absoluteY, node.width, node.height);
      ctx.restore();
      return;
    }

    const widthScale = node.width / imageWidth;
    const heightScale = node.height / imageHeight;
    const scale =
      node.fitMode === "contain"
        ? Math.min(widthScale, heightScale)
        : Math.max(widthScale, heightScale);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const offsetX = record.absoluteX + (node.width - drawWidth) / 2;
    const offsetY = record.absoluteY + (node.height - drawHeight) / 2;

    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    ctx.restore();
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
  images: Record<string, CanvasImageSource | null | undefined>,
  overlay: {
    hoveredId: string | null;
    marquee: { end: Point; start: Point } | null;
    primarySelectionId: string | null;
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
        if (record.node.assetId && images[record.node.assetId]) {
          drawResolvedImage(
            ctx,
            record,
            images[record.node.assetId] as CanvasImageSource
          );
        } else {
          drawImagePlaceholder(ctx, record);
        }
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

    ctx.save();
    ctx.strokeStyle = overlay.selectedIds.includes(record.node.id)
      ? "#f5a24a"
      : "#5fabc0";
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.setLineDash(overlay.selectedIds.includes(record.node.id) ? [] : [6 / viewport.zoom, 4 / viewport.zoom]);

    if (record.node.type === "line") {
      ctx.beginPath();
      ctx.moveTo(record.absoluteX, record.absoluteY);
      ctx.lineTo(record.absoluteX2 ?? record.absoluteX, record.absoluteY2 ?? record.absoluteY);
      ctx.stroke();
    } else {
      ctx.strokeRect(
        record.bounds.x,
        record.bounds.y,
        record.bounds.width,
        record.bounds.height
      );
    }

    if (overlay.primarySelectionId === record.node.id) {
      ctx.fillStyle = "#f5a24a";

      for (const handle of getResizeHandlePoints(record)) {
        const size = 10 / viewport.zoom;
        ctx.beginPath();
        ctx.rect(
          handle.point.x - size / 2,
          handle.point.y - size / 2,
          size,
          size
        );
        ctx.fill();
      }
    }

    ctx.restore();
  }

  if (overlay.marquee) {
    const minX = Math.min(overlay.marquee.start.x, overlay.marquee.end.x);
    const minY = Math.min(overlay.marquee.start.y, overlay.marquee.end.y);
    const width = Math.abs(overlay.marquee.end.x - overlay.marquee.start.x);
    const height = Math.abs(overlay.marquee.end.y - overlay.marquee.start.y);

    ctx.save();
    ctx.fillStyle = "rgba(95, 171, 192, 0.16)";
    ctx.strokeStyle = "rgba(95, 171, 192, 0.9)";
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.setLineDash([8 / viewport.zoom, 6 / viewport.zoom]);
    ctx.fillRect(minX, minY, width, height);
    ctx.strokeRect(minX, minY, width, height);
    ctx.restore();
  }

  ctx.restore();
}
