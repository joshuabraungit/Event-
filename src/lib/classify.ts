import type { Confidence, EvidenceKind, ScoreComponentKey, UgcStyle } from "./types";

export interface UgcAssessment {
  ugcStyle: UgcStyle;
  ugcConfidence: Confidence;
  ugcBasis: string;
}

const FIRST_PERSON = /\b(i|i'm|i've|i'd|my|me)\b/i;
const TESTIMONIAL = /\b(honestly|obsessed|game[- ]changer|tried|i swear|life[- ]chang|can't believe|no one told me|wish i knew|been using|my routine|story ?time|pov)\b/i;
const CREATOR_MARKERS = /(#ad\b|#sponsored|#partner|paid partnership|in partnership with|@[a-z0-9_.]{2,}|creator|ambassador)/i;
const BRAND_VOICE = /\b(we|our|shop now|introducing|new collection|limited time|save \d+%|free shipping)\b/i;

/**
 * Heuristic read of whether an ad LOOKS creator-led or UGC-style. This is an
 * interpretation of style only. It never says whether the person is a real
 * customer, a paid creator, or an actor.
 */
export function assessUgcStyle(adText: string, format: string): UgcAssessment {
  const cues: string[] = [];
  if (FIRST_PERSON.test(adText)) cues.push("first-person voice");
  if (TESTIMONIAL.test(adText)) cues.push("testimonial-style phrasing");
  if (CREATOR_MARKERS.test(adText)) cues.push("creator or partnership marker");
  const isVideo = /video|reel|short/i.test(format);
  if (isVideo) cues.push("video format");
  const brandVoice = BRAND_VOICE.test(adText);

  const strong = cues.filter((c) => c !== "video format").length;
  let ugcStyle: UgcStyle = "unknown";
  let ugcConfidence: Confidence = "low";
  if (!adText.trim()) {
    return {
      ugcStyle: "unknown",
      ugcConfidence: "low",
      ugcBasis: "No ad text available to assess. Open the ad to judge the format yourself.",
    };
  }
  if (strong >= 2) {
    ugcStyle = "likely";
    ugcConfidence = isVideo ? "medium" : "low";
  } else if (strong === 1) {
    ugcStyle = "possible";
    ugcConfidence = "low";
  } else if (brandVoice) {
    ugcStyle = "unlikely";
    ugcConfidence = "low";
  }
  const basis = cues.length
    ? `Based on ad text cues: ${cues.join(", ")}.`
    : brandVoice
      ? "Ad text reads in the brand's own voice."
      : "No clear cues in the ad text.";
  return {
    ugcStyle,
    ugcConfidence,
    ugcBasis: `${basis} This is a style interpretation from text only; it doesn't tell us whether the person is a customer, a paid creator, or an actor.`,
  };
}

/** Rough evidence kind from a web page's title / snippet. */
export function classifyArticle(title: string, snippet: string, url: string): EvidenceKind {
  const t = `${title} ${snippet} ${url}`.toLowerCase();
  if (/\bsponsor(ed|s|ing|ship)?\b|presenting partner|title partner/.test(t)) return "sponsorship";
  if (/partner(s|ed|ing|ship)? with|collab(oration|orat|s)?\b|ambassador|creator program|teams up with/.test(t)) return "partnership";
  if (/press release|announces|launch(es|ed)?|introduc(es|ing)|unveil/.test(t)) return "press";
  return "news";
}

export function defaultSignals(kind: EvidenceKind): ScoreComponentKey[] {
  switch (kind) {
    case "brand_profile":
      return ["audience", "message"];
    case "product":
      return ["audience"];
    case "ad":
    case "creator_content":
      return ["advertising", "message"];
    case "sponsorship":
    case "partnership":
      return ["partnership", "audience"];
    case "partnership_page":
      return ["partnership"];
    case "press":
    case "news":
      return ["message"];
    default:
      return [];
  }
}
