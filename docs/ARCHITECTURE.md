# Studio: the build contract

Venture Drafters Studio is the in-house marketing tool: content, calendar, video production, pictures and recurring events in one place. The network CRM is a separate tool, Network (`../Network/`), which reads from Studio over the link routes in section 5; see `docs/SPLIT-AND-HOSTING.md`. Studio holds nothing about a person. This file is the contract every builder follows. It is deliberately exact about names, shapes and file ownership so that several people (or agents) can build modules at the same time without stepping on each other.

Written 29 October 2026. The product design is in `docs/PRODUCT.md`; the phase 1 content design it grew from is in `../Marketing/docs/superpowers/specs/2026-10-29-content-studio-phase1-design.md`.

---

## 1. Principles

1. **Plain JavaScript, no build step.** ES modules in the browser, Node 24 on the server. No bundler, no framework, no TypeScript. The only npm dependencies allowed are the ones listed in section 9.
2. **Local first, hostable later.** Tonight it runs on the Mac at `http://localhost:4747`. Every read and write goes through one store module with a small interface, so a Supabase adapter can replace the JSON-file adapter without touching the app.
3. **AI through the Claude Code command line by default.** `claude -p` runs on the founder's subscription, so no API bill. The same function can use the Claude API when `ANTHROPIC_API_KEY` is set. Every AI operation has a fixed input shape and a JSON schema for its output.
4. **The brief is data.** `data/rules.json` holds what we say and never say, the limits per account and the checklist. The checker and every AI prompt read it. Nothing about the brand is hard-coded in a view.
5. **Approval is a state, enforced on the server.** There are three roles, `employee`, `manager` and `director`; `docs/ROLES.md` is the contract for who may do what and for the review path (`in-review`, then `approved` by a manager, or `director-review` and then `approved` by the director, with `changes-requested` from either). A piece becomes `approved` only through `POST /api/pieces/:id/approve`; a `PUT`, `PATCH` or `POST` that would move a piece into `approved` or `director-review` is refused with 403. A manager or the director may approve, request changes, send a piece to the director, record it as posted, regenerate slots, run the calendar import and export, and the recurring import and expansion; only the director changes settings and rules, deletes, sees the link token and answers runner requests (403 otherwise, naming the role). A manager or the director may set a PIN (`users[].pinHash`, a SHA-256 of the PIN, never served); when set, those actions also need the header `X-Studio-Pin`, or they are refused with `{ detail: { pin: true } }` and the app asks for it once per session. A `PUT` or `PATCH` on pieces, events, campaigns, videos, settings or rules that carries an `updatedAt` older than the stored one is refused with 409 `{ detail: { conflict, by, at } }` unless the body carries `force: true`.
6. **Phone for reviewing, Mac for making.** Review, approve and read the day's list must work at 390 px wide. Editing, the calendar and video planning are built for a laptop.
7. **Brand tokens everywhere.** `app/css/tokens.css` is the Venture Drafters token file. Navy, warm yellow, Gilmer, Plus Jakarta Sans, JetBrains Mono. No gradients, no emoji, sentence case, formal register in every label and message.

---

## 2. Folder layout and ownership

