/**
 * Shared math for the infinite canvas: pan/zoom coordinate conversion,
 * per-element bounding boxes, and generic move/resize transforms that
 * work across every element type (strokes, shapes, text).
 *
 * "view" = { scale, offsetX, offsetY } — describes the current pan/zoom.
 * World coordinates are what's stored in `elements` and persisted.
 * Screen coordinates are pixel positions inside the canvas container.
 */

export function worldToScreen(x, y, view) {
  return { x: x * view.scale + view.offsetX, y: y * view.scale + view.offsetY };
}

export function screenToWorld(x, y, view) {
  return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale };
}

// Bounding box of an element, in world coordinates.
export function getBBox(el) {
  if (el.type === "stroke") {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (el.type === "text") {
    const w = (el.text?.length || 4) * (el.fontSize || 20) * 0.55;
    const h = (el.fontSize || 20) * 1.3;
    return { minX: el.x, minY: el.y - h, maxX: el.x + w, maxY: el.y };
  }
  // rect, circle, line, arrow, triangle all use x1,y1,x2,y2
  return {
    minX: Math.min(el.x1, el.x2),
    minY: Math.min(el.y1, el.y2),
    maxX: Math.max(el.x1, el.x2),
    maxY: Math.max(el.y1, el.y2),
  };
}

export function hitTest(el, worldX, worldY, padding = 8) {
  const b = getBBox(el);
  return (
    worldX >= b.minX - padding &&
    worldX <= b.maxX + padding &&
    worldY >= b.minY - padding &&
    worldY <= b.maxY + padding
  );
}

// Apply fn(x, y) -> {x, y} to every coordinate pair in an element.
// This one function powers both "move" and "resize" for every element type.
export function transformElement(el, fn) {
  if (el.type === "stroke") {
    return { ...el, points: el.points.map((p) => fn(p.x, p.y)) };
  }
  if (el.type === "text") {
    const p = fn(el.x, el.y);
    return { ...el, x: p.x, y: p.y };
  }
  const p1 = fn(el.x1, el.y1);
  const p2 = fn(el.x2, el.y2);
  return { ...el, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

export function moveElement(el, dx, dy) {
  return transformElement(el, (x, y) => ({ x: x + dx, y: y + dy }));
}

// Resize by dragging the bottom-right handle to (newMaxX, newMaxY),
// keeping the top-left corner fixed as the anchor.
export function resizeElement(el, newMaxX, newMaxY) {
  const b = getBBox(el);
  const oldW = Math.max(b.maxX - b.minX, 1);
  const oldH = Math.max(b.maxY - b.minY, 1);
  const scaleX = Math.max((newMaxX - b.minX) / oldW, 0.05);
  const scaleY = Math.max((newMaxY - b.minY) / oldH, 0.05);
  if (el.type === "text") {
    return { ...el, fontSize: Math.max(8, Math.round((el.fontSize || 20) * scaleY)) };
  }
  return transformElement(el, (x, y) => ({
    x: b.minX + (x - b.minX) * scaleX,
    y: b.minY + (y - b.minY) * scaleY,
  }));
}

export const SHAPE_TYPES = ["rect", "circle", "line", "arrow", "triangle"];

// A small set of stable, pleasant colors assigned deterministically per
// user id, so the same person always gets the same cursor color.
const CURSOR_PALETTE = ["#F97316", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EAB308", "#EC4899", "#14B8A6"];
export function colorForUser(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_PALETTE[hash % CURSOR_PALETTE.length];
}
