import { aiCandidateProvider, aiConfigured, interpretEvidence } from "./ai";
import { defaultSignals } from "./classify";
import { newId } from "./db";
import {
  buildOutreachDraft,
  fitSummaryFromScore,
  heuristicInterpretation,
  suggestContactRole,
  suggestSponsorship,
} from "./insights";
import {
  LIVE_CANDIDATE_PROVIDERS,
  LIVE_EVIDENCE_PROVIDERS,
  MOCK_CANDIDATE_PROVIDERS,
  MOCK_EVIDENCE_PROVIDERS,
} from "./providers/registry";
import type { BrandCandidate, CandidateProvider, EvidenceProvider, ProviderContext, RawEvidence } from "./providers/types";
import { ProviderError } from "./providers/types";
import { eventKeywords, keywordRelevance, matchesAvoidList } from "./relevance";
import * as repo from "./repo";
import { deriveFlags, scoreProspect } from "./scoring";
import { brandKey, hashString, hostnameOf, normalizeDomain, splitList } from "./text";
import type {
  EventRecord,
  EvidenceRecord,
  ProspectRecord,
  ProviderRunStatus,
  ResearchJob,
} from "./types";
import type { z } from "zod";
import type { manualEvidenceSchema } from "./validation";

export interface ResearchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  candidateProviders?: CandidateProvider[];
  evidenceProviders?: EvidenceProvider[];
  useAi?: boolean;
  concurrency?: number;
}

/** Parse "Name" or "Name | domain.com" lines from the event's brands-to-consider field. */
export function parseSeedBrands(text: string): BrandCandidate[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, site] = line.split("|").map((s) => s.trim());
      const website = site ? (site.startsWith("http") ? site : `https://${normalizeDomain(site)}`) : "";
      return {
        name,
        website,
        description: "",
        categories: [],
        source: "user_seed" as const,
        rationale: "Added by you as a brand to consider.",
        isMock: false,
      };
    });
}

