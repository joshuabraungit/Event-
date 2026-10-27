import { z } from "zod";
import { EVIDENCE_KINDS, PROSPECT_STATUSES, SPONSORSHIP_TYPES } from "./types";
import { isHttpUrl } from "./text";

const optionalDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD");

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .default("")
  .refine((v) => v === "" || isHttpUrl(v), "Must be a full http(s) URL");

export const eventInputSchema = z
  .object({
    name: z.string().trim().min(2, "Event name is required").max(200),
    description: z.string().trim().min(10, "Describe the event in at least a sentence").max(5000),
    startDate: optionalDate,
    endDate: optionalDate,
    location: z.string().trim().min(1, "City, region, or Online is required").max(200),
    audience: z.string().trim().min(3, "Describe the audience").max(2000),
    expectedAttendance: z
      .union([z.number(), z.string()])
      .optional()
      .nullable()
      .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 10_000_000), "Enter a whole number"),
    demographics: z.string().trim().max(2000).optional().default(""),
    website: optionalUrl,
    sponsorshipTypes: z.array(z.enum(SPONSORSHIP_TYPES)).optional().default([]),
    avoid: z.string().trim().max(2000).optional().default(""),
    notes: z.string().trim().max(5000).optional().default(""),
    seedBrands: z.string().trim().max(5000).optional().default(""),
  })
  .refine((e) => !e.startDate || !e.endDate || e.endDate >= e.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export type EventInput = z.infer<typeof eventInputSchema>;

export const prospectPatchSchema = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
  saved: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  notes: z.string().max(10_000).optional(),
  outreachDraft: z.string().max(10_000).optional(),
});

export const addBrandSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optionalUrl,
  description: z.string().trim().max(2000).optional().default(""),
});

export const manualEvidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  sourceUrl: z.string().trim().refine(isHttpUrl, "A source link (http/https) is required for evidence"),
  sourceTitle: z.string().trim().min(1, "Add the page title").max(500),
  activityDate: optionalDate,
  excerpt: z.string().trim().min(3, "Quote or describe what the source shows").max(5000),
  notes: z.string().trim().max(5000).optional().default(""),
  contactName: z.string().trim().max(200).optional().default(""),
  ad: z
    .object({
      platform: z.string().trim().max(100).default(""),
      adUrl: optionalUrl,
      libraryUrl: optionalUrl,
      activeStatus: z.enum(["active", "inactive", "unknown"]).default("unknown"),
      format: z.string().trim().max(100).default("unknown"),
      ugcStyle: z.enum(["likely", "possible", "unlikely", "unknown"]).default("unknown"),
      ugcBasis: z.string().trim().max(1000).default(""),
    })
    .optional()
    .nullable(),
});

export const evidencePatchSchema = z.object({
  flags: z.array(z.enum(["conflicting", "inaccessible"])).optional(),
});

export function formatZodError(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
