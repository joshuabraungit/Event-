import type {
  Confidence,
  EvidenceFlag,
  EvidenceRecord,
  ScoreComponent,
  ScoreComponentKey,
  ScoreResult,
} from "./types";
import { daysBetween, hostnameOf, isHttpUrl } from "./text";
import { TOPIC_NEUTRAL_KINDS } from "./relevance";

/**
 * Transparent 0–100 fit score. Points come only from evidence that has a
 * source link and was retrieved from that source (or entered by the user
 * with a link). Missing evidence earns zero points and is described as
 * "not found in the sources checked", never as "doesn't exist".
 *
 * Ad activity earns advertising points only. It never adds partnership
 * points and is never treated as a sign of sponsorship budget.
 */

export const WEIGHTS: Record<ScoreComponentKey, number> = {
  audience: 35,
  message: 20,
  advertising: 15,
  partnership: 20,
  recency: 10,
};

export const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  audience: "Audience and event fit",
  message: "Message and values alignment",
  advertising: "Evidence of advertising",
  partnership: "Evidence of partnerships or sponsorships",
  recency: "Recent relevant activity",
};

/** Relevance below this is too weak to count toward fit. */
export const MIN_RELEVANCE = 0.3;
/** Activity older than this is flagged stale and earns no recency points. */
export const STALE_DAYS = 548; // ~18 months

const BLOCKING_FLAGS: EvidenceFlag[] = ["inaccessible", "conflicting"];

/** Can this evidence earn points at all? */
export function isEligible(e: EvidenceRecord): boolean {
  if (!isHttpUrl(e.sourceUrl)) return false;
  if (e.verification === "unverified") return false;
  if (e.flags.some((f) => BLOCKING_FLAGS.includes(f))) return false;
  return true;
}

export function ineligibilityReason(e: EvidenceRecord): string | null {
  if (!isHttpUrl(e.sourceUrl)) return "No source link, so it can't earn points.";
  if (e.verification === "unverified") return "Unverified claim, so it can't earn points.";
  const blocking = e.flags.filter((f) => BLOCKING_FLAGS.includes(f));
  if (blocking.length) return `Flagged ${blocking.join(" and ")}, so it can't earn points until resolved.`;
  return null;
}

/** Third-party sources count a bit less than the brand's own pages or an ad library. */
function sourceWeight(e: EvidenceRecord): number {
  return e.flags.includes("third_party") ? 0.8 : 1;
}

function strength(e: EvidenceRecord): number {
  return e.relevance * sourceWeight(e);
}

function distinctSources(items: EvidenceRecord[]): number {
  return new Set(items.map((e) => hostnameOf(e.sourceUrl) + "|" + e.sourceUrl)).size;
}

function byStrength(items: EvidenceRecord[]): EvidenceRecord[] {
  return [...items].sort((a, b) => strength(b) - strength(a));
}

function notFound(what: string, checked: string[]): string {
  const where = checked.length ? ` in the sources checked (${checked.join(", ")})` : " in the sources checked";
  return `No ${what} found${where}. That doesn't mean none exists.`;
}

function round(n: number): number {
  return Math.round(n);
}

/** Generic "fit" component: strongest relevant item plus a little for independent corroboration. */
function fitComponent(
  key: "audience" | "message",
  items: EvidenceRecord[],
  checked: string[],
): ScoreComponent {
  const max = WEIGHTS[key];
  const relevant = byStrength(items.filter((e) => e.relevance >= MIN_RELEVANCE));
  const label = COMPONENT_LABELS[key];
  if (relevant.length === 0) {
    const weakNote = items.length
      ? ` ${items.length} source(s) mentioned the brand but didn't clearly relate to this event.`
      : "";
    return {
      key,
      label,
      points: 0,
      max,
      missing: true,
      evidenceIds: [],
      explanation:
        notFound(key === "audience" ? "sourced evidence of audience overlap" : "sourced evidence of aligned messaging", checked) +
        weakNote,
    };
  }
  const best = relevant[0];
  const bestShare = key === "audience" ? 25 : 14;
  const perExtra = key === "audience" ? 5 : 3;
  const extras = relevant.slice(1);
  const corroboration = Math.min(max - bestShare, perExtra * Math.max(0, distinctSources(relevant) - 1));
  const points = Math.min(max, round(bestShare * strength(best) + corroboration));
  const terms = [...new Set(relevant.flatMap((e) => e.matchedTerms))].slice(0, 6);
  const termText = terms.length ? ` Shared themes: ${terms.join(", ")}.` : "";
  const what = key === "audience" ? "audience or products overlap with this event" : "messaging lines up with the event's purpose";
  return {
    key,
    label,
    points,
    max,
    missing: false,
    evidenceIds: relevant.map((e) => e.id),
    explanation:
      `Strongest source ("${best.sourceTitle || best.publisher}") suggests the brand's ${what} (relevance ${Math.round(
        best.relevance * 100,
      )}%).` +
      (extras.length ? ` ${extras.length} more source(s) back this up.` : " Only one source supports this so far.") +
      termText,
  };
}