```
Studio/
  README.md                how to run it
  docs/                    ARCHITECTURE.md (this), PRODUCT.md, MODULES/*.md
  research/                research notes and the India calendar JSON
  server/
    index.mjs              http server: static app, /api, /media, /data   [core]
    store.mjs              store interface + JSON-file adapter             [core]
    workspaces.mjs         the workspace registry, owners, /api/workspaces  [core]
    api.mjs                route table, validation, auth stub              [core]
    ai.mjs                 Claude bridge (CLI or API) + operation registry [core]
    ops/                   one file per AI operation (prompt + schema)     [content, video, recurring, pictures]
    rules.mjs              deterministic checker                           [content]
    slots.mjs              slot generation from accounts + calendar        [calendar]
    video.mjs              video project files and the bv hand-off         [video]
    recurring.mjs          event expansion, greeting generation            [recurring]
    images.mjs             card storage and the illustration provider      [pictures]
    link.mjs               read-only routes for the Network tool            [core]
    import/                import from ../Marketing (run once, re-runnable)[content]
  app/
    index.html             shell: nav, router outlet, toast, dialog        [core]
    css/tokens.css         copied from the design system                   [core]
    css/app.css            layout, components                               [core]
    js/api.js              fetch wrapper for /api                           [core]
    js/router.js           hash router, view registry                      [core]
    js/ui.js               shared components (see section 7)               [core]
    js/views/today.js      the Today strip's lists and summary (drawn by the calendar)  [core]
    js/views/library.js    content library                                  [content]
    js/views/piece.js      piece editor + AI panel + checker + preview      [content]
    js/views/review.js     review queue, phone first                        [content]
    js/views/calendar.js   month and week planner                           [calendar]
    js/views/video.js      video projects                                   [video]
    js/views/recurring.js  events, greetings, announcements                 [recurring]
    js/views/cards.js      brand card maker (SVG to PNG)                    [pictures]
    js/views/settings.js   accounts, rules, solutions, users, go-dark       [core]
    js/cards/*.js          card templates                                   [pictures]
    fonts/, img/           Gilmer, logos
  data/                    the JSON store (one file per collection)
  media/                   uploaded and generated files, served at /media
  video/                   one folder per video project (bv projects)
```

A builder edits only the files marked with their module name, plus their own `server/ops/*.mjs` and `docs/MODULES/<module>.md`. Core files change only through the core owner. If a module needs a shared component, it asks for it in `js/ui.js` through the core owner rather than copying.

---

## 3. The store

`server/store.mjs` exports one object with this interface. Every collection is a JSON array in `<dataDir>/<collection>.json`, kept in memory and written atomically (write to a temp file, rename) after each change.

Each workspace (one company, `docs/WORKSPACES.md`) has its own store, made by `createJsonStore(dataDir)` (or, from phase 2, the Sheets adapter chosen by `STUDIO_STORE`). The exported `store` hands every call to the store of the current request's workspace through `withWorkspace` (Node's `AsyncLocalStorage`), so modules keep importing `store` unchanged; outside a request it is the default workspace's store, `data/`. Every adapter must pass `server/_storeContract.mjs`.

```js
store.list(collection, filterFn?)         // -> array (copies)
store.get(collection, id)                 // -> object or null
store.put(collection, obj)                // insert or replace by obj.id; sets updatedAt; returns the stored copy
store.patch(collection, id, partial)      // shallow merge; returns the stored copy
store.remove(collection, id)              // -> boolean
store.nextId(prefix)                      // -> 'prefix-0001' style, unique within the collection file
store.log(who, what, ref)                 // appends to data/log.json
```

Collections: `pieces`, `versions`, `slots`, `accounts`, `rules` (single document, id `rules`), `solutions`, `events`, `campaigns`, `videos`, `settings` (single document, id `settings`), `log`, `images`, `festival-angles`. (`people` and `touches` moved to the Network tool on 29 October 2026.)

Ids are strings. Existing content ids are kept exactly (`e01-follow-up`, `c1-five-signs`, `B1`, `L1`). New ids come from `nextId`: `pc-` pieces, `sl-` slots, `ev-` events, `vd-` videos, `cp-` campaigns, `im-` images.

Every record has `id`, `createdAt`, `updatedAt` (ISO strings) and, where a person made it, `by` (an email or name from settings).

---

## 4. Data shapes

All optional fields may be absent. Dates are `YYYY-MM-DD`; times are `HH:MM` 24-hour IST; timestamps are ISO.

