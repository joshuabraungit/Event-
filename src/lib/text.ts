// Small text utilities used for keyword relevance, dedupe, and URL handling.

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both
  but by can could did do does doing down during each event events few for from further had has have having he her here
  hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off
  on once only or other our ours ourselves out over own people same she should so some such than that the their theirs
  them themselves then there these they this those through to too under until up very was we were what when where which
  while who whom why will with would you your yours yourself yourselves us get got one two new like want wants need
  needs make makes around without within across per via should've they'll we'll we're you're it's don't didn't
  women's men's attendees attendee audience organizers organizer focused focus beyond really etc online city region
  year years day days people's way ways thing things help helps bring bringing together learn learning talk talks`
    .split(/\s+/)
    .filter(Boolean),
);

/** Very small stemmer: enough to match "communicating" with "communication". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suffix of ["ational", "ations", "ation", "ings", "ing", "ies", "ers", "ed", "ly", "es", "s"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies") w += "y";
      break;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) ?? [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Distinct stemmed keywords from a block of text. */
export function keywords(text: string): string[] {
  return [...new Set(tokenize(text).map(stem))];
}

export function splitList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return s.split(/[/?#]/)[0] ?? "";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function brandKey(name: string, website?: string): string {
  const domain = website ? normalizeDomain(website) : "";
  if (domain) return domain;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function hashString(s: string): string {
  // FNV-1a, enough for dedupe keys and deterministic mock data.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Accepts ISO-ish dates and returns YYYY-MM-DD, or null when unparseable. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
