const express = require("express");
const { nanoid } = require("nanoid");
const { Boards, Users } = require("../db/store");
const { authMiddleware } = require("./auth");

const router = express.Router();

// Create a new whiteboard room. Returns a short room ID used in the URL,
// e.g. /board/AJH281
router.post("/", authMiddleware, (req, res) => {
  const roomId = nanoid(6).toUpperCase();
  const board = Boards.create({ roomId, ownerId: req.user.id });
  res.json(board);
});

// Fetch a board's saved elements when a user joins/reloads it.
router.get("/:roomId", authMiddleware, (req, res) => {
  const board = Boards.findByRoomId(req.params.roomId.toUpperCase());
  if (!board) return res.status(404).json({ error: "Board not found" });
  res.json(board);
});

// List boards the current user owns (for a "My Boards" home screen).
router.get("/", authMiddleware, (req, res) => {
  res.json(Boards.listByOwner(req.user.id));
});

// ---------- Roles (Owner / Editor / Viewer) ----------
router.get("/:roomId/role", authMiddleware, (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  const board = Boards.findByRoomId(roomId);
  if (!board) return res.status(404).json({ error: "Board not found" });
  res.json({ role: Boards.getRole(roomId, req.user.id) });
});

// Only the board owner can change someone else's role.
router.post("/:roomId/role", authMiddleware, (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  const board = Boards.findByRoomId(roomId);
  if (!board) return res.status(404).json({ error: "Board not found" });
  if (board.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the board owner can change roles" });
  }
  const { email, role } = req.body;
  if (!["editor", "viewer"].includes(role)) {
    return res.status(400).json({ error: "role must be 'editor' or 'viewer'" });
  }
  const target = Users.findByEmail(email);
  if (!target) return res.status(404).json({ error: "No user with that email" });
  Boards.setRole(roomId, target.id, role);
  res.json({ ok: true, email, role });
});

// ---------- Analytics (owner only) ----------
router.get("/:roomId/analytics", authMiddleware, (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  const board = Boards.findByRoomId(roomId);
  if (!board) return res.status(404).json({ error: "Board not found" });
  if (board.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the board owner can view analytics" });
  }
  res.json(Boards.getAnalytics(roomId));
});

module.exports = router;
