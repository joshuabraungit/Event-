import Link from "next/link";
import * as repo from "@/lib/repo";
import { formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const events = repo.listEvents();
  return (
    <>
      <div className="row spread" style={{ marginBottom: "1rem" }}>
        <div>
          <h1>Your events</h1>
          <p className="muted">Describe an event, then find brands that may fit, with the evidence behind each one.</p>
        </div>
        <Link href="/events/new" className="btn primary">
          + New event
        </Link>
      </div>
      {events.length === 0 ? (
        <div className="card empty">
          <p>No events yet.</p>
          <Link href="/events/new" className="btn primary">
            Create your first event
          </Link>
        </div>
      ) : (
        events.map((e) => {
          const count = repo.listProspects(e.id).filter((p) => !p.dismissed).length;
          const job = repo.latestJob(e.id);
          return (
            <Link key={e.id} href={`/events/${e.id}`} className="card" style={{ display: "block", color: "inherit" }}>
              <div className="row spread">
                <h2 style={{ margin: 0 }}>{e.name}</h2>
                <span className="badge">{count} prospect{count === 1 ? "" : "s"}</span>
              </div>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                {e.location}
                {e.startDate ? ` · ${formatDate(e.startDate)}` : ""}
                {job ? ` · last research ${formatDate(job.createdAt)} (${job.mode})` : " · not researched yet"}
              </p>
            </Link>
          );
        })
      )}
    </>
  );
}
