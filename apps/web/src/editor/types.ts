import {
  type PageDocumentDto,
  type PageDto,
  type SceneGraphNode
} from "@openmirage/types";

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

export interface FlattenedSceneNode {
  absoluteX: number;
  absoluteX2: number | null;
  absoluteY: number;
  absoluteY2: number | null;
  node: SceneGraphNode;
}

export interface PaintRecord extends FlattenedSceneNode {
  selectable: boolean;
}

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

