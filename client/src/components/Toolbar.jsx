const COLORS = ["#111827", "#EF4444", "#3B82F6", "#10B981", "#EAB308", "#8B5CF6"];

const TOOLS = [
  { id: "select", icon: "⬚", title: "Select & move (V)" },
  { id: "pen", icon: "✏️", title: "Pen (P)" },
  { id: "eraser", icon: "🧽", title: "Eraser (E)" },
  { id: "rect", icon: "⬛", title: "Rectangle (R)" },
  { id: "circle", icon: "⭕", title: "Circle (C)" },
  { id: "line", icon: "📏", title: "Line (L)" },
  { id: "arrow", icon: "➡️", title: "Arrow (A)" },
  { id: "triangle", icon: "🔺", title: "Triangle (T)" },
  { id: "text", icon: "🅣", title: "Text (X)" },
  { id: "pan", icon: "✋", title: "Pan — or hold Space (H)" },
];

export default function Toolbar({
  tool,
  setTool,
  color,
  setColor,
  brushSize,
  setBrushSize,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddSticky,
  onClear,
  onExport,
  roomId,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onInvite,
  darkMode,
  onToggleDarkMode,
  readOnly,
  role,
  onInsertTemplate,
  onOpenAIDiagram,
  onOpenManageAccess,
  onOpenAnalytics,
  micOn,
  camOn,
  screenOn,
  onToggleMic,
  onToggleCam,
  onToggleScreen,
}) {
  return (
    <div className="toolbar-wrap">
      <div className="toolbar">
        <div className="toolbar-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? "active" : ""}`}
              title={t.title}
              onClick={() => setTool(t.id)}
              disabled={readOnly && t.id !== "select" && t.id !== "pan"}
            >
              {t.icon}
            </button>
          ))}
          <button className="tool-btn" title="Add sticky note" onClick={onAddSticky} disabled={readOnly}>
            📝
          </button>
        </div>

        <div className="toolbar-group colors">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${color === c ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className="toolbar-group">
          <label className="brush-label">
            Size
            <input
              type="range"
              min="1"
              max="20"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="toolbar-group">
          <button className="tool-btn" title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
            ↩️
          </button>
          <button className="tool-btn" title="Redo (Ctrl+Y)" onClick={onRedo} disabled={!canRedo}>
            ↪️
          </button>
          <button className="tool-btn" title="Clear board" onClick={onClear} disabled={readOnly}>
            🗑️
          </button>
          <button className="tool-btn" title="Export as PNG" onClick={() => onExport("png")}>
            ⬇️PNG
          </button>
          <button className="tool-btn" title="Export as JPEG" onClick={() => onExport("jpeg")}>
            ⬇️JPG
          </button>
        </div>

        <div className="toolbar-group zoom-group">
          <button className="tool-btn" title="Zoom out (Ctrl -)" onClick={onZoomOut}>
            −
          </button>
          <button className="zoom-display" title="Reset zoom" onClick={onZoomReset}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool-btn" title="Zoom in (Ctrl +)" onClick={onZoomIn}>
            +
          </button>
        </div>

        <div className="toolbar-group room-code">
          <span>
            Room: <strong>{roomId}</strong>
          </span>
          {role && <span className={`role-badge role-${role}`}>{role}</span>}
          <button className="btn-secondary small" onClick={onInvite}>
            🔗 Invite
          </button>
          <button className="tool-btn" title="Toggle dark mode" onClick={onToggleDarkMode}>
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      <div className="toolbar toolbar-secondary">
        <div className="toolbar-group">
          <select
            className="template-select"
            defaultValue=""
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value) onInsertTemplate(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              📐 Insert template…
            </option>
            <option value="flowchart">Flowchart</option>
            <option value="mindmap">Mind Map</option>
            <option value="kanban">Kanban board</option>
          </select>
          <button className="btn-secondary small" onClick={onOpenAIDiagram} disabled={readOnly}>
            ✨ AI Diagram
          </button>
        </div>

        <div className="toolbar-group media-group">
          <button className={`tool-btn ${micOn ? "active" : ""}`} title="Toggle microphone" onClick={onToggleMic}>
            {micOn ? "🎤" : "🔇"}
          </button>
          <button className={`tool-btn ${camOn ? "active" : ""}`} title="Toggle camera" onClick={onToggleCam}>
            {camOn ? "🎥" : "📷"}
          </button>
          <button
            className={`tool-btn ${screenOn ? "active" : ""}`}
            title="Share your screen"
            onClick={onToggleScreen}
          >
            🖥️
          </button>
        </div>

        {role === "owner" && (
          <div className="toolbar-group">
            <button className="btn-secondary small" onClick={onOpenManageAccess}>
              🔐 Manage access
            </button>
            <button className="btn-secondary small" onClick={onOpenAnalytics}>
              📈 Analytics
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
