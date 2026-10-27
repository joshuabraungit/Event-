import Link from "next/link";
import { notFound } from "next/navigation";
import ProspectList from "@/components/ProspectList";
import ResearchPanel from "@/components/ResearchPanel";
import DeleteEventButton from "@/components/DeleteEventButton";
import { formatDate } from "@/components/ui";
import { providerSummaries } from "@/lib/providers/registry";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = repo.getEvent((await params).id);
  if (!event) notFound();
  const prospects = repo.listProspects(event.id);
  const job = repo.latestJob(event.id);
  const when = event.startDate
    ? event.endDate && event.endDate !== event.startDate
      ? `${formatDate(event.startDate)} to ${formatDate(event.endDate)}`
      : formatDate(event.startDate)
    : "Date not set";

  return (
    <>
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 400px" }}>
          <h1>{event.name}</h1>
          <p className="muted">
            {event.location} · {when}
            {event.expectedAttendance ? ` · ~${event.expectedAttendance} attendees` : ""}
            {event.website && (
              <>
                {" · "}
                <a href={event.website} target="_blank" rel="noreferrer">
                  website
                </a>
              </>
            )}
          </p>
        </div>
        <div className="row">
          <Link className="btn" href={`/events/${event.id}/edit`}>
            Edit event
          </Link>
          <DeleteEventButton id={event.id} />
        </div>
      </div>
      <details className="card">
        <summary>
          <b>Event details</b>
        </summary>
        <dl className="kv" style={{ marginTop: "0.75rem" }}>
          <dt>Description</dt>
          <dd>{event.description}</dd>
          <dt>Audience</dt>
          <dd>{event.audience}</dd>
          {event.demographics && (
            <>
              <dt>Demographics</dt>
              <dd>{event.demographics}</dd>
            </>
          )}
          <dt>Opportunities</dt>
          <dd>{event.sponsorshipTypes.join(", ") || "Not specified"}</dd>
          <dt>Avoid</dt>
          <dd>{event.avoid || "Nothing listed"}</dd>
          <dt>Brands to consider</dt>
          <dd style={{ whiteSpace: "pre-line" }}>{event.seedBrands || "None listed"}</dd>
          {event.notes && (
            <>
              <dt>Notes</dt>
              <dd style={{ whiteSpace: "pre-line" }}>{event.notes}</dd>
            </>
          )}
        </dl>
      </details>
      <ResearchPanel eventId={event.id} initialJob={job} providers={providerSummaries()} hasSeeds={Boolean(event.seedBrands.trim())} />
      <ProspectList eventId={event.id} initial={prospects} />
    </>
  );
}
