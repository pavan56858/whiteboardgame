import { useEffect, useRef } from "react";
import { getBBox, screenToWorld, SHAPE_TYPES } from "../geometry.js";

const HANDLE_SIZE = 9;

export default function Canvas({
  elements,
  liveStrokes,
  tool,
  color,
  brushSize,
  view,
  selectedId,
  spacePressed,
  readOnly,
  onDrawPoint,
  onStrokeComplete,
  onShapeComplete,
  onSelectElement,
  onDragSelected,
  onResizeSelected,
  onDragCommit,
  onRequestText,
  onPan,
  onDrawingChange,
}) {
  const canvasRef = useRef(null);
  const gestureRef = useRef(null); // { mode: 'draw'|'shape'|'move'|'resize'|'pan', ... }

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      redraw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawStroke(ctx, stroke) {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
  }

  function drawShape(ctx, el) {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const { x1, y1, x2, y2 } = el;

    if (el.type === "rect") {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (el.type === "circle") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (el.type === "line") {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (el.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10 + el.width;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (el.type === "triangle") {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      ctx.beginPath();
      ctx.moveTo((minX + maxX) / 2, minY);
      ctx.lineTo(minX, maxY);
      ctx.lineTo(maxX, maxY);
      ctx.closePath();
      ctx.stroke();
    }
  }

  function drawText(ctx, el) {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = el.color;
    ctx.font = `${el.fontSize || 20}px "Inter", sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(el.text || "", el.x, el.y);
  }

  function drawElement(ctx, el) {
    if (el.type === "stroke") drawStroke(ctx, el);
    else if (el.type === "text") drawText(ctx, el);
    else if (SHAPE_TYPES.includes(el.type)) drawShape(ctx, el);
  }

  function drawSelectionUI(ctx, el) {
    const b = getBBox(el);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#3B5BFD";
    ctx.lineWidth = 1 / view.scale;
    ctx.setLineDash([5 / view.scale, 4 / view.scale]);
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.setLineDash([]);
    const hs = HANDLE_SIZE / view.scale;
    ctx.fillStyle = "#3B5BFD";
    ctx.fillRect(b.maxX - hs / 2, b.maxY - hs / 2, hs, hs);
    ctx.restore();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    elements.forEach((el) => drawElement(ctx, el));
    Object.values(liveStrokes || {}).forEach((stroke) => drawStroke(ctx, stroke));

    if (gestureRef.current?.mode === "shape" && gestureRef.current.preview) {
      drawShape(ctx, gestureRef.current.preview);
    }

    const selected = elements.find((e) => e.id === selectedId);
    if (selected && (tool === "select")) drawSelectionUI(ctx, selected);
  }

  useEffect(redraw); // redraw on every render (cheap enough for this scale of app)

  function getScreenPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function getWorldPoint(e) {
    const s = getScreenPoint(e);
    return screenToWorld(s.x, s.y, view);
  }

  function resizeHandleHit(el, world) {
    const b = getBBox(el);
    const hs = (HANDLE_SIZE / view.scale) * 1.6;
    return Math.abs(world.x - b.maxX) <= hs && Math.abs(world.y - b.maxY) <= hs;
  }

  function hitTestTopmost(world) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const b = getBBox(el);
      const pad = 6 / view.scale;
      if (
        world.x >= b.minX - pad &&
        world.x <= b.maxX + pad &&
        world.y >= b.minY - pad &&
        world.y <= b.maxY + pad
      ) {
        return el;
      }
    }
    return null;
  }

  function handleStart(e) {
    const screen = getScreenPoint(e);
    const world = screenToWorld(screen.x, screen.y, view);

    if (tool === "pan" || spacePressed) {
      gestureRef.current = { mode: "pan", lastScreen: screen };
      return;
    }

    if (tool === "select") {
      const selected = elements.find((el) => el.id === selectedId);
      if (!readOnly && selected && resizeHandleHit(selected, world)) {
        gestureRef.current = { mode: "resize" };
        return;
      }
      const hit = hitTestTopmost(world);
      onSelectElement(hit ? hit.id : null);
      if (hit && !readOnly) {
        gestureRef.current = { mode: "move", lastWorld: world };
      }
      return;
    }

    if (readOnly) return; // pen/eraser/shapes/text all blocked for viewers

    if (tool === "text") {
      onRequestText(world);
      return;
    }

    if (tool === "pen" || tool === "eraser") {
      onDrawingChange(true);
      gestureRef.current = {
        mode: "draw",
        stroke: {
          id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
          type: "stroke",
          tool,
          color,
          width: tool === "eraser" ? brushSize * 3 : brushSize,
          points: [world],
        },
      };
      return;
    }

    if (SHAPE_TYPES.includes(tool)) {
      gestureRef.current = {
        mode: "shape",
        preview: {
          id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
          type: tool,
          color,
          width: brushSize,
          x1: world.x,
          y1: world.y,
          x2: world.x,
          y2: world.y,
        },
      };
    }
  }

  function handleMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    const screen = getScreenPoint(e);
    const world = screenToWorld(screen.x, screen.y, view);

    if (g.mode === "pan") {
      const dx = screen.x - g.lastScreen.x;
      const dy = screen.y - g.lastScreen.y;
      g.lastScreen = screen;
      onPan(dx, dy);
      return;
    }
    if (g.mode === "draw") {
      g.stroke.points.push(world);
      onDrawPoint(g.stroke);
      redraw();
      return;
    }
    if (g.mode === "shape") {
      g.preview.x2 = world.x;
      g.preview.y2 = world.y;
      redraw();
      return;
    }
    if (g.mode === "move") {
      const dx = world.x - g.lastWorld.x;
      const dy = world.y - g.lastWorld.y;
      g.lastWorld = world;
      onDragSelected(dx, dy);
      return;
    }
    if (g.mode === "resize") {
      onResizeSelected(world.x, world.y);
    }
  }

  function handleEnd() {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;

    if (g.mode === "draw") {
      onDrawingChange(false);
      if (g.stroke.points.length > 1) onStrokeComplete(g.stroke);
    } else if (g.mode === "shape") {
      const moved = Math.hypot(g.preview.x2 - g.preview.x1, g.preview.y2 - g.preview.y1) > 2;
      if (moved) onShapeComplete(g.preview);
    } else if (g.mode === "move" || g.mode === "resize") {
      onDragCommit();
    }
  }

  const cursorStyle =
    tool === "pan" || spacePressed
      ? "grab"
      : tool === "select"
      ? "default"
      : tool === "text"
      ? "text"
      : "crosshair";

  return (
    <canvas
      ref={canvasRef}
      className="whiteboard-canvas"
      style={{ cursor: cursorStyle }}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
    />
  );
}
