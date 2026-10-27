import type { EventRecord } from "./types";
import { keywords, stem, tokenize } from "./text";

/** Kinds whose value doesn't depend on topical overlap (a contact page is useful whatever it says). */
export const TOPIC_NEUTRAL_KINDS = ["partnership_page", "contact"];

/**
 * Keyword profile for an event. Name, description and audience carry the
 * most signal; demographics add a little. Notes and the avoid list are not
 * used (notes are for the organizer, the avoid list is a filter).
 */
export function eventKeywords(event: Pick<EventRecord, "name" | "description" | "audience" | "demographics">): string[] {
  return keywords([event.name, event.description, event.audience, event.demographics].join(" "));
}

export interface RelevanceResult {
  relevance: number; // 0..1
  matchedTerms: string[];
}

/**
 * Heuristic relevance: share of distinct event keywords that also appear in
 * the evidence text. Three or more distinct matches counts as fully relevant.
 * Used when no AI interpreter is configured, and as a cross-check otherwise.
 */
export function keywordRelevance(eventTerms: string[], text: string): RelevanceResult {
  // Map each stem back to a readable word from the evidence text for display.
  const display = new Map<string, string>();
  for (const word of tokenize(text)) {
    const s = stem(word);
    if (!display.has(s)) display.set(s, word);
  }
  const matchedTerms = eventTerms.filter((t) => display.has(t)).map((t) => display.get(t)!);
  const relevance = Math.min(1, matchedTerms.length / 3);
  return { relevance: Math.round(relevance * 100) / 100, matchedTerms };
}

/** True when any avoid-list entry appears in the brand's name, domain, categories or description. */
export function matchesAvoidList(
  avoidEntries: string[],
  brand: { name: string; website: string; categories: string[]; description: string },
): string | null {
  const haystack = [brand.name, brand.website, brand.categories.join(" "), brand.description].join(" ").toLowerCase();
  for (const entry of avoidEntries) {
    const e = entry.toLowerCase().trim();
    if (e.length < 2) continue;
    const pattern = new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (pattern.test(haystack)) return entry;
  }
  return null;
}
