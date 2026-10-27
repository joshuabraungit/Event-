import { isEligible } from "./scoring";
import { STATUS_LABELS, type ProspectWithEvidence } from "./types";

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Guard against spreadsheet formula injection from scraped text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_HEADERS = [
  "Brand",
  "Website",
  "Mock data",
  "Score",
  "Audience fit (/35)",
  "Message alignment (/20)",
  "Advertising (/15)",
  "Partnerships (/20)",
  "Recency (/10)",
  "Confidence",
  "Rationale",
  "Score breakdown",
  "Suggested sponsorship",
  "Suggested contact role",
  "Verified contact",
  "Status",
  "Saved",
  "Notes",
  "Source URLs",
  "Source titles",
  "Activity dates",
  "Date checked",
  "Missing information",
];

export function prospectsToCsv(prospects: ProspectWithEvidence[]): string {
  const rows = prospects.map((p) => {
    const comp = (k: string) => p.score?.components.find((c) => c.key === k)?.points ?? "";
    const sources = p.evidence.filter((e) => e.sourceUrl);
    const contact = p.evidence.find((e) => e.kind === "contact" && isEligible(e));
    return [
      p.name,
      p.website,
      p.isMock ? "YES - sample data, not a real finding" : "no",
      p.score?.total ?? "",
      comp("audience"),
      comp("message"),
      comp("advertising"),
      comp("partnership"),
      comp("recency"),
      p.score?.confidence ?? "",
      p.fitSummary,
      p.score?.components.map((c) => `${c.label}: ${c.points}/${c.max} - ${c.explanation}`).join(" | ") ?? "",
      p.suggestedSponsorship.join("; "),
      p.suggestedContactRole,
      contact ? [contact.contactName, contact.contactUrl, contact.sourceUrl].filter(Boolean).join(" ") : "",
      STATUS_LABELS[p.status],
      p.saved ? "yes" : "no",
      p.notes,
      sources.map((e) => e.sourceUrl).join(" \n"),
      sources.map((e) => e.sourceTitle).join(" \n"),
      sources.map((e) => e.activityDate ?? "unknown").join(" \n"),
      sources.map((e) => e.checkedAt.slice(0, 10)).join(" \n"),
      p.score?.missingInfo.join("; ") ?? "",
    ];
  });
  return [CSV_HEADERS, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
