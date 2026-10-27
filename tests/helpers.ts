import { openDatabase, setDb } from "@/lib/db";
import * as repo from "@/lib/repo";
import type { EvidenceRecord } from "@/lib/types";
import { eventInputSchema } from "@/lib/validation";

export function freshDb() {
  setDb(openDatabase(":memory:"));
}

export const NOW = new Date("2026-10-27T12:00:00Z");

export function sexEdEvent(overrides: Record<string, unknown> = {}) {
  return repo.createEvent(
    eventInputSchema.parse({
      name: "The Sex Ed We Should Have Had",
      description:
        "An evening for women about the sex education they should have received: pleasure, communication, and understanding their bodies beyond anatomy.",
      location: "Toronto",
      audience: "Adult women curious about pleasure, communication and their bodies",
      expectedAttendance: 150,
      sponsorshipTypes: ["cash", "product", "speakers"],
      ...overrides,
    }),
  );
}

export function devEvent() {
  return repo.createEvent(
    eventInputSchema.parse({
      name: "Rust & Ops Summit",
      description: "A conference for software developers and DevOps engineers about CI/CD pipelines, observability and open source.",
      location: "Online",
      audience: "Software developers and engineering leaders",
    }),
  );
}

let n = 0;
export function ev(partial: Partial<EvidenceRecord>): EvidenceRecord {
  n++;
  return {
    id: `e${n}`,
    prospectId: "p1",
    kind: "brand_profile",
    provider: "test",
    sourceUrl: `https://brand.example/page${n}`,
    sourceTitle: `Page ${n}`,
    publisher: "brand.example",
    activityDate: null,
    checkedAt: NOW.toISOString(),
    excerpt: "",
    interpretation: "",
    interpretedBy: "heuristic",
    signals: ["audience", "message"],
    relevance: 1,
    matchedTerms: [],
    verification: "verified_source",
    flags: [],
    ad: null,
    contactName: null,
    contactUrl: null,
    dedupeKey: `k${n}`,
    createdAt: NOW.toISOString(),
    ...partial,
  };
}
