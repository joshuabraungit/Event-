import { classifyArticle, defaultSignals } from "../classify";
import { hostnameOf, normalizeDomain, toIsoDate, truncate } from "../text";
import {
  fetchWithTimeout,
  ProviderError,
  type BrandCandidate,
  type EvidenceProvider,
  type ProviderContext,
  type RawEvidence,
} from "./types";

/**
 * Public articles, press releases, sponsor pages and partnership
 * announcements via the Brave Search API (official, key required).
 * Search results are leads: the snippet is what the search engine shows,
 * so third-party pages are flagged and weighted lower in scoring.
 */

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
  age?: string;
  profile?: { name?: string };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function queriesFor(brand: BrandCandidate): string[] {
  const n = `"${brand.name}"`;
  return [`${n} sponsor OR sponsorship OR "sponsored by"`, `${n} "partners with" OR partnership OR creator OR ambassador`, `${n} launch OR campaign`];
}

export const webSearchProvider: EvidenceProvider = {
  id: "web_search",
  label: "Web search (Brave Search API)",
  access: "official_api",
  description:
    "Finds public articles, press releases, event sponsor pages and partnership announcements. Uses the page date the search engine reports, which may differ from the activity date; open the source to confirm.",
  configVars: ["BRAVE_SEARCH_API_KEY"],
  availability() {
    return process.env.BRAVE_SEARCH_API_KEY
      ? { state: "ok", message: "Configured." }
      : { state: "not_configured", message: "Set BRAVE_SEARCH_API_KEY to search public articles and announcements." };
  },
  manualCheckUrl: (brand) => `https://search.brave.com/search?q=${encodeURIComponent(`"${brand.name}" sponsorship OR partnership`)}`,
  async collect(brand: BrandCandidate, ctx: ProviderContext): Promise<RawEvidence[]> {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) throw new ProviderError("BRAVE_SEARCH_API_KEY is not set", "not_configured");
    const domain = normalizeDomain(brand.website);
    const out: RawEvidence[] = [];
    const seen = new Set<string>();
    for (const q of queriesFor(brand)) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10&safesearch=moderate`;
      const res = await fetchWithTimeout(ctx.fetchImpl, url, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
      });
      if (res.status === 429) throw new ProviderError("Brave Search rate limit reached. Try again later.", "rate_limited");
      if (res.status === 401 || res.status === 403) throw new ProviderError("Brave Search rejected the API key.", "error");
      if (!res.ok) throw new ProviderError(`Brave Search returned HTTP ${res.status}`, "error");
      const body = (await res.json()) as { web?: { results?: BraveResult[] } };
      for (const r of body.web?.results ?? []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        const title = stripTags(r.title ?? "");
        const snippet = stripTags(r.description ?? "");
        // Only keep results that actually mention the brand.
        const mentions = `${title} ${snippet}`.toLowerCase().includes(brand.name.toLowerCase()) || hostnameOf(r.url).endsWith(domain);
        if (!mentions) continue;
        const kind = classifyArticle(title, snippet, r.url);
        out.push({
          kind,
          sourceUrl: r.url,
          sourceTitle: title || r.url,
          publisher: r.profile?.name || hostnameOf(r.url),
          activityDate: toIsoDate(r.page_age),
          excerpt: truncate(snippet, 400),
          signals: defaultSignals(kind),
          verification: "verified_source",
          interpretation: "From a search result snippet. Open the page to confirm the details.",
        });
      }
    }
    return out;
  },
};
