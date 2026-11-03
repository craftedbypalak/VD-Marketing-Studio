# Two tools, one link, and how they go on the website

Date: 29 October 2026. Decision by Palak: the network CRM is not part of the marketing tool. Marketing staff get Studio; only the founder gets Network. The two are separate entities that talk through a small API.

## 1. The split

| | Studio (marketing) | Network (relationships) |
|---|---|---|
| Folder | `Venture Drafters/Studio/` | `Venture Drafters/Network/` |
| Local port | 4747 | 4748 |
| Who signs in | marketing staff and the founder | the founder only |
| Owns | pieces, versions, slots, accounts, rules, solutions, events, campaigns, videos, images, log, settings | people, touches, a synced copy of events, log, settings |
| Modules | Content, Review, Calendar, Video, Recurring (greeting pieces, announcements), Pictures, Today | People, Person page, Due today, Weekly routine, Festival batches, Today |
| AI ops | propose, draft, check, refine, reviewPass, greetingTemplates, announcement, the four video ops, imagePrompts | touchSuggest |
| Git | its own repo (unchanged) | its own repo |

Nothing about a person ever enters Studio. Studio's Today loses "Touches due"; Studio's Recurring loses "Generate touches" and the consent counts; Studio's Settings loses tier cadences and the own-content ratio. All of that lives in Network.

### What stays in Studio on purpose

Events keep their `tiers` and `community` fields. They are the calendar's definition of a festival ("Platinum, Gold and Silver, Muslim community"), hold no names, and Network reads them over the link. Marketing staff can see that Eid goes to three tiers; they cannot see who is in them.

## 2. The link (Studio → Network, read-only)

Studio exposes two routes guarded by a shared token (`settings.linkToken` in Studio; header `X-Link-Token`). Network's settings hold `studioUrl` and `studioToken`.

```
GET /api/link/events?from=YYYY-MM-DD&to=YYYY-MM-DD
  → [{ id, name, date, kind, scope, community, tiers, postingRule, greetingText, wording: { whatsapp } }]
GET /api/link/pieces?status=published|approved
  → [{ id, title, hook, channel, accountId, url, publishedAt, solutionId }]
```

Network pulls with `POST /api/network/sync` (idempotent by event id; keeps local edits to tiers if the founder changed them). It uses events to plan one-to-one festival touches and pieces as "something worth sending" inside touchSuggest, never more than the own-content ratio allows.

Nothing flows the other way. Studio never calls Network.

## 3. Hosting on the website: Vercel, Google Sheets and Google Drive

Yes, this works, and the store interface was written for it. Each tool becomes its own Vercel project under a subdomain of the website (for example `studio.venturedrafters.in`, `network.venturedrafters.in`), each with its own Google Sheet and its own Drive folder. Access then is simply who the Sheet and the folder are shared with, which is the separation Palak asked for.

### The pieces

| Layer | Today (local) | On the website |
|---|---|---|
| App | static files from `app/` | the same files, served by Vercel |
| API | `node:http` on 4747 | one Vercel function (`api/[...path].js`) that wraps the same router; no code change in modules |
| Data | `data/*.json` | one Google Sheet per tool, one tab per collection, header row = fields, nested fields as JSON text; a `store-sheets.mjs` adapter with the same list/get/put/patch/remove/nextId/log interface |
| Media | `media/` | a Drive folder per tool; browser uploads straight to Drive through a resumable session the API opens (Vercel functions cap bodies at 4.5 MB, so files never pass through them); records keep the Drive file id |
| Sign-in | user picker | Google sign-in (Identity Services); the function verifies the ID token and checks the email against the Users tab; approver stays server-side |
| AI | `claude -p` on the Mac | see below |
| Video pipeline | the Mac (bv, ffmpeg, stock search) | still the Mac; the hand-off folder becomes a Drive folder |

### AI without API spend

`claude -p` on the subscription cannot run on Vercel. Two modes, switched in Settings:

- **Runner (recommended).** The hosted app writes an AI job to a Jobs tab. A small Node process on Palak's Mac polls the Sheet every 20 seconds, runs the op through `claude -p` on the subscription, writes the result back. Staff get drafts and checks at no API cost; the queue waits while the Mac is off.
- **API.** `ANTHROPIC_API_KEY` in Vercel; pay per token; always on. The code path already exists (`aiMode: "api"`).

### Honest limits of Sheets as a database

- Quota is 300 reads a minute per project and about half a second per call. The adapter reads a whole tab once per request and writes through, which keeps a three-person team far under the limit.
- Ten million cells per spreadsheet. Studio has about a thousand rows today; years of headroom.
- No transactions. Last write wins; the adapter rejects a write whose `updatedAt` is older than the row's, which is enough for two people editing at once.
- A person editing the Sheet by hand can break a row (bad JSON in a nested field). The adapter reports the row and skips it rather than failing the tab.

For a marketing team of three this is enough, and the Sheet is a source of truth Palak can open, filter and fix without the tool. If it ever strains, the same adapter interface moves to Supabase.

### What only Palak can create (needed before the hosted build)

1. A Google Cloud project with the Sheets API and Drive API enabled, one service account, its JSON key.
2. Two Google Sheets (Studio, Network), each shared with the service account as editor; the Network sheet shared with no one else.
3. Two Drive folders, shared the same way.
4. An OAuth client ID (web) for Google sign-in, with the two subdomains as authorised origins.
5. A Vercel account connected to the website's domain, two projects, the key and IDs as environment variables.

### Build order for the hosted step

1. `store-sheets.mjs` behind the same interface, with a one-time `import` script that uploads `data/*.json` to the Sheet.
2. The Vercel function wrapper and `vercel.json` (static `app/`, rewrites `/api/*`).
3. Google sign-in and the Users tab check.
4. Drive uploads for media and the Pictures PNGs.
5. The Mac runner for AI jobs.
6. The same again for Network, which shares every piece of this code.
