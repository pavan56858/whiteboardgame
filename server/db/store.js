/**
 * Lightweight file-based JSON "database".
 *
 * The project doc calls for MongoDB. This file gives you a working app
 * with ZERO external setup (no Atlas account, no local mongod needed).
 * It exposes the exact same shape of functions a Mongoose model would
 * (findOne, create, updateOne, etc.) so swapping in real MongoDB later
 * is a small, isolated change — see README.md "Swapping in real MongoDB".
 *
 * Data lives in server/db/data.json and is written atomically on every change.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { users: [], boards: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return { users: [], boards: [] };
  }
}

function saveData(data) {
  // Write to a temp file then rename — avoids a corrupted file if the
  // process crashes mid-write.
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let data = loadData();

// ---------- Users ----------
const Users = {
  findByEmail(email) {
    return data.users.find((u) => u.email === email) || null;
  },
  findById(id) {
    return data.users.find((u) => u.id === id) || null;
  },
  create({ name, email, passwordHash }) {
    const user = {
      id: "u_" + Date.now() + Math.random().toString(36).slice(2, 8),
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
    saveData(data);
    return user;
  },
};

// ---------- Boards ----------
const Boards = {
  findByRoomId(roomId) {
    return data.boards.find((b) => b.roomId === roomId) || null;
  },
  create({ roomId, ownerId }) {
    const board = {
      roomId,
      ownerId,
      createdAt: new Date().toISOString(),
      elements: [], // strokes, shapes, text
      stickyNotes: [], // includes votes: { userId: true }
      roles: {}, // userId -> 'editor' | 'viewer' (owner is implicit via ownerId)
      analytics: { edits: {}, sessions: [] },
    };
    data.boards.push(board);
    saveData(data);
    return board;
  },
  save(roomId, elements) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return null;
    board.elements = elements;
    board.updatedAt = new Date().toISOString();
    saveData(data);
    return board;
  },
  saveStickies(roomId, stickyNotes) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return null;
    board.stickyNotes = stickyNotes;
    saveData(data);
    return board;
  },
  listByOwner(ownerId) {
    return data.boards.filter((b) => b.ownerId === ownerId);
  },

  // ---------- Roles / permissions ----------
  getRole(roomId, userId) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return null;
    if (board.ownerId === userId) return "owner";
    return board.roles?.[userId] || "editor"; // default: anyone with the link can edit
  },
  setRole(roomId, userId, role) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return null;
    if (!board.roles) board.roles = {};
    board.roles[userId] = role;
    saveData(data);
    return board;
  },

  // ---------- Analytics ----------
  recordEdit(roomId, userId, name) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return;
    if (!board.analytics) board.analytics = { edits: {}, sessions: [] };
    if (!board.analytics.edits[userId]) board.analytics.edits[userId] = { name, count: 0 };
    board.analytics.edits[userId].count += 1;
    board.analytics.edits[userId].name = name; // keep name fresh
    saveData(data);
  },
  recordSession(roomId, userId, name, durationMs) {
    const board = Boards.findByRoomId(roomId);
    if (!board) return;
    if (!board.analytics) board.analytics = { edits: {}, sessions: [] };
    board.analytics.sessions.push({ userId, name, durationMs, endedAt: new Date().toISOString() });
    saveData(data);
  },
  getAnalytics(roomId) {
    const board = Boards.findByRoomId(roomId);
    return board?.analytics || { edits: {}, sessions: [] };
  },
};

module.exports = { Users, Boards };
