# Workspaces: one company each

Version 1, 2 November 2026. Studio started as a tool for one company. It is becoming a tool that Venture Drafters runs for many client companies. Each company is a **workspace**, and has its own content, calendar, rules, company profile, users and roles. This document is the contract for workspaces and the plan for the five phases. `docs/CLOUD-SESSION-PROMPT.md` holds the brief.

## 1. What a workspace is

A workspace is one company. It has:

- its own store (today a folder of JSON files; from phase 2 its own Google Sheet),
- its own Google Drive folder (phase 4),
- its own users, each with a role (`employee`, `manager` or `director`), kept in its settings document (from phase 2 its Users tab),
- its own review routing, rules and, from phase 3, its company profile.

The director of a workspace manages its users. The **owner** is a role at the agency level, not inside a workspace. An owner creates workspaces and may enter any of them, where they work as the director (`docs/ROLES.md` section 1).

A user may belong to more than one workspace, with a different role in each. After choosing a user (later, after signing in), the app shows a switcher listing the workspaces that user may enter.

## 2. The master registry

A small registry lists every workspace and the owners. Locally it is `data/master/`. In phase 2 it becomes a master Google Sheet called **Workspaces**.

| File (tab) | Fields |
|---|---|
| `workspaces.json` (Workspaces) | `id`, `name`, `status` (`active`, `paused` or `archived`), `sheetId`, `driveFolderId`, `createdAt`, `createdBy`, `dataDir` (JSON store only: the folder, relative to the Studio root) |
| `owners.json` (Owners) | `id` (the email in lower case), `email`, `name` |
| `log.json` (Log) | who created or changed a workspace |

Venture Drafters is workspace one, `vd`, and its data stays where it was: `data/*.json`. A workspace created later keeps its files in `data/workspaces/<id>/`, which git ignores, because a client's content does not belong in this repository. An empty registry reads as a single default workspace on `data/`.

The registry, and every workspace other than the default, are never served under `/data`.

## 3. How a request finds its workspace

- The app sends `X-Studio-Workspace: <id>` with every request, from the switcher. A request without it works in the default workspace: `STUDIO_DEFAULT_WORKSPACE`, else the first active one. Older clients, scripts and the Network link keep working unchanged.
- An unknown workspace is refused with 404. A user who is neither a member nor an owner is refused with 403 ("You are not a member of the workspace ..."). A paused or archived workspace is refused with 403 to everyone but an owner.
- `GET /api/health` and the `/api/workspaces` routes always answer, so the app can list the workspaces and switch even when its stored choice is refused.
- `server/store.mjs` exports the same `store` as before. For the duration of a request (and everything it awaits), `store` reads and writes that request's workspace only. This uses Node's `AsyncLocalStorage`, so no module had to change. `ctx.workspace` carries the workspace record for handlers that need it.

## 4. Routes

| Route | Who | Effect |
|---|---|---|
| `GET /api/workspaces` | anyone | `{ current, owner, workspaces: [{ id, name, status, sheetId, driveFolderId, createdAt, role }] }`. An owner sees every workspace. A user sees the active workspaces they belong to, with their role in each. With no user, every active workspace is listed (local development only) |
| `GET /api/workspaces/:id` | owner or member | one workspace |
| `POST /api/workspaces` `{ name, id?, director: { email, name } }` | owner | creates the workspace and its store, with the director as its only user, empty collections and starter limits; 409 when the id is taken |
| `PATCH /api/workspaces/:id` `{ name?, status?, sheetId?, driveFolderId? }` | owner | renames, pauses, archives or reopens a workspace, or records its Sheet and Drive folder |
| `GET /api/me` | anyone | now also `owner` and `workspace: { id, name }` |

## 5. Choosing the store

`STUDIO_STORE` selects the adapter for every workspace:

- `json` (the default): the JSON files, as today. Tests and local work use this.
- `sheets` (phase 2): `server/store-sheets.mjs`, one Google Sheet per workspace. Until phase 2 lands, choosing it fails with a plain message.

Every adapter has exactly the interface in `ARCHITECTURE.md` section 3 (`list`, `get`, `put`, `patch`, `remove`, `nextId`, `log`, `getSingleton`) and must pass the shared suite in `server/_storeContract.mjs`.

## 6. The Sheet layout (phase 2, proposed)

