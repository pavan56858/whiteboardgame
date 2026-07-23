/**
 * Starter templates for "Flowchart", "Mind Map", and "Kanban" modes.
 * These aren't separate app modes with custom logic — they're just a
 * pre-built set of board elements (and, for Kanban, sticky notes)
 * dropped onto the canvas at the given origin. Everything they create
 * uses the same rect/arrow/text/sticky-note primitives the rest of the
 * app already syncs and persists, so there's nothing new to test here.
 */

function id() {
  return "el_" + Date.now() + Math.random().toString(36).slice(2, 7);
}

export function buildFlowchartTemplate(ox, oy, color = "#111827") {
  const steps = ["Start", "Process input", "Decision?", "Handle result", "End"];
  const boxW = 160, boxH = 60, gapY = 110;
  const elements = [];
  const centers = [];

  steps.forEach((label, i) => {
    const x1 = ox, y1 = oy + i * gapY, x2 = x1 + boxW, y2 = y1 + boxH;
    centers.push({ x: (x1 + x2) / 2, y2 });
    elements.push({ id: id(), type: "rect", x1, y1, x2, y2, color, width: 2 });
    elements.push({ id: id(), type: "text", x: x1 + 12, y: y1 + boxH / 2 + 5, text: label, color, fontSize: 15 });
  });
  for (let i = 0; i < centers.length - 1; i++) {
    elements.push({
      id: id(),
      type: "arrow",
      x1: centers[i].x,
      y1: centers[i].y2,
      x2: centers[i + 1].x,
      y2: centers[i + 1].y2 - boxH,
      color,
      width: 2,
    });
  }
  return elements;
}

export function buildMindMapTemplate(ox, oy, color = "#111827") {
  const centerW = 160, centerH = 60;
  const cx1 = ox, cy1 = oy, cx2 = ox + centerW, cy2 = oy + centerH;
  const ccx = (cx1 + cx2) / 2, ccy = (cy1 + cy2) / 2;

  const elements = [
    { id: id(), type: "rect", x1: cx1, y1: cy1, x2: cx2, y2: cy2, color, width: 2 },
    { id: id(), type: "text", x: cx1 + 14, y: ccy + 5, text: "Main idea", color, fontSize: 16 },
  ];

  const branches = ["Idea A", "Idea B", "Idea C", "Idea D"];
  const radius = 220;
  branches.forEach((label, i) => {
    const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
    const bx = ccx + Math.cos(angle) * radius;
    const by = ccy + Math.sin(angle) * radius;
    const bw = 130, bh = 50;
    elements.push({
      id: id(),
      type: "line",
      x1: ccx,
      y1: ccy,
      x2: bx,
      y2: by,
      color,
      width: 2,
    });
    elements.push({
      id: id(),
      type: "rect",
      x1: bx - bw / 2,
      y1: by - bh / 2,
      x2: bx + bw / 2,
      y2: by + bh / 2,
      color,
      width: 2,
    });
    elements.push({
      id: id(),
      type: "text",
      x: bx - bw / 2 + 10,
      y: by + 5,
      text: label,
      color,
      fontSize: 14,
    });
  });
  return elements;
}

// Kanban returns { elements, stickyNotes } since columns are drawn
// shapes/text but cards are real sticky notes (so they're draggable
// between columns and votable, same as any other sticky note).
export function buildKanbanTemplate(ox, oy, color = "#111827") {
  const columns = ["To Do", "In Progress", "Done"];
  const colW = 260, colH = 480, gap = 24;
  const elements = [];
  const stickyNotes = [];

  columns.forEach((title, i) => {
    const x1 = ox + i * (colW + gap);
    const y1 = oy;
    const x2 = x1 + colW;
    const y2 = y1 + colH;
    elements.push({ id: id(), type: "rect", x1, y1, x2, y2, color, width: 2 });
    elements.push({ id: id(), type: "text", x: x1 + 12, y: y1 + 26, text: title, color, fontSize: 17 });

    if (i === 0) {
      stickyNotes.push(
        { id: "note_" + Date.now() + "_a", x: x1 + 20, y: y1 + 60, text: "Example task 1", color: "#FEF08A", votes: {} },
        { id: "note_" + Date.now() + "_b", x: x1 + 20, y: y1 + 200, text: "Example task 2", color: "#FEF08A", votes: {} }
      );
    }
  });
  return { elements, stickyNotes };
}
