import type {
  AdDetails,
  EventRecord,
  EvidenceFlag,
  EvidenceKind,
  ProviderState,
  ScoreComponentKey,
  Verification,
} from "../types";

/** A brand worth researching. Where it came from is NOT evidence of fit. */
export interface BrandCandidate {
  name: string;
  website: string;
  description: string;
  categories: string[];
  source: "user_seed" | "ai_suggestion" | "mock" | "manual";
  rationale: string;
  isMock: boolean;
}

/** Evidence as a provider returns it, before relevance / flags / scoring. */
export interface RawEvidence {
  kind: EvidenceKind;
  sourceUrl: string;
  sourceTitle: string;
  publisher?: string;
  activityDate: string | null;
  excerpt: string;
  signals: ScoreComponentKey[];
  verification: Verification;
  flags?: EvidenceFlag[];
  interpretation?: string;
  ad?: AdDetails | null;
  contactName?: string | null;
  contactUrl?: string | null;
  /** Stable id from the source (e.g. ad id) used for dedupe. Defaults to the URL. */
  sourceId?: string;
}

export interface ProviderContext {
  event: EventRecord;
  eventTerms: string[];
  now: Date;
  fetchImpl: typeof fetch;
}

export interface ProviderAvailability {
  state: ProviderState;
  message: string;
}

export type ProviderAccess = "official_api" | "public_web" | "manual" | "mock" | "ai";

export interface ProviderInfo {
  id: string;
  label: string;
  access: ProviderAccess;
  /** What the provider covers, and its limits, in plain language. */
  description: string;
  configVars: string[];
}

export interface EvidenceProvider extends ProviderInfo {
  availability(): ProviderAvailability;
  collect(brand: BrandCandidate, ctx: ProviderContext): Promise<RawEvidence[]>;
  /** A link the user can open to check this source by hand. */
  manualCheckUrl?(brand: BrandCandidate): string | null;
}

export interface CandidateProvider extends ProviderInfo {
  availability(): ProviderAvailability;
  discover(ctx: ProviderContext): Promise<BrandCandidate[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "rate_limited" | "error" | "unavailable" | "not_configured",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 12_000, ...rest } = init;
  try {
    return await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`Request failed: ${msg}`, "error");
  }
}

export const USER_AGENT = "SponsorSignalsBot/0.1 (sponsorship research; respects robots.txt)";
