import {
  type HydratedPageScene,
  flattenSceneInPaintOrder
} from "./scene.js";

export interface ExportImageSourceMap {
  [assetId: string]: string | undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function formatOpacity(opacity: number): string {
  return String(Math.max(0, Math.min(1, opacity)));
}

function renderTransform(
  rotation: number,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  if (!rotation) {
    return "";
  }

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return ` transform="rotate(${rotation} ${centerX} ${centerY})"`;
}

function renderTextLines(
  x: number,
  y: number,
  lineHeight: number,
  content: string
): string {
  const lines = content.split(/\r?\n/u);

  return lines
    .map((line, index) => {
      const lineY = y + index * lineHeight;
      return `<tspan x="${x}" y="${lineY}">${escapeXml(line || " ")}</tspan>`;
    })
    .join("");
}

export function serializeSceneToSvg(
  scene: HydratedPageScene,
  images: ExportImageSourceMap = {}
): string {
  const clipDefs: string[] = [];
  const elements: string[] = [];

  for (const record of flattenSceneInPaintOrder(scene)) {
    const { node } = record;

    if (node.type === "group") {
      continue;
    }

    const commonOpacity = ` opacity="${formatOpacity(node.opacity)}"`;
    const transform = renderTransform(
      node.rotation,
      record.absoluteX,
      record.absoluteY,
      node.width,
      node.height
    );

    if (node.type === "frame" || node.type === "rectangle") {
      const fillColor =
        node.type === "frame"
          ? node.background?.color.hex ?? "transparent"
          : node.fill?.color.hex ?? "transparent";
      const strokeColor =
        node.type === "frame"
          ? node.stroke?.color.hex ?? "none"
          : node.stroke?.color.hex ?? "none";
      const strokeWidth =
        node.type === "frame"
          ? node.stroke?.width ?? 0
          : node.stroke?.width ?? 0;
      const rx =
        node.type === "frame" ? node.cornerRadius : node.cornerRadius;

      elements.push(
        `<rect x="${record.absoluteX}" y="${record.absoluteY}" width="${node.width}" height="${node.height}" rx="${rx}" ry="${rx}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${commonOpacity}${transform} />`
      );
      continue;
    }

    if (node.type === "ellipse") {
      elements.push(
        `<ellipse cx="${record.absoluteX + node.width / 2}" cy="${record.absoluteY + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${node.fill?.color.hex ?? "transparent"}" stroke="${node.stroke?.color.hex ?? "none"}" stroke-width="${node.stroke?.width ?? 0}"${commonOpacity}${transform} />`
      );
      continue;
    }

    if (node.type === "line") {
      elements.push(
        `<line x1="${record.absoluteX}" y1="${record.absoluteY}" x2="${record.absoluteX2 ?? record.absoluteX}" y2="${record.absoluteY2 ?? record.absoluteY}" stroke="${node.stroke.color.hex}" stroke-width="${node.stroke.width}" stroke-linecap="round"${commonOpacity} />`
      );
      continue;
    }

    if (node.type === "text") {
      const anchor =
        node.typography.textAlign === "center"
          ? "middle"
          : node.typography.textAlign === "right"
            ? "end"
            : "start";
      const textX =
        node.typography.textAlign === "center"
          ? record.absoluteX + node.width / 2
          : node.typography.textAlign === "right"
            ? record.absoluteX + node.width
            : record.absoluteX;

      elements.push(
        `<text x="${textX}" y="${record.absoluteY}" fill="${node.typography.color.hex}" font-family="${escapeXml(node.typography.fontFamily)}" font-size="${node.typography.fontSize}" font-weight="${node.typography.fontWeight}" text-anchor="${anchor}"${commonOpacity}${transform}>${renderTextLines(textX, record.absoluteY + node.typography.fontSize, node.typography.lineHeight, node.content)}</text>`
      );
      continue;
    }

    if (node.type === "image") {
      const href = images[node.assetId];

      if (!href) {
        elements.push(
          `<rect x="${record.absoluteX}" y="${record.absoluteY}" width="${node.width}" height="${node.height}" fill="#e8eef4" stroke="#5fabc0" stroke-width="2"${commonOpacity}${transform} />`
        );
        continue;
      }

      const clipId = `clip-${node.id}`;
      clipDefs.push(
        `<clipPath id="${clipId}"><rect x="${record.absoluteX}" y="${record.absoluteY}" width="${node.width}" height="${node.height}" rx="0" ry="0" /></clipPath>`
      );

      const preserveAspectRatio =
        node.fitMode === "fill"
          ? "none"
          : node.fitMode === "contain"
            ? "xMidYMid meet"
            : "xMidYMid slice";

      elements.push(
        `<image x="${record.absoluteX}" y="${record.absoluteY}" width="${node.width}" height="${node.height}" href="${href}" preserveAspectRatio="${preserveAspectRatio}" clip-path="url(#${clipId})"${commonOpacity}${transform} />`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="${escapeXml(scene.page.name)}">`,
    `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${scene.background}" />`,
    clipDefs.length > 0 ? `<defs>${clipDefs.join("")}</defs>` : "",
    elements.join(""),
    "</svg>"
  ].join("");
}
