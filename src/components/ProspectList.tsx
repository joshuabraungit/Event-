"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectRecord, type ProspectStatus } from "@/lib/types";
import { ConfidenceBadge, MockBadge, ScoreBadge } from "./ui";

type Filter = "active" | "saved" | "dismissed" | "all";

export async function patchProspect(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/prospects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
  return (await res.json()).prospect as ProspectRecord;
}

export default function ProspectList({ eventId, initial }: { eventId: string; initial: ProspectRecord[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, Partial<ProspectRecord>>>({});
  const prospects = initial.map((p) => ({ ...p, ...overrides[p.id] }));
  const [filter, setFilter] = useState<Filter>("active");
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [brand, setBrand] = useState({ name: "", website: "" });

  const visible = useMemo(
    () =>
      prospects.filter((p) => {
        if (filter === "active" && p.dismissed) return false;
        if (filter === "saved" && !p.saved) return false;
        if (filter === "dismissed" && !p.dismissed) return false;
        if (statusFilter && p.status !== statusFilter) return false;
        return true;
      }),
    [prospects, filter, statusFilter],
  );

  async function update(id: string, patch: Partial<ProspectRecord>) {
    setError(null);
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
    try {
      await patchProspect(id, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      setOverrides((o) => {
        const { [id]: _drop, ...rest } = o;
        return rest;
      });
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function addBrand(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/events/${eventId}/prospects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brand),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error + (body.fields ? `: ${Object.values(body.fields).join(", ")}` : ""));
    setBrand({ name: "", website: "" });
    setAdding(false);
    router.push(`/events/${eventId}/prospects/${body.prospect.id}`);
  }

  const exportIds = selected.size ? [...selected] : visible.map((p) => p.id);
  const anyMock = prospects.some((p) => p.isMock);

  return (
    <section className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Potential sponsors</h2>
        <div className="row">
          <button onClick={() => setAdding((a) => !a)}>+ Add a brand</button>
          <a
            className={`btn${exportIds.length ? "" : " disabled"}`}
            href={exportIds.length ? `/api/events/${eventId}/export?ids=${exportIds.join(",")}` : undefined}
            aria-disabled={!exportIds.length}
          >
            Export {selected.size ? `${selected.size} selected` : "shown"} to CSV
          </a>
        </div>
      </div>

      {anyMock && (
        <div className="mock-banner" style={{ marginTop: "0.75rem" }}>
          Some results below are <b>mock data</b>: fictional brands and sample evidence for testing. Don't contact them or treat them as findings.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      {adding && (
        <form onSubmit={addBrand} className="row" style={{ margin: "0.75rem 0", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label htmlFor="bn">Brand name</label>
            <input id="bn" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} required />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label htmlFor="bw">
              Website <span className="hint">optional</span>
            </label>
            <input id="bw" type="url" placeholder="https://" value={brand.website} onChange={(e) => setBrand({ ...brand, website: e.target.value })} />
          </div>
          <button className="primary" type="submit">
            Add
          </button>
        </form>
      )}

      <div className="row spread" style={{ margin: "0.75rem 0" }}>
        <div className="tabs" style={{ margin: 0 }}>
          {(["active", "saved", "dismissed", "all"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "active" ? "Not dismissed" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ProspectStatus | "")} style={{ width: "auto" }} aria-label="Filter by status">
          <option value="">Any status</option>
          {PROSPECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty">{prospects.length ? "Nothing matches this filter." : "No prospects yet. Run research above, or add a brand by hand."}</div>
      ) : (
        <div>
          {visible.map((p) => (
            <div key={p.id} className={`prospect-row${p.dismissed ? " dismissed" : ""}`}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
              <ScoreBadge score={p.score?.total} />
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: "0.4rem" }}>
                  <Link className="title" href={`/events/${eventId}/prospects/${p.id}`}>
                    {p.name}
                  </Link>
                  {p.isMock && <MockBadge />}
                  {p.saved && <span className="badge accent">Saved</span>}
                  <ConfidenceBadge confidence={p.score?.confidence} />
                </div>
                <div className="meta">
                  {p.categories.slice(0, 3).join(" · ")}
                  {p.categories.length ? " · " : ""}
                  {p.fitSummary}
                </div>
                {p.score && (
                  <div className="mini-bars" title={p.score.components.map((c) => `${c.label}: ${c.points}/${c.max}`).join("\n")}>
                    {p.score.components.map((c) => (
                      <span key={c.key}>
                        <i style={{ width: `${(c.points / c.max) * 100}%` }} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="row actions" style={{ gap: "0.4rem" }}>
                <select value={p.status} onChange={(e) => update(p.id, { status: e.target.value as ProspectStatus })} style={{ width: "auto" }} aria-label="Status">
                  {PROSPECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button className="small" onClick={() => update(p.id, { saved: !p.saved })}>
                  {p.saved ? "Unsave" : "Save"}
                </button>
                <button className="small" onClick={() => update(p.id, { dismissed: !p.dismissed })}>
                  {p.dismissed ? "Restore" : "Dismiss"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
