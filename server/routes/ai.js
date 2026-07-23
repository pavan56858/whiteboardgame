const express = require("express");
const { Boards } = require("../db/store");
const { authMiddleware } = require("./auth");

const router = express.Router();

const SYSTEM_PROMPT = `You generate simple system/architecture diagrams as strict JSON — nothing else, no markdown fences, no commentary.

Output shape exactly:
{"nodes":[{"id":"n1","label":"Short label","x":0,"y":0}],"edges":[{"from":"n1","to":"n2"}]}

Rules:
- 4 to 10 nodes. Arrange them left-to-right / top-to-bottom in a logical flow using x,y in a 900x500 box (x: 0-900, y: 0-500). Space boxes at least 160px apart so they don't overlap.
- Each node label is under 4 words.
- edges.from/to must reference node ids that exist.
- Output ONLY the JSON object, nothing before or after it.`;

function extractJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
  return JSON.parse(trimmed.slice(start, end + 1));
}

// Converts the model's {nodes, edges} shape into whiteboard elements
// (rect + text per node, arrow per edge) offset around (originX, originY).
function diagramToElements(diagram, originX, originY, color) {
  const elements = [];
  const nodeBox = { w: 150, h: 60 };
  const nodeCenter = {};

  (diagram.nodes || []).forEach((node) => {
    const x1 = originX + node.x;
    const y1 = originY + node.y;
    const x2 = x1 + nodeBox.w;
    const y2 = y1 + nodeBox.h;
    nodeCenter[node.id] = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, x1, y1, x2, y2 };

    elements.push({
      id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
      type: "rect",
      x1, y1, x2, y2,
      color,
      width: 2,
    });
    elements.push({
      id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
      type: "text",
      x: x1 + 10,
      y: y1 + nodeBox.h / 2 + 6,
      text: String(node.label || node.id).slice(0, 40),
      color,
      fontSize: 15,
    });
  });

  (diagram.edges || []).forEach((edge) => {
    const from = nodeCenter[edge.from];
    const to = nodeCenter[edge.to];
    if (!from || !to) return; // skip edges referencing unknown nodes rather than failing the whole diagram
    elements.push({
      id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
      type: "arrow",
      x1: from.x2,
      y1: from.y,
      x2: to.x1,
      y2: to.y,
      color,
      width: 2,
    });
  });

  return elements;
}

router.post("/diagram", authMiddleware, async (req, res) => {
  const { prompt, roomId, originX = 0, originY = 0, color = "#111827" } = req.body;
  if (!prompt || !roomId) return res.status(400).json({ error: "prompt and roomId are required" });

  const board = Boards.findByRoomId(roomId.toUpperCase());
  if (!board) return res.status(404).json({ error: "Board not found" });
  const role = Boards.getRole(roomId.toUpperCase(), req.user.id);
  if (role === "viewer") return res.status(403).json({ error: "Viewers can't generate diagrams" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error:
        "ANTHROPIC_API_KEY is not set on the server. Add it to server/.env to enable AI diagram generation.",
    });
  }

  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Diagram request: ${prompt}` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Anthropic API error", details: errText });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return res.status(502).json({ error: "Model returned no text content" });

    const diagram = extractJson(textBlock.text);
    const elements = diagramToElements(diagram, originX, originY, color);
    res.json({ elements });
  } catch (err) {
    res.status(500).json({ error: "AI diagram generation failed", details: err.message });
  }
});

module.exports = router;
module.exports.extractJson = extractJson;
module.exports.diagramToElements = diagramToElements;
