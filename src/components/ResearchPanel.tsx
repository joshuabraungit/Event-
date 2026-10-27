"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ResearchJob } from "@/lib/types";
import type { ProviderSummary } from "@/lib/providers/registry";

const STATE_TONE: Record<string, string> = {
  ok: "good",
  manual: "",
  not_configured: "",
  unavailable: "warn",
  skipped: "",
  error: "bad",
  rate_limited: "warn",
};

const STATE_LABEL: Record<string, string> = {
  ok: "Checked",
  manual: "Manual only",
  not_configured: "Not configured",
  unavailable: "Unavailable",
  skipped: "Skipped",
  error: "Error",
  rate_limited: "Rate limited",
};

export default function ResearchPanel({
  eventId,
  initialJob,
  providers,
  hasSeeds,
}: {
  eventId: string;
  initialJob: ResearchJob | null;
  providers: ProviderSummary[];
  hasSeeds: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = useState<ResearchJob | null>(initialJob);
  const liveReady = providers.some((p) => p.mode === "live" && p.role === "evidence" && p.state === "ok");
  const aiReady = providers.some((p) => p.id === "ai_candidates" && p.state === "ok");
  const [mode, setMode] = useState<"mock" | "live">(initialJob?.mode ?? (aiReady || hasSeeds ? "live" : "mock"));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!running || !job) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { job: ResearchJob };
        setJob(body.job);
        if (body.job.status === "queued" || body.job.status === "running") {
          timer.current = setTimeout(poll, 1200);
          router.refresh();
        } else {
          router.refresh();
        }
      } catch {
        setError("Lost contact with the server while checking progress. Refresh to try again.");
      }
    };
    timer.current = setTimeout(poll, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, running]);

  async function run() {
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Couldn't start research.");
      setJob(body.job);
    } catch {
      setError("Network error. Research didn't start.");
    }
  }

  const relevant = providers.filter((p) => p.mode === mode);

  return (
    <section className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Research</h2>
        <div className="row">
          <div className="tabs" style={{ margin: 0 }} role="group" aria-label="Data mode">
            <button type="button" aria-pressed={mode === "live"} onClick={() => setMode("live")} disabled={running}>
              Live sources
            </button>
            <button type="button" aria-pressed={mode === "mock"} onClick={() => setMode("mock")} disabled={running}>
              Mock data
            </button>
          </div>
          <button className="primary" onClick={run} disabled={running}>
            {running ? "Researching…" : job ? "Run again" : "Find sponsors"}
          </button>
        </div>
      </div>

      {mode === "mock" && (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Mock mode uses fictional brands on <code>.example</code> sites so you can try the workflow without API keys. Results are labeled MOCK and are never real findings.
        </p>
      )}
      {mode === "live" && !aiReady && !hasSeeds && (
        <div className="alert warn" style={{ marginTop: "0.75rem" }}>
          Live mode needs brands to research. Add some under <b>Brands to consider</b> (edit the event), add one below, or set <code>ANTHROPIC_API_KEY</code> for AI suggestions.
        </div>
      )}
      {mode === "live" && !liveReady && (
        <div className="alert warn" style={{ marginTop: "0.75rem" }}>No live evidence source is available. See the Sources page.</div>
      )}
      {error && <div className="alert error">{error}</div>}

      {job && (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="row spread">
            <span>
              <b>{job.stage}</b>{" "}
              <span className={`badge ${job.status === "succeeded" ? "good" : job.status === "failed" ? "bad" : job.status === "partial" ? "warn" : "accent"}`}>
                {job.status}
              </span>{" "}
              {job.mode === "mock" && <span className="badge mock">MOCK</span>}
            </span>
            <small>{job.progress}%</small>
          </div>
          <div className="progress">
            <span style={{ width: `${job.progress}%` }} />
          </div>
          {job.error && <div className="alert error">{job.error}</div>}
          {job.providerStatus.length > 0 && (
            <details open={job.status === "partial" || job.status === "failed"}>
              <summary className="muted">Source status for this run</summary>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {job.providerStatus.map((s) => (
                      <tr key={s.provider}>
                        <td>{s.label}</td>
                        <td>
                          <span className={`badge ${STATE_TONE[s.state] ?? ""}`}>{STATE_LABEL[s.state] ?? s.state}</span>
                        </td>
                        <td className="muted">
                          {s.itemsFound > 0 ? `${s.itemsFound} item(s). ` : ""}
                          {s.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {job.log.length > 0 && (
            <details>
              <summary className="muted">Run log ({job.log.length})</summary>
              <ul className="muted" style={{ fontSize: "0.85rem" }}>
                {job.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {!job && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Sources for this mode: {relevant.map((p) => `${p.label} (${STATE_LABEL[p.state] ?? p.state})`).join(", ")}.
        </p>
      )}
    </section>
  );
}