export function dedupeCandidates(candidates: BrandCandidate[]): BrandCandidate[] {
  const out: BrandCandidate[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Map<string, BrandCandidate>();
  for (const c of candidates) {
    const nameKey = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = brandKey(c.name, c.website);
    const prior = seenNames.get(nameKey);
    if (seenKeys.has(key) || prior) {
      // Prefer the entry that has a website; keep the user's seed over AI suggestions.
      if (prior && !prior.website && c.website) prior.website = c.website;
      continue;
    }
    seenKeys.add(key);
    seenNames.set(nameKey, c);
    out.push({ ...c });
  }
  return out;
}

export function toEvidenceRecord(raw: RawEvidence, prospect: ProspectRecord, provider: string, eventTerms: string[], now: Date): EvidenceRecord {
  const rel = keywordRelevance(eventTerms, `${raw.sourceTitle} ${raw.excerpt} ${raw.ad?.adText ?? ""}`);
  const domain = normalizeDomain(prospect.website);
  const base = {
    kind: raw.kind,
    activityDate: raw.activityDate,
    relevance: rel.relevance,
    flags: raw.flags ?? [],
    sourceUrl: raw.sourceUrl,
  };
  const record: EvidenceRecord = {
    id: newId("evi"),
    prospectId: prospect.id,
    kind: raw.kind,
    provider,
    sourceUrl: raw.sourceUrl,
    sourceTitle: raw.sourceTitle,
    publisher: raw.publisher || hostnameOf(raw.sourceUrl),
    activityDate: raw.activityDate,
    checkedAt: now.toISOString(),
    excerpt: raw.excerpt,
    interpretation: "",
    interpretedBy: "heuristic",
    signals: raw.signals.length ? raw.signals : defaultSignals(raw.kind),
    relevance: rel.relevance,
    matchedTerms: rel.matchedTerms,
    verification: raw.verification,
    flags: deriveFlags(base, domain, now),
    ad: raw.ad ?? null,
    contactName: raw.contactName ?? null,
    contactUrl: raw.contactUrl ?? null,
    dedupeKey: hashString(`${raw.kind}|${raw.sourceId ?? raw.sourceUrl}|${raw.kind === "contact" ? raw.contactUrl : ""}`),
    createdAt: now.toISOString(),
  };
  record.interpretation = raw.interpretation
    ? `${raw.interpretation} ${heuristicInterpretation(record)}`
    : heuristicInterpretation(record);
  return record;
}

/** Recompute flags, score, suggestions and (unless edited) the outreach draft. */
export function refreshProspect(prospectId: string, now: Date = new Date()): ProspectRecord | null {
  const prospect = repo.getProspect(prospectId);
  if (!prospect) return null;
  const event = repo.getEvent(prospect.eventId);
  if (!event) return null;
  const domain = normalizeDomain(prospect.website);
  const evidence = repo.listEvidence(prospect.id).map((e) => {
    const flags = deriveFlags(e, domain, now);
    if (flags.join() !== e.flags.join()) {
      const updated = { ...e, flags };
      repo.saveEvidence(updated);
      return updated;
    }
    return e;
  });
  const score = scoreProspect(evidence, { now, checkedSources: prospect.checkedSources });
  prospect.score = score;
  if (prospect.fitSummaryBy !== "ai" || !prospect.fitSummary) {
    prospect.fitSummary = fitSummaryFromScore(prospect.name, score);
    prospect.fitSummaryBy = "rules";
  }
  prospect.suggestedSponsorship = suggestSponsorship(event, evidence, prospect.categories);
  prospect.suggestedContactRole = suggestContactRole(evidence);
  if (!prospect.relevantProducts.length) {
    prospect.relevantProducts = evidence
      .filter((e) => e.kind === "product" && e.relevance >= 0.3)
      .map((e) => e.sourceTitle.replace(/\s*\|.*$/, ""))
      .slice(0, 5);
  }
  if (!prospect.outreachEdited) prospect.outreachDraft = buildOutreachDraft(event, prospect, evidence);
  return repo.saveProspect(prospect);
}

function upsertCandidate(event: EventRecord, c: BrandCandidate): ProspectRecord {
  const key = brandKey(c.name, c.website);
  const existing = repo.getProspectByKey(event.id, key);
  if (existing) {
    // Keep the user's status, notes and edits; refresh descriptive fields.
    existing.description ||= c.description;
    existing.categories = existing.categories.length ? existing.categories : c.categories;
    existing.website ||= c.website;
    return repo.saveProspect(existing);
  }
  return repo.saveProspect(
    repo.newProspect({
      eventId: event.id,
      brandKey: key,
      name: c.name,
      website: c.website,
      description: c.description,
      categories: c.categories,
      candidateSource: c.source,
      candidateRationale: c.rationale,
      isMock: c.isMock,
    }),
  );
}

function statusEntry(job: ResearchJob, id: string, label: string): ProviderRunStatus {
  let entry = job.providerStatus.find((s) => s.provider === id);
  if (!entry) {
    entry = { provider: id, label, state: "ok", message: "", itemsFound: 0 };
    job.providerStatus.push(entry);
  }
  return entry;
}

function recordError(entry: ProviderRunStatus, err: unknown, brand?: string): void {
  const kind = err instanceof ProviderError ? err.kind : "error";
  const msg = err instanceof Error ? err.message : String(err);
  // Rate limits and errors win over "ok" so the user sees the problem.
  if (entry.state === "ok" || entry.state === "skipped" || kind === "rate_limited") {
    entry.state = kind === "not_configured" ? "not_configured" : kind;
  }
  entry.message = brand ? `${msg} (last seen on ${brand})` : msg;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export async function runResearch(jobId: string, opts: ResearchOptions = {}): Promise<ResearchJob> {
  const job = repo.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const event = repo.getEvent(job.eventId);
  const now = opts.now ?? new Date();
  const save = () => repo.saveJob(job);
  const log = (line: string) => {
    job.log.push(line);
    job.log = job.log.slice(-200);
  };
  if (!event) {
    job.status = "failed";
    job.error = "Event not found.";
    job.finishedAt = new Date().toISOString();
    save();
    return job;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.stage = "Finding brands to research";
  job.progress = 2;
  save();

  const isMock = job.mode === "mock";
  const candidateProviders = opts.candidateProviders ?? (isMock ? MOCK_CANDIDATE_PROVIDERS : LIVE_CANDIDATE_PROVIDERS);
  const evidenceProviders = opts.evidenceProviders ?? (isMock ? MOCK_EVIDENCE_PROVIDERS : LIVE_EVIDENCE_PROVIDERS);
  const useAi = opts.useAi ?? (!isMock && aiConfigured());
  const ctx: ProviderContext = { event, eventTerms: eventKeywords(event), now, fetchImpl: opts.fetchImpl ?? fetch };

  try {
    // 1. Candidates
    let candidates: BrandCandidate[] = isMock ? [] : parseSeedBrands(event.seedBrands);
    for (const cp of candidateProviders) {
      const entry = statusEntry(job, cp.id, cp.label);
      const avail = cp.availability();
      if (avail.state !== "ok") {
        entry.state = avail.state;
        entry.message = avail.message;
        continue;
      }
      try {
        const found = await cp.discover(ctx);
        entry.itemsFound = found.length;
        entry.message = `Suggested ${found.length} brand(s).`;
        candidates.push(...found);
      } catch (err) {
        recordError(entry, err);
        log(`${cp.label}: ${entry.message}`);
      }
    }
    candidates = dedupeCandidates(candidates);

    // 2. Avoid list
    const avoid = splitList(event.avoid);
    const kept: BrandCandidate[] = [];
    for (const c of candidates) {
      const hit = matchesAvoidList(avoid, c);
      if (hit) log(`Skipped ${c.name}: matches your avoid list ("${hit}").`);
      else kept.push(c);
    }

    // Brands added by hand on earlier runs get re-researched too.
    for (const p of repo.listProspects(event.id)) {
      if (p.candidateSource === "manual" && !kept.some((c) => brandKey(c.name, c.website) === p.brandKey) && p.isMock === isMock) {
        kept.push({ name: p.name, website: p.website, description: p.description, categories: p.categories, source: "manual", rationale: p.candidateRationale, isMock: p.isMock });
      }
    }

    if (!kept.length) {
      job.status = "failed";
      job.error = isMock
        ? "No mock brands matched. Try adding more detail to the event description."
        : aiConfigured()
          ? "No brands to research. Add brands under 'Brands to consider', or check the AI provider status."
          : "No brands to research. Add brands under 'Brands to consider' on the event, configure ANTHROPIC_API_KEY for suggestions, or run in mock mode.";
      job.finishedAt = new Date().toISOString();
      job.progress = 100;
      save();
      return job;
    }

    for (const ep of evidenceProviders) {
      const entry = statusEntry(job, ep.id, ep.label);
      const avail = ep.availability();
      entry.state = avail.state === "ok" ? "ok" : avail.state;
      entry.message = avail.message;
    }
    job.stage = `Researching ${kept.length} brand(s)`;
    job.progress = 10;
    save();

    // 3. Evidence per brand
    let done = 0;
    const blockedBy = new Map<string, string[]>();
    await mapLimit(kept, opts.concurrency ?? 3, async (candidate) => {
      const prospect = upsertCandidate(event, candidate);
      const checked: string[] = [];
      const providerErrors: Set<string> = new Set();
      for (const ep of evidenceProviders) {
        const entry = statusEntry(job, ep.id, ep.label);
        if (ep.availability().state !== "ok") continue;
        if (entry.state === "rate_limited") continue; // stop hammering a rate-limited source
        try {
          const raws = await ep.collect(candidate, ctx);
          checked.push(ep.label);
          if (raws.some((r) => r.flags?.includes("inaccessible"))) {
            blockedBy.set(ep.id, [...(blockedBy.get(ep.id) ?? []), candidate.name]);
            const names = blockedBy.get(ep.id)!;
            if (entry.state === "ok") entry.state = "unavailable";
            entry.message = `Couldn't read ${names.length} source(s) (${names.join(", ")}). Check them by hand.`;
          }
          for (const raw of raws) {
            const { inserted } = repo.upsertEvidence(toEvidenceRecord(raw, prospect, ep.id, ctx.eventTerms, now));
            if (inserted) entry.itemsFound++;
          }
        } catch (err) {
          recordError(entry, err, candidate.name);
          providerErrors.add(ep.label);
          log(`${ep.label} failed for ${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      prospect.checkedSources = checked;
      prospect.lastResearchedAt = now.toISOString();
      repo.saveProspect(prospect);

      // 4. Optional AI interpretation of what we found
      if (useAi) {
        const evidence = repo.listEvidence(prospect.id).filter((e) => e.verification !== "mock");
        if (evidence.length) {
          try {
            const ai = await interpretEvidence(event, prospect, evidence);
            for (const e of evidence) {
              const r = ai.byId.get(e.id);
              if (!r) continue;
              const updated: EvidenceRecord = {
                ...e,
                relevance: Math.round(r.relevance * 100) / 100,
                signals: r.signals.length ? r.signals : e.signals,
                interpretation: r.interpretation,
                interpretedBy: "ai",
              };
              if (updated.ad && r.ugcStyle !== "unknown") {
                updated.ad = {
                  ...updated.ad,
                  ugcStyle: r.ugcStyle,
                  ugcConfidence: updated.ad.ugcConfidence,
                  ugcBasis: `AI interpretation: ${r.ugcBasis} This is a style read only; it doesn't establish whether the person is a customer, paid creator or actor.`,
                };
              }
              repo.saveEvidence(updated);
            }
            const p = repo.getProspect(prospect.id)!;
            p.fitSummary = ai.fitSummary;
            p.fitSummaryBy = "ai";
            p.relevantProducts = ai.relevantProducts;
            repo.saveProspect(p);
          } catch (err) {
            const entry = statusEntry(job, aiCandidateProvider.id, aiCandidateProvider.label);
            recordError(entry, err, candidate.name);
            log(`AI interpretation failed for ${candidate.name}; using keyword matching instead.`);
          }
        }
      }

      refreshProspect(prospect.id, now);
      done++;
      job.progress = Math.min(98, 10 + Math.round((done / kept.length) * 88));
      job.stage = `Researched ${done} of ${kept.length}: ${candidate.name}`;
      save();
    });

    const anyProblem = job.providerStatus.some((s) => s.state === "error" || s.state === "rate_limited" || (s.state === "unavailable" && blockedBy.has(s.provider)));
    job.status = anyProblem ? "partial" : "succeeded";
    job.stage = anyProblem ? "Finished with some source errors" : "Finished";
    job.progress = 100;
    job.finishedAt = new Date().toISOString();
    save();
    return job;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
    save();
    return job;
  }
}