function advertisingComponent(items: EvidenceRecord[], checked: string[]): ScoreComponent {
  const max = WEIGHTS.advertising;
  const ads = byStrength(items.filter((e) => e.kind === "ad" || (e.kind === "creator_content" && e.ad)));
  if (ads.length === 0) {
    return {
      key: "advertising",
      label: COMPONENT_LABELS.advertising,
      points: 0,
      max,
      missing: true,
      evidenceIds: [],
      explanation: notFound("ads", checked) + " Ad libraries only cover some regions and some ads.",
    };
  }
  const best = ads[0];
  const found = 6;
  const relevancePts = round(6 * best.relevance);
  const creatorStyle = ads.find(
    (e) => e.ad && (e.ad.ugcStyle === "likely" || e.ad.ugcStyle === "possible") && e.ad.ugcConfidence !== "low",
  );
  const creatorPts = creatorStyle && creatorStyle.relevance >= MIN_RELEVANCE ? 3 : 0;
  const points = Math.min(max, found + relevancePts + creatorPts);
  const parts = [
    `Found ${ads.length} ad(s) with source links (6 pts).`,
    `Most relevant ad scores ${Math.round(best.relevance * 100)}% relevance to the event (${relevancePts} pts).`,
  ];
  if (creatorPts) parts.push("At least one relevant ad looks creator-led or UGC-style (3 pts). That's our interpretation of the format, not proof of who appears in it.");
  parts.push("Ads show marketing activity, not sponsorship budget or interest.");
  return {
    key: "advertising",
    label: COMPONENT_LABELS.advertising,
    points,
    max,
    missing: false,
    evidenceIds: ads.map((e) => e.id),
    explanation: parts.join(" "),
  };
}

function partnershipComponent(items: EvidenceRecord[], checked: string[]): ScoreComponent {
  const max = WEIGHTS.partnership;
  const sponsorships = byStrength(items.filter((e) => e.kind === "sponsorship"));
  const partnerships = byStrength(items.filter((e) => e.kind === "partnership"));
  const pages = items.filter((e) => e.kind === "partnership_page");
  const parts: string[] = [];
  let points = 0;
  if (sponsorships.length) {
    const p = round(7 + 3 * sponsorships[0].relevance);
    points += p;
    parts.push(`Sponsored at least one event, podcast, community or newsletter (${p} pts).`);
  }
  if (partnerships.length) {
    const p = round(4 + 2 * partnerships[0].relevance);
    points += p;
    parts.push(`Has partnered with creators, educators or organizations (${p} pts).`);
  }
  if (pages.length) {
    points += 4;
    parts.push("Has a public partnerships or sponsorship page (4 pts).");
  }
  const ids = [...sponsorships, ...partnerships, ...pages].map((e) => e.id);
  if (!ids.length) {
    return {
      key: "partnership",
      label: COMPONENT_LABELS.partnership,
      points: 0,
      max,
      missing: true,
      evidenceIds: [],
      explanation: notFound("past sponsorships or partnerships", checked),
    };
  }
  const missingBits: string[] = [];
  if (!sponsorships.length) missingBits.push("past sponsorships");
  if (!partnerships.length) missingBits.push("creator or organization partnerships");
  if (!pages.length) missingBits.push("a partnerships page");
  if (missingBits.length) parts.push(`Not found yet: ${missingBits.join(", ")}.`);
  return {
    key: "partnership",
    label: COMPONENT_LABELS.partnership,
    points: Math.min(max, points),
    max,
    missing: false,
    evidenceIds: ids,
    explanation: parts.join(" "),
  };
}

