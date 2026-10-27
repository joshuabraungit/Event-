import { normalizeDomain } from "../text";
import { ProviderError, type EvidenceProvider } from "./types";

/**
 * Sources we can't query automatically within their terms. They're listed so
 * the UI can show them as unavailable and hand the user a link to check by
 * hand, then add what they find as manual evidence.
 */

export const googleAdsTransparencyProvider: EvidenceProvider = {
  id: "google_ads_transparency",
  label: "Google Ads Transparency Center",
  access: "manual",
  description:
    "No official API for general ad search. Google publishes a BigQuery dataset, but it covers advertisers that served ads in the EEA/Turkey only. Check by hand using the link, then add evidence manually.",
  configVars: [],
  availability: () => ({ state: "manual", message: "Manual check only. Use the link on each brand's page." }),
  manualCheckUrl(brand) {
    const domain = normalizeDomain(brand.website);
    return domain
      ? `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(domain)}`
      : "https://adstransparency.google.com/?region=anywhere";
  },
  async collect() {
    throw new ProviderError("Manual source", "unavailable");
  },
};

export const tiktokProvider: EvidenceProvider = {
  id: "tiktok",
  label: "TikTok Ad Library / Creative Center",
  access: "manual",
  description:
    "TikTok's Commercial Content API needs an approved developer application and covers ads shown in Europe. Creative Center's Top Ads is a curated selection, not a complete list. Check by hand and add evidence manually.",
  configVars: [],
  availability: () => ({ state: "manual", message: "Manual check only. API access requires TikTok approval." }),
  manualCheckUrl: () => "https://library.tiktok.com/ads",
  async collect() {
    throw new ProviderError("Manual source", "unavailable");
  },
};

export const creativeCenterLink = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en";
