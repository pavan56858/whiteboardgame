require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { router: authRouter } = require("./routes/auth");
const boardsRouter = require("./routes/boards");
const aiRouter = require("./routes/ai");
const { initSocket } = require("./socket");

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/boards", boardsRouter);
app.use("/api/ai", aiRouter);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});
initSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Whiteboard server running on http://localhost:${PORT}`);
});
