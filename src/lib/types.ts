// Shared domain types. Keep facts (what a source says) separate from
// interpretation (what we or an AI model think it means).

export const SPONSORSHIP_TYPES = ["cash", "product", "speakers", "experiences", "other"] as const;
export type SponsorshipType = (typeof SPONSORSHIP_TYPES)[number];

export const PROSPECT_STATUSES = [
  "to_review",
  "interested",
  "contacted",
  "in_conversation",
  "not_a_fit",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  to_review: "To review",
  interested: "Interested",
  contacted: "Contacted",
  in_conversation: "In conversation",
  not_a_fit: "Not a fit",
};

export interface EventRecord {
  id: string;
  name: string;
  description: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  location: string; // city, region, or "Online"
  audience: string;
  expectedAttendance: number | null;
  demographics: string;
  website: string;
  sponsorshipTypes: SponsorshipType[];
  avoid: string; // comma or newline separated categories / brands
  notes: string;
  seedBrands: string; // optional brands to research, one per line ("Name" or "Name | domain")
  createdAt: string;
  updatedAt: string;
}

export const EVIDENCE_KINDS = [
  "brand_profile", // what the brand says about itself (homepage, about page)
  "product", // a relevant product or service
  "ad", // an ad found in an ad library
  "creator_content", // creator / UGC-style content outside an ad library
  "sponsorship", // brand sponsored an event, podcast, community, newsletter
  "partnership", // brand partnered with creators, educators, organizations
  "partnership_page", // public partnerships / sponsorship contact page
  "press", // press release or announcement from the brand
  "news", // third-party article
  "contact", // public contact (name, email, form) found on a source page
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  brand_profile: "Brand profile",
  product: "Product / service",
  ad: "Ad",
  creator_content: "Creator / UGC-style content",
  sponsorship: "Sponsorship",
  partnership: "Partnership",
  partnership_page: "Partnerships page",
  press: "Press / announcement",
  news: "News / article",
  contact: "Public contact",
  other: "Other",
};

export type ScoreComponentKey = "audience" | "message" | "advertising" | "partnership" | "recency";

/**
 * How we know the evidence exists.
 * - verified_source: retrieved by a provider directly from the cited URL/API
 * - user_provided: entered by the user with a source link
 * - unverified: a claim without a usable source (never earns points)
 * - mock: generated sample data (never a real finding)
 */
export type Verification = "verified_source" | "user_provided" | "unverified" | "mock";

export type EvidenceFlag = "stale" | "weak" | "conflicting" | "inaccessible" | "third_party" | "date_unknown";

export type UgcStyle = "likely" | "possible" | "unlikely" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface AdDetails {
  platform: string; // e.g. "Facebook", "Instagram", "Google", "TikTok"
  advertiser: string;
  adUrl: string | null; // direct link to the specific ad, if stable
  libraryUrl: string | null; // advertiser's ad-library page when a direct link is unavailable
  activeStatus: "active" | "inactive" | "unknown";
  activeStatusCheckedAt: string | null;
  adText: string;
  format: string; // "video", "image", "carousel", "unknown"...
  ugcStyle: UgcStyle; // an INTERPRETATION, never a claim about who the person is
  ugcConfidence: Confidence;
  ugcBasis: string;
}

export interface EvidenceRecord {
  id: string;
  prospectId: string;
  kind: EvidenceKind;
  provider: string;
  sourceUrl: string;
  sourceTitle: string;
  publisher: string; // hostname or outlet
  activityDate: string | null; // when the underlying activity happened (YYYY-MM-DD)
  checkedAt: string; // when we looked at it (ISO)
  excerpt: string; // FACT: text taken from the source
  interpretation: string; // INTERPRETATION: why it might matter
  interpretedBy: "heuristic" | "ai" | "user";
  signals: ScoreComponentKey[];
  relevance: number; // 0..1, relevance to this event
  matchedTerms: string[];
  verification: Verification;
  flags: EvidenceFlag[];
  ad: AdDetails | null;
  contactName: string | null;
  contactUrl: string | null;
  dedupeKey: string;
  createdAt: string;
}

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  points: number;
  max: number;
  explanation: string;
  evidenceIds: string[];
  missing: boolean;
}

export interface ScoreResult {
  total: number;
  components: ScoreComponent[];
  confidence: Confidence;
  confidenceReason: string;
  missingInfo: string[];
}

export interface ProspectRecord {
  id: string;
  eventId: string;
  brandKey: string;
  name: string;
  website: string;
  description: string;
  categories: string[];
  candidateSource: "user_seed" | "ai_suggestion" | "mock" | "manual";
  candidateRationale: string; // why this brand was considered (not evidence)
  isMock: boolean;
  score: ScoreResult | null;
  fitSummary: string;
  fitSummaryBy: "rules" | "ai";
  relevantProducts: string[];
  suggestedSponsorship: string[];
  suggestedContactRole: string;
  outreachDraft: string;
  outreachEdited: boolean; // true once the user edits the draft; we stop regenerating it
  checkedSources: string[]; // providers that ran for this brand, for honest "not found" wording
  status: ProspectStatus;
  saved: boolean;
  dismissed: boolean;
  notes: string;
  lastResearchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectWithEvidence extends ProspectRecord {
  evidence: EvidenceRecord[];
}

export type ProviderState = "ok" | "unavailable" | "not_configured" | "error" | "rate_limited" | "skipped" | "manual";

export interface ProviderRunStatus {
  provider: string;
  label: string;
  state: ProviderState;
  message: string;
  itemsFound: number;
}

export type JobStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export interface ResearchJob {
  id: string;
  eventId: string;
  mode: "mock" | "live";
  status: JobStatus;
  progress: number;
  stage: string;
  providerStatus: ProviderRunStatus[];
  log: string[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
