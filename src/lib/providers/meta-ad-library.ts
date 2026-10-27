import { assessUgcStyle } from "../classify";
import { toIsoDate, truncate } from "../text";
import {
  fetchWithTimeout,
  ProviderError,
  type BrandCandidate,
  type EvidenceProvider,
  type ProviderContext,
  type RawEvidence,
} from "./types";

/**
 * Meta Ad Library API (Graph API `ads_archive`). Official, but:
 * - needs an access token from an identity-verified account with Ad Library API access;
 * - commercial (non-political) ads are only returned where they were delivered in the EU/UK;
 * - the API doesn't expose creative format, so format is "unknown" unless the text says more;
 * - `ad_snapshot_url` embeds the access token, so we never store it. We link to the public
 *   Ad Library page for the ad id instead.
 */

interface MetaAd {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
}

export function publicAdUrl(id: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

/** Country the manual Ad Library links open on. The public site covers US ads even though the API doesn't. */
function linkCountry(): string {
  return (process.env.AD_LIBRARY_LINK_COUNTRY || "US").trim().toUpperCase();
}

export function advertiserLibraryUrl(pageId: string): string {
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${linkCountry()}&view_all_page_id=${encodeURIComponent(pageId)}`;
}

export function keywordLibraryUrl(name: string): string {
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${linkCountry()}&q=${encodeURIComponent(name)}&search_type=keyword_unordered`;
}

function nameMatches(pageName: string | undefined, brand: string): boolean {
  if (!pageName) return false;
  const a = pageName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function metaAdToEvidence(ad: MetaAd, brand: BrandCandidate, now: Date): RawEvidence {
  const text = [...(ad.ad_creative_bodies ?? []), ...(ad.ad_creative_link_titles ?? [])].join(" ").trim();
  const stop = toIsoDate(ad.ad_delivery_stop_time);
  const today = now.toISOString().slice(0, 10);
  const activeStatus = !stop || stop >= today ? "active" : "inactive";
  const platforms = (ad.publisher_platforms ?? []).map((p) => p[0].toUpperCase() + p.slice(1));
  const ugc = assessUgcStyle(text, "unknown");
  return {
    kind: "ad",
    sourceUrl: publicAdUrl(ad.id),
    sourceTitle: `${ad.page_name ?? brand.name} ad in Meta Ad Library`,
    publisher: "Meta Ad Library",
    activityDate: toIsoDate(ad.ad_delivery_start_time),
    excerpt: truncate(text || "(No ad text returned by the API.)", 600),
    signals: ["advertising", "message"],
    verification: "verified_source",
    sourceId: `meta:${ad.id}`,
    ad: {
      platform: platforms.length ? platforms.join(", ") : "Meta",
      advertiser: ad.page_name ?? brand.name,
      adUrl: publicAdUrl(ad.id),
      libraryUrl: ad.page_id ? advertiserLibraryUrl(ad.page_id) : keywordLibraryUrl(brand.name),
      activeStatus,
      activeStatusCheckedAt: now.toISOString(),
      adText: truncate(text, 600),
      format: "unknown (not exposed by the API)",
      ...ugc,
    },
  };
}

export const metaAdLibraryProvider: EvidenceProvider = {
  id: "meta_ad_library",
  label: "Meta Ad Library API",
  access: "official_api",
  description:
    "Official Graph API. Returns commercial ads only where they were delivered in the EU/UK (plus political/issue ads globally). Not finding ads here doesn't mean the brand doesn't advertise.",
  configVars: ["META_AD_LIBRARY_ACCESS_TOKEN", "META_GRAPH_API_VERSION", "META_AD_REACHED_COUNTRIES", "AD_LIBRARY_LINK_COUNTRY"],
  availability() {
    return process.env.META_AD_LIBRARY_ACCESS_TOKEN
      ? { state: "ok", message: "Configured. Coverage for commercial ads is limited to EU/UK delivery." }
      : {
          state: "not_configured",
          message: "Set META_AD_LIBRARY_ACCESS_TOKEN to search the Ad Library API. Until then, use the manual link.",
        };
  },
  manualCheckUrl: (brand) => keywordLibraryUrl(brand.name),
  async collect(brand: BrandCandidate, ctx: ProviderContext): Promise<RawEvidence[]> {
    const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    if (!token) throw new ProviderError("META_AD_LIBRARY_ACCESS_TOKEN is not set", "not_configured");
    const version = process.env.META_GRAPH_API_VERSION || "v24.0";
    const countries = (process.env.META_AD_REACHED_COUNTRIES || "GB,DE,FR,IE,NL,ES,IT,SE")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const params = new URLSearchParams({
      search_terms: brand.name,
      ad_reached_countries: JSON.stringify(countries),
      ad_active_status: "ALL",
      ad_type: "ALL",
      fields:
        "id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms",
      limit: "25",
      access_token: token,
    });
    const res = await fetchWithTimeout(ctx.fetchImpl, `https://graph.facebook.com/${version}/ads_archive?${params}`);
    const body = (await res.json().catch(() => ({}))) as { data?: MetaAd[]; error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      const code = body.error?.code;
      if (res.status === 429 || code === 4 || code === 17 || code === 613 || code === 80004)
        throw new ProviderError("Meta Ad Library rate limit reached. Try again later.", "rate_limited");
      if (code === 190 || res.status === 401) throw new ProviderError("Meta rejected the access token (expired or invalid).", "error");
      if (code === 10 || code === 200) throw new ProviderError("This token doesn't have Ad Library API access yet.", "unavailable");
      throw new ProviderError(`Meta Ad Library error: ${body.error?.message ?? `HTTP ${res.status}`}`, "error");
    }
    // Keyword search matches ad text too, so keep only ads from a page that looks like the brand.
    return (body.data ?? []).filter((ad) => nameMatches(ad.page_name, brand.name)).map((ad) => metaAdToEvidence(ad, brand, ctx.now));
  },
};
