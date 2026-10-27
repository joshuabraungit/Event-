"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EVIDENCE_KIND_LABELS, EVIDENCE_KINDS, type EvidenceKind } from "@/lib/types";

const empty = {
  kind: "ad" as EvidenceKind,
  sourceUrl: "",
  sourceTitle: "",
  activityDate: "",
  excerpt: "",
  notes: "",
  contactName: "",
  platform: "",
  adUrl: "",
  libraryUrl: "",
  activeStatus: "unknown",
  format: "",
  ugcStyle: "unknown",
  ugcBasis: "",
};

export default function ManualEvidenceForm({ prospectId, links }: { prospectId: string; links: { id: string; label: string; url: string; note: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof empty, v: string) => setF((x) => ({ ...x, [k]: v }));
  const isAd = f.kind === "ad" || f.kind === "creator_content";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setMsg("");
    const payload = {
      kind: f.kind,
      sourceUrl: f.sourceUrl,
      sourceTitle: f.sourceTitle,
      activityDate: f.activityDate || null,
      excerpt: f.excerpt,
      notes: f.notes,
      contactName: f.contactName,
      ad: isAd
        ? { platform: f.platform, adUrl: f.adUrl, libraryUrl: f.libraryUrl, activeStatus: f.activeStatus, format: f.format || "unknown", ugcStyle: f.ugcStyle, ugcBasis: f.ugcBasis }
        : null,
    };
    const res = await fetch(`/api/prospects/${prospectId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      setErrors(body.fields ?? {});
      setMsg(body.error ?? "Couldn't add evidence.");
      return;
    }
    setF(empty);
    setOpen(false);
    router.refresh();
  }

  const input = (k: keyof typeof empty, label: string, opts: { type?: string; hint?: string; textarea?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`me-${k}`}>
        {label} {opts.hint && <span className="hint">{opts.hint}</span>}
      </label>
      {opts.textarea ? (
        <textarea id={`me-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input id={`me-${k}`} type={opts.type ?? "text"} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      )}
      {errors[k] && <div className="field-error">{errors[k]}</div>}
    </div>
  );

  return (
    <section className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Check sources by hand</h2>
        <button onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Add evidence"}</button>
      </div>
      <p className="muted" style={{ marginTop: "0.5rem" }}>
        Some sources can&apos;t be searched automatically. Open them, then add what you find with its link. Evidence you add is labeled as yours and counts toward the score only with a source link.
      </p>
      <ul style={{ paddingLeft: "1.1rem", margin: "0 0 0.5rem" }}>
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>{" "}
            <small>{l.note}</small>
          </li>
        ))}
      </ul>
      {open && (
        <form onSubmit={submit} noValidate style={{ marginTop: "0.75rem" }}>
          {msg && <div className="alert error">{msg}</div>}
          <div className="grid2">
            <div className="field">
              <label htmlFor="me-kind">Type</label>
              <select id="me-kind" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                {EVIDENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EVIDENCE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            {input("activityDate", "Activity date", { type: "date", hint: "when it happened, if known" })}
          </div>
          {input("sourceUrl", "Source link *", { type: "url" })}
          {input("sourceTitle", "Page title *")}
          {input("excerpt", "What the source shows *", { textarea: true, hint: "quote or describe; this is the fact" })}
          {f.kind === "contact" && input("contactName", "Contact name", { hint: "only if the source names them" })}
          {isAd && (
            <div className="grid2">
              {input("platform", "Platform", { hint: "e.g. TikTok, Google, Instagram" })}
              {input("format", "Format", { hint: "video, image, carousel…" })}
              {input("adUrl", "Direct ad link", { type: "url", hint: "if stable" })}
              {input("libraryUrl", "Advertiser library page", { type: "url" })}
              <div className="field">
                <label htmlFor="me-active">Active when you checked?</label>
                <select id="me-active" value={f.activeStatus} onChange={(e) => set("activeStatus", e.target.value)}>
                  <option value="unknown">Unknown</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="me-ugc">Looks creator-led / UGC-style?</label>
                <select id="me-ugc" value={f.ugcStyle} onChange={(e) => set("ugcStyle", e.target.value)}>
                  <option value="unknown">Can&apos;t tell</option>
                  <option value="likely">Likely</option>
                  <option value="possible">Possibly</option>
                  <option value="unlikely">Unlikely</option>
                </select>
              </div>
            </div>
          )}
          {isAd && input("ugcBasis", "Why you think so", { hint: "e.g. person talking to camera, first-person script" })}
          {input("notes", "Your interpretation", { textarea: true, hint: "optional; shown separately from the fact" })}
          <button className="primary" type="submit">
            Add evidence
          </button>
        </form>
      )}
    </section>
  );
}
