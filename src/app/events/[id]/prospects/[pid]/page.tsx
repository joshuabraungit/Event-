import Link from "next/link";
import { notFound } from "next/navigation";
import ManualEvidenceForm from "@/components/ManualEvidenceForm";
import { EvidenceActions, OutreachEditor, ProspectActions } from "@/components/ProspectControls";
import { ConfidenceBadge, FlagBadges, formatDate, MockBadge, ScoreBadge, SourceLink, StatusBadge } from "@/components/ui";
import { creativeCenterLink } from "@/lib/providers/manual-sources";
import { manualCheckLinks } from "@/lib/providers/registry";
import * as repo from "@/lib/repo";
import { ineligibilityReason, isEligible } from "@/lib/scoring";
import { daysBetween } from "@/lib/text";
import { EVIDENCE_KIND_LABELS, type EvidenceKind, type EvidenceRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

const VERIFICATION_TEXT: Record<EvidenceRecord["verification"], string> = {
  verified_source: "Retrieved from source",
  user_provided: "Added by you",
  unverified: "Unverified",
  mock: "MOCK sample",
};

const UGC_TEXT = { likely: "Likely creator-led / UGC-style", possible: "Possibly creator-led / UGC-style", unlikely: "Probably not UGC-style", unknown: "Can't tell" };

function EvidenceCard({ e }: { e: EvidenceRecord }) {
  const excluded = ineligibilityReason(e);
  return (
    <div className={`evidence${excluded ? " excluded" : ""}`} id={e.id}>
      <div className="row spread" style={{ gap: "0.4rem" }}>
        <div className="row" style={{ gap: "0.4rem" }}>
          <span className="badge accent">{EVIDENCE_KIND_LABELS[e.kind]}</span>
          <span className={`badge ${e.verification === "mock" ? "mock" : e.verification === "unverified" ? "bad" : ""}`}>{VERIFICATION_TEXT[e.verification]}</span>
          <FlagBadges flags={e.flags} />
        </div>
        <small>relevance {Math.round(e.relevance * 100)}%</small>
      </div>
      <div style={{ marginTop: "0.4rem", fontWeight: 600 }}>
        <SourceLink href={e.sourceUrl}>{e.sourceTitle || e.sourceUrl}</SourceLink>
      </div>
      <dl className="kv">
        <dt>Publisher</dt>
        <dd>{e.publisher || "unknown"}</dd>
        <dt>Activity date</dt>
        <dd>{e.activityDate ? formatDate(e.activityDate) : "unknown"}</dd>
        <dt>Checked</dt>
        <dd>{formatDate(e.checkedAt)}</dd>
      </dl>
      {e.ad && (
        <dl className="kv">
          <dt>Platform</dt>
          <dd>{e.ad.platform}</dd>
          <dt>Advertiser</dt>
          <dd>{e.ad.advertiser}</dd>
          <dt>Ad link</dt>
          <dd>
            {e.ad.adUrl ? <SourceLink href={e.ad.adUrl}>Open this ad</SourceLink> : "No stable direct link"}
            {e.ad.libraryUrl && (
              <>
                {" · "}
                <SourceLink href={e.ad.libraryUrl}>Advertiser&apos;s ad library page</SourceLink>
              </>
            )}
          </dd>
          <dt>Status</dt>
          <dd>
            {e.ad.activeStatus === "unknown" ? "Unknown" : `Observed ${e.ad.activeStatus}`}
            {e.ad.activeStatusCheckedAt ? ` (checked ${formatDate(e.ad.activeStatusCheckedAt)})` : ""}
          </dd>
          <dt>Format</dt>
          <dd>{e.ad.format}</dd>
        </dl>
      )}
      <div className="fact">
        <span className="label">{e.ad ? "Ad text (fact)" : "What the source says (fact)"}</span>
        {e.excerpt || <span className="muted">No text captured.</span>}
      </div>
      <div className="interp">
        <span className="label">Interpretation ({e.interpretedBy === "ai" ? "AI" : e.interpretedBy === "user" ? "yours" : "keyword match"})</span>
        {e.interpretation}
        {e.matchedTerms.length > 0 && <div className="muted">Matched event themes: {e.matchedTerms.join(", ")}</div>}
      </div>
      {e.ad && (
        <div className="interp">
          <span className="label">Creator / UGC-style read (interpretation)</span>
          <b>{UGC_TEXT[e.ad.ugcStyle]}</b> · {e.ad.ugcConfidence} confidence. {e.ad.ugcBasis}
        </div>
      )}
      {e.kind === "contact" && e.contactUrl && (
        <div>
          Contact: {e.contactName ? `${e.contactName} · ` : ""}
          <SourceLink href={e.contactUrl}>{e.contactUrl.replace(/^mailto:/, "")}</SourceLink>
        </div>
      )}
      {excluded && <div className="alert warn" style={{ margin: "0.4rem 0 0" }}>{excluded}</div>}
      {e.verification !== "mock" && <EvidenceActions id={e.id} flags={e.flags} userProvided={e.verification === "user_provided"} />}
    </div>
  );
}

function Section({ title, items, empty }: { title: string; items: EvidenceRecord[]; empty: string }) {
  return (
    <section className="card">
      <h2>
        {title} <small>({items.length})</small>
      </h2>
      {items.length ? items.map((e) => <EvidenceCard key={e.id} e={e} />) : <p className="muted">{empty}</p>}
    </section>
  );
}

const byDateDesc = (a: EvidenceRecord, b: EvidenceRecord) => (b.activityDate ?? "").localeCompare(a.activityDate ?? "");
const ofKind = (ev: EvidenceRecord[], kinds: EvidenceKind[]) => ev.filter((e) => kinds.includes(e.kind)).sort(byDateDesc);

export default async function ProspectPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const event = repo.getEvent(id);
  const prospect = repo.getProspect(pid);
  if (!event || !prospect || prospect.eventId !== event.id) notFound();
  const evidence = repo.listEvidence(prospect.id);
  const score = prospect.score;
  const contact = evidence.find((e) => e.kind === "contact" && isEligible(e));
  const checked = prospect.checkedSources.length ? prospect.checkedSources.join(", ") : "none yet";
  const now = new Date();
  const recent = evidence
    .filter((e) => e.activityDate && daysBetween(e.activityDate, now) <= 365 && e.relevance >= 0.3)
    .sort(byDateDesc);
  const ads = ofKind(evidence, ["ad"]);
  const creator = evidence.filter((e) => e.kind === "creator_content" || (e.ad && (e.ad.ugcStyle === "likely" || e.ad.ugcStyle === "possible")));
  const partnerships = ofKind(evidence, ["sponsorship", "partnership", "partnership_page"]);
  const profile = ofKind(evidence, ["brand_profile", "product"]);
  const other = ofKind(evidence, ["press", "news", "contact", "other"]);

  return (
    <>
      <p>
        <Link href={`/events/${event.id}`}>← {event.name}</Link>
      </p>
      {prospect.isMock && (
        <div className="mock-banner">
          <b>Mock data.</b> {prospect.name} is a fictional brand and everything on this page is sample data for testing the workflow. None of it is a real finding.
        </div>
      )}

      <section className="card">
        <div className="row" style={{ alignItems: "flex-start", gap: "1rem" }}>
          <ScoreBadge score={score?.total} big />
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div className="row" style={{ gap: "0.5rem" }}>
              <h1 style={{ margin: 0 }}>{prospect.name}</h1>
              {prospect.isMock && <MockBadge />}
              <StatusBadge status={prospect.status} />
              <ConfidenceBadge confidence={score?.confidence} />
            </div>
            <p className="muted" style={{ margin: "0.25rem 0" }}>
              {prospect.website ? <SourceLink href={prospect.website}>{prospect.website.replace(/^https?:\/\//, "")}</SourceLink> : "Website unknown"}
              {prospect.categories.length ? ` · ${prospect.categories.join(", ")}` : ""}
            </p>
            {prospect.description && <p>{prospect.description}</p>}
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Why it was considered: {prospect.candidateRationale || "n/a"} · Sources checked: {checked}
              {prospect.lastResearchedAt ? ` · Last researched ${formatDate(prospect.lastResearchedAt)}` : ""}
            </p>
          </div>
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Score breakdown</h2>
          {score ? (
            <>
              {score.components.map((c) => (
                <div key={c.key} className="component">
                  <div className="head">
                    <span>{c.label}</span>
                    <span>
                      {c.points} / {c.max}
                    </span>
                  </div>
                  <div className="bar" style={{ margin: "0.3rem 0" }}>
                    <span style={{ width: `${(c.points / c.max) * 100}%` }} />
                  </div>
                  <small>{c.explanation}</small>
                  {c.evidenceIds.length > 0 && (
                    <div style={{ fontSize: "0.8rem" }}>
                      Evidence:{" "}
                      {c.evidenceIds.map((eid, i) => (
                        <a key={eid} href={`#${eid}`}>
                          [{i + 1}]{" "}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                Confidence: {score.confidence}. {score.confidenceReason}
              </p>
            </>
          ) : (
            <p className="muted">Not scored yet.</p>
          )}
        </section>

        <section className="card">
          <h2>Why it might fit</h2>
          <p>
            {prospect.fitSummary || "No summary yet."} <small>({prospect.fitSummaryBy === "ai" ? "AI interpretation" : "generated from the score"})</small>
          </p>
          {prospect.relevantProducts.length > 0 && (
            <>
              <h3>Relevant products or services</h3>
              <ul>
                {prospect.relevantProducts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Suggested sponsorship</h3>
          <ul>
            {prospect.suggestedSponsorship.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Who to contact</h3>
          {contact ? (
            <p>
              Verified public contact: {contact.contactName ? <b>{contact.contactName}</b> : null}{" "}
              {contact.contactUrl && <SourceLink href={contact.contactUrl}>{contact.contactUrl.replace(/^mailto:/, "")}</SourceLink>} (from{" "}
              <SourceLink href={contact.sourceUrl}>{contact.sourceTitle || "source"}</SourceLink>)
            </p>
          ) : (
            <p className="muted">No verified public contact found.</p>
          )}
          <p>
            Suggested role: <b>{prospect.suggestedContactRole}</b> <small>(a suggestion, not a known person)</small>
          </p>
          {score && score.missingInfo.length > 0 && (
            <>
              <h3>Missing information</h3>
              <ul className="muted">
                {score.missingInfo.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Organize</h2>
          <ProspectActions prospect={prospect} />
        </section>
        <section className="card">
          <h2>Outreach draft</h2>
          <OutreachEditor prospect={prospect} />
        </section>
      </div>

      <Section title="Advertising" items={ads} empty={`No ads found in the sources checked (${checked}). Ad libraries only cover some regions and ads, so this doesn't mean the brand doesn't advertise.`} />
      {creator.length > 0 && (
        <section className="card">
          <h2>Creator or UGC-style content ({creator.length})</h2>
          <p className="muted">
            These look creator-led or UGC-style based on text cues. That&apos;s an interpretation of style: it doesn&apos;t tell us whether the person is a customer, a paid creator, or an actor.
          </p>
          <ul>
            {creator.map((e) => (
              <li key={e.id}>
                <a href={`#${e.id}`}>{e.sourceTitle}</a> ({e.ad ? UGC_TEXT[e.ad.ugcStyle].toLowerCase() : "creator content"})
              </li>
            ))}
          </ul>
        </section>
      )}
      <Section title="Partnerships and sponsorships" items={partnerships} empty={`No past partnerships or sponsorships found in the sources checked (${checked}). That doesn't mean none exist.`} />
      <section className="card">
        <h2>Recent relevant activity</h2>
        {recent.length ? (
          <ul>
            {recent.map((e) => (
              <li key={e.id}>
                {formatDate(e.activityDate)}: <a href={`#${e.id}`}>{e.sourceTitle}</a> <small>({EVIDENCE_KIND_LABELS[e.kind]})</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No relevant activity with a known date in the last 12 months.</p>
        )}
      </section>
      <Section title="Brand and products" items={profile} empty="No brand or product pages captured yet." />
      <Section title="Other sources and contacts" items={other} empty="None." />
      <ManualEvidenceForm
        prospectId={prospect.id}
        links={[
          ...manualCheckLinks(prospect),
          { id: "cc", label: "TikTok Creative Center: Top Ads", url: creativeCenterLink, note: "Curated selection, not a full list" },
        ]}
      />
    </>
  );
}