### 4.1 Piece
```js
{
  id, type,            // type: reel-animated | episode | carousel | broll | linkedin-text | linkedin-carousel |
                       //       status-rule | greeting | wa-note | youtube-long | youtube-short | field-story | announcement | image-post
  pillar,              // problem | science | glimpse | offer | founder | greeting | announcement
  status,              // idea | draft | in-review | director-review | changes-requested | approved | scheduled | posted | measured | retired
                       //   (the review path and who moves a piece between them: docs/ROLES.md)
  hook,                // 8 words or fewer
  pis: { problem, impact, solution: [..], close },
  renditions: {        // one piece written once; its form per account
    ig: { caption, hashtags: [..], firstComment },
    li: { text, firstComment },          // Palak's LinkedIn
    liCo: { text },                      // company page reshare line
    fb: { text },
    waStatus: { text },
    waNote: { text },
    yt: { title, description, tags: [..] }
  },
  script: [ { say, sees, codes: [..], seconds } ],   // broll and youtube-long
  slides: [ { t: 'cover'|'point'|'list'|'cta', eyebrow, head, body, n, items: [..] } ],
  assets: [ { id, kind: 'video'|'image'|'pdf'|'slides'|'cover'|'photo'|'clip', path, label, w, h, seconds } ],
  images: [ imageId ],
  source: { file, id },          // where it came from in ../Marketing
  passthrough: { ... },          // renderer fields Studio does not edit
  owner, notes, tags: [..],
  campaignId, videoId,
  targets: [ accountId ],        // where it goes (main account first)
  plannedDate, plannedTime,      // mirrors the slot it sits in, for list views
  measure: { postedLink, postedAt, realReplies, messages, callsBooked, sends, shares, saves, quotes: [..], note },
  check: { at, violations: [ { rule, severity: 'block'|'warn', text, fix } ], passed },
  approvedBy, approvedAt, approvedRole,          // set by approve only
  review: { note, by, at },                      // the latest change request
  escalation: { note, by, at },                  // the manager's note to the director
  reviewTrail: [ { at, by, role, action, note? } ]   // server-written: submitted | approved | escalated | changes-requested | returned
}
```

### 4.2 Version
`{ id, pieceId, n, snapshot: <piece without check/measure>, by, at, changeNote }`
Created by the server on every `PUT /api/pieces/:id` whose text fields changed, and on approve.

### 4.3 Slot
```js
{ id, date, time, accountId, kind,   // kind: reel | trial | carousel | li | li-carousel | status | status-opt | note | yt-long | yt-short | reshare | family | greeting
  state,            // open | filled | dark | greeting-only | derived | optional
  pieceId, label, reason, derivedFrom: slotId }
```
Generated by `server/slots.mjs` from `accounts` (their weekly and monthly rules) and `events` (dark, greeting-only). Regenerated idempotently: filled slots are never deleted; open ones are rebuilt.

### 4.4 Account
```js
{ id, label, short, group,        // group: Venture Drafters | Palak | WhatsApp
  role, platform,                 // platform: instagram | linkedin | facebook | youtube | whatsapp | in-person
  limits: { textMax, hashtagsMax, hashtagsWhere: 'end'|'none'|'bottom', hookChars, firstCommentLinks: true },
  weekly: [ { day: 'Mon', time: '19:30', kind, label, optional, alternate, derived, why,
              every: 2, anchor: 'YYYY-MM-DD',    // a fortnightly rule fires every `every` weeks from the anchor (the YouTube long video, every other Monday from 2026-11-16)
              scheduledUpload: true } ],        // generated even on a dark or greeting-only day (an upload needs no live reply); go dark still holds it
  monthly: [ { rule: '2nd Wed'|'2nd Sat', time, kind, label, skipMonths: [..], why } ],
  weekly:  [ { day, time, kind, label, why, every?: 2, anchor?: 'YYYY-MM-DD', from?: 'YYYY-MM-DD', scheduledUpload?: true } ],   // every + anchor make a fortnightly rule; scheduledUpload lets a YouTube upload sit on a dark or greeting-only day
  repurposeTo: [ { accountId, how, when: { kind } } ],
  openSlotsFrom, openSlotsTo }
```
Seeded from `../Marketing/POSTING/channels.json`.

### 4.5 Rules (single document)
```js
{ id: 'rules',
  voice: [ 'Short sentences. One idea each.', ... ],
  say: [..], never: [ { phrase, scope: 'any'|'headline'|'ourVoice', note } ],
  courseTerms: [..],                 // always block
  claimsOk: [..], claimsBlocked: [..],
  allowNames: [..],                  // names the brief permits
  limits: { hookWords: 8, igHashtags: 5, liHashtagsBottom: 3, liHookChars: 210, exclamation: 0, emoji: 0 },
  checklist: [ { id, text, auto: true|false } ],
  examplesByType: { 'linkedin-text': [..], carousel: [..], ... },   // signed-off copy for the AI
  frame: '...'                        // the storyline paragraph the AI is given
}
```

