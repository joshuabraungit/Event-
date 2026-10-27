# Sponsor Signals

Sponsorship prospecting for event organizers. Describe your event, and Sponsor Signals finds brands that may fit, scores them 0–100 with a transparent breakdown, and shows the sourced evidence behind every point: brand pages, ads (including creator-led or UGC-style ads), past sponsorships and partnerships, and recent activity.

It's an MVP. It runs fully offline in **mock mode** (clearly labeled fictional data) and gets more useful as you add API keys.

## Quick start

Requires **Node 22.13+** (uses the built-in `node:sqlite`; no native modules to compile).

```bash
npm install
cp .env.example .env.local   # optional: every key is optional
npm run dev                  # http://localhost:3000
```

Then: **New event** → fill in the form → on the event page pick **Mock data** → **Find sponsors**.

For a real run, pick **Live sources**. Live mode needs brands to research: list them under *Brands to consider* on the event (`Brand name | brand.com`, one per line), add them from the prospect list, or set `ANTHROPIC_API_KEY` for AI suggestions.

Other commands:

```bash
npm test            # vitest: scoring, source attribution, workflows, providers
npm run typecheck
npm run build && npm start
```

You'll see a one-line `ExperimentalWarning: SQLite is an experimental feature` from Node. That's expected.

## What's in the MVP

- Create, edit and delete events (name, description, dates, location/online, audience, attendance, demographics, website, sponsorship types, avoid list, brands to consider, notes)
- Background research jobs with progress, per-source status, a run log, and clear error / rate-limit / partial states
- Ranked prospects with a 0–100 score and a per-component breakdown in plain language
- Sponsor detail page: score breakdown with links to the exact evidence, fit summary, relevant products, ads with platform / link / active status / date checked / ad text / format / UGC-style read, partnerships and sponsorships, recent activity, suggested sponsorship type, suggested contact role, verified public contact (only when actually found), confidence, missing information
- Manual evidence entry for anything the app can't fetch, with direct links to check each source by hand
- Flag evidence as conflicting or inaccessible (excludes it from scoring)
- Save, dismiss, notes, statuses (To review, Interested, Contacted, In conversation, Not a fit), filters
- Editable outreach draft with copy button. Nothing is ever sent.
- CSV export of selected or shown prospects: score, components, rationale, source URLs, titles, activity dates, dates checked, suggested contact role, contact, status, notes
- Mock mode with ~30 fictional brands across many categories, so it works for any event type

Not included (by design): billing, automatic outreach, CRM integrations, a contact database.

## How scoring works

| Component | Max | Earns points from |
|---|---|---|
| Audience and event fit | 35 | Sources showing the brand's audience/products overlap with the event (strongest source + corroboration from other sources) |
| Message and values alignment | 20 | Sources whose messaging lines up with the event's purpose |
| Evidence of advertising | 15 | Ads found (6), relevance of the best ad (up to 6), a relevant ad that looks creator-led/UGC-style with medium+ confidence (3) |
| Partnerships / sponsorships | 20 | Past sponsorship (7–10), creator/educator/org partnership (4–6), public partnerships page (4) |
| Recent relevant activity | 10 | Newest dated, relevant activity: ≤90 days 10, ≤6 months 7, ≤12 months 4, older 0 |

Rules the code enforces (see `src/lib/scoring.ts` and `tests/scoring.test.ts`):

