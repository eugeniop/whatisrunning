// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { db } = require("./db");

const PORT = process.env.PORT || 3000;

const VALID_LOCATIONS = new Set(["Upper loop", "Lower loop 1", "Lower loop 2"]);
const VALID_POWER = new Set(["Steam", "Diesel", "Electric"]);
const VALID_TYPES = new Set(["Passenger", "Freight", "Special", "Mixed"]);

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast helper
function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// DB statements
const stmtListRunning = db.prepare(`
  SELECT id, name, railway, country, power, trainType, years, notes, location, updated_at
  FROM trains
  WHERE active = 1
  ORDER BY location ASC, updated_at DESC
`);

const stmtInsert = db.prepare(`
  INSERT INTO trains (id, name, railway, country, power, trainType, years, notes, owner, location, active, updated_at)
  VALUES (@id, @name, @railway, @country, @power, @trainType, @years, @notes, @owner, @location, 1, @updated_at)
`);

const stmtUpdate = db.prepare(`
  UPDATE trains SET
    name=@name, railway=@railway, country=@country, power=@power, trainType=@trainType,
    years=@years, notes=@notes, owner=@owner, location=@location, updated_at=@updated_at
  WHERE id=@id
`);

const stmtDeactivate = db.prepare(`
  UPDATE trains SET active=0, updated_at=@updated_at WHERE id=@id
`);

const stmtGetById = db.prepare(`SELECT * FROM trains WHERE id = ?`);

// Validation
function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

function validateTrain(body) {
  const {
    name, railway, country, power, trainType, years, notes = "",
    owner = "", location
  } = body;

  if (!name || typeof name !== "string") return "name required";
  if (!railway || typeof railway !== "string") return "railway required";
  if (!country || typeof country !== "string") return "country required (emoji flag)";
  if (!power || !VALID_POWER.has(power)) return `power must be one of: ${[...VALID_POWER].join(", ")}`;
  if (!trainType || !VALID_TYPES.has(trainType)) return `trainType must be one of: ${[...VALID_TYPES].join(", ")}`;
  if (!years || typeof years !== "string") return "years required (e.g. 1950 or 1950–1960)";
  if (!location || !VALID_LOCATIONS.has(location)) return `location must be one of: ${[...VALID_LOCATIONS].join(", ")}`;

  // Keep notes/owner as strings
  if (typeof notes !== "string") return "notes must be a string";
  if (typeof owner !== "string") return "owner must be a string";

  return null;
}

// Pages
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// API
app.get("/api/running", (req, res) => {
  res.json({ trains: stmtListRunning.all() });
});

app.post("/api/running", (req, res) => {
  const err = validateTrain(req.body);
  if (err) return bad(res, err);

  const id = crypto.randomUUID();
  const updated_at = new Date().toISOString();

  const row = { id, updated_at, ...req.body, notes: req.body.notes ?? "", owner: req.body.owner ?? "" };
  stmtInsert.run(row);

  const payload = stmtListRunning.all();
  broadcast("running:update", payload);

  res.status(201).json({ id });
});

app.patch("/api/running/:id", (req, res) => {
  const id = req.params.id;
  const existing = stmtGetById.get(id);
  if (!existing) return res.status(404).json({ error: "not found" });

  // allow partial update by merging
  const merged = { ...existing, ...req.body, id };
  const err = validateTrain(merged);
  if (err) return bad(res, err);

  merged.updated_at = new Date().toISOString();
  stmtUpdate.run(merged);

  const payload = stmtListRunning.all();
  broadcast("running:update", payload);

  res.json({ ok: true });
});

app.delete("/api/running/:id", (req, res) => {
  const id = req.params.id;
  const existing = stmtGetById.get(id);
  if (!existing) return res.status(404).json({ error: "not found" });

  stmtDeactivate.run({ id, updated_at: new Date().toISOString() });

  const payload = stmtListRunning.all();
  broadcast("running:update", payload);

  res.json({ ok: true });
});

// WebSocket connections
wss.on("connection", (ws) => {
  // send current state immediately
  ws.send(JSON.stringify({ event: "running:init", payload: stmtListRunning.all() }));
});

server.listen(PORT, () => {
  console.log(`Train display running on http://localhost:${PORT}`);
});
