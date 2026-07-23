import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getSession, clearSession } from "../api";

export default function Home() {
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const session = getSession();

  async function createBoard() {
    try {
      const { data } = await api.post("/api/boards");
      navigate(`/board/${data.roomId}`);
    } catch {
      setError("Couldn't create a board. Is the server running?");
    }
  }

  function joinBoard(e) {
    e.preventDefault();
    if (!joinId.trim()) return;
    navigate(`/board/${joinId.trim().toUpperCase()}`);
  }

  function logout() {
    clearSession();
    navigate("/login");
  }

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">◧</span>
          <span>Boardroom</span>
        </div>
        <div className="home-header-right">
          <span className="muted">Hi, {session?.user?.name}</span>
          <button className="link-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-card">
          <h1>Start a new whiteboard</h1>
          <p className="muted">
            You'll get a room code to share. Anyone with the link draws with you live.
          </p>
          <button className="btn-primary" onClick={createBoard}>
            + Create Whiteboard
          </button>
        </div>

        <div className="home-card">
          <h2>Join an existing board</h2>
          <form onSubmit={joinBoard} className="join-form">
            <input
              placeholder="Enter room code e.g. AJH281"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button className="btn-secondary" type="submit">
              Join
            </button>
          </form>
        </div>

        {error && <div className="error-banner">{error}</div>}
      </main>
    </div>
  );
}