### 4.6 Solution
`{ id, publicName, oneLine, removes: [ problem lines ], proofAssetId }` (the public-safe register; never an internal name).

### 4.7 Person and 4.8 Touch
Moved to the Network tool (`docs/SPLIT-AND-HOSTING.md`). Studio holds neither shape.

### 4.9 Event
```js
{ id, date, name, kind,        // greeting | dark | greeting-only | compliance | event | wedding-muhurat | budget | mourning | announcement | quiet
  scope,                       // national | mp | indore | ours
  greetingText, whoGets,       // everyone | hindu | muslim | sikh | christian | jain | buddhist | business-only | none
  postingRule,                 // normal | greeting-only | dark | quiet
  confidence, source,
  recurrence,                  // annual-fixed | lunar | manual | none
  tiers: [..],                 // which network tiers the festival goes to; the calendar's definition, read by Network
  templates: { status, linkedin, whatsapp },   // whatsapp is the one-to-one line Network addresses to each person
  series,                      // the festival across years (diwali, holi, ganesh-chaturthi, ...), the key into the angle bank
  conceptAllowed,              // true where a playful commercial note is customary; an approver may change it
  concepts: { '2026': { proposals: [..], at, mode, by } },   // the three concepts proposed for that year
  generated: { pieceId, conceptPieceId, conceptAngleId } }

### 4.9a Festival angle (collection `festival-angles`, file `data/festival-angles.json`)
`{ id, series, title, image, scene, solutionId, solutionName, line, usedIn: [ year, .. ] }`. An angle used for a festival is not offered again within four years.
```
Seeded from `research/india-calendar-2026-11-to-2027-12.json` and `channels.json` dark and events maps.

### 4.10 Video project
```js
{ id, pieceId, title, solutionId, status,   // outline | script | scenes | footage | voice | own-clips | edit | done
  outline: [ { n, title, minutes, onScreen: [..], toCamera: [..], shorts: [ { hook, from, to } ] } ],
  script: '...',                               // the full spoken script, chapters separated by headings
  scenes: [ { n, say, sees, kind: 'broll'|'screen'|'face'|'card', clipPath, start, seconds } ],
  footage: [ { scene, query, ids: [..], own: true|false, path } ],
  ownClips: [ { path, label, seconds, scene } ],
  bvProject,                                   // path under video/
  shortsPieceIds: [..], notes }
```

### 4.11 Campaign
`{ id, name, kind: 'announcement'|'launch'|'offer'|'event'|'milestone', from, to, pieceIds: [..], notes }`

### 4.12 Settings (single document)
```js
{ id: 'settings', users: [ { email, name, role: 'employee'|'manager'|'director', pinHash? } ],
  reviewRouting: { directorTypes: [..], directorPillars: [..], directorOnWarnings },   // ROLES.md section 2
  model: 'sonnet'|'opus'|'haiku'|<id>, model: 'sonnet'|'opus'|'haiku'|<id>,
  aiMode: 'cli'|'api', imageProvider: 'none'|'gemini'|'openai', timezone: 'Asia/Kolkata',
  goDark: { on: false, from, to, reason },
  linkToken,                 // the shared secret the Network tool sends as X-Link-Token
  studioRoot, marketingRoot }
```

### 4.13 Image
`{ id, pieceId, kind: 'card'|'illustration'|'thumbnail', template, prompt, provider, path, w, h, approved }`

---

## 5. The HTTP API

All routes are under `/api`. JSON in, JSON out. Errors: `{ error: 'message' }` with a 4xx or 5xx status. The server works in the workspace named by the `X-Studio-Workspace` header, else the default one, and refuses a user who is neither a member of it nor an owner (403); `ctx.workspace` is the workspace record (`docs/WORKSPACES.md` section 3). The server adds `by` from the `X-Studio-User` header (set by the app from the chosen user in settings; a sign-in comes with hosting) and reads `X-Studio-Pin` for actions reserved for a manager or the director. The settings document is served without PIN hashes, with each user's `role` plus a derived `approver` (manager or director) and `pinSet`, with `reviewRouting` filled with its defaults, and, to anyone but the director, without `linkToken`. Module handlers get `ctx.role()`, `ctx.isApprover()` and `ctx.requireApprover(what)` (both meaning manager or director), `ctx.isDirector()` and `ctx.requireDirector(what)`.

