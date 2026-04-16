import {
  type EditorCommand,
  type PageDocumentDto,
  type PageDto,
  type PresenceParticipant,
  type PresencePayload,
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
  bounds: NodeBounds;
  node: SceneGraphNode;
}

export interface PaintRecord extends FlattenedSceneNode {
  isContainer: boolean;
  painted: boolean;
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

export interface NodeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export type ResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw"
  | "line-start"
  | "line-end";

export interface ResizeHandleHit {
  handle: ResizeHandle;
  nodeId: string;
}

export interface HistoryEntry {
  after: PageDocumentDto;
  before: PageDocumentDto;
  command: EditorCommand;
}

export interface EditorSessionSnapshot {
  canRedo: boolean;
  canUndo: boolean;
  document: PageDocumentDto;
  localClientId: number;
  presenceEntries: EditorPresenceEntry[];
}

export interface EditorSession {
  commit(command: EditorCommand): boolean;
  connect(): void;
  destroy(): void;
  getSnapshot(): EditorSessionSnapshot;
  clearPresence(): void;
  setPresenceCursor(cursor: Point | null): void;
  setPresenceSelection(nodeIds: string[]): void;
  redo(): boolean;
  subscribe(listener: (snapshot: EditorSessionSnapshot) => void): () => void;
  undo(): boolean;
}

export interface EditorPresenceEntry {
  clientId: number;
  payload: PresencePayload;
}

export interface EditorPresenceIdentity {
  participant: PresenceParticipant;
}

export interface ActiveTextEdit {
  draft: string;
  nodeId: string;
}

export type ActiveInteraction =
  | {
      currentPagePoint?: Point;
      startPagePoint: Point;
      startSelectedIds: string[];
      type: "marquee";
    }
  | {
      currentPagePoint?: Point;
      originalDocument: PageDocumentDto;
      startPagePoint: Point;
      type: "move";
    }
  | {
      handle: ResizeHandle;
      currentPagePoint?: Point;
      originalDocument: PageDocumentDto;
      record: PaintRecord;
      startPagePoint: Point;
      type: "resize";
    }
  | {
      currentPagePoint?: Point;
      startScreenPoint: Point;
      startViewport: ViewportState;
      type: "pan";
    };

export interface EditorState {
  activeInteraction: ActiveInteraction | null;
  activeScopeId: string | null;
  activeTextEdit: ActiveTextEdit | null;
  hoveredId: string | null;
  primarySelectionId: string | null;
  selectedIds: string[];
  viewport: ViewportState;
}
