import {
  type ColorValue,
  type PageDocumentDto,
  type SceneGraphNode,
  type TypographyStyle
} from "@openmirage/types";
import { getNodeAbsolutePosition, getNodeBounds, isContainerNode } from "./commands";

export interface InspectField {
  label: string;
  value: string;
}

export interface InspectSection {
  fields: InspectField[];
  title: string;
}

export interface InspectDetails {
  nodeId: string;
  sections: InspectSection[];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatColor(value: ColorValue | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return `${value.hex} · ${formatPercent(value.alpha)}`;
}

function formatTypographyField(
  label: string,
  value: string | number
): InspectField {
  return {
    label,
    value: typeof value === "number" ? formatNumber(value) : value
  };
}

function getParentLabel(
  document: PageDocumentDto,
  node: SceneGraphNode
): string {
  if (!node.parentId) {
    return "Root";
  }

  return document.nodes[node.parentId]?.name ?? "Root";
}

function deriveSpacingFields(
  document: PageDocumentDto,
  node: SceneGraphNode
): InspectField[] {
  if (!node.parentId) {
    return [];
  }

  const nodeBounds = getNodeBounds(document, node.id);
  const parent = document.nodes[node.parentId];
  const parentBounds = parent ? getNodeBounds(document, parent.id) : null;

  if (!nodeBounds || !parentBounds || !isContainerNode(parent)) {
    return [];
  }

  return [
    {
      label: "Top",
      value: formatNumber(nodeBounds.y - parentBounds.y)
    },
    {
      label: "Right",
      value: formatNumber(
        parentBounds.x + parentBounds.width - (nodeBounds.x + nodeBounds.width)
      )
    },
    {
      label: "Bottom",
      value: formatNumber(
        parentBounds.y +
          parentBounds.height -
          (nodeBounds.y + nodeBounds.height)
      )
    },
    {
      label: "Left",
      value: formatNumber(nodeBounds.x - parentBounds.x)
    }
  ];
}

function deriveColorFields(node: SceneGraphNode): InspectField[] {
  const fields: InspectField[] = [];

  if ("fill" in node) {
    const fill = formatColor(node.fill?.color);
    if (fill) {
      fields.push({ label: "Fill", value: fill });
    }
  }

  if ("stroke" in node) {
    const stroke = formatColor(node.stroke?.color);
    if (stroke) {
      fields.push({ label: "Stroke", value: stroke });
    }
  }

  if (node.type === "frame") {
    const background = formatColor(node.background?.color);
    if (background) {
      fields.push({ label: "Background", value: background });
    }
  }

  if (node.type === "text") {
    fields.push({
      label: "Text",
      value: formatColor(node.typography.color) ?? "None"
    });
  }

  return fields;
}

function deriveTypographyFields(
  typography: TypographyStyle | null
): InspectField[] {
  if (!typography) {
    return [];
  }

  return [
    formatTypographyField("Font family", typography.fontFamily),
    formatTypographyField("Font size", typography.fontSize),
    formatTypographyField("Font weight", typography.fontWeight),
    formatTypographyField("Line height", typography.lineHeight),
    formatTypographyField("Text align", typography.textAlign)
  ];
}

export function deriveInspectDetails(
  document: PageDocumentDto,
  nodeId: string
): InspectDetails | null {
  const node = document.nodes[nodeId];

  if (!node) {
    return null;
  }

  const absolutePosition = getNodeAbsolutePosition(document, node.id);
  const nodeBounds = getNodeBounds(document, node.id);

  if (!absolutePosition || !nodeBounds) {
    return null;
  }

  const metadataFields: InspectField[] = [
    { label: "Name", value: node.name },
    { label: "ID", value: node.id },
    { label: "Type", value: node.type },
    { label: "Parent", value: getParentLabel(document, node) },
    { label: "Visible", value: node.visible ? "Yes" : "No" },
    { label: "Locked", value: node.locked ? "Yes" : "No" },
    { label: "Opacity", value: formatPercent(node.opacity) }
  ];

  const dimensionFields: InspectField[] = [
    { label: "X", value: formatNumber(absolutePosition.x) },
    { label: "Y", value: formatNumber(absolutePosition.y) },
    { label: "Width", value: formatNumber(nodeBounds.width) },
    { label: "Height", value: formatNumber(nodeBounds.height) }
  ];

  if (node.type === "line") {
    dimensionFields.push(
      { label: "X2", value: formatNumber(node.x2) },
      { label: "Y2", value: formatNumber(node.y2) },
      { label: "Stroke width", value: formatNumber(node.stroke.width) }
    );
  }

  const sections: InspectSection[] = [
    {
      fields: metadataFields,
      title: "Metadata"
    },
    {
      fields: dimensionFields,
      title: "Dimensions"
    }
  ];

  const spacingFields = deriveSpacingFields(document, node);
  if (spacingFields.length > 0) {
    sections.push({
      fields: spacingFields,
      title: "Spacing"
    });
  }

  const colorFields = deriveColorFields(node);
  if (colorFields.length > 0) {
    sections.push({
      fields: colorFields,
      title: "Color"
    });
  }

  const typographyFields = deriveTypographyFields(
    node.type === "text" ? node.typography : null
  );
  if (typographyFields.length > 0) {
    sections.push({
      fields: typographyFields,
      title: "Typography"
    });
  }

  return {
    nodeId,
    sections
  };
}
