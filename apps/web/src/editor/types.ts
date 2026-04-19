import {
  DEFAULT_PAGE_BACKGROUND,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  type EditorCommand,
  type FlattenedSceneNode,
  type HydratedPageScene,
  type NodeBounds,
  type PageDocumentDto,
  type PaintRecord,
  type PresenceParticipant,
  type PresencePayload
} from "@openmirage/types";

export {
  DEFAULT_PAGE_BACKGROUND,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH
};
export type {
  FlattenedSceneNode,
  HydratedPageScene,
  NodeBounds,
  PaintRecord
};

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Point {
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

export type EditorSessionConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "retrying";

export interface EditorSessionStatus {
  attemptCount: number;
  lastFailureReason: string | null;
  state: EditorSessionConnectionState;
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
