import type { Confidence, EvidenceFlag, ProspectStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

export function ScoreBadge({ score, big }: { score: number | null | undefined; big?: boolean }) {
  const s = score ?? 0;
  const tone = s >= 65 ? "hi" : s >= 35 ? "mid" : "lo";
  return (
    <span className={`score ${tone}${big ? " big" : ""}`} aria-label={`Fit score ${s} out of 100`}>
      {score ?? "–"}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence | undefined }) {
  if (!confidence) return null;
  const tone = confidence === "high" ? "good" : confidence === "medium" ? "warn" : "";
  return <span className={`badge ${tone}`}>{confidence} confidence</span>;
}

export function MockBadge() {
  return <span className="badge mock" title="Sample data for testing. Not a real finding.">MOCK DATA</span>;
}

export function StatusBadge({ status }: { status: ProspectStatus }) {
  const tone = status === "interested" || status === "in_conversation" ? "good" : status === "not_a_fit" ? "bad" : status === "contacted" ? "accent" : "";
  return <span className={`badge ${tone}`}>{STATUS_LABELS[status]}</span>;
}

const FLAG_TEXT: Record<EvidenceFlag, { label: string; tone: string; title: string }> = {
  stale: { label: "Stale", tone: "warn", title: "Activity is more than 18 months old." },
  weak: { label: "Weak match", tone: "", title: "Little overlap with the event's themes." },
  conflicting: { label: "Conflicting", tone: "bad", title: "Marked as conflicting with other evidence. Excluded from scoring." },
  inaccessible: { label: "Inaccessible", tone: "bad", title: "We couldn't read this source. Excluded from scoring." },
  third_party: { label: "Third-party", tone: "", title: "Not the brand's own site or an ad library. Weighted a bit lower." },
  date_unknown: { label: "Date unknown", tone: "", title: "No reliable activity date found." },
};

export function FlagBadges({ flags }: { flags: EvidenceFlag[] }) {
  return (
    <>
      {flags.map((f) => (
        <span key={f} className={`badge ${FLAG_TEXT[f].tone}`} title={FLAG_TEXT[f].title}>
          {FLAG_TEXT[f].label}
        </span>
      ))}
    </>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Opens external sources in a new tab. Only http(s) links are rendered as links. */
export function SourceLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  let ok = false;
  try {
    const u = new URL(href ?? "");
    ok = u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    ok = false;
  }
  if (!ok) return <span className="muted">{children} (no link)</span>;
  return (
    <a href={href!} target="_blank" rel="noreferrer noopener" className="breakall">
      {children}
    </a>
  );
}
