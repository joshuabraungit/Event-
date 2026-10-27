"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectRecord, type ProspectStatus } from "@/lib/types";
import { patchProspect } from "./ProspectList";

export function ProspectActions({ prospect }: { prospect: ProspectRecord }) {
  const router = useRouter();
  const [p, setP] = useState(prospect);
  const [notes, setNotes] = useState(prospect.notes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function update(patch: Partial<ProspectRecord>) {
    setState("saving");
    try {
      setP(await patchProspect(p.id, patch));
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <select value={p.status} onChange={(e) => update({ status: e.target.value as ProspectStatus })} style={{ width: "auto" }} aria-label="Status">
          {PROSPECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button onClick={() => update({ saved: !p.saved })}>{p.saved ? "★ Saved" : "☆ Save"}</button>
        <button onClick={() => update({ dismissed: !p.dismissed })}>{p.dismissed ? "Restore" : "Dismiss"}</button>
      </div>
      <div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Calls, context, next steps…" />
        <div className="row" style={{ marginTop: "0.4rem" }}>
          <button className="small" onClick={() => update({ notes })} disabled={notes === p.notes}>
            Save notes
          </button>
          <small aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save. Try again." : ""}</small>
        </div>
      </div>
    </div>
  );
}

export function OutreachEditor({ prospect }: { prospect: ProspectRecord }) {
  const [draft, setDraft] = useState(prospect.outreachDraft);
  const [saved, setSaved] = useState(prospect.outreachDraft);
  const [msg, setMsg] = useState("");

  async function save() {
    try {
      const p = await patchProspect(prospect.id, { outreachDraft: draft });
      setSaved(p.outreachDraft);
      setMsg("Draft saved. It won't be regenerated on future research runs.");
    } catch {
      setMsg("Couldn't save the draft.");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setMsg("Copied to clipboard.");
    } catch {
      setMsg("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <div>
      <textarea className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Outreach draft" />
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button className="primary" onClick={copy}>
          Copy
        </button>
        <button onClick={save} disabled={draft === saved}>
          Save edits
        </button>
        <small aria-live="polite">{msg}</small>
      </div>
      <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
        Nothing is sent from here. Replace bracketed placeholders and check the observation against its source before you send it.
      </p>
    </div>
  );
}

export function EvidenceActions({ id, flags, userProvided }: { id: string; flags: string[]; userProvided: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const userFlags = flags.filter((f) => f === "conflicting" || f === "inaccessible");

  async function setFlag(flag: "conflicting" | "inaccessible") {
    setBusy(true);
    const next = userFlags.includes(flag) ? userFlags.filter((f) => f !== flag) : [...userFlags, flag];
    await fetch(`/api/evidence/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flags: next }) });
    setBusy(false);
    router.refresh();
  }
  async function remove() {
    if (!confirm("Delete this evidence you added?")) return;
    setBusy(true);
    await fetch(`/api/evidence/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="row" style={{ gap: "0.35rem", marginTop: "0.4rem" }}>
      <button className="small" disabled={busy} onClick={() => setFlag("conflicting")}>
        {userFlags.includes("conflicting") ? "Unflag conflicting" : "Flag conflicting"}
      </button>
      <button className="small" disabled={busy} onClick={() => setFlag("inaccessible")}>
        {userFlags.includes("inaccessible") ? "Mark accessible" : "Flag inaccessible"}
      </button>
      {userProvided && (
        <button className="small danger" disabled={busy} onClick={remove}>
          Delete
        </button>
      )}
    </div>
  );
}
