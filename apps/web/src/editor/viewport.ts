import { type Point, type ViewportState } from "./types";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function createInitialViewport(): ViewportState {
  return {
    panX: 80,
    panY: 80,
    zoom: 1
  };
}

export function pagePointToScreenPoint(
  point: Point,
  viewport: ViewportState
): Point {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY
  };
}

export function screenPointToPagePoint(
  point: Point,
  viewport: ViewportState
): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom
  };
}

export function zoomViewportAtPoint(
  viewport: ViewportState,
  nextZoom: number,
  anchor: Point
): ViewportState {
  const zoom = clampZoom(nextZoom);
  const pagePoint = screenPointToPagePoint(anchor, viewport);

  return {
    panX: anchor.x - pagePoint.x * zoom,
    panY: anchor.y - pagePoint.y * zoom,
    zoom
  };
}

