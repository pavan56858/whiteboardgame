import { useState } from "react";
import { worldToScreen } from "../geometry.js";

export default function StickyNote({ note, view, currentUserId, readOnly, onUpdate, onDelete, onVote }) {
  const [editing, setEditing] = useState(false);
  const screen = worldToScreen(note.x, note.y, view);
  const votes = note.votes || {};
  const voteCount = Object.keys(votes).length;
  const iVoted = !!votes[currentUserId];

  function handleDragStart(e) {
    if (readOnly) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = note.x;
    const origY = note.y;

    function onMove(moveEvent) {
      const dx = (moveEvent.clientX - startX) / view.scale;
      const dy = (moveEvent.clientY - startY) / view.scale;
      onUpdate({ ...note, x: origX + dx, y: origY + dy });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleVote() {
    onVote(note.id);
  }

  return (
    <div
      className="sticky-note"
      style={{
        left: screen.x,
        top: screen.y,
        transform: `scale(${view.scale})`,
        transformOrigin: "top left",
        background: note.color || "#FEF08A",
      }}
    >
      <div className="sticky-header" onMouseDown={handleDragStart}>
        <span className="sticky-drag-handle">⠿</span>
        {!readOnly && (
          <button className="sticky-delete" onClick={() => onDelete(note.id)}>
            ✕
          </button>
        )}
      </div>
      {editing && !readOnly ? (
        <textarea
          autoFocus
          defaultValue={note.text}
          onBlur={(e) => {
            onUpdate({ ...note, text: e.target.value });
            setEditing(false);
          }}
        />
      ) : (
        <p onDoubleClick={() => !readOnly && setEditing(true)}>{note.text || "Double-click to edit…"}</p>
      )}
      <button className={`sticky-vote ${iVoted ? "voted" : ""}`} onClick={toggleVote} title="Vote">
        👍 {voteCount > 0 ? voteCount : ""}
      </button>
    </div>
  );
}
