const jwt = require("jsonwebtoken");
const { Boards } = require("./db/store");
const { JWT_SECRET } = require("./routes/auth");

// roomId -> Map(socketId -> { id, name, color, role })
const presence = new Map();

// Debounced auto-save: key -> timeout handle
const saveTimers = new Map();
function scheduleSave(roomId, elements) {
  const key = "elements:" + roomId;
  if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
  const t = setTimeout(() => {
    Boards.save(roomId, elements);
    saveTimers.delete(key);
  }, 3000);
  saveTimers.set(key, t);
}
function scheduleStickySave(roomId, stickyNotes) {
  const key = "stickies:" + roomId;
  if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
  const t = setTimeout(() => {
    Boards.saveStickies(roomId, stickyNotes);
    saveTimers.delete(key);
  }, 3000);
  saveTimers.set(key, t);
}

const CURSOR_PALETTE = ["#F97316", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EAB308", "#EC4899", "#14B8A6"];
function colorForUser(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_PALETTE[hash % CURSOR_PALETTE.length];
}

// In-memory copy of sticky notes per room, kept in sync with what's
// broadcast so late joiners and the debounced save both have the latest.
const stickyState = new Map(); // roomId -> array of notes

function initSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No auth token"));
      const user = jwt.verify(token, JWT_SECRET);
      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket) => {
    let currentRoom = null;
    let joinedAt = null;

    socket.on("join-room", ({ roomId }, ack) => {
      currentRoom = roomId;
      joinedAt = Date.now();
      socket.join(roomId);
      socket.role = Boards.getRole(roomId, socket.user.id);

      if (!presence.has(roomId)) presence.set(roomId, new Map());
      presence.get(roomId).set(socket.id, {
        id: socket.id,
        name: socket.user.name,
        color: colorForUser(socket.user.id),
        role: socket.role,
      });

      const board = Boards.findByRoomId(roomId);
      if (!stickyState.has(roomId)) {
        stickyState.set(roomId, board?.stickyNotes || []);
      }
      const users = Array.from(presence.get(roomId).values());
      const existingPeerIds = users.filter((u) => u.id !== socket.id).map((u) => u.id);

      socket.to(roomId).emit("presence-update", users);
      // Let existing peers know a newcomer arrived, for WebRTC — the
      // newcomer will initiate connections to each of them.
      socket.to(roomId).emit("webrtc-peer-joined", { id: socket.id, name: socket.user.name });

      if (typeof ack === "function") {
        ack({
          elements: board ? board.elements : [],
          stickyNotes: stickyState.get(roomId) || [],
          users,
          role: socket.role,
          peerIds: existingPeerIds,
        });
      }
    });

    function canEdit() {
      return socket.role !== "viewer";
    }

    // --- Drawing ---
    socket.on("draw", (payload) => {
      if (!currentRoom || !canEdit()) return;
      socket.to(currentRoom).emit("draw", payload);
    });

    socket.on("sync-elements", (elements) => {
      if (!currentRoom || !canEdit()) return;
      socket.to(currentRoom).emit("sync-elements", elements);
      scheduleSave(currentRoom, elements);
      Boards.recordEdit(currentRoom, socket.user.id, socket.user.name);
    });

    // --- Sticky notes (also used for Kanban cards + votes) ---
    socket.on("sticky-add", (note) => {
      if (!currentRoom || !canEdit()) return;
      const list = stickyState.get(currentRoom) || [];
      list.push(note);
      stickyState.set(currentRoom, list);
      socket.to(currentRoom).emit("sticky-add", note);
      scheduleStickySave(currentRoom, list);
      Boards.recordEdit(currentRoom, socket.user.id, socket.user.name);
    });
    socket.on("sticky-update", (note) => {
      if (!currentRoom || !canEdit()) return;
      const list = (stickyState.get(currentRoom) || []).map((n) => (n.id === note.id ? note : n));
      stickyState.set(currentRoom, list);
      socket.to(currentRoom).emit("sticky-update", note);
      scheduleStickySave(currentRoom, list);
      Boards.recordEdit(currentRoom, socket.user.id, socket.user.name);
    });
    socket.on("sticky-delete", (noteId) => {
      if (!currentRoom || !canEdit()) return;
      const list = (stickyState.get(currentRoom) || []).filter((n) => n.id !== noteId);
      stickyState.set(currentRoom, list);
      socket.to(currentRoom).emit("sticky-delete", noteId);
      scheduleStickySave(currentRoom, list);
    });

    // Voting is intentionally allowed for viewers too — it's a lightweight
    // signal, not a board edit, so it bypasses the canEdit() check.
    socket.on("sticky-vote", (noteId) => {
      if (!currentRoom) return;
      const list = stickyState.get(currentRoom) || [];
      const note = list.find((n) => n.id === noteId);
      if (!note) return;
      const votes = { ...(note.votes || {}) };
      if (votes[socket.user.id]) delete votes[socket.user.id];
      else votes[socket.user.id] = true;
      note.votes = votes;
      stickyState.set(currentRoom, list);
      socket.to(currentRoom).emit("sticky-update", note);
      scheduleStickySave(currentRoom, list);
    });

    // --- "X is drawing…" indicator ---
    socket.on("drawing-status", (isDrawing) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("drawing-status", { id: socket.id, isDrawing });
    });

    // --- Live cursors ---
    socket.on("cursor-move", ({ x, y }) => {
      if (!currentRoom) return;
      const users = presence.get(currentRoom);
      const me = users?.get(socket.id);
      socket.to(currentRoom).emit("cursor-move", {
        id: socket.id,
        x,
        y,
        name: me?.name || "Guest",
        color: me?.color || "#333",
      });
    });

    // --- Board-wide actions ---
    socket.on("clear-board", () => {
      if (!currentRoom || !canEdit()) return;
      socket.to(currentRoom).emit("clear-board");
      scheduleSave(currentRoom, []);
    });

    // --- WebRTC signaling relay (voice / video / screen share) ---
    // The client owns all peer-connection logic; the server only relays
    // opaque signaling payloads between two specific socket ids.
    socket.on("webrtc-signal", ({ to, data }) => {
      if (!to) return;
      io.to(to).emit("webrtc-signal", { from: socket.id, data });
    });

    socket.on("disconnect", () => {
      if (!currentRoom) return;
      const users = presence.get(currentRoom);
      if (users) {
        users.delete(socket.id);
        io.to(currentRoom).emit("presence-update", Array.from(users.values()));
        io.to(currentRoom).emit("cursor-leave", socket.id);
        io.to(currentRoom).emit("webrtc-peer-left", { id: socket.id });
        if (users.size === 0) presence.delete(currentRoom);
      }
      if (joinedAt) {
        Boards.recordSession(currentRoom, socket.user.id, socket.user.name, Date.now() - joinedAt);
      }
    });
  });
}

module.exports = { initSocket };
