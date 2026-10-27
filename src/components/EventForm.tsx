"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EventRecord, SponsorshipType } from "@/lib/types";
import { SPONSORSHIP_TYPES } from "@/lib/types";

const TYPE_LABELS: Record<SponsorshipType, string> = {
  cash: "Cash",
  product: "Product",
  speakers: "Speakers",
  experiences: "Experiences",
  other: "Other",
};

type FormState = Omit<EventRecord, "id" | "createdAt" | "updatedAt" | "expectedAttendance" | "startDate" | "endDate"> & {
  expectedAttendance: string;
  startDate: string;
  endDate: string;
};

function initial(event?: EventRecord): FormState {
  return {
    name: event?.name ?? "",
    description: event?.description ?? "",
    startDate: event?.startDate ?? "",
    endDate: event?.endDate ?? "",
    location: event?.location ?? "",
    audience: event?.audience ?? "",
    expectedAttendance: event?.expectedAttendance?.toString() ?? "",
    demographics: event?.demographics ?? "",
    website: event?.website ?? "",
    sponsorshipTypes: event?.sponsorshipTypes ?? [],
    avoid: event?.avoid ?? "",
    notes: event?.notes ?? "",
    seedBrands: event?.seedBrands ?? "",
  };
}

export default function EventForm({ event }: { event?: EventRecord }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initial(event));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await fetch(event ? `/api/events/${event.id}` : "/api/events", {
        method: event ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrors(body.fields ?? {});
        setMessage(body.error ?? "Couldn't save the event.");
        return;
      }
      router.push(`/events/${body.event.id}`);
      router.refresh();
    } catch {
      setMessage("Network error. Your changes weren't saved.");
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof FormState, label: string, opts: { hint?: string; type?: string; textarea?: boolean; required?: boolean; placeholder?: string } = {}) => (
    <div className="field">
      <label htmlFor={key}>
        {label}
        {opts.required ? " *" : ""} {opts.hint && <span className="hint">{opts.hint}</span>}
      </label>
      {opts.textarea ? (
        <textarea id={key} value={form[key] as string} placeholder={opts.placeholder} onChange={(e) => set(key, e.target.value as never)} />
      ) : (
        <input id={key} type={opts.type ?? "text"} value={form[key] as string} placeholder={opts.placeholder} onChange={(e) => set(key, e.target.value as never)} />
      )}
      {errors[key] && <div className="field-error">{errors[key]}</div>}
    </div>
  );

  return (
    <form onSubmit={submit} className="card" noValidate>
      {message && <div className="alert error">{message}</div>}
      {field("name", "Event name", { required: true })}
      {field("description", "Description", { required: true, textarea: true, hint: "What happens and why it matters. This drives matching." })}
      <div className="grid2">
        {field("startDate", "Start date", { type: "date", hint: "if known" })}
        {field("endDate", "End date", { type: "date", hint: "for multi-day events" })}
      </div>
      <div className="grid2">
        {field("location", "City, region, or Online", { required: true })}
        {field("expectedAttendance", "Expected attendance", { type: "number", hint: "leave blank if unsure; we never guess it" })}
      </div>
      {field("audience", "Audience description", { required: true, textarea: true, hint: "Who attends, in your words. Used in outreach drafts." })}
      {field("demographics", "Audience demographics", { textarea: true, hint: "optional" })}
      {field("website", "Event website or social page", { type: "url", placeholder: "https://", hint: "optional" })}
      <div className="field">
        <label>Sponsorship opportunities</label>
        <div className="checks">
          {SPONSORSHIP_TYPES.map((t) => (
            <label key={t}>
              <input
                type="checkbox"
                checked={form.sponsorshipTypes.includes(t)}
                onChange={(e) =>
                  set("sponsorshipTypes", e.target.checked ? [...form.sponsorshipTypes, t] : form.sponsorshipTypes.filter((x) => x !== t))
                }
              />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </div>
      {field("avoid", "Categories or brands to avoid", { textarea: true, hint: "comma or line separated; matching brands are skipped" })}
      {field("seedBrands", "Brands to consider", {
        textarea: true,
        hint: 'optional, one per line: "Brand name" or "Brand name | brand.com". Researched in live mode.',
      })}
      {field("notes", "Additional notes", { textarea: true, hint: "private to you" })}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : event ? "Save changes" : "Create event"}
        </button>
        <button type="button" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
