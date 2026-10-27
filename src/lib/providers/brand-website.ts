import { classifyArticle, defaultSignals } from "../classify";
import { normalizeDomain, toIsoDate, truncate } from "../text";
import {
  fetchWithTimeout,
  ProviderError,
  USER_AGENT,
  type BrandCandidate,
  type EvidenceProvider,
  type ProviderContext,
  type RawEvidence,
} from "./types";

/**
 * Reads the brand's own public pages: homepage, plus up to three linked
 * partnership / sponsorship / press pages. Honors robots.txt, sends an
 * identifying user agent, never logs in, and stops on any block.
 */

const MAX_BYTES = 1_500_000;
const LINK_PATTERN = /(partner|sponsor|affiliate|ambassador|collab|creator|influencer|press|newsroom|media-kit)/i;

export function parseRobots(robotsTxt: string, agent = "sponsorsignalsbot"): string[] {
  // Returns Disallow prefixes for our agent (or * if no specific group).
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && field === "disallow" && value) current.disallow.push(value);
    }
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  return (specific ?? star)?.disallow ?? [];
}

export function isAllowed(pathname: string, disallow: string[]): boolean {
  return !disallow.some((rule) => {
    const prefix = rule.replace(/\*.*$/, "").replace(/\$$/, "");
    return prefix === "" ? false : pathname.startsWith(prefix);
  });
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function meta(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      "i",
    );
    const m = html.match(re);
    if (m) return decode((m[1] ?? m[2] ?? "").trim());
  }
  return "";
}

export function extractPage(html: string, url: string) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const description = meta(html, ["description", "og:description", "twitter:description"]);
  const published =
    meta(html, ["article:published_time", "og:published_time", "date", "pubdate"]) ||
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ||
    "";
  const bodyText = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  const links: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(m[1], url).toString();
      links.push({ href, text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    } catch {
      // ignore malformed links
    }
  }
  const emails = [...new Set([...html.matchAll(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))];
  return { title, description, published: toIsoDate(published), bodyText, links, emails };
}

async function getText(ctx: ProviderContext, url: string): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const res = await fetchWithTimeout(ctx.fetchImpl, url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
    redirect: "follow",
  });
  if (res.status === 429) throw new ProviderError(`Rate limited by ${new URL(url).hostname}`, "rate_limited");
  const text = res.ok ? (await res.text()).slice(0, MAX_BYTES) : "";
  return { ok: res.ok, status: res.status, text, finalUrl: res.url || url };
}

export const brandWebsiteProvider: EvidenceProvider = {
  id: "brand_website",
  label: "Brand websites",
  access: "public_web",
  description:
    "Reads the brand's homepage and linked partnership, sponsorship and press pages. Honors robots.txt and doesn't bypass logins or bot protection. Many sites block automated requests; those show as inaccessible.",
  configVars: ["BRAND_WEBSITE_FETCH"],
  availability() {
    if (process.env.BRAND_WEBSITE_FETCH === "false") return { state: "not_configured", message: "Disabled with BRAND_WEBSITE_FETCH=false." };
    return { state: "ok", message: "Fetches public pages directly." };
  },
  manualCheckUrl: (brand) => brand.website || null,
  async collect(brand: BrandCandidate, ctx: ProviderContext): Promise<RawEvidence[]> {
    const domain = normalizeDomain(brand.website);
    if (!domain) return [];
    const origin = `https://${domain}`;
    let disallow: string[] = [];
    try {
      const robots = await getText(ctx, `${origin}/robots.txt`);
      if (robots.ok) disallow = parseRobots(robots.text);
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "rate_limited") throw err;
      // No robots.txt reachable: proceed carefully with the homepage only.
    }
    const out: RawEvidence[] = [];
    if (!isAllowed("/", disallow)) {
      return [
        {
          kind: "other",
          sourceUrl: origin,
          sourceTitle: `${brand.name} website`,
          activityDate: null,
          excerpt: "robots.txt asks automated tools not to read this site, so we didn't. Check it by hand and add what you find.",
          signals: [],
          verification: "unverified",
          flags: ["inaccessible"],
        },
      ];
    }
    let home;
    try {
      home = await getText(ctx, origin);
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "rate_limited") throw err;
      home = { ok: false, status: 0, text: "", finalUrl: origin };
    }
    if (!home.ok || !home.text) {
      return [
        {
          kind: "other",
          sourceUrl: origin,
          sourceTitle: `${brand.name} website`,
          activityDate: null,
          excerpt: `Couldn't read the homepage (HTTP ${home.status || "error"}). The site may block automated requests. Check it by hand.`,
          signals: [],
          verification: "unverified",
          flags: ["inaccessible"],
        },
      ];
    }
    const page = extractPage(home.text, home.finalUrl);
    const excerpt = truncate(page.description || page.bodyText, 400);
    if (excerpt) {
      out.push({
        kind: "brand_profile",
        sourceUrl: home.finalUrl,
        sourceTitle: page.title || `${brand.name} homepage`,
        activityDate: null,
        excerpt,
        signals: defaultSignals("brand_profile"),
        verification: "verified_source",
      });
    }
    const candidates = page.links
      .filter((l) => {
        try {
          const u = new URL(l.href);
          return u.hostname.replace(/^www\./, "").endsWith(domain) && LINK_PATTERN.test(`${u.pathname} ${l.text}`);
        } catch {
          return false;
        }
      })
      .filter((l, i, arr) => arr.findIndex((x) => x.href === l.href) === i)
      .slice(0, 3);
    for (const link of candidates) {
      const u = new URL(link.href);
      if (!isAllowed(u.pathname, disallow)) continue;
      let sub;
      try {
        sub = await getText(ctx, link.href);
      } catch (err) {
        if (err instanceof ProviderError && err.kind === "rate_limited") throw err;
        continue;
      }
      if (!sub.ok) continue;
      const p = extractPage(sub.text, sub.finalUrl);
      const isPartnerPage = /partner|sponsor|affiliate|ambassador|collab|creator|influencer/i.test(`${u.pathname} ${link.text}`);
      const kind = isPartnerPage ? "partnership_page" : classifyArticle(p.title, p.description, u.pathname);
      out.push({
        kind,
        sourceUrl: sub.finalUrl,
        sourceTitle: p.title || link.text || u.pathname,
        activityDate: kind === "partnership_page" ? null : p.published,
        excerpt: truncate(p.description || p.bodyText, 400),
        signals: defaultSignals(kind),
        verification: "verified_source",
      });
      const partnerEmail = p.emails.find((e) => /partner|sponsor|collab|events|marketing|press|media/.test(e));
      if (partnerEmail) {
        out.push({
          kind: "contact",
          sourceUrl: sub.finalUrl,
          sourceTitle: p.title || link.text,
          activityDate: null,
          excerpt: `Public contact listed on this page: ${partnerEmail}`,
          signals: [],
          verification: "verified_source",
          contactName: null,
          contactUrl: `mailto:${partnerEmail}`,
        });
      }
    }
    return out;
  },
};
