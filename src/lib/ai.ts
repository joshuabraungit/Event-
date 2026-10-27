import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { EventRecord, EvidenceRecord, ScoreComponentKey, UgcStyle } from "./types";
import type { BrandCandidate, CandidateProvider, ProviderContext } from "./providers/types";
import { ProviderError } from "./providers/types";
import { splitList } from "./text";

/**
 * Optional Claude integration. Two jobs:
 * 1. Suggest brands to research (labeled "AI suggestion"; earns no points).
 * 2. Interpret evidence we already retrieved: relevance, which score
 *    components it supports, and a UGC-style read for ads. It may only refer
 *    to evidence ids we gave it, and can't add facts or sources.
 */

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

async function structured<T extends z.ZodType>(schema: T, system: string, user: string, maxTokens = 8000): Promise<z.infer<T>> {
  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      // Sensitive event topics (e.g. sex education) can trip safety classifiers;
      // let the API retry a declined request on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new ProviderError("The AI model declined this request.", "error");
    if (!response.parsed_output) throw new ProviderError("The AI response couldn't be parsed.", "error");
    return response.parsed_output as z.infer<T>;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Claude API rate limit reached. Try again shortly.", "rate_limited");
    if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("ANTHROPIC_API_KEY was rejected.", "error");
    if (err instanceof Anthropic.APIError) throw new ProviderError(`Claude API error: ${err.message}`, "error");
    throw new ProviderError(`Claude request failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function describeEvent(event: EventRecord): string {
  return [
    `Event: ${event.name}`,
    `Description: ${event.description}`,
    `Audience: ${event.audience}`,
    event.demographics && `Demographics: ${event.demographics}`,
    `Location: ${event.location}`,
    event.sponsorshipTypes.length && `Sponsorship opportunities: ${event.sponsorshipTypes.join(", ")}`,
    event.avoid && `Do NOT suggest these categories or brands: ${splitList(event.avoid).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CandidateSchema = z.object({
  brands: z.array(
    z.object({
      name: z.string(),
      website: z.string().describe("Official website domain, e.g. example.com. Empty string if unsure."),
      categories: z.array(z.string()),
      description: z.string().describe("One sentence on what the brand sells."),
      rationale: z.string().describe("Why it might fit this event's audience. A hypothesis, not a fact."),
    }),
  ),
});

export const aiCandidateProvider: CandidateProvider = {
  id: "ai_candidates",
  label: "Claude brand suggestions",
  access: "ai",
  description:
    "Suggests real brands to research based on the event description. Suggestions are hypotheses: they only earn points once sources back them up.",
  configVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
  availability: () =>
    aiConfigured()
      ? { state: "ok", message: "Configured." }
      : { state: "not_configured", message: "Set ANTHROPIC_API_KEY to get AI brand suggestions. You can still list brands yourself." },
  async discover(ctx: ProviderContext): Promise<BrandCandidate[]> {
    const result = await structured(
      CandidateSchema,
      "You help event organizers find brands that might sponsor their events. Suggest real, currently operating brands whose customers overlap with the event audience. Include a mix of well-known and smaller, mission-aligned brands. Never invent brands. If unsure of a website, leave it empty. Respect the avoid list.",
      `${describeEvent(ctx.event)}\n\nSuggest up to 12 brands to research.`,
    );
    return result.brands.slice(0, 12).map((b) => ({
      name: b.name.trim(),
      website: b.website ? (b.website.startsWith("http") ? b.website : `https://${b.website}`) : "",
      description: b.description,
      categories: b.categories,
      source: "ai_suggestion" as const,
      rationale: `AI suggestion (not evidence): ${b.rationale}`,
      isMock: false,
    }));
  },
};

const SIGNALS = ["audience", "message", "advertising", "partnership"] as const;

const InterpretSchema = z.object({
  evidence: z.array(
    z.object({
      id: z.string(),
      relevance: z.number().describe("0 to 1: how directly this source relates to THIS event's audience and themes."),
      signals: z.array(z.enum(SIGNALS)),
      interpretation: z.string().describe("One or two sentences. Interpretation only; don't restate as fact anything the excerpt doesn't say."),
      ugcStyle: z.enum(["likely", "possible", "unlikely", "unknown"]).describe("For ads only: does it LOOK creator-led/UGC-style? Use unknown for non-ads."),
      ugcBasis: z.string().describe("For ads: the textual cues. Never claim the person is a customer, paid creator or actor."),
    }),
  ),
  fitSummary: z.string().describe("2-3 sentences on why this brand might fit, citing evidence ids in [brackets]."),
  relevantProducts: z.array(z.string()).describe("Products or services named in the evidence that relate to the event."),
});

export interface AiInterpretation {
  byId: Map<string, { relevance: number; signals: ScoreComponentKey[]; interpretation: string; ugcStyle: UgcStyle; ugcBasis: string }>;
  fitSummary: string;
  relevantProducts: string[];
}

export async function interpretEvidence(
  event: EventRecord,
  brand: { name: string; website: string },
  evidence: EvidenceRecord[],
): Promise<AiInterpretation> {
  const facts = evidence
    .map((e) => `[${e.id}] kind=${e.kind}; source="${e.sourceTitle}" (${e.sourceUrl}); activity date=${e.activityDate ?? "unknown"}; excerpt: ${e.excerpt}`)
    .join("\n");
  const result = await structured(
    InterpretSchema,
    "You assess evidence about a brand for an event organizer. Use ONLY the excerpts provided. Don't add facts, numbers, people or sources. Advertising doesn't imply sponsorship budget or interest. A creator-looking ad doesn't prove who the person is. Keep interpretation separate from fact.",
    `${describeEvent(event)}\n\nBrand: ${brand.name} (${brand.website || "website unknown"})\n\nEvidence:\n${facts}\n\nReturn one entry per evidence id.`,
  );
  const ids = new Set(evidence.map((e) => e.id));
  const byId: AiInterpretation["byId"] = new Map();
  for (const item of result.evidence) {
    if (!ids.has(item.id)) continue; // ignore anything the model made up
    byId.set(item.id, {
      relevance: Math.max(0, Math.min(1, item.relevance)),
      signals: item.signals,
      interpretation: item.interpretation,
      ugcStyle: item.ugcStyle,
      ugcBasis: item.ugcBasis,
    });
  }
  // Drop summary citations to ids that don't exist.
  const fitSummary = result.fitSummary.replace(/\[([^\]]+)\]/g, (m, id: string) => (ids.has(id) ? m : ""));
  return { byId, fitSummary, relevantProducts: result.relevantProducts.slice(0, 6) };
}
