import { beforeEach, describe, expect, it } from "vitest";
import { prospectsToCsv, csvEscape } from "@/lib/csv";
import * as repo from "@/lib/repo";
import { addManualBrand, addManualEvidence, dedupeCandidates, parseSeedBrands, refreshProspect, runResearch } from "@/lib/research";
import { metaAdLibraryProvider } from "@/lib/providers/meta-ad-library";
import { brandWebsiteProvider } from "@/lib/providers/brand-website";
import type { CandidateProvider } from "@/lib/providers/types";
import { prospectPatchSchema, eventInputSchema } from "@/lib/validation";
import { devEvent, freshDb, NOW, sexEdEvent } from "./helpers";

beforeEach(() => freshDb());

describe("event validation", () => {
  it("requires the core fields and rejects bad dates and URLs", () => {
    const r = eventInputSchema.safeParse({ name: "", description: "short", location: "", audience: "", website: "nope", startDate: "2026-05-02", endDate: "2026-05-01" });
    expect(r.success).toBe(false);
    const keys = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(keys).toEqual(expect.arrayContaining(["name", "description", "location", "audience", "website"]));
  });
  it("saves and edits an event", () => {
    const e = sexEdEvent();
    const updated = repo.updateEvent(e.id, eventInputSchema.parse({ ...e, name: "Renamed event" }))!;
    expect(updated.name).toBe("Renamed event");
    expect(repo.getEvent(e.id)!.name).toBe("Renamed event");
  });
});

