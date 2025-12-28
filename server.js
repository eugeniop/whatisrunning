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
const VALID_POWER_TYPES = new Set(["AC", "DC", "Digital"]);
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
  SELECT id, name, railway, country, power, trainType, numberOfCars, powerType, years, notes, location, updated_at
  FROM trains
  WHERE active = 1
  ORDER BY location ASC, updated_at DESC
`);

const stmtInsert = db.prepare(`
  INSERT INTO trains (id, name, railway, country, power, trainType, numberOfCars, powerType, years, notes, owner, location, active, updated_at)
  VALUES (@id, @name, @railway, @country, @power, @trainType, @numberOfCars, @powerType, @years, @notes, @owner, @location, 1, @updated_at)
`);

const stmtInsertRun = db.prepare(`
  INSERT INTO train_runs (id, train_id, name, railway, country, power, trainType, numberOfCars, powerType, years, notes, owner, location, start_time, stop_time)
  VALUES (@id, @train_id, @name, @railway, @country, @power, @trainType, @numberOfCars, @powerType, @years, @notes, @owner, @location, @start_time, @stop_time)
`);

const stmtUpdate = db.prepare(`
  UPDATE trains SET
    name=@name, railway=@railway, country=@country, power=@power, trainType=@trainType,
    numberOfCars=@numberOfCars, powerType=@powerType,
    years=@years, notes=@notes, owner=@owner, location=@location, updated_at=@updated_at
  WHERE id=@id
`);

const stmtDeactivate = db.prepare(`
  UPDATE trains SET active=0, updated_at=@updated_at WHERE id=@id
`);

const stmtGetById = db.prepare(`SELECT * FROM trains WHERE id = ?`);
const stmtFindOpenRun = db.prepare(`
  SELECT id FROM train_runs
  WHERE train_id = ? AND stop_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
`);

const stmtFindLatestRun = db.prepare(`
  SELECT id FROM train_runs
  WHERE train_id = ?
  ORDER BY start_time DESC
  LIMIT 1
`);

const stmtUpdateRunStop = db.prepare(`
  UPDATE train_runs SET stop_time=@stop_time WHERE id=@id
`);

const stmtRunsByDate = db.prepare(`
  SELECT train_id, name, railway, country, power, trainType, numberOfCars, powerType, years, notes, owner, location, start_time, stop_time
  FROM train_runs
  WHERE date(start_time) = @date
  ORDER BY start_time ASC
`);

// Validation
function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

function validateTrain(body) {
  const {
    name, railway, country, power, trainType, numberOfCars, powerType, years, notes = "",
    owner = "", location
  } = body;

  if (!name || typeof name !== "string") return "name required";
  if (!railway || typeof railway !== "string") return "railway required";
  if (!country || typeof country !== "string") return "country required (emoji flag)";
  if (!power || !VALID_POWER.has(power)) return `power must be one of: ${[...VALID_POWER].join(", ")}`;
  if (!trainType || !VALID_TYPES.has(trainType)) return `trainType must be one of: ${[...VALID_TYPES].join(", ")}`;
  if (!Number.isInteger(numberOfCars) || numberOfCars < 0 || numberOfCars > 100) return "numberOfCars must be an integer between 0 and 100";
  if (!powerType || !VALID_POWER_TYPES.has(powerType)) return `powerType must be one of: ${[...VALID_POWER_TYPES].join(", ")}`;
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
app.get("/activity", (req, res) => res.sendFile(path.join(__dirname, "public", "activity.html")));

// API
app.get("/api/running", (req, res) => {
  res.json({ trains: stmtListRunning.all() });
});

app.post("/api/running", (req, res) => {
  const normalized = {
    ...req.body,
    numberOfCars: Number(req.body.numberOfCars),
    powerType: req.body.powerType
  };
  const err = validateTrain(normalized);
  if (err) return bad(res, err);

  const id = crypto.randomUUID();
  const updated_at = new Date().toISOString();

  const row = {
    id,
    updated_at,
    ...normalized,
    notes: normalized.notes ?? "",
    owner: normalized.owner ?? ""
  };
  stmtInsert.run(row);

  stmtInsertRun.run({
    id: crypto.randomUUID(),
    train_id: id,
    name: row.name,
    railway: row.railway,
    country: row.country,
    power: row.power,
    trainType: row.trainType,
    numberOfCars: row.numberOfCars,
    powerType: row.powerType,
    years: row.years,
    notes: row.notes,
    owner: row.owner,
    location: row.location,
    start_time: updated_at,
    stop_time: null
  });

  const payload = stmtListRunning.all();
  broadcast("running:update", payload);

  res.status(201).json({ id });
});

app.patch("/api/running/:id", (req, res) => {
  const id = req.params.id;
  const existing = stmtGetById.get(id);
  if (!existing) return res.status(404).json({ error: "not found" });

  // allow partial update by merging
  const merged = {
    ...existing,
    ...req.body,
    id
  };
  if (req.body.numberOfCars !== undefined) merged.numberOfCars = Number(req.body.numberOfCars);
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

  const stop_time = new Date().toISOString();
  stmtDeactivate.run({ id, updated_at: stop_time });
  const openRun = stmtFindOpenRun.get(id);
  if (openRun) {
    stmtUpdateRunStop.run({ id: openRun.id, stop_time });
  } else {
    const latest = stmtFindLatestRun.get(id);
    const fallbackId = latest?.id;
    if (fallbackId) {
      stmtUpdateRunStop.run({ id: fallbackId, stop_time });
    } else {
      stmtInsertRun.run({
        id: crypto.randomUUID(),
        train_id: id,
        name: existing.name,
        railway: existing.railway,
        country: existing.country,
        power: existing.power,
        trainType: existing.trainType,
        numberOfCars: existing.numberOfCars,
        powerType: existing.powerType,
        years: existing.years,
        notes: existing.notes,
        owner: existing.owner,
        location: existing.location,
        start_time: stop_time,
        stop_time
      });
    }
  }

  const payload = stmtListRunning.all();
  broadcast("running:update", payload);

  res.json({ ok: true });
});

app.get("/api/reports/runs", (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return bad(res, "date query param (YYYY-MM-DD) is required");
  }

  const rows = stmtRunsByDate.all({ date });
  const report = rows.map((r) => {
    const start = new Date(r.start_time);
    const end = r.stop_time ? new Date(r.stop_time) : new Date();
    const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return {
      ...r,
      duration: {
        minutes: durationMinutes,
        hours,
        remainderMinutes: minutes
      }
    };
  });

  res.json({ runs: report });
});

// WebSocket connections
wss.on("connection", (ws) => {
  // send current state immediately
  ws.send(JSON.stringify({ event: "running:init", payload: stmtListRunning.all() }));
});

server.listen(PORT, () => {
  console.log(`Train display running on http://localhost:${PORT}`);
});
