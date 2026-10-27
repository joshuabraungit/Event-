import { describe, expect, it } from "vitest";
import { assessUgcStyle, classifyArticle } from "@/lib/classify";
import { extractPage, isAllowed, parseRobots } from "@/lib/providers/brand-website";
import { keywordRelevance, matchesAvoidList } from "@/lib/relevance";
import { providerSummaries } from "@/lib/providers/registry";

describe("robots.txt", () => {
  it("applies the * group and our own group", () => {
    const txt = "User-agent: *\nDisallow: /private\n\nUser-agent: SponsorSignalsBot\nDisallow: /\n";
    expect(parseRobots(txt)).toEqual(["/"]);
    expect(isAllowed("/about", parseRobots(txt))).toBe(false);
    const star = parseRobots("User-agent: *\nDisallow: /cart\nDisallow:\n");
    expect(isAllowed("/cart/x", star)).toBe(false);
    expect(isAllowed("/partners", star)).toBe(true);
  });
});

describe("page extraction", () => {
  it("pulls title, description, published date, links and emails", () => {
    const html = `<html><head><title>Partner with Us | Acme</title>
      <meta name="description" content="Sponsorship &amp; creator partnerships">
      <meta property="article:published_time" content="2026-05-04T10:00:00Z"></head>
      <body><a href="/partners">Partners</a><a href="mailto:partnerships@acme.test">email</a></body></html>`;
    const p = extractPage(html, "https://acme.test/");
    expect(p.title).toBe("Partner with Us | Acme");
    expect(p.description).toBe("Sponsorship & creator partnerships");
    expect(p.published).toBe("2026-05-04");
    expect(p.links[0].href).toBe("https://acme.test/partners");
    expect(p.emails).toEqual(["partnerships@acme.test"]);
  });
});

describe("classification", () => {
  it("labels UGC style as interpretation and never certain from text alone", () => {
    const a = assessUgcStyle("Honestly I tried this and I'm obsessed #ad", "video");
    expect(a.ugcStyle).toBe("likely");
    expect(a.ugcConfidence).not.toBe("high");
    expect(a.ugcBasis).toMatch(/interpretation/);
    expect(assessUgcStyle("Shop now: save 20% on our new collection", "image").ugcStyle).toBe("unlikely");
    expect(assessUgcStyle("", "video").ugcStyle).toBe("unknown");
  });
  it("classifies articles", () => {
    expect(classifyArticle("Acme sponsors city marathon", "", "")).toBe("sponsorship");
    expect(classifyArticle("Acme partners with educators", "", "")).toBe("partnership");
    expect(classifyArticle("Acme launches new line", "", "")).toBe("press");
  });
});

describe("relevance and avoid list", () => {
  it("matches stemmed keywords", () => {
    const r = keywordRelevance(["pleasure", "communicat", "bodi"], "Better communication and pleasure for our bodies");
    expect(r.matchedTerms.length).toBeGreaterThanOrEqual(2);
  });
  it("matches whole words in avoid entries", () => {
    const brand = { name: "Fizzwell", website: "https://fizzwell.example", categories: ["alcohol"], description: "" };
    expect(matchesAvoidList(["alcohol"], brand)).toBe("alcohol");
    expect(matchesAvoidList(["well"], brand)).toBeNull();
  });
});

describe("provider registry", () => {
  it("never exposes secret values", () => {
    process.env.BRAVE_SEARCH_API_KEY = "super-secret";
    try {
      const json = JSON.stringify(providerSummaries());
      expect(json).not.toContain("super-secret");
      expect(json).toContain("BRAVE_SEARCH_API_KEY");
    } finally {
      delete process.env.BRAVE_SEARCH_API_KEY;
    }
  });
  it("marks Google and TikTok as manual", () => {
    const s = providerSummaries();
    expect(s.find((p) => p.id === "google_ads_transparency")!.state).toBe("manual");
    expect(s.find((p) => p.id === "tiktok")!.state).toBe("manual");
  });
});
