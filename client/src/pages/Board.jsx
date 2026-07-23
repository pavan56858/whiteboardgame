import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Canvas from "../components/Canvas.jsx";
import Toolbar from "../components/Toolbar.jsx";
import StickyNote from "../components/StickyNote.jsx";
import Cursor from "../components/Cursor.jsx";
import { getSocket, disconnectSocket } from "../socket.js";
import { getSession, api } from "../api.js";
import { screenToWorld, moveElement, resizeElement } from "../geometry.js";
import { createWebRTCManager } from "../webrtc.js";
import { buildFlowchartTemplate, buildMindMapTemplate, buildKanbanTemplate } from "../templates.js";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function Board() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const session = getSession();

  const [elements, setElementsState] = useState([]);
  const elementsRef = useRef([]);
  function setElements(next) {
    elementsRef.current = next;
    setElementsState(next);
  }

  const [stickyNotes, setStickyNotes] = useState([]);
  const [liveStrokes, setLiveStrokes] = useState({});
  const [cursors, setCursors] = useState({});
  const [drawingUsers, setDrawingUsers] = useState(new Set());
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [myRole, setMyRole] = useState("editor");
  const readOnly = myRole === "viewer";

  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#111827");
  const [brushSize, setBrushSize] = useState(4);
  const [selectedId, setSelectedId] = useState(null);
  const [textEditing, setTextEditing] = useState(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("whiteboard-dark") === "1");

  // Panels
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessRole, setAccessRole] = useState("editor");
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [analytics, setAnalytics] = useState(null);

  // WebRTC (voice / camera / screen share)
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const webrtcRef = useRef(null);
  const localMicTrackRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const hasActiveMediaRef = useRef(false);
  const usersRef = useRef([]);

  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const dragSnapshotRef = useRef(null);
  const clipboardRef = useRef(null);
  const [historyTick, setHistoryTick] = useState(0);

  const containerRef = useRef(null);
  const socketRef = useRef(null);
  const lastCursorEmit = useRef(0);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    localStorage.setItem("whiteboard-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  // Viewers only ever get select/pan tools, even if they had another
  // tool selected before their role changed mid-session.
  useEffect(() => {
    if (readOnly && !["select", "pan"].includes(tool)) setTool("select");
  }, [readOnly, tool]);

  // ---------- Socket + WebRTC wiring ----------
  useEffect(() => {
    if (!session) {
      navigate("/login");
      return;
    }

    const socket = getSocket();
    socketRef.current = socket;
    socket.connect();

    webrtcRef.current = createWebRTCManager({
      socket,
      onRemoteStream: (peerId, stream) => setRemoteStreams((prev) => ({ ...prev, [peerId]: stream })),
      onRemoteStreamRemoved: (peerId) =>
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        }),
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.emit("join-room", { roomId }, (state) => {
      setElements(state.elements || []);
      setStickyNotes(state.stickyNotes || []);
      setUsers(state.users || []);
      setMyRole(state.role || "editor");
      // If we're already broadcasting media, connect to everyone present.
      if (hasActiveMediaRef.current) {
        (state.peerIds || []).forEach((id) => webrtcRef.current.connectToPeer(id));
      }
    });

    socket.on("presence-update", (u) => setUsers(u));

    socket.on("draw", (stroke) => {
      setLiveStrokes((prev) => ({ ...prev, [stroke.id]: stroke }));
    });
    socket.on("sync-elements", (els) => {
      setElements(els);
      setLiveStrokes({});
    });
    socket.on("clear-board", () => {
      setElements([]);
      setLiveStrokes({});
      historyRef.current = [];
      redoRef.current = [];
      setSelectedId(null);
      setHistoryTick((t) => t + 1);
    });

    socket.on("sticky-add", (note) => setStickyNotes((prev) => [...prev, note]));
    socket.on("sticky-update", (note) =>
      setStickyNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)))
    );
    socket.on("sticky-delete", (id) => setStickyNotes((prev) => prev.filter((n) => n.id !== id)));

    socket.on("cursor-move", (c) => setCursors((prev) => ({ ...prev, [c.id]: c })));
    socket.on("cursor-leave", (id) =>
      setCursors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      })
    );
    socket.on("drawing-status", ({ id, isDrawing }) => {
      setDrawingUsers((prev) => {
        const next = new Set(prev);
        if (isDrawing) next.add(id);
        else next.delete(id);
        return next;
      });
    });

    // --- WebRTC signaling ---
    socket.on("webrtc-signal", (payload) => webrtcRef.current.handleSignal(payload));
    socket.on("webrtc-peer-joined", ({ id }) => {
      if (hasActiveMediaRef.current) webrtcRef.current.connectToPeer(id);
    });
    socket.on("webrtc-peer-left", ({ id }) => webrtcRef.current.removePeer(id));

    return () => {
      disconnectSocket();
      webrtcRef.current?.closeAll();
      localMicTrackRef.current?.stop();
      localVideoTrackRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---------- Generic commit helper (pushes undo history + broadcasts) ----------
  const commitElements = useCallback(
    (next) => {
      if (readOnly) return;
      historyRef.current.push(elementsRef.current);
      redoRef.current = [];
      setElements(next);
      socketRef.current.emit("sync-elements", next);
      setHistoryTick((t) => t + 1);
    },
    [readOnly]
  );

  function addElement(el, select = true) {
    commitElements([...elementsRef.current, el]);
    if (select) setSelectedId(el.id);
  }
  function addElements(list) {
    if (list.length === 0) return;
    commitElements([...elementsRef.current, ...list]);
  }
  function updateElementById(id, fn) {
    commitElements(elementsRef.current.map((el) => (el.id === id ? fn(el) : el)));
  }
  function deleteElementById(id) {
    commitElements(elementsRef.current.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // ---------- Drawing (pen/eraser) ----------
  const handleDrawPoint = useCallback(
    (stroke) => {
      if (readOnly) return;
      socketRef.current.emit("draw", stroke);
    },
    [readOnly]
  );
  const handleStrokeComplete = useCallback(
    (stroke) => commitElements([...elementsRef.current, stroke]),
    [commitElements]
  );
  function handleDrawingChange(isDrawing) {
    socketRef.current.emit("drawing-status", isDrawing);
  }

  // ---------- Shapes ----------
  function handleShapeComplete(shapeEl) {
    addElement(shapeEl);
  }

  // ---------- Selection: drag/resize (batched until pointer-up) ----------
  function handleDragSelected(dx, dy) {
    if (readOnly) return;
    if (!dragSnapshotRef.current) dragSnapshotRef.current = elementsRef.current;
    const next = elementsRef.current.map((el) =>
      el.id === selectedId ? moveElement(el, dx, dy) : el
    );
    setElements(next);
  }
  function handleResizeSelected(worldX, worldY) {
    if (readOnly) return;
    if (!dragSnapshotRef.current) dragSnapshotRef.current = elementsRef.current;
    const next = elementsRef.current.map((el) =>
      el.id === selectedId ? resizeElement(el, worldX, worldY) : el
    );
    setElements(next);
  }
  function handleDragCommit() {
    if (dragSnapshotRef.current) {
      historyRef.current.push(dragSnapshotRef.current);
      redoRef.current = [];
      socketRef.current.emit("sync-elements", elementsRef.current);
      dragSnapshotRef.current = null;
      setHistoryTick((t) => t + 1);
    }
  }

  // ---------- Text tool ----------
  function handleRequestText(payload) {
    if (readOnly) return;
    setTextEditing({
      x: payload.x,
      y: payload.y,
      value: payload.existingText || "",
      existingId: payload.existingId || null,
    });
  }
  function commitText() {
    if (!textEditing) return;
    const trimmed = textEditing.value.trim();
    if (textEditing.existingId) {
      if (trimmed === "") deleteElementById(textEditing.existingId);
      else updateElementById(textEditing.existingId, (el) => ({ ...el, text: trimmed }));
    } else if (trimmed !== "") {
      addElement(
        {
          id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7),
          type: "text",
          x: textEditing.x,
          y: textEditing.y,
          text: trimmed,
          color,
          fontSize: 20,
        },
        false
      );
    }
    setTextEditing(null);
  }

  // ---------- Undo / redo / clear ----------
  function handleUndo() {
    if (readOnly || historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    redoRef.current.push(elementsRef.current);
    setElements(prev);
    socketRef.current.emit("sync-elements", prev);
    setHistoryTick((t) => t + 1);
  }
  function handleRedo() {
    if (readOnly || redoRef.current.length === 0) return;
    const next = redoRef.current.pop();
    historyRef.current.push(elementsRef.current);
    setElements(next);
    socketRef.current.emit("sync-elements", next);
    setHistoryTick((t) => t + 1);
  }
  function handleClear() {
    if (readOnly) return;
    historyRef.current.push(elementsRef.current);
    redoRef.current = [];
    setElements([]);
    setSelectedId(null);
    socketRef.current.emit("clear-board");
    setHistoryTick((t) => t + 1);
  }

  // ---------- Sticky notes ----------
  function handleAddSticky() {
    if (readOnly) return;
    const rect = containerRef.current.getBoundingClientRect();
    const world = screenToWorld(rect.width / 2 + Math.random() * 80, rect.height / 2 + Math.random() * 80, view);
    const note = { id: "note_" + Date.now(), x: world.x, y: world.y, text: "", color: "#FEF08A", votes: {} };
    setStickyNotes((prev) => [...prev, note]);
    socketRef.current.emit("sticky-add", note);
  }
  function handleUpdateSticky(note) {
    if (readOnly) return;
    setStickyNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
    socketRef.current.emit("sticky-update", note);
  }
  function handleDeleteSticky(id) {
    if (readOnly) return;
    setStickyNotes((prev) => prev.filter((n) => n.id !== id));
    socketRef.current.emit("sticky-delete", id);
  }
  function handleVoteSticky(id) {
    // Allowed for viewers too — voting is a lightweight signal, not an edit.
    setStickyNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const votes = { ...(n.votes || {}) };
        const uid = session.user.id;
        if (votes[uid]) delete votes[uid];
        else votes[uid] = true;
        return { ...n, votes };
      })
    );
    socketRef.current.emit("sticky-vote", id);
  }

  // ---------- Templates & AI diagram ----------
  function handleInsertTemplate(type) {
    if (readOnly) return;
    const rect = containerRef.current.getBoundingClientRect();
    const origin = screenToWorld(rect.width / 2 - 300, rect.height / 2 - 150, view);
    if (type === "flowchart") {
      addElements(buildFlowchartTemplate(origin.x, origin.y, color));
    } else if (type === "mindmap") {
      addElements(buildMindMapTemplate(origin.x, origin.y, color));
    } else if (type === "kanban") {
      const { elements: els, stickyNotes: cards } = buildKanbanTemplate(origin.x, origin.y, color);
      addElements(els);
      cards.forEach((card) => {
        setStickyNotes((prev) => [...prev, card]);
        socketRef.current.emit("sticky-add", card);
      });
    }
  }

  async function handleGenerateAIDiagram() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const rect = containerRef.current.getBoundingClientRect();
      const origin = screenToWorld(rect.width / 2 - 300, rect.height / 2 - 150, view);
      const { data } = await api.post("/api/ai/diagram", {
        prompt: aiPrompt,
        roomId,
        originX: origin.x,
        originY: origin.y,
        color,
      });
      addElements(data.elements);
      setAiModalOpen(false);
      setAiPrompt("");
      showToast(`Generated ${data.elements.length} diagram elements`);
    } catch (err) {
      showToast(err.response?.data?.error || "AI diagram generation failed");
    } finally {
      setAiLoading(false);
    }
  }

  // ---------- Access management (owner only) ----------
  async function handleSetRole() {
    try {
      await api.post(`/api/boards/${roomId}/role`, { email: accessEmail, role: accessRole });
      showToast(`${accessEmail} is now ${accessRole}`);
      setAccessEmail("");
    } catch (err) {
      showToast(err.response?.data?.error || "Couldn't update access");
    }
  }

  // ---------- Analytics (owner only) ----------
  async function handleOpenAnalytics() {
    setAnalyticsModalOpen(true);
    try {
      const { data } = await api.get(`/api/boards/${roomId}/analytics`);
      setAnalytics(data);
    } catch {
      showToast("Couldn't load analytics");
    }
  }

  // ---------- Pan & zoom ----------
  function handlePan(dxScreen, dyScreen) {
    setView((v) => ({ ...v, offsetX: v.offsetX + dxScreen, offsetY: v.offsetY + dyScreen }));
  }
  function zoomBy(factor, centerScreen) {
    setView((v) => {
      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.scale * factor));
      const rect = containerRef.current.getBoundingClientRect();
      const cx = centerScreen?.x ?? rect.width / 2;
      const cy = centerScreen?.y ?? rect.height / 2;
      return {
        scale: newScale,
        offsetX: cx - (cx - v.offsetX) * (newScale / v.scale),
        offsetY: cy - (cy - v.offsetY) * (newScale / v.scale),
      };
    });
  }
  function handleWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.08 : 0.93, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setView((v) => ({ ...v, offsetX: v.offsetX - e.deltaX, offsetY: v.offsetY - e.deltaY }));
    }
  }

  // ---------- Cursor broadcasting ----------
  function handleMouseMove(e) {
    const now = Date.now();
    if (now - lastCursorEmit.current < 20) return;
    lastCursorEmit.current = now;
    const rect = containerRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, view);
    socketRef.current.emit("cursor-move", world);
  }

  // ---------- Export ----------
  function handleExport(format = "png") {
    const canvas = containerRef.current.querySelector("canvas");
    let dataUrl;
    if (format === "jpeg") {
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d");
      tctx.fillStyle = "#ffffff";
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      tctx.drawImage(canvas, 0, 0);
      dataUrl = tmp.toDataURL("image/jpeg", 0.92);
    } else {
      dataUrl = canvas.toDataURL("image/png");
    }
    const link = document.createElement("a");
    link.download = `whiteboard-${roomId}.${format === "jpeg" ? "jpg" : "png"}`;
    link.href = dataUrl;
    link.click();
    showToast(`Exported as ${format.toUpperCase()}`);
  }

  function handleInvite() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => showToast("Invite link copied!"))
      .catch(() => showToast("Copy failed — copy the URL manually"));
  }

  // ---------- WebRTC media controls ----------
  function rebuildLocalStream() {
    const tracks = [];
    if (localMicTrackRef.current) tracks.push(localMicTrackRef.current);
    if (localVideoTrackRef.current) tracks.push(localVideoTrackRef.current);
    const stream = new MediaStream(tracks);
    hasActiveMediaRef.current = tracks.length > 0;
    webrtcRef.current?.setLocalStream(stream);
    if (hasActiveMediaRef.current) {
      usersRef.current.forEach((u) => {
        if (u.id !== socketRef.current.id && !webrtcRef.current.hasPeer(u.id)) {
          webrtcRef.current.connectToPeer(u.id);
        }
      });
    }
  }

  async function toggleMic() {
    if (micOn) {
      localMicTrackRef.current?.stop();
      localMicTrackRef.current = null;
      setMicOn(false);
      rebuildLocalStream();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localMicTrackRef.current = stream.getAudioTracks()[0];
      setMicOn(true);
      rebuildLocalStream();
    } catch {
      showToast("Microphone access denied or unavailable");
    }
  }

  async function toggleCam() {
    if (camOn) {
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current = null;
      setCamOn(false);
      rebuildLocalStream();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current = stream.getVideoTracks()[0];
      setCamOn(true);
      setScreenOn(false);
      rebuildLocalStream();
    } catch {
      showToast("Camera access denied or unavailable");
    }
  }

  async function toggleScreen() {
    if (screenOn) {
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current = null;
      setScreenOn(false);
      rebuildLocalStream();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      track.onended = () => {
        setScreenOn(false);
        localVideoTrackRef.current = null;
        rebuildLocalStream();
      };
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current = track;
      setScreenOn(true);
      setCamOn(false);
      rebuildLocalStream();
    } catch {
      showToast("Screen share cancelled or unavailable");
    }
  }

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const TOOL_KEYS = {
      v: "select", p: "pen", e: "eraser", r: "rect", c: "circle",
      l: "line", a: "arrow", t: "triangle", x: "text", h: "pan",
    };
    function onKeyDown(e) {
      if (isTypingTarget(document.activeElement)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleExport("png");
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId && !readOnly) {
          const orig = elementsRef.current.find((el) => el.id === selectedId);
          if (orig) {
            const copy = moveElement(
              { ...orig, id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7) },
              20, 20
            );
            addElement(copy);
          }
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        if (selectedId) clipboardRef.current = elementsRef.current.find((el) => el.id === selectedId);
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (clipboardRef.current && !readOnly) {
          const copy = moveElement(
            { ...clipboardRef.current, id: "el_" + Date.now() + Math.random().toString(36).slice(2, 7) },
            20, 20
          );
          addElement(copy);
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !readOnly) {
        e.preventDefault();
        deleteElementById(selectedId);
        return;
      }
      if (!mod && !readOnly && TOOL_KEYS[e.key.toLowerCase()]) {
        setTool(TOOL_KEYS[e.key.toLowerCase()]);
      } else if (!mod && readOnly && (e.key.toLowerCase() === "h" || e.key.toLowerCase() === "v")) {
        setTool(TOOL_KEYS[e.key.toLowerCase()]);
      }
    }
    function onKeyUp(e) {
      if (e.code === "Space") setSpacePressed(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, readOnly]);

  const textScreenPos = textEditing
    ? { x: textEditing.x * view.scale + view.offsetX, y: textEditing.y * view.scale + view.offsetY }
    : null;

  return (
    <div className="board-page">
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyRef.current.length > 0}
        canRedo={redoRef.current.length > 0}
        onAddSticky={handleAddSticky}
        onClear={handleClear}
        onExport={handleExport}
        roomId={roomId}
        zoom={view.scale}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(0.83)}
        onZoomReset={() => setView({ scale: 1, offsetX: 0, offsetY: 0 })}
        onInvite={handleInvite}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        readOnly={readOnly}
        role={myRole}
        onInsertTemplate={handleInsertTemplate}
        onOpenAIDiagram={() => setAiModalOpen(true)}
        onOpenManageAccess={() => setAccessModalOpen(true)}
        onOpenAnalytics={handleOpenAnalytics}
        micOn={micOn}
        camOn={camOn}
        screenOn={screenOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleScreen={toggleScreen}
      />

      <div className="board-body">
        <div
          className="board-canvas-wrap"
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onWheel={handleWheel}
        >
          <Canvas
            elements={elements}
            liveStrokes={liveStrokes}
            tool={tool}
            color={color}
            brushSize={brushSize}
            view={view}
            selectedId={selectedId}
            spacePressed={spacePressed}
            readOnly={readOnly}
            onDrawPoint={handleDrawPoint}
            onStrokeComplete={handleStrokeComplete}
            onShapeComplete={handleShapeComplete}
            onSelectElement={setSelectedId}
            onDragSelected={handleDragSelected}
            onResizeSelected={handleResizeSelected}
            onDragCommit={handleDragCommit}
            onRequestText={handleRequestText}
            onPan={handlePan}
            onDrawingChange={handleDrawingChange}
          />

          {stickyNotes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              view={view}
              currentUserId={session?.user?.id}
              readOnly={readOnly}
              onUpdate={handleUpdateSticky}
              onDelete={handleDeleteSticky}
              onVote={handleVoteSticky}
            />
          ))}

          {Object.values(cursors).map((c) => (
            <Cursor key={c.id} {...c} view={view} isDrawing={drawingUsers.has(c.id)} />
          ))}

          {textEditing && (
            <textarea
              autoFocus
              className="text-tool-input"
              style={{ left: textScreenPos.x, top: textScreenPos.y - 22, fontSize: 20 * view.scale, color }}
              value={textEditing.value}
              onChange={(e) => setTextEditing((t) => ({ ...t, value: e.target.value }))}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.target.blur();
                } else if (e.key === "Escape") {
                  setTextEditing(null);
                }
              }}
            />
          )}

          {toast && <div className="toast">{toast}</div>}

          {Object.keys(remoteStreams).length > 0 && (
            <div className="media-strip">
              {Object.entries(remoteStreams).map(([peerId, stream]) => (
                <RemoteMediaTile key={peerId} stream={stream} />
              ))}
            </div>
          )}
        </div>

        <aside className="presence-sidebar">
          <h3>Online {connected ? "🟢" : "🔴"}</h3>
          <ul>
            {users.map((u) => (
              <li key={u.id}>
                <span className="dot" style={{ background: u.color }} />
                {u.name}
                {u.role && u.role !== "editor" && <span className="role-tag">{u.role}</span>}
                {drawingUsers.has(u.id) && <span className="drawing-badge">drawing…</span>}
              </li>
            ))}
          </ul>
          {readOnly && <p className="viewonly-note">You have view-only access to this board.</p>}
        </aside>
      </div>

      {aiModalOpen && (
        <div className="modal-backdrop" onClick={() => !aiLoading && setAiModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✨ AI Diagram Generator</h3>
            <p className="muted">
              Describe a system, and it'll be laid out on your board as boxes and arrows.
            </p>
            <textarea
              autoFocus
              placeholder="e.g. system architecture for an e-commerce app"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button className="btn-secondary small" onClick={() => setAiModalOpen(false)} disabled={aiLoading}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleGenerateAIDiagram} disabled={aiLoading}>
                {aiLoading ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {accessModalOpen && (
        <div className="modal-backdrop" onClick={() => setAccessModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔐 Manage access</h3>
            <p className="muted">Set someone's role on this board by their account email.</p>
            <input
              type="email"
              placeholder="person@example.com"
              value={accessEmail}
              onChange={(e) => setAccessEmail(e.target.value)}
            />
            <select value={accessRole} onChange={(e) => setAccessRole(e.target.value)}>
              <option value="editor">Editor — can draw and edit</option>
              <option value="viewer">Viewer — read-only (can still vote)</option>
            </select>
            <div className="modal-actions">
              <button className="btn-secondary small" onClick={() => setAccessModalOpen(false)}>
                Close
              </button>
              <button className="btn-primary" onClick={handleSetRole}>
                Set role
              </button>
            </div>
          </div>
        </div>
      )}

      {analyticsModalOpen && (
        <div className="modal-backdrop" onClick={() => setAnalyticsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📈 Board analytics</h3>
            {!analytics ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <h4>Edits per user</h4>
                <ul className="analytics-list">
                  {Object.values(analytics.edits).length === 0 && <li className="muted">No edits yet.</li>}
                  {Object.values(analytics.edits).map((e, i) => (
                    <li key={i}>
                      {e.name} — {e.count} edit{e.count === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
                <h4>Session time</h4>
                <ul className="analytics-list">
                  {analytics.sessions.length === 0 && <li className="muted">No completed sessions yet.</li>}
                  {analytics.sessions
                    .slice(-10)
                    .reverse()
                    .map((s, i) => (
                      <li key={i}>
                        {s.name} — {Math.round(s.durationMs / 1000)}s
                      </li>
                    ))}
                </ul>
              </>
            )}
            <div className="modal-actions">
              <button className="btn-secondary small" onClick={() => setAnalyticsModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteMediaTile({ stream }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline className="media-tile" />;
}