- **No source link, no points.** Evidence needs an http(s) source. Unverified claims earn nothing.
- **Inaccessible or conflicting evidence earns nothing** until you clear the flag.
- **Missing evidence is never evidence of absence.** Empty components say "not found in the sources checked (…). That doesn't mean none exists."
- **Ads never add partnership points** and are never read as sponsorship budget.
- **Activity date ≠ date checked.** Recency uses when the activity happened. Unknown dates earn no recency points. Content older than 18 months is flagged stale.
- **Third-party sources** (not the brand's site or an ad library) count 20% less.
- **Facts and interpretation are stored and shown separately.** "UGC-style" is always labeled an interpretation, and never claims the person is a customer, paid creator or actor.
- **Confidence** reflects how many independent sources back the points (high = 3+ including a direct one).

Relevance is keyword overlap between the event's description/audience and the evidence text (stemmed). With `ANTHROPIC_API_KEY` set, Claude re-scores relevance per evidence item and writes the interpretation, but it can only reference evidence the providers actually retrieved; it can't add facts, sources or people.

## Research sources: what actually works

| Source | Status | Notes |
|---|---|---|
| **Brand websites** | Works, no key | Reads the homepage plus up to 3 linked partner/sponsor/press pages. Honors robots.txt, identifies itself, never logs in or bypasses bot protection. Extracts publish dates when the page has them and `partnerships@`-style public emails. Sites that block bots show as *inaccessible* and earn no points. Disable with `BRAND_WEBSITE_FETCH=false`. |
| **Web search** (Brave Search API) | Needs `BRAVE_SEARCH_API_KEY` | Finds press releases, event sponsor pages, partnership announcements. Uses the search engine's page date, which may differ from the activity date. Snippets are third-party and weighted lower. |
| **Meta Ad Library API** | Needs `META_AD_LIBRARY_ACCESS_TOKEN` | Official Graph API (`ads_archive`). Requires identity verification and Ad Library API access. **Commercial ads are only returned where they were delivered in the EU/UK** (set countries with `META_AD_REACHED_COUNTRIES`). Doesn't expose creative format. We link to the public `facebook.com/ads/library/?id=…` page and never store `ad_snapshot_url` (it contains your token). |
| **Google Ads Transparency Center** | Manual | No official API for general ad search. Google's BigQuery dataset covers advertisers serving in the EEA/Turkey only (possible future provider). Each brand page links to the Transparency Center search for its domain. |
| **TikTok Ad Library / Creative Center** | Manual | The Commercial Content API needs an approved TikTok developer application and covers ads shown in Europe. Creative Center Top Ads is a curated selection, not a census. Links provided; add findings by hand. |
| **Claude** (brand suggestions + interpretation) | Needs `ANTHROPIC_API_KEY` | Suggestions are labeled "AI suggestion (not evidence)" and earn no points by themselves. Default model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). Uses the API's server-side refusal fallback, since sensitive topics like sex education can occasionally trip safety filters. |
| **Mock** | Always | Fictional brands on `.example` domains. Every item is labeled MOCK in the UI, the outreach draft and the CSV. |

The **Sources** page in the app shows live status for each. Providers implement one interface (`src/lib/providers/types.ts`) and are registered in `src/lib/providers/registry.ts`, so adding or swapping one is a single file plus one line.

A missing result from any source doesn't mean a brand doesn't advertise or sponsor. Coverage is partial everywhere.

## Stack and why

- **Next.js 16 (App Router) + TypeScript**: one project for UI and API routes, server components keep API keys server-side by default.
- **SQLite via Node's built-in `node:sqlite`**: persistent storage with zero setup and no native build step. Records are stored as JSON documents in a few tables, which keeps the MVP schema flexible. Swap `src/lib/repo.ts` for Postgres when you need multi-user hosting.
- **In-process background jobs**: research runs asynchronously in the server process; job state (progress, provider status, errors, log) is persisted and polled by the UI. If the server restarts mid-job, the job is marked failed with a clear message.
- **Zod** for input validation, **Vitest** for tests, plain CSS (responsive, light/dark).

Environment variables are only read on the server. `/api/providers` reports which variables a source needs, never their values (there's a test for that).

## Project layout

```
src/lib/
  scoring.ts        transparent 0–100 scoring + evidence flags
  research.ts       research job orchestration, manual brand/evidence
  insights.ts       suggestions, contact role, outreach drafts
  relevance.ts      keyword relevance, avoid-list matching
  classify.ts       UGC-style heuristic, article classification
  ai.ts             optional Claude integration
  providers/        brand-website, web-search, meta-ad-library, manual-sources, mock
  repo.ts, db.ts    SQLite persistence
  csv.ts            export
src/app/            pages and API routes
tests/              scoring, workflow, provider tests
```

## Limitations and known gaps

- **Live mode doesn't discover brands on its own without Claude.** Without `ANTHROPIC_API_KEY`, you supply the brand names. Search-based discovery is a natural next provider.
- **Brand website reading is shallow**: homepage + up to 3 linked pages, regex HTML parsing, no JavaScript rendering. Single-page-app sites may yield little.
- **Ad coverage is regional.** Meta's commercial ads only via EU/UK delivery; Google and TikTok are manual.
- **UGC-style detection is text-only** (first-person voice, testimonial phrasing, creator markers). It can't see the video. Treat it as a hint to go look.
- **Keyword relevance is blunt** without Claude: it can miss synonyms and over-match common words.
- **Jobs run in the web server process.** Fine for a single instance; for production, move `runResearch` to a queue worker.
- **Single user, no auth.** Don't expose it publicly as is.
- The Meta and Brave integrations are built against their documented APIs and tested with mocked responses, but couldn't be exercised against the live services from the build environment (outbound access was blocked).

## Decisions that need your input

1. **Brand discovery in live mode**: use Claude suggestions (needs a key and has per-run cost), add a search-based discovery provider, or keep it organizer-led?
2. **Search provider**: Brave was chosen for its simple official API. SerpAPI, Bing or Google Programmable Search are drop-in alternatives if you have a preference or existing account.
3. **Meta Ad Library access**: worth going through Meta's identity verification? Without it, ad evidence in live mode is manual-only.
4. **TikTok Commercial Content API**: apply for access, or stay manual?
5. **Hosting**: if more than one person will use it, we should move to Postgres, add auth, and run jobs in a worker.
