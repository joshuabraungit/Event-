import type { DatabaseSync } from "node:sqlite";
import { getDb, newId } from "./db";
import type {
  EventRecord,
  EvidenceRecord,
  ProspectRecord,
  ProspectWithEvidence,
  ResearchJob,
} from "./types";
import type { EventInput } from "./validation";

type Row = { data: string };

function db(): DatabaseSync {
  return getDb();
}

const nowIso = () => new Date().toISOString();

// ---------- events ----------

export function createEvent(input: EventInput): EventRecord {
  const ts = nowIso();
  const event: EventRecord = { ...input, id: newId("evt"), createdAt: ts, updatedAt: ts };
  db().prepare("INSERT INTO events (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    event.id,
    JSON.stringify(event),
    ts,
    ts,
  );
  return event;
}

export function updateEvent(id: string, input: EventInput): EventRecord | null {
  const existing = getEvent(id);
  if (!existing) return null;
  const event: EventRecord = { ...existing, ...input, id, updatedAt: nowIso() };
  db().prepare("UPDATE events SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(event), event.updatedAt, id);
  return event;
}

export function getEvent(id: string): EventRecord | null {
  const row = db().prepare("SELECT data FROM events WHERE id = ?").get(id) as Row | undefined;
  return row ? (JSON.parse(row.data) as EventRecord) : null;
}

export function listEvents(): EventRecord[] {
  return (db().prepare("SELECT data FROM events ORDER BY updated_at DESC").all() as Row[]).map(
    (r) => JSON.parse(r.data) as EventRecord,
  );
}

export function deleteEvent(id: string): boolean {
  return Number(db().prepare("DELETE FROM events WHERE id = ?").run(id).changes) > 0;
}

// ---------- prospects ----------

export function getProspectByKey(eventId: string, brandKey: string): ProspectRecord | null {
  const row = db().prepare("SELECT data FROM prospects WHERE event_id = ? AND brand_key = ?").get(eventId, brandKey) as
    | Row
    | undefined;
  return row ? (JSON.parse(row.data) as ProspectRecord) : null;
}

export function getProspect(id: string): ProspectRecord | null {
  const row = db().prepare("SELECT data FROM prospects WHERE id = ?").get(id) as Row | undefined;
  return row ? (JSON.parse(row.data) as ProspectRecord) : null;
}

export function saveProspect(p: ProspectRecord): ProspectRecord {
  p.updatedAt = nowIso();
  db()
    .prepare(
      `INSERT INTO prospects (id, event_id, brand_key, data, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, score = excluded.score, updated_at = excluded.updated_at`,
    )
    .run(p.id, p.eventId, p.brandKey, JSON.stringify(p), p.score?.total ?? null, p.createdAt, p.updatedAt);
  return p;
}

export function newProspect(
  fields: Pick<ProspectRecord, "eventId" | "brandKey" | "name" | "website" | "candidateSource"> & Partial<ProspectRecord>,
): ProspectRecord {
  const ts = nowIso();
  return {
    id: newId("pro"),
    description: "",
    categories: [],
    candidateRationale: "",
    isMock: false,
    score: null,
    fitSummary: "",
    fitSummaryBy: "rules",
    relevantProducts: [],
    suggestedSponsorship: [],
    suggestedContactRole: "",
    outreachDraft: "",
    outreachEdited: false,
    checkedSources: [],
    status: "to_review",
    saved: false,
    dismissed: false,
    notes: "",
    lastResearchedAt: null,
    createdAt: ts,
    updatedAt: ts,
    ...fields,
  };
}

export function listProspects(eventId: string): ProspectRecord[] {
  return (
    db()
      .prepare("SELECT data FROM prospects WHERE event_id = ? ORDER BY COALESCE(score, -1) DESC, created_at ASC")
      .all(eventId) as Row[]
  ).map((r) => JSON.parse(r.data) as ProspectRecord);
}

export function listProspectsWithEvidence(eventId: string, ids?: string[]): ProspectWithEvidence[] {
  const prospects = listProspects(eventId).filter((p) => !ids || ids.includes(p.id));
  return prospects.map((p) => ({ ...p, evidence: listEvidence(p.id) }));
}

export function deleteProspect(id: string): void {
  db().prepare("DELETE FROM prospects WHERE id = ?").run(id);
}

// ---------- evidence ----------

export function listEvidence(prospectId: string): EvidenceRecord[] {
  return (
    db().prepare("SELECT data FROM evidence WHERE prospect_id = ? ORDER BY created_at ASC").all(prospectId) as Row[]
  ).map((r) => JSON.parse(r.data) as EvidenceRecord);
}

export function getEvidence(id: string): EvidenceRecord | null {
  const row = db().prepare("SELECT data FROM evidence WHERE id = ?").get(id) as Row | undefined;
  return row ? (JSON.parse(row.data) as EvidenceRecord) : null;
}

/**
 * Insert evidence, deduplicating on (prospect, dedupeKey). A repeat sighting
 * refreshes checkedAt and active status but keeps the original record, so
 * the same ad found twice is stored once.
 */
export function upsertEvidence(e: EvidenceRecord): { record: EvidenceRecord; inserted: boolean } {
  const existing = db()
    .prepare("SELECT data FROM evidence WHERE prospect_id = ? AND dedupe_key = ?")
    .get(e.prospectId, e.dedupeKey) as Row | undefined;
  if (existing) {
    const prev = JSON.parse(existing.data) as EvidenceRecord;
    const merged: EvidenceRecord = {
      ...prev,
      checkedAt: e.checkedAt,
      ad: e.ad ?? prev.ad,
      // keep user flags, refresh the rest
      flags: [...new Set([...e.flags, ...prev.flags.filter((f) => f === "conflicting")])],
      relevance: e.relevance,
      matchedTerms: e.matchedTerms,
      interpretation: e.interpretation || prev.interpretation,
      interpretedBy: e.interpretation ? e.interpretedBy : prev.interpretedBy,
      signals: e.signals,
    };
    saveEvidence(merged);
    return { record: merged, inserted: false };
  }
  db()
    .prepare("INSERT INTO evidence (id, prospect_id, dedupe_key, data, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(e.id, e.prospectId, e.dedupeKey, JSON.stringify(e), e.createdAt);
  return { record: e, inserted: true };
}

export function saveEvidence(e: EvidenceRecord): void {
  db().prepare("UPDATE evidence SET data = ? WHERE id = ?").run(JSON.stringify(e), e.id);
}

export function deleteEvidence(id: string): void {
  db().prepare("DELETE FROM evidence WHERE id = ?").run(id);
}

// ---------- jobs ----------

export function createJob(eventId: string, mode: ResearchJob["mode"]): ResearchJob {
  const job: ResearchJob = {
    id: newId("job"),
    eventId,
    mode,
    status: "queued",
    progress: 0,
    stage: "Queued",
    providerStatus: [],
    log: [],
    error: null,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
  };
  db()
    .prepare("INSERT INTO research_jobs (id, event_id, data, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(job.id, eventId, JSON.stringify(job), job.status, job.createdAt);
  return job;
}

export function saveJob(job: ResearchJob): void {
  db().prepare("UPDATE research_jobs SET data = ?, status = ? WHERE id = ?").run(JSON.stringify(job), job.status, job.id);
}

export function getJob(id: string): ResearchJob | null {
  const row = db().prepare("SELECT data FROM research_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? (JSON.parse(row.data) as ResearchJob) : null;
}

export function latestJob(eventId: string): ResearchJob | null {
  const row = db()
    .prepare("SELECT data FROM research_jobs WHERE event_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(eventId) as Row | undefined;
  return row ? (JSON.parse(row.data) as ResearchJob) : null;
}

export function activeJob(eventId: string): ResearchJob | null {
  const row = db()
    .prepare(
      "SELECT data FROM research_jobs WHERE event_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
    )
    .get(eventId) as Row | undefined;
  return row ? (JSON.parse(row.data) as ResearchJob) : null;
}
