import { aiCandidateProvider } from "../ai";
import { brandWebsiteProvider } from "./brand-website";
import { googleAdsTransparencyProvider, tiktokProvider } from "./manual-sources";
import { metaAdLibraryProvider } from "./meta-ad-library";
import { mockCandidateProvider, mockEvidenceProvider } from "./mock";
import type { CandidateProvider, EvidenceProvider, ProviderAvailability, ProviderInfo } from "./types";
import { webSearchProvider } from "./web-search";

/** Live evidence providers, in the order they run. Add new sources here. */
export const LIVE_EVIDENCE_PROVIDERS: EvidenceProvider[] = [
  brandWebsiteProvider,
  webSearchProvider,
  metaAdLibraryProvider,
  googleAdsTransparencyProvider,
  tiktokProvider,
];

export const LIVE_CANDIDATE_PROVIDERS: CandidateProvider[] = [aiCandidateProvider];

export const MOCK_EVIDENCE_PROVIDERS: EvidenceProvider[] = [mockEvidenceProvider];
export const MOCK_CANDIDATE_PROVIDERS: CandidateProvider[] = [mockCandidateProvider];

export interface ProviderSummary extends ProviderInfo, ProviderAvailability {
  role: "candidates" | "evidence";
  mode: "live" | "mock";
}

function summarize(p: CandidateProvider | EvidenceProvider, role: ProviderSummary["role"], mode: ProviderSummary["mode"]): ProviderSummary {
  const { id, label, access, description, configVars } = p;
  return { id, label, access, description, configVars, role, mode, ...p.availability() };
}

/** Safe to send to the browser: names and states only, never secret values. */
export function providerSummaries(): ProviderSummary[] {
  return [
    ...LIVE_CANDIDATE_PROVIDERS.map((p) => summarize(p, "candidates", "live")),
    ...LIVE_EVIDENCE_PROVIDERS.map((p) => summarize(p, "evidence", "live")),
    ...MOCK_CANDIDATE_PROVIDERS.map((p) => summarize(p, "candidates", "mock")),
    ...MOCK_EVIDENCE_PROVIDERS.map((p) => summarize(p, "evidence", "mock")),
  ];
}

export function manualCheckLinks(brand: { name: string; website: string }): { id: string; label: string; url: string; note: string }[] {
  const b = { ...brand, description: "", categories: [], source: "manual" as const, rationale: "", isMock: false };
  return LIVE_EVIDENCE_PROVIDERS.flatMap((p) => {
    const url = p.manualCheckUrl?.(b);
    if (!url) return [];
    const st = p.availability();
    return [{ id: p.id, label: p.label, url, note: st.state === "ok" ? "Also checked automatically" : st.message }];
  });
}