/** Create a job and run it in the background (in-process). Returns immediately. */
export function startResearch(eventId: string, mode: "mock" | "live"): ResearchJob {
  const running = repo.activeJob(eventId);
  if (running) return running;
  const job = repo.createJob(eventId, mode);
  setTimeout(() => {
    runResearch(job.id).catch((err) => console.error("research job crashed", err));
  }, 0);
  return job;
}

export function addManualBrand(eventId: string, input: { name: string; website: string; description: string }): ProspectRecord {
  const key = brandKey(input.name, input.website);
  const existing = repo.getProspectByKey(eventId, key);
  if (existing) return existing;
  const p = repo.saveProspect(
    repo.newProspect({
      eventId,
      brandKey: key,
      name: input.name,
      website: input.website,
      description: input.description,
      candidateSource: "manual",
      candidateRationale: "Added by you.",
    }),
  );
  return refreshProspect(p.id) ?? p;
}

export function addManualEvidence(prospectId: string, input: z.infer<typeof manualEvidenceSchema>, now: Date = new Date()): EvidenceRecord | null {
  const prospect = repo.getProspect(prospectId);
  if (!prospect) return null;
  const event = repo.getEvent(prospect.eventId);
  if (!event) return null;
  const ad =
    input.kind === "ad" || input.kind === "creator_content"
      ? input.ad
        ? {
            platform: input.ad.platform || "Unknown",
            advertiser: prospect.name,
            adUrl: input.ad.adUrl || null,
            libraryUrl: input.ad.libraryUrl || null,
            activeStatus: input.ad.activeStatus,
            activeStatusCheckedAt: input.ad.activeStatus === "unknown" ? null : now.toISOString(),
            adText: input.excerpt,
            format: input.ad.format || "unknown",
            ugcStyle: input.ad.ugcStyle,
            ugcConfidence: "low" as const,
            ugcBasis: input.ad.ugcBasis ? `Your note: ${input.ad.ugcBasis}` : "Set by you.",
          }
        : null
      : null;
  const raw: RawEvidence = {
    kind: input.kind,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    activityDate: input.activityDate,
    excerpt: input.excerpt,
    signals: defaultSignals(input.kind),
    verification: "user_provided",
    ad,
    contactName: input.kind === "contact" ? input.contactName || null : null,
    contactUrl: input.kind === "contact" ? input.sourceUrl : null,
    sourceId: `manual:${input.sourceUrl}:${input.excerpt.slice(0, 40)}`,
  };
  const record = toEvidenceRecord(raw, prospect, "manual", eventKeywords(event), now);
  if (input.notes) record.interpretation = `Your note: ${input.notes}`;
  record.interpretedBy = input.notes ? "user" : "heuristic";
  const { record: saved } = repo.upsertEvidence(record);
  if (!prospect.checkedSources.includes("Manual entry")) {
    prospect.checkedSources.push("Manual entry");
    repo.saveProspect(prospect);
  }
  refreshProspect(prospectId, now);
  return saved;
}