Generic, for every collection in section 3:
```
GET    /api/:collection?field=value&...   list, exact-match filters on top-level fields
GET    /api/:collection/:id
PUT    /api/:collection/:id               replace (creates if missing); pieces get a version
PATCH  /api/:collection/:id
DELETE /api/:collection/:id
POST   /api/:collection                  create with nextId
```

Module routes:
```
GET  /api/workspaces                     { current, owner, workspaces: [{ id, name, status, sheetId, driveFolderId, createdAt, role }] }
GET  /api/workspaces/:id                 owner or member
POST /api/workspaces                     { name, id?, director: { email, name } }   owner only
PATCH /api/workspaces/:id                { name?, status?, sheetId?, driveFolderId? }  owner only
GET  /api/me                             { email, name, role, owner, workspace: { id, name }, pinSet, can: { approve, escalate, approveForDirector, settings, delete, recordPosted } }
GET  /api/review/queue                   { manager: [in-review], director: [director-review], mine: [caller's in review or sent back] }, oldest first, each with needsDirector, needsDirectorWhy
POST /api/pieces/:id/approve             manager (not when needsDirector: 409 { detail: { needsDirector, why } }) or director, PIN when set -> approved, approvedRole, version
POST /api/pieces/:id/escalate            { note }   manager or director: in-review -> director-review
POST /api/pieces/:id/request-changes     { note }   manager from in-review, director from either -> changes-requested
POST /api/pieces/:id/return              { note }   director: director-review -> in-review
POST /api/settings/pin                   { pin }    sets or clears the PIN of the current manager or director
POST /api/content/check-all              runs the checker over every piece and stores the result
POST /api/pieces/:id/check               runs rules.mjs; stores piece.check; returns it
POST /api/pieces/:id/place               { slotId } places into a slot (validates kind, dark day)
POST /api/pieces/:id/unplace
GET  /api/pieces/:id/versions
POST /api/pieces/:id/revert              { versionId }

POST /api/ai/:op                         runs an AI operation (section 6); body is the op input; `handOutput` in the body is used as the answer and logged as written by hand
GET  /api/ai/ops                         lists operations with their input fields
GET  /api/ai/pending                     requests waiting for a runner (the login expired and settings.runnerWaitMs > 0)
POST /api/ai/pending/:id/answer          { output } answers one, director only; logged as ai.runner.answer
POST /api/pieces/:id/record-posted       { postedAt, accountId, url?, note? } manager or director; marks an approved piece posted, by hand, until posting is connected

POST /api/slots/regenerate               { from, to }
GET  /api/calendar?from=&to=             slots joined with pieces and events for the range
POST /api/calendar/export-csv            writes ../Marketing/POSTING/calendar.csv in its current shape

GET  /api/link/events?from=&to=          read-only, for the Network tool; header X-Link-Token = settings.linkToken, else 401
GET  /api/link/pieces?status=published|approved   read-only, same guard; the shapes are in SPLIT-AND-HOSTING.md section 2

POST /api/recurring/generate             { from, to, eventId? } -> greeting pieces on the eve's Status slot
GET  /api/occasions/concepts?days=       festivals in the next year that allow a concept, with unused angles and the year's proposals
POST /api/occasions/concepts/propose     { eventId, handOutput? } -> three concepts from festivalConcept, saved on the event
POST /api/occasions/concepts/make        { eventId, index, type? } -> the piece in review, placed three to seven days before; the angle marked used
GET  /api/recurring/upcoming?days=30

POST /api/video                          create project from a youtube-long piece or a solution
POST /api/video/:id/outline | script | scenes | footage   AI steps
POST /api/video/:id/handoff              writes video/<id>/script.md, brand.json, shot-plan.md, footage-list.md and the Claude Code prompt
POST /api/video/:id/own-clips            registers uploaded clips to scenes

POST /api/media                          multipart upload -> /media/<file>; returns { path, w, h, seconds }
POST /api/images/card                    { template, fields, w, h } -> renders? No: cards render in the browser; this stores the PNG the browser posts
POST /api/images/illustration            { pieceId, prompt } -> provider call or { error: 'no provider configured' }
GET  /api/today?date=                    one call for the Today view: the month card (slots, posted, AI calls and cost, actions by person, last change, PIN state, `month.role`), `reviewCounts: { manager, director, mine, changesRequested }`, slots due this week with what is missing, pieces in review (in-review, director-review, changes-requested), the checker's blocked list and the storyline count, events in 14 days, video steps
```

