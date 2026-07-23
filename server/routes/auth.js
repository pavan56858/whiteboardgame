const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Users } = require("../db/store");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (Users.findByEmail(email)) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = Users.create({ name, email, passwordHash });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Registration failed", details: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = Users.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Login failed", details: err.message });
  }
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { router, authMiddleware, JWT_SECRET };