Each workspace's Sheet has one tab per collection. The tabs people use every day carry readable columns in a sensible order, a frozen header row, and dropdowns on status, role, type, pillar and channel. Every nested field the code needs but a person does not goes into one trailing column, `_json`. A hand edit that breaks a row is reported and that row is skipped. The stale-save check (`updatedAt`) stays.

### Pieces

| Column | From |
|---|---|
| id | `id` |
| planned date | `plannedDate` |
| planned time | `plannedTime` |
| channel | `targets[0]` (dropdown of the Channels tab) |
| type | `type` (dropdown) |
| pillar | `pillar` (dropdown) |
| status | `status` (dropdown) |
| hook | `hook` |
| caption or body | the main rendition's text: `renditions.ig.caption`, else `renditions.li.text`, else the first rendition with text |
| owner | `owner`, else `by` |
| reviewer | the last reviewer in `reviewTrail` |
| approved by | `approvedBy` |
| approved at | `approvedAt` |
| campaign | `campaignId` |
| updated at | `updatedAt` |
| `_json` | everything else: `pis`, the other renditions, `script`, `slides`, `assets`, `images`, `check`, `measure`, `review`, `escalation`, `reviewTrail`, `source`, `passthrough`, `tags`, `notes`, `targets`, `videoId`, `approvedRole`, `createdAt`, `lastBy` |

An edit in the caption or body column writes back to the rendition it was read from.

### Slots (shown as Calendar)

| Column | From |
|---|---|
| id | `id` |
| date | `date` |
| time | `time` |
| channel | `accountId` (dropdown) |
| kind | `kind` (dropdown) |
| state | `state` (dropdown) |
| piece id | `pieceId` |
| piece hook | a lookup formula on the Pieces tab, read-only |
| label | `label` |
| reason | `reason` |
| updated at | `updatedAt` |
| `_json` | `derivedFrom`, `csv`, `createdAt` and anything else |

Campaigns, Events and Users follow the same pattern (Users: email, name, role, PIN set). Versions, Log, Images and Videos keep a short readable front (id, piece or subject, who, when) with the rest in `_json`. A Readme tab explains every tab in plain language.

## 7. The company profile tabs (phase 3, proposed)

What makes the tool belong to a company. These tabs replace `data/rules.json`, `data/solutions.json`, `data/accounts.json`, the register paragraph in `server/ops/_shared.mjs` and every hard-coded company name in the code.

| Tab | Fields |
|---|---|
| Company | name, one line, what they sell, region, language, register (formal or plain, and how), brand colours (tokens), fonts, logo file (Drive id), source, confidence, approved by, approved at |
| ICP | segment, who they are, their problems, their words (the phrases they use), objections, where to reach them, source, confidence |
| Voice | kind (say, never, banned claim, allowed claim, tone example, allowed name), text, scope (any, headline or our voice, for never), note, source, confidence |
| Offer | id, public name, one line, what it removes (one problem per line), proof, source, confidence |
| Channels | the current accounts: id, label, platform, group, role, limits, the weekly and monthly rules (`_json`) |
| Calendar rules | dark days, greeting-only days, the festivals the company greets, posting times, timezone |
| Profile versions | version, at, by, source document, what changed (`_json`) |

Each field proposed by the intake operation (`profileIntake`) carries its **source** (the document and the passage) and its **confidence** (high, medium or low). Fields the source did not cover are listed as open questions, never invented. The director approves the profile field by field; only an approved profile reaches the AI operations.

## 8. The five phases

1. **Workspaces and the store interface, on JSON files** (this phase). The registry, the owner role, the switcher, one store per workspace behind the unchanged `store`, the shared store contract.
2. **The Sheets adapter.** `server/store-sheets.mjs` against a fake in-memory Sheets client, the tab layout in section 6, dropdowns, the Readme tab, bad-row reporting, one read per tab per request, and the import and export scripts.
3. **The company profile.** The tabs in section 7, the `profileIntake` operation (document upload, pasted text, the template), field-by-field review, version history and differences, `registerParagraph` read from the profile, the brand tokens per workspace, and a test that fails on any hard-coded company or person name outside the seed data and the docs.
4. **Google sign-in and Drive uploads.** Identity Services, the ID token checked on the server against the workspace's Users tab, the picker and PIN kept for local work only; media uploaded straight to the workspace's Drive folder through a resumable session.
5. **Vercel.** The static app, one function wrapping the router, `vercel.json`, and `docs/SETUP-GOOGLE.md` with every name the code expects.
