// db.js
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "trains.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS trains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  railway TEXT NOT NULL,
  country TEXT NOT NULL,         -- emoji flag, e.g. 🇩🇪
  power TEXT NOT NULL,           -- Steam/Diesel/Electric
  trainType TEXT NOT NULL,       -- Passenger/Freight/Special/Mixed
  years TEXT NOT NULL,           -- e.g. 1950 or 1950–1960
  notes TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '', -- stored, not shown on display
  location TEXT NOT NULL,         -- Upper loop / Lower loop 1 / Lower loop 2
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trains_active ON trains(active);
CREATE INDEX IF NOT EXISTS idx_trains_updated ON trains(updated_at);

CREATE TABLE IF NOT EXISTS train_runs (
  id TEXT PRIMARY KEY,
  train_id TEXT NOT NULL,
  name TEXT NOT NULL,
  railway TEXT NOT NULL,
  country TEXT NOT NULL,
  power TEXT NOT NULL,
  trainType TEXT NOT NULL,
  years TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  start_time TEXT NOT NULL,
  stop_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_train_runs_train ON train_runs(train_id);
CREATE INDEX IF NOT EXISTS idx_train_runs_start ON train_runs(start_time);
`);

module.exports = { db };
