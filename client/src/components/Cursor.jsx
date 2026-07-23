import { worldToScreen } from "../geometry.js";

export default function Cursor({ x, y, name, color, isDrawing, view }) {
  const screen = worldToScreen(x, y, view);
  return (
    <div className="live-cursor" style={{ left: screen.x, top: screen.y }}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M2 2 L18 8 L10 10 L8 18 Z" fill={color} stroke="white" strokeWidth="1" />
      </svg>
      <span className="cursor-label" style={{ background: color }}>
        {name}
        {isDrawing ? " ✏️" : ""}
      </span>
    </div>
  );
}
