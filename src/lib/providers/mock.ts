import { assessUgcStyle } from "../classify";
import { keywordRelevance } from "../relevance";
import { hashString, normalizeDomain } from "../text";
import { MOCK_BRANDS, type MockBrand } from "./mock-catalog";
import type { BrandCandidate, CandidateProvider, EvidenceProvider, ProviderContext, RawEvidence } from "./types";

/**
 * Mock mode: fictional brands with realistic-looking evidence on *.example
 * URLs. Everything it returns is marked verification "mock" and shown with a
 * MOCK label. It exists so the app can be tested without API keys.
 */

function brandText(b: MockBrand): string {
  return [b.name, b.categories.join(" "), b.tagline, b.audience, ...b.products.map((p) => p.description)].join(" ");
}

function seeded(seed: string, n: number): number {
  return parseInt(hashString(seed), 16) % n;
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export const mockCandidateProvider: CandidateProvider = {
  id: "mock_candidates",
  label: "Mock brand catalog",
  access: "mock",
  description: "Picks fictional brands from a built-in catalog whose descriptions overlap with the event. Never real.",
  configVars: [],
  availability: () => ({ state: "ok", message: "Always available. Results are fictional." }),
  async discover(ctx: ProviderContext): Promise<BrandCandidate[]> {
    const ranked = MOCK_BRANDS.map((b) => ({ b, r: keywordRelevance(ctx.eventTerms, brandText(b)) }))
      .sort((x, y) => y.r.matchedTerms.length - x.r.matchedTerms.length || x.b.name.localeCompare(y.b.name));
    const matched = ranked.filter((x) => x.r.matchedTerms.length > 0).slice(0, 10);
    // Always include a couple of weak matches so the ranking shows contrast.
    const filler = ranked.filter((x) => x.r.matchedTerms.length === 0).slice(0, matched.length >= 8 ? 2 : 5);
    return [...matched, ...filler].map(({ b, r }) => ({
      name: b.name,
      website: `https://${b.domain}`,
      description: b.tagline,
      categories: b.categories,
      source: "mock" as const,
      rationale: r.matchedTerms.length
        ? `Mock catalog match on: ${r.matchedTerms.join(", ")}.`
        : "Included as a weak mock match for comparison.",
      isMock: true,
    }));
  },
};

export const mockEvidenceProvider: EvidenceProvider = {
  id: "mock_evidence",
  label: "Mock evidence",
  access: "mock",
  description: "Generates sample evidence (profiles, ads, partnerships) for mock brands. Clearly labeled; never a real finding.",
  configVars: [],
  availability: () => ({ state: "ok", message: "Always available in mock mode." }),
  manualCheckUrl: () => null,
  async collect(brand: BrandCandidate, ctx: ProviderContext): Promise<RawEvidence[]> {
    const domain = normalizeDomain(brand.website);
    const b = MOCK_BRANDS.find((m) => m.domain === domain);
    if (!b) return [];
    const now = ctx.now;
    const base = `https://${b.domain}`;
    const out: RawEvidence[] = [];
    const seed = (k: string) => `${b.domain}:${k}`;

    out.push({
      kind: "brand_profile",
      sourceUrl: `${base}/about`,
      sourceTitle: `About ${b.name} (mock)`,
      activityDate: null,
      excerpt: `${b.tagline} ${b.audience}`,
      signals: ["audience", "message"],
      verification: "mock",
    });
    for (const p of b.products) {
      out.push({
        kind: "product",
        sourceUrl: `${base}/products/${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        sourceTitle: `${p.name} | ${b.name} (mock)`,
        activityDate: null,
        excerpt: `${p.name}: ${p.description}`,
        signals: ["audience"],
        verification: "mock",
      });
    }
    b.adHooks.forEach((hook, i) => {
      const adId = `mock-${hashString(seed(`ad${i}`))}`;
      const started = 5 + seeded(seed(`adstart${i}`), 200);
      const active = started < 60 || seeded(seed(`active${i}`), 2) === 0;
      const ugc = assessUgcStyle(hook.text, hook.format);
      out.push({
        kind: "ad",
        sourceUrl: `https://mock-ad-library.example/ads/${adId}`,
        sourceTitle: `${b.name} ad on ${i % 2 === 0 ? "Instagram" : "Facebook"} (mock)`,
        publisher: "Mock ad library",
        activityDate: daysAgo(now, started),
        excerpt: hook.text,
        signals: ["advertising", "message"],
        verification: "mock",
        sourceId: adId,
        ad: {
          platform: i % 2 === 0 ? "Instagram" : "Facebook",
          advertiser: b.name,
          adUrl: `https://mock-ad-library.example/ads/${adId}`,
          libraryUrl: `https://mock-ad-library.example/advertisers/${b.domain}`,
          activeStatus: active ? "active" : "inactive",
          activeStatusCheckedAt: now.toISOString(),
          adText: hook.text,
          format: hook.format,
          ...ugc,
        },
      });
    });
    if (b.sponsors) {
      const d = 20 + seeded(seed("spons"), 500);
      out.push({
        kind: "sponsorship",
        sourceUrl: `https://community-news.example/${b.domain.split(".")[0]}-sponsor`,
        sourceTitle: `${b.name} named sponsor of ${b.sponsors} (mock)`,
        publisher: "community-news.example",
        activityDate: daysAgo(now, d),
        excerpt: `${b.name} was listed as a sponsor of ${b.sponsors}. ${b.audience}`,
        signals: ["partnership", "audience"],
        verification: "mock",
      });
    }
    if (b.partners) {
      const d = 10 + seeded(seed("partner"), 300);
      out.push({
        kind: "partnership",
        sourceUrl: `${base}/blog/partnering-with-${b.partners.split(" ")[0].toLowerCase()}`,
        sourceTitle: `${b.name} partners with ${b.partners} (mock)`,
        activityDate: daysAgo(now, d),
        excerpt: `${b.name} announced a partnership with ${b.partners}. ${b.tagline}`,
        signals: ["partnership", "audience"],
        verification: "mock",
      });
    }
    if (b.hasPartnerPage) {
      out.push({
        kind: "partnership_page",
        sourceUrl: `${base}/partnerships`,
        sourceTitle: `Partner with ${b.name} (mock)`,
        activityDate: null,
        excerpt: `${b.name} invites event, community and creator partnership inquiries via a form on this page.`,
        signals: ["partnership"],
        verification: "mock",
      });
      out.push({
        kind: "contact",
        sourceUrl: `${base}/partnerships`,
        sourceTitle: `Partner with ${b.name} (mock)`,
        activityDate: null,
        excerpt: "Partnership inquiries: partnerships@" + b.domain,
        signals: [],
        verification: "mock",
        contactName: null,
        contactUrl: `mailto:partnerships@${b.domain}`,
      });
    }
    if (b.launch) {
      const d = 3 + seeded(seed("launch"), 120);
      out.push({
        kind: "press",
        sourceUrl: `${base}/press/launch`,
        sourceTitle: `${b.name} launches ${b.launch} (mock)`,
        activityDate: daysAgo(now, d),
        excerpt: `${b.name} today launched ${b.launch}. ${b.tagline}`,
        signals: ["message"],
        verification: "mock",
      });
    }
    return out;
  },
};
