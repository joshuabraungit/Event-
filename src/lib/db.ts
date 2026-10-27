import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// node:sqlite ships with Node 22.13+. It prints a one-line experimental
// warning on first use; that's expected.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_event ON research_jobs(event_id, created_at);
CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  brand_key TEXT NOT NULL,
  data TEXT NOT NULL,
  score INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, brand_key)
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(prospect_id, dedupe_key)
);
`;

let instance: DatabaseSync | null = null;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) {
    const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "sponsor-signals.db");
    instance = openDatabase(file);
    // Jobs run in-process. If the server restarted mid-job, mark it failed so the UI doesn't spin forever.
    markInterruptedJobs(instance);
  }
  return instance;
}

/** Test hook: swap in an isolated database. */
export function setDb(db: DatabaseSync | null): void {
  instance = db;
}

function markInterruptedJobs(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, data FROM research_jobs WHERE status IN ('queued','running')").all() as {
    id: string;
    data: string;
  }[];
  for (const row of rows) {
    const job = JSON.parse(row.data);
    job.status = "failed";
    job.error = "The server restarted while this job was running. Run research again.";
    job.finishedAt = new Date().toISOString();
    db.prepare("UPDATE research_jobs SET data = ?, status = ? WHERE id = ?").run(JSON.stringify(job), "failed", row.id);
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