---

## 6. The AI bridge and operations

`server/ai.mjs` exports `run(opName, input, ctx)`. It loads `server/ops/<opName>.mjs`, which exports:

```js
export const name = 'draft';
export const description = '...';
export const inputFields = [ 'pis', 'type', 'targets' ];
export function buildPrompt(input, ctx)  // ctx = { rules, solutions, examples, accounts, settings }
                                         // returns { system, user }
export const schema = { type: 'object', properties: {...}, required: [...] };
export function postProcess(output, input, ctx)  // optional
```

The bridge:
- In `cli` mode runs `claude -p --bare --output-format json --json-schema '<schema>' --model <settings.model> --system-prompt '<system>' --tools "" --no-session-persistence` with the user prompt on stdin, parses the JSON result, and returns `{ output, usage, mode: 'cli' }`. Timeout 180 s. One call at a time per operation name; a queue for batch jobs with progress at `GET /api/ai/jobs/:id`.
- In `api` mode calls the Claude Messages API with the same system and user text and a tool whose input schema is `schema`, with prompt caching on the system block. The builder reads the current Claude API reference before writing this.
- Every call is logged with op, input summary, duration, mode.

Operations (owner in brackets):
- `propose` [content]: owner moment or topic -> three P.I.S. sets with three hooks each.
- `draft` [content]: P.I.S. set + type + targets -> a full piece (renditions, script or slides).
- `check` [content]: piece -> violations the word lists cannot catch, with fixes.
- `refine` [content]: piece + instruction -> new text + changeNote. Used by the review pass.
- `reviewPass` [content]: batch over pieces in `in-review` with version 1 only; one `refine` each, standing instruction from rules.frame.
- `imagePrompts` [pictures]: piece -> illustration prompt (prefix from settings) + card texts.
- `caseStudyOutline` [video]: solution + notes -> outline (4.10).
- `videoScript` [video]: outline -> script by chapter, spoken register, numbers written as words where needed.
- `scenePlan` [video]: script -> scenes with say, sees, kind and stock search queries.
- `shortsCuts` [video]: script -> three to five Shorts, each a complete P.I.S. under 60 seconds, as youtube-short pieces.
- `greetingTemplates` [recurring]: event + tiers -> Status text, LinkedIn post, WhatsApp line; plain, no offer. The WhatsApp line is kept on the event for Network, which addresses it to each person there.
- `announcement` [recurring]: campaign facts -> pieces per target account.
- `festivalConcept` [occasions]: a festival instance + its unused angles -> three concepts, each the idea in one line, the tool it sells, the scene, and draft lines for a Reel hook and caption, a Status line, a LinkedIn opening and a carousel cover.

Prompt rules shared by every op (in `server/ops/_shared.mjs`): the register paragraph; rules.frame; rules.say and never; claimsOk and claimsBlocked; the Solutions list as the only allowed solution names; the examples for the type; "return only the JSON the schema asks for".

---

## 7. UI conventions (`app/js/ui.js`)

Exports small functions that return DOM nodes: `el(tag, attrs, children)`, `button({ kind: 'primary'|'secondary'|'ghost'|'danger', label, onClick, icon })`, `field({ label, input })`, `input`, `textarea({ counter: max })`, `select`, `chip({ label, tone })`, `statusPill(status)`, `card({ title, body, footer })`, `table({ columns, rows })`, `dialog({ title, body, actions })`, `toast(message, tone)`, `tabs`, `empty({ title, hint })`, `preview.instagram(piece)`, `preview.linkedin(piece)`, `preview.status(piece)`, `preview.youtube(piece)`.

