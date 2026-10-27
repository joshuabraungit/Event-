import { isEligible, MIN_RELEVANCE } from "./scoring";
import type { EventRecord, EvidenceRecord, ProspectRecord, ScoreResult } from "./types";
import { truncate } from "./text";

/** Plain-language interpretation of one evidence item, when no AI is configured. */
export function heuristicInterpretation(e: Pick<EvidenceRecord, "kind" | "relevance" | "matchedTerms" | "ad">): string {
  const themes = e.matchedTerms.length ? `Overlaps with the event on: ${e.matchedTerms.slice(0, 5).join(", ")}.` : "";
  if (e.kind === "partnership_page") return "The brand publicly invites partnership inquiries.";
  if (e.kind === "contact") return "A public contact route listed on the source page.";
  if (e.relevance < MIN_RELEVANCE) return `Little overlap with this event's themes in the text we saw. ${themes}`.trim();
  switch (e.kind) {
    case "ad":
    case "creator_content":
      return `An ad whose message relates to the event. ${themes}`.trim();
    case "sponsorship":
      return `Shows the brand has sponsored something before. ${themes}`.trim();
    case "partnership":
      return `Shows the brand partners with others. ${themes}`.trim();
    default:
      return themes || "Relevant to the event.";
  }
}

export function fitSummaryFromScore(name: string, score: ScoreResult): string {
  const strong = score.components.filter((c) => !c.missing && c.points / c.max >= 0.5).map((c) => c.label.toLowerCase());
  const missing = score.components.filter((c) => c.missing).map((c) => c.label.toLowerCase());
  const parts: string[] = [];
  if (strong.length) parts.push(`${name} looks strongest on ${strong.join(", ")}.`);
  else parts.push(`Evidence for ${name} is thin so far.`);
  if (missing.length) parts.push(`We didn't find sourced evidence for ${missing.join(", ")} in the sources checked.`);
  return parts.join(" ");
}

export function suggestSponsorship(event: EventRecord, evidence: EvidenceRecord[], categories: string[]): string[] {
  const usable = evidence.filter(isEligible);
  const offered = new Set(event.sponsorshipTypes);
  const out: string[] = [];
  const hasProduct = usable.some((e) => e.kind === "product");
  const hasEducators = usable.some((e) => (e.kind === "partnership" || e.kind === "sponsorship") && /educat|expert|therap|clinic|physio|doctor|author|speaker|coach/i.test(e.excerpt));
  const isExperience = /retreat|experience|travel|spa|hospitality|venue|food|beverage|coffee/i.test(categories.join(" "));
  if (hasProduct && (offered.size === 0 || offered.has("product"))) out.push("Product (samples, gift bags or demos)");
  if (hasEducators && (offered.size === 0 || offered.has("speakers"))) out.push("Speaker or expert session");
  if (isExperience && (offered.size === 0 || offered.has("experiences"))) out.push("Experience (activation, lounge or hosted session)");
  if (offered.size === 0 || offered.has("cash")) out.push("Cash sponsorship (tiered package)");
  if (!out.length) out.push("Other: ask what format suits them");
  return out;
}

export function suggestContactRole(evidence: EvidenceRecord[]): string {
  const usable = evidence.filter(isEligible);
  if (usable.some((e) => e.kind === "sponsorship" || e.kind === "partnership_page")) return "Head of Partnerships or Sponsorships Manager";
  if (usable.some((e) => e.ad && (e.ad.ugcStyle === "likely" || e.ad.ugcStyle === "possible"))) return "Influencer & Creator Partnerships Manager";
  if (usable.some((e) => e.kind === "partnership")) return "Partnerships Manager";
  if (usable.some((e) => e.kind === "ad")) return "Brand Marketing Director";
  return "Events or Community Manager";
}

const OBSERVATION_ORDER = ["sponsorship", "partnership", "ad", "creator_content", "press", "product", "news", "brand_profile"];

/** The verified, relevant evidence best suited to open an outreach email. */
export function pickObservation(evidence: EvidenceRecord[]): EvidenceRecord | null {
  const usable = evidence.filter((e) => isEligible(e) && e.relevance >= MIN_RELEVANCE && OBSERVATION_ORDER.includes(e.kind));
  usable.sort((a, b) => {
    const ka = OBSERVATION_ORDER.indexOf(a.kind);
    const kb = OBSERVATION_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return (b.activityDate ?? "").localeCompare(a.activityDate ?? "");
  });
  return usable[0] ?? null;
}

function monthYear(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function lowerFirst(s: string): string {
  // Keep acronyms and names like "LGBTQ+" or "Toronto" intact when the second letter is uppercase too.
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function firstSentence(text: string): string {
  const s = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return truncate(s, 220);
}

function whenWhere(event: EventRecord): string {
  const bits: string[] = [];
  if (event.startDate) bits.push(event.endDate && event.endDate !== event.startDate ? `${event.startDate} to ${event.endDate}` : event.startDate);
  if (event.location) bits.push(/^online$/i.test(event.location) ? "online" : `in ${event.location}`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

export function observationSentence(e: EvidenceRecord, brandName: string): string {
  if (e.kind === "ad" && e.ad) {
    const since = e.activityDate ? ` that started running in ${monthYear(e.activityDate)}` : "";
    return `I came across ${brandName}'s ${e.ad.platform} ad${since}: "${truncate(e.ad.adText || e.excerpt, 110)}"`;
  }
  const when = e.activityDate ? ` from ${monthYear(e.activityDate)}` : "";
  return `I came across "${truncate(e.sourceTitle, 120)}"${when}.`;
}

/**
 * Short, editable outreach draft. Uses only a sourced observation and what
 * the organizer told us about the event; no invented metrics or history.
 */
export function buildOutreachDraft(
  event: EventRecord,
  prospect: Pick<ProspectRecord, "name" | "isMock">,
  evidence: EvidenceRecord[],
): string {
  const obs = pickObservation(evidence);
  const contact = evidence.find((e) => isEligible(e) && e.kind === "contact" && e.contactName);
  const lines: string[] = [];
  if (prospect.isMock) lines.push("[MOCK DATA: this draft is based on sample data. Don't send it.]", "");
  lines.push(`Hi ${contact?.contactName ?? "[Name]"},`, "");
  if (obs) lines.push(observationSentence(obs, prospect.name));
  else lines.push(`[Add a specific, sourced observation about ${prospect.name} here. We didn't find one we could verify.]`);
  const attendance = event.expectedAttendance ? ` We're expecting around ${event.expectedAttendance} people.` : "";
  lines.push(
    `We're bringing ${lowerFirst(event.audience.replace(/\.$/, ""))} together for ${event.name}${whenWhere(event)}. ${firstSentence(event.description)}${attendance}`,
    "",
    "It felt like there might be some overlap with what you're doing. Is sponsoring events like this something your team explores?",
    "",
    "[Your name]",
  );
  return lines.join("\n");
}