function recencyComponent(items: EvidenceRecord[], now: Date): ScoreComponent {
  const max = WEIGHTS.recency;
  const relevant = items.filter((e) => e.relevance >= MIN_RELEVANCE && e.kind !== "brand_profile");
  const dated = relevant.filter((e) => e.activityDate);
  if (!dated.length) {
    return {
      key: "recency",
      label: COMPONENT_LABELS.recency,
      points: 0,
      max,
      missing: true,
      evidenceIds: [],
      explanation: relevant.length
        ? "Relevant activity was found, but none of it had a reliable activity date, so no recency points."
        : "No dated, relevant activity found in the sources checked.",
    };
  }
  const newest = [...dated].sort((a, b) => (b.activityDate! > a.activityDate! ? 1 : -1))[0];
  const age = daysBetween(newest.activityDate!, now);
  let points = 0;
  let desc: string;
  if (age < 0) {
    points = 10;
    desc = `an upcoming activity dated ${newest.activityDate}`;
  } else if (age <= 90) {
    points = 10;
    desc = `${age} days ago`;
  } else if (age <= 180) {
    points = 7;
    desc = `about ${Math.round(age / 30)} months ago`;
  } else if (age <= 365) {
    points = 4;
    desc = `about ${Math.round(age / 30)} months ago`;
  } else {
    points = 0;
    desc = `over a year ago (${newest.activityDate})`;
  }
  return {
    key: "recency",
    label: COMPONENT_LABELS.recency,
    points,
    max,
    missing: false,
    evidenceIds: [newest.id],
    explanation: `Most recent relevant activity happened ${desc}, based on the activity date, not the date we found it ("${
      newest.sourceTitle || newest.publisher
    }").`,
  };
}

function confidenceFor(eligible: EvidenceRecord[], all: EvidenceRecord[]): { confidence: Confidence; reason: string } {
  const sources = distinctSources(eligible);
  const direct = eligible.some((e) => !e.flags.includes("third_party"));
  const conflicting = all.some((e) => e.flags.includes("conflicting"));
  if (conflicting) return { confidence: "low", reason: "Some evidence is flagged as conflicting." };
  if (sources >= 3 && direct) return { confidence: "high", reason: `${sources} independent sources, including direct ones.` };
  if (sources >= 2) return { confidence: "medium", reason: `${sources} sources support this result.` };
  return { confidence: "low", reason: sources === 1 ? "Only one source supports this result." : "No eligible sources yet." };
}

export interface ScoreOptions {
  now?: Date;
  /** Providers that were checked, used to word "not found" messages honestly. */
  checkedSources?: string[];
}

export function scoreProspect(evidence: EvidenceRecord[], opts: ScoreOptions = {}): ScoreResult {
  const now = opts.now ?? new Date();
  const checked = opts.checkedSources ?? [];
  const eligible = evidence.filter(isEligible);

  const audience = fitComponent("audience", eligible.filter((e) => e.signals.includes("audience")), checked);
  const message = fitComponent("message", eligible.filter((e) => e.signals.includes("message")), checked);
  const advertising = advertisingComponent(eligible, checked);
  const partnership = partnershipComponent(eligible, checked);
  const recency = recencyComponent(eligible, now);

  const components = [audience, message, advertising, partnership, recency];
  const total = Math.max(0, Math.min(100, components.reduce((s, c) => s + c.points, 0)));
  const contributing = new Set(components.flatMap((c) => c.evidenceIds));
  const { confidence, reason } = confidenceFor(eligible.filter((e) => contributing.has(e.id)), evidence);

  const missingInfo: string[] = [];
  for (const c of components) if (c.missing) missingInfo.push(c.label);
  if (!evidence.some((e) => e.kind === "contact" && isEligible(e))) missingInfo.push("Verified public contact");
  const excluded = evidence.length - eligible.length;
  if (excluded > 0) missingInfo.push(`${excluded} evidence item(s) excluded from scoring (no source, unverified, inaccessible or conflicting)`);

  return { total, components, confidence, confidenceReason: reason, missingInfo };
}

/** Flags derived automatically from the evidence itself. */
export function deriveFlags(
  e: Pick<EvidenceRecord, "activityDate" | "relevance" | "flags" | "sourceUrl" | "kind">,
  brandDomain: string,
  now: Date = new Date(),
): EvidenceFlag[] {
  const flags = new Set<EvidenceFlag>(e.flags.filter((f) => f === "conflicting" || f === "inaccessible"));
  if (!e.activityDate) flags.add("date_unknown");
  else if (daysBetween(e.activityDate, now) > STALE_DAYS) flags.add("stale");
  if (e.relevance < MIN_RELEVANCE && !TOPIC_NEUTRAL_KINDS.includes(e.kind)) flags.add("weak");
  const host = hostnameOf(e.sourceUrl);
  const isAdLibrary = e.kind === "ad";
  if (host && brandDomain && !isAdLibrary && !host.endsWith(brandDomain)) flags.add("third_party");
  return [...flags];
}