Layout (grouped on 30 October 2026): the calendar is the home view; a Content group holds Library, Review, Video, Visuals and Occasions; Settings stands alone. The left nav shows the group with its items; the phone tab bar shows Calendar, Content and Settings, with a sub-bar for the Content group's items. The old Today page is a strip above the calendar (one line folded, the lists unfolded); `#/today` redirects to `#/calendar?today=1`. Page title in Gilmer. Eyebrow labels in small caps. Status pills use the status colours only (green done, risk amber, late red); brand yellow is for the primary action and highlights. Numbers and dates in JetBrains Mono. No emoji anywhere, including icons: use inline SVG line icons from `app/img/icons.svg` (sprite).

Hash routes: `#/calendar` (home), `#/calendar/:yyyy-mm`, `#/content`, `#/content/:id`, `#/review`, `#/video`, `#/video/:id`, `#/occasions`, `#/visuals`, `#/settings`; `#/today` redirects to the calendar with the Today strip open.

Every view exports `{ route, title, render(container, params) }` and registers itself in `app/js/router.js`'s list.

---

## 8. The checker (`server/rules.mjs`)

`check(piece, rules, accounts)` returns `{ passed, violations: [ { rule, severity, field, text, fix } ] }`. Severity `block` stops approval; `warn` is shown. Checks, in order:

1. Course terms (block), anywhere in any public field.
2. `never` phrases: scope `any` block; scope `headline` block only in `hook`, the first line of `li.text`, slide 1, `yt.title`; scope `ourVoice` warn.
3. Emoji (block), exclamation marks (block), ALL CAPS words of 4+ letters (warn).
4. Hook over `limits.hookWords` (warn).
5. Instagram hashtags over `igHashtags` or not at the end (block); LinkedIn hashtags in the body (block) or more than 3 at the bottom (warn).
6. Text over the account's `textMax` (block).
7. Figures: `Rs` amounts, `%`, hours, lakh, crore, `x` multiples not within 60 characters of "example" or "illustrative" (warn).
8. Firm-like names not in `allowNames` (warn): capitalised multi-word or suffix pattern.
9. Whole Hindi sentences (Devanagari runs over 12 characters, or more than one Hinglish tag) (warn).
10. A solution line that names nothing in Solutions and contains "system" alone (warn: say the tool).
11. "runs by itself", "without people", "on autopilot", "assigns itself" (block).
12. Claims from `claimsBlocked` (block).
13. An unfilled square-bracket placeholder (block, raised from warn on 30 October 2026).
14. The storyline: a piece that speaks of a system, software, a screen or a list and names no tool from Solutions, and carries none of the brief's standing lines (warn; founder, greeting and announcement pieces are exempt).
15. The rupee glyph where the brief writes "Rs" (warn).
16. A LinkedIn post that does not end with one question (warn).
17. A Status rule with no `*starred*` phrase (warn).
18. Instagram hashtags in mixed case (warn).

Checks 11 and 2 also catch "fixes itself", "sort themselves" and "moves by itself", added after the content audit of 30 October 2026.

Public fields: hook, every rendition text and title, slides, script `say`, pis.

---

## 9. Dependencies and running

`server/package.json` dependencies: none required for the server (use `node:http`, `node:fs`, `node:child_process`). Allowed if needed: `busboy` for uploads. The app has no dependencies. Fonts load locally. No internet is needed except for AI calls and the image provider.

```bash
cd Studio && node server/index.mjs        # http://localhost:4747
node server/import/run.mjs                # import from ../Marketing (re-runnable)
```

`data/` is committed except `data/log.json`; `media/` and `video/*/build` are ignored.

---

## 10. Hosting later (not built tonight)

Decided on 29 October 2026 and written in `docs/SPLIT-AND-HOSTING.md` section 3: each tool becomes its own Vercel project under a subdomain of the website, with a Google Sheet as the store (one tab per collection, behind the same store interface) and a Drive folder for media; Google sign-in checks the email against the Users tab; AI runs through a small runner on the Mac that polls a Jobs tab and answers through `claude -p`, or through the API with a key. The Supabase route in earlier drafts is the fallback if Sheets strains.