describe("mock research job", () => {
  it("returns a ranked list labeled as mock, with sourced evidence", async () => {
    const event = sexEdEvent();
    const job = repo.createJob(event.id, "mock");
    const done = await runResearch(job.id, { now: NOW });
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(100);
    const prospects = repo.listProspectsWithEvidence(event.id);
    expect(prospects.length).toBeGreaterThan(5);
    // ranked by score
    const scores = prospects.map((p) => p.score!.total);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // relevant categories rank above unrelated ones
    const top3 = prospects.slice(0, 3).flatMap((p) => p.categories).join(" ");
    expect(top3).toMatch(/sexual wellness|women's health|menopause|pelvic/);
    for (const p of prospects) {
      expect(p.isMock).toBe(true);
      for (const e of p.evidence) {
        expect(e.verification).toBe("mock");
        expect(e.sourceUrl).toMatch(/^https:\/\/[^/]*\.example\//);
      }
      expect(p.outreachDraft).toMatch(/^\[MOCK DATA/);
    }
  });

  it("works for a different kind of event (nothing hardcoded)", async () => {
    const event = devEvent();
    const job = repo.createJob(event.id, "mock");
    await runResearch(job.id, { now: NOW });
    const top = repo.listProspects(event.id)[0];
    expect(top.categories.join(" ")).toMatch(/developer|cloud|software/);
  });

  it("respects the avoid list", async () => {
    const event = sexEdEvent({ avoid: "sexual wellness, Second Spring" });
    const job = repo.createJob(event.id, "mock");
    const done = await runResearch(job.id, { now: NOW });
    const names = repo.listProspects(event.id).map((p) => p.name);
    expect(names).not.toContain("Velvet Hour");
    expect(names).not.toContain("Second Spring");
    expect(done.log.join("\n")).toMatch(/avoid list/);
  });

  it("dedupes evidence and keeps user status/notes when research runs again", async () => {
    const event = sexEdEvent();
    await runResearch(repo.createJob(event.id, "mock").id, { now: NOW });
    const first = repo.listProspectsWithEvidence(event.id);
    const p = first[0];
    repo.saveProspect({ ...repo.getProspect(p.id)!, status: "contacted", notes: "Emailed Sam", saved: true });
    await runResearch(repo.createJob(event.id, "mock").id, { now: NOW });
    const again = repo.listProspectsWithEvidence(event.id);
    expect(again.length).toBe(first.length);
    const p2 = again.find((x) => x.id === p.id)!;
    expect(p2.evidence.length).toBe(p.evidence.length);
    expect(p2.status).toBe("contacted");
    expect(p2.notes).toBe("Emailed Sam");
  });
});

describe("live research without keys", () => {
  it("fails clearly when there are no brands to research", async () => {
    const event = sexEdEvent();
    const job = repo.createJob(event.id, "live");
    const done = await runResearch(job.id, { now: NOW, candidateProviders: [], evidenceProviders: [] });
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/Brands to consider/);
  });

  it("marks unconfigured providers and records rate limits as a partial result", async () => {
    const event = sexEdEvent({ seedBrands: "Acme Wellness | acme.test" });
    process.env.META_AD_LIBRARY_ACCESS_TOKEN = "test-token";
    const fakeFetch = (async (url: string) => {
      if (String(url).includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ error: { code: 4, message: "Application request limit reached" } }), { status: 400 });
      }
      return new Response("", { status: 403 });
    }) as unknown as typeof fetch;
    try {
      const job = repo.createJob(event.id, "live");
      const done = await runResearch(job.id, {
        now: NOW,
        fetchImpl: fakeFetch,
        candidateProviders: [],
        evidenceProviders: [brandWebsiteProvider, metaAdLibraryProvider],
        useAi: false,
      });
      expect(done.status).toBe("partial");
      const meta = done.providerStatus.find((s) => s.provider === "meta_ad_library")!;
      expect(meta.state).toBe("rate_limited");
      const p = repo.listProspectsWithEvidence(event.id)[0];
      // homepage blocked: recorded as inaccessible, earns no points
      const blocked = p.evidence.find((e) => e.flags.includes("inaccessible"));
      expect(blocked).toBeTruthy();
      const site = done.providerStatus.find((s) => s.provider === "brand_website")!;
      expect(site.state).toBe("unavailable");
      expect(site.message).toMatch(/Couldn't read 1 source/);
      expect(p.score!.total).toBe(0);
    } finally {
      delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    }
  });

  it("stores Meta ads with public ad links and never the token-bearing snapshot URL", async () => {
    const event = sexEdEvent({ seedBrands: "Velvet Hour | velvethour.test" });
    process.env.META_AD_LIBRARY_ACCESS_TOKEN = "secret-token";
    const fakeFetch = (async (url: string) => {
      if (String(url).includes("graph.facebook.com")) {
        return Response.json({
          data: [
            {
              id: "123",
              page_id: "999",
              page_name: "Velvet Hour",
              ad_creative_bodies: ["Honestly no one taught me about pleasure in sex ed. I tried this and my communication changed."],
              ad_delivery_start_time: "2026-09-01",
              publisher_platforms: ["instagram"],
              ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=123&access_token=secret-token",
            },
            { id: "456", page_name: "Unrelated Page", ad_creative_bodies: ["velvet hour sale"] },
          ],
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const done = await runResearch(repo.createJob(event.id, "live").id, {
        now: NOW,
        fetchImpl: fakeFetch,
        candidateProviders: [],
        evidenceProviders: [metaAdLibraryProvider],
        useAi: false,
      });
      expect(done.status).toBe("succeeded");
      const p = repo.listProspectsWithEvidence(event.id)[0];
      const ads = p.evidence.filter((e) => e.kind === "ad");
      expect(ads).toHaveLength(1);
      expect(ads[0].ad!.adUrl).toBe("https://www.facebook.com/ads/library/?id=123");
      expect(ads[0].ad!.activeStatus).toBe("active");
      expect(ads[0].activityDate).toBe("2026-09-01");
      expect(ads[0].ad!.ugcStyle).toBe("likely");
      expect(ads[0].ad!.ugcBasis).toMatch(/doesn't tell us whether the person is a customer/);
      expect(JSON.stringify(repo.listEvidence(p.id))).not.toContain("secret-token");
      expect(p.outreachDraft).toMatch(/Instagram ad that started running in September 2026/);
    } finally {
      delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    }
  });

  it("surfaces a provider crash without failing the whole job", async () => {
    const event = sexEdEvent({ seedBrands: "Somebrand" });
    const broken: CandidateProvider = {
      id: "broken",
      label: "Broken",
      access: "ai",
      description: "",
      configVars: [],
      availability: () => ({ state: "ok", message: "" }),
      discover: async () => {
        throw new Error("boom");
      },
    };
    const done = await runResearch(repo.createJob(event.id, "live").id, { now: NOW, candidateProviders: [broken], evidenceProviders: [], useAi: false });
    expect(done.status).toBe("partial");
    expect(done.providerStatus.find((s) => s.provider === "broken")!.message).toMatch(/boom/);
    expect(repo.listProspects(event.id)).toHaveLength(1);
  });
});

describe("manual workflows", () => {
  it("parses and dedupes seed brands", () => {
    const seeds = parseSeedBrands("Velvet Hour | velvethour.com\nvelvet hour\nBloomline");
    expect(dedupeCandidates(seeds).map((s) => s.name)).toEqual(["Velvet Hour", "Bloomline"]);
    expect(seeds[0].website).toBe("https://velvethour.com");
  });

  it("manual evidence requires a source and updates the score with attribution", () => {
    const event = sexEdEvent();
    const p = addManualBrand(event.id, { name: "Acme", website: "https://acme.test", description: "" });
    expect(p.score!.total).toBe(0);
    addManualEvidence(
      p.id,
      {
        kind: "sponsorship",
        sourceUrl: "https://festival.test/sponsors",
        sourceTitle: "Our sponsors",
        activityDate: "2026-08-10",
        excerpt: "Acme sponsored a women's pleasure and communication workshop.",
        notes: "",
        contactName: "",
        ad: null,
      },
      NOW,
    );
    const after = repo.getProspect(p.id)!;
    expect(after.score!.total).toBeGreaterThan(0);
    const partnership = after.score!.components.find((c) => c.key === "partnership")!;
    expect(partnership.points).toBeGreaterThan(0);
    const ev = repo.listEvidence(p.id)[0];
    expect(ev.verification).toBe("user_provided");
    expect(partnership.evidenceIds).toContain(ev.id);
  });

  it("only uses a contact name that came from a source", () => {
    const event = sexEdEvent();
    const p = addManualBrand(event.id, { name: "Acme", website: "https://acme.test", description: "" });
    expect(p.outreachDraft).toMatch(/Hi \[Name\]/);
    expect(p.outreachDraft).toMatch(/\[Add a specific, sourced observation/);
    addManualEvidence(p.id, { kind: "contact", sourceUrl: "https://acme.test/team", sourceTitle: "Team", activityDate: null, excerpt: "Jordan Lee, Head of Partnerships", notes: "", contactName: "Jordan Lee", ad: null }, NOW);
    expect(repo.getProspect(p.id)!.outreachDraft).toMatch(/Hi Jordan Lee/);
  });

  it("outreach never invents attendance and stops regenerating once edited", () => {
    const event = sexEdEvent({ expectedAttendance: null });
    const p = addManualBrand(event.id, { name: "Acme", website: "", description: "" });
    expect(p.outreachDraft).not.toMatch(/expecting around/);
    const patch = prospectPatchSchema.parse({ outreachDraft: "My own words" });
    repo.saveProspect({ ...repo.getProspect(p.id)!, ...patch, outreachEdited: true });
    refreshProspect(p.id, NOW);
    expect(repo.getProspect(p.id)!.outreachDraft).toBe("My own words");
  });
});

describe("CSV export", () => {
  it("includes score, rationale, sources, dates, role and notes", async () => {
    const event = sexEdEvent();
    await runResearch(repo.createJob(event.id, "mock").id, { now: NOW });
    const ps = repo.listProspectsWithEvidence(event.id).slice(0, 2);
    repo.saveProspect({ ...repo.getProspect(ps[0].id)!, notes: 'Said "maybe", call back' });
    const csv = prospectsToCsv(repo.listProspectsWithEvidence(event.id, [ps[0].id]));
    const [header] = csv.split("\r\n");
    for (const h of ["Score", "Rationale", "Source URLs", "Activity dates", "Date checked", "Suggested contact role", "Notes", "Mock data"]) {
      expect(header).toContain(h);
    }
    expect(csv).toContain('"Said ""maybe"", call back"');
    expect(csv).toContain("https://");
    expect(csv).toContain("YES - sample data");
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(csvEscape("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
});
