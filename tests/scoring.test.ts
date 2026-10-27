import { describe, expect, it } from "vitest";
import { deriveFlags, isEligible, scoreProspect, WEIGHTS } from "@/lib/scoring";
import { ev, NOW } from "./helpers";

const comp = (r: ReturnType<typeof scoreProspect>, k: string) => r.components.find((c) => c.key === k)!;

describe("scoring weights", () => {
  it("adds up to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("scoreProspect", () => {
  it("scores zero with no evidence and says missing evidence isn't proof of absence", () => {
    const r = scoreProspect([], { now: NOW, checkedSources: ["Brand websites"] });
    expect(r.total).toBe(0);
    for (const c of r.components) {
      expect(c.points).toBe(0);
      expect(c.missing).toBe(true);
    }
    expect(comp(r, "partnership").explanation).toMatch(/doesn't mean none exists/);
    expect(comp(r, "partnership").explanation).toMatch(/Brand websites/);
    expect(r.confidence).toBe("low");
  });

  it("never awards points for evidence without a source link", () => {
    const r = scoreProspect(
      [
        ev({ sourceUrl: "", relevance: 1 }),
        ev({ kind: "sponsorship", sourceUrl: "not a url", signals: ["partnership"], relevance: 1 }),
      ],
      { now: NOW },
    );
    expect(r.total).toBe(0);
  });

  it("never awards points for unverified claims", () => {
    const r = scoreProspect([ev({ verification: "unverified", relevance: 1 }), ev({ kind: "ad", verification: "unverified", signals: ["advertising"] })], { now: NOW });
    expect(r.total).toBe(0);
  });

  it("excludes inaccessible or conflicting evidence until resolved", () => {
    const e = ev({ flags: ["conflicting"] });
    expect(isEligible(e)).toBe(false);
    expect(scoreProspect([e], { now: NOW }).total).toBe(0);
  });

  it("does not award partnership points for ads (ads don't imply sponsorship)", () => {
    const ad = ev({
      kind: "ad",
      signals: ["advertising", "message"],
      relevance: 1,
      activityDate: "2026-10-01",
      ad: {
        platform: "Instagram",
        advertiser: "Brand",
        adUrl: "https://ads.example/1",
        libraryUrl: null,
        activeStatus: "active",
        activeStatusCheckedAt: NOW.toISOString(),
        adText: "Honestly I tried it",
        format: "video",
        ugcStyle: "likely",
        ugcConfidence: "medium",
        ugcBasis: "cues",
      },
    });
    const r = scoreProspect([ad], { now: NOW });
    expect(comp(r, "partnership").points).toBe(0);
    expect(comp(r, "advertising").points).toBe(15);
    expect(comp(r, "advertising").explanation).toMatch(/not sponsorship budget/);
    expect(comp(r, "advertising").explanation).toMatch(/interpretation/);
  });

  it("only counts the creator-style bonus with medium+ confidence", () => {
    const base = {
      platform: "Facebook",
      advertiser: "B",
      adUrl: null,
      libraryUrl: "https://ads.example/lib",
      activeStatus: "unknown" as const,
      activeStatusCheckedAt: null,
      adText: "",
      format: "image",
      ugcStyle: "possible" as const,
      ugcBasis: "",
    };
    const low = scoreProspect([ev({ kind: "ad", signals: ["advertising"], ad: { ...base, ugcConfidence: "low" } })], { now: NOW });
    const med = scoreProspect([ev({ kind: "ad", signals: ["advertising"], ad: { ...base, ugcConfidence: "medium" } })], { now: NOW });
    expect(comp(med, "advertising").points - comp(low, "advertising").points).toBe(3);
  });

  it("caps each component at its weight and the total at 100", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      ev({ sourceUrl: `https://site${i}.example/x`, relevance: 1, activityDate: "2026-10-20" }),
    );
    const partners = [
      ev({ kind: "sponsorship", signals: ["partnership", "audience"], activityDate: "2026-10-01" }),
      ev({ kind: "partnership", signals: ["partnership", "audience"] }),
      ev({ kind: "partnership_page", signals: ["partnership"] }),
    ];
    const r = scoreProspect([...many, ...partners], { now: NOW });
    for (const c of r.components) expect(c.points).toBeLessThanOrEqual(c.max);
    expect(comp(r, "audience").points).toBe(35);
    expect(comp(r, "partnership").points).toBe(20);
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it("uses the activity date, not the date checked, for recency", () => {
    const old = ev({ kind: "press", signals: ["message"], activityDate: "2023-01-10", checkedAt: NOW.toISOString() });
    const r = scoreProspect([old], { now: NOW });
    expect(comp(r, "recency").points).toBe(0);
    expect(comp(r, "recency").explanation).toMatch(/over a year ago/);
    const fresh = ev({ kind: "press", signals: ["message"], activityDate: "2026-09-15" });
    expect(comp(scoreProspect([fresh], { now: NOW }), "recency").points).toBe(10);
  });

  it("gives no recency points when dates are unknown", () => {
    const r = scoreProspect([ev({ kind: "press", signals: ["message"], activityDate: null })], { now: NOW });
    expect(comp(r, "recency").points).toBe(0);
    expect(comp(r, "recency").explanation).toMatch(/reliable activity date/);
  });

  it("ignores weakly relevant evidence for fit", () => {
    const r = scoreProspect([ev({ relevance: 0.1 })], { now: NOW });
    expect(comp(r, "audience").points).toBe(0);
    expect(comp(r, "audience").explanation).toMatch(/didn't clearly relate/);
  });

  it("weights third-party sources lower than direct ones", () => {
    const direct = scoreProspect([ev({ relevance: 1 })], { now: NOW });
    const third = scoreProspect([ev({ relevance: 1, flags: ["third_party"] })], { now: NOW });
    expect(comp(third, "audience").points).toBeLessThan(comp(direct, "audience").points);
  });

  it("every component that earned points cites evidence with a source link", () => {
    const items = [
      ev({ relevance: 0.9 }),
      ev({ kind: "sponsorship", signals: ["partnership", "audience"], activityDate: "2026-08-01" }),
      ev({ kind: "ad", signals: ["advertising"], relevance: 0.5 }),
      ev({ sourceUrl: "", relevance: 1 }),
    ];
    const byId = new Map(items.map((e) => [e.id, e]));
    const r = scoreProspect(items, { now: NOW });
    for (const c of r.components) {
      if (c.points > 0) {
        expect(c.evidenceIds.length).toBeGreaterThan(0);
        for (const id of c.evidenceIds) expect(byId.get(id)!.sourceUrl).toMatch(/^https?:\/\//);
      }
    }
    expect(r.missingInfo.join(" ")).toMatch(/excluded from scoring/);
  });

  it("rates confidence by independent sources", () => {
    const one = scoreProspect([ev({})], { now: NOW });
    const three = scoreProspect([ev({ sourceUrl: "https://a.example" }), ev({ sourceUrl: "https://b.example" }), ev({ sourceUrl: "https://c.example" })], { now: NOW });
    expect(one.confidence).toBe("low");
    expect(three.confidence).toBe("high");
  });
});

describe("deriveFlags", () => {
  it("flags stale, weak, third-party and unknown dates", () => {
    expect(deriveFlags({ activityDate: "2020-01-01", relevance: 0.1, flags: [], sourceUrl: "https://news.example/a", kind: "news" }, "brand.com", NOW).sort()).toEqual(
      ["stale", "third_party", "weak"].sort(),
    );
    expect(deriveFlags({ activityDate: null, relevance: 1, flags: [], sourceUrl: "https://brand.com/a", kind: "press" }, "brand.com", NOW)).toEqual(["date_unknown"]);
  });
  it("keeps user-set conflicting flags and doesn't mark ad libraries third-party", () => {
    const f = deriveFlags({ activityDate: "2026-10-01", relevance: 1, flags: ["conflicting"], sourceUrl: "https://facebook.com/ads", kind: "ad" }, "brand.com", NOW);
    expect(f).toEqual(["conflicting"]);
  });
});
