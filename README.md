# Venture Drafters Studio

Brand: the same as the website. Navy `#0a3050` leads, green `#8ace8a` is the accent, and the VD logo has the angled D with a green arrow. The tokens are `app/css/tokens.css` (change the brand there only, through `--accent`); the logos in `app/img/` are copies of the website's `logo/` folder.

The in-house marketing tool: content, calendar, video production, pictures and recurring events in one place. Plain JavaScript, no build step. The contract every builder follows is `docs/ARCHITECTURE.md`.

The network CRM (people, tiers, touches) is a separate tool, **Network**, in `../Network/`, for the founder only. Studio holds nothing about a person; Network reads the calendar and the published pieces from Studio over two read-only link routes (`docs/SPLIT-AND-HOSTING.md`).

## Start here (Palak)

1. **Open it.** On the website (Vercel, see "On Vercel" below), or on a Mac with `node server/index.mjs`.
2. **Sign in to Claude Code once.** In a terminal run `claude`, then `/login`. Every AI step in Studio (propose, draft, refine, check, greetings, video scripts) runs through that login on your subscription. Until this is done each AI button shows "Run claude and /login in a terminal".
3. **Run Studio.** `cd "Venture Drafters/Studio" && node server/index.mjs`, then open http://localhost:4747. It opens on the calendar: the month at a glance with every slot, piece and event on its day, and the Today strip above it (unfold it for what is due, what is blocked, the queue and the month card). The left nav groups the rest: Content (Library, Review, Video, Visuals, Occasions) and Settings; on the phone the tab bar shows those three and a sub-bar for Content. Settings shows who you are working as (you are the approver).
4. **First hour.** Content holds all 85 existing pieces, every one in review with its video or slides. The checker has found 19 pieces that break the brief (retired lines, "best", six hashtags): in Content, choose "Blocked by the checker" under Checker, or follow the link from the Today strip on the calendar. "Check all" in Content re-runs the checker over every piece. Press "Review pass" in the review queue to have the AI propose a refined version 2 of every piece; then approve, edit or keep the original, one card at a time, on your phone or the Mac.
5. **Set your PIN** in Settings, Users, so that nobody else at this Mac can approve in your name. Today reminds you until it is set.
6. **The calendar** already carries November to 1 December as signed off, with open slots to March 2027 and every dark, greeting-only and compliance day. "Write calendar.csv" keeps the old posting kit in step.
7. **Occasions** (named Recurring until 30 October 2026) holds the India business calendar to December 2027; "Generate pieces" on the Greetings tab prepares the eve's Status greeting for each festival. The Concepts tab proposes, for each festival where a playful commercial note is customary, three ideas that tie the festival image to an owner's scene and one tool we sell (Ganesh and the laddus, the stock colour sheet), different every year from an angle bank; "Make the piece" places the chosen one three to seven days before the festival, in review. Each festival carries the network tiers it goes to; the Network tool reads them and prepares the one-to-one greetings there.
8. **Link to Network.** Settings, Link, shows the token Network needs (copy it into Network's settings as the Studio token).
9. **Video**: YouTube is fortnightly from Monday 16 November 2026 (every other Monday at 11:00, Shorts between, never fewer than two uploads a month). The ten episodes of Built to Run: Stories are in the library as long-video pieces with a video project each, placed on the ten Mondays to 22 March, with the VSP film on 5 April; the VSP-system case studies join the alternate Mondays once one is produced. "New video project" from a system in the Solutions list, then Outline, Script, Scenes, Footage, Voice, Own clips, Edit (the hand-off folder with the exact commands for the brand-video pipeline) and Shorts. `node server/import/case-studies.mjs` re-imports the episodes from Marketing/case-studies (re-runnable).

What is not done yet: posting to the platforms (phase 2), keeping data on the website (Google Sheets, see `docs/SPLIT-AND-HOSTING.md`), AI illustrations need an image API key, and the AI prompts have only been checked as prompts, never against a real model reply, because the login had expired on 29 October 2026. 

## Run it

```bash
cd "Venture Drafters/Studio"
node server/index.mjs
# Venture Drafters Studio on http://localhost:4747
```

Node 24 or later. No npm install: the server uses `node:http`, `node:fs` and `node:child_process` only. Stop it with Ctrl-C. `PORT` and `HOST` can be set in the environment.

The server serves `app/` as the single-page app (any non-API path returns `index.html`), `/media/*` from `media/` (or the media CDN when the file is not on this machine), `/data/<collection>.json` read-only, and `/api/*` as described in the contract (section 5).

A quick check from another terminal:

```bash
curl -s localhost:4747/api/health
curl -s localhost:4747/api/accounts | head -c 400
curl -s -X POST localhost:4747/api/pieces -H 'content-type: application/json' -H 'X-Studio-User: tools@vspindia.com' \
  -d '{"type":"linkedin-text","pillar":"problem","status":"draft","hook":"You are the follow-up department"}'
```

## On Vercel

The repo deploys to Vercel as it is (`vercel.json`): `scripts/build-static.mjs` copies `app/` to `public/`, the only folder served as files, and `api/index.mjs` runs the same handler as the local server for `/api/*`, `/media/*` and `/data/*`. `data/`, `server/` and the docs are never reachable as plain files. In the Vercel project leave Root Directory empty and Framework Preset on Other; `vercel.json` sets the build.

- **Data.** The function copies `data/` to `/tmp` on a cold start and works on that copy, so changes made on the hosted tool last only until the instance restarts. The app shows a banner saying so. The Google Sheets store (`docs/SPLIT-AND-HOSTING.md`, section 3) is what makes it keep data.
- **Media.** `media/` is not deployed. `/media/*` redirects to `STUDIO_MEDIA_BASE_URL`, by default the media library as it stood in commit `e6ba358` (V1), served by jsDelivr while the repo is public. The library is no longer in the repo; point `STUDIO_MEDIA_BASE_URL` at Google Drive or a bucket when it moves there. To get the files back on a Mac: `git checkout e6ba358 -- media`.
- **AI.** There is no `claude` command on Vercel. Add `ANTHROPIC_API_KEY` in the Vercel project's environment variables and the AI steps use the Claude API (`STUDIO_AI_MODE` forces either mode).
- **Limits.** Uploads over 4.5 MB (video clips) and the video hand-off folder need the Mac until Drive uploads land.

## The AI bridge

`server/ai.mjs` runs each operation through the Claude Code command line by default (`settings.aiMode: "cli"`), on the founder's subscription. The `claude` command must be logged in on the Mac: run `claude` once in a terminal and complete `/login`. With `ANTHROPIC_API_KEY` in the environment and `settings.aiMode: "api"`, the same operations use the Claude Messages API with structured outputs and prompt caching.

- `--bare` is passed to the CLI only when a token is in the environment (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`), because `--bare` skips keychain reads. Without a token the flag is dropped so the keychain login is used. `settings.cliBare: true|false` forces either way.
- If the server is started from inside a Claude Code session, the bridge strips the nested-session variables before spawning `claude`.
- Test it from Settings, AI, "Test the bridge", or:

```bash
curl -s -X POST localhost:4747/api/ai/ping -H 'content-type: application/json' -d '{"text":"Run the business. Not the follow-ups."}'
```

Batch: `POST /api/ai/batch { op, inputs: [...] }` returns `{ jobId }`; poll `GET /api/ai/jobs/:id` for progress and results. Jobs run one at a time, in order.

## Folders

```
server/   index.mjs (http), store.mjs (JSON store), api.mjs (routes), ai.mjs (Claude bridge), multipart.mjs (uploads)
          ops/      one file per AI operation; _shared.mjs holds the shared prompt text
          rules.mjs slots.mjs video.mjs recurring.mjs images.mjs   module files
          link.mjs  the two read-only routes the Network tool pulls from (X-Link-Token)
          *.test.mjs tests; _scratch.mjs starts a throwaway server on a copy of the data
app/      index.html, css/, js/ (api.js, router.js, ui.js, app.js, views/), fonts/, img/
data/     one JSON array per collection; settings.json and rules.json hold a single document
media/    uploads on this machine (ignored by git; the library is on the media CDN)
api/      index.mjs, the Vercel function
scripts/  build-static.mjs, the Vercel build
video/    one folder per video project
```

## How to add a view

1. Create `app/js/views/<name>.js` exporting `route` (a hash pattern such as `'#/video/:id'`, or an array of them), `title` (a string or a function of params) and `async render(container, params)`. `params` carries the named segments, `query` (from `#/path?x=y`) and `route`. Return a function to clean up when the view is replaced.
2. Import it in `app/js/router.js` and add it to `VIEWS`. Add a line to `NAV` only if it belongs in the main navigation.
3. Build the page from `app/js/ui.js` components (`el`, `button`, `field`, `input`, `textarea`, `select`, `chip`, `statusPill`, `card`, `table`, `dialog`, `toast`, `tabs`, `empty`, `preview.*`). Tokens only, formal labels, sentence case, no emoji.
4. Talk to the server through `app/js/api.js` (`api.get/post/put/patch/del`, `api.upload`, `api.ai`). The chosen user is sent on every request as `X-Studio-User`.

The module-owned views are `library`, `piece`, `review`, `calendar`, `video`, `occasions` and `cards`.

## How to add an AI op

1. Create `server/ops/<name>.mjs` exporting `name`, `description`, `inputFields`, `buildPrompt(input, ctx)` returning `{ system, user }`, `schema` (JSON Schema for the output; objects should carry `additionalProperties: false`) and optionally `postProcess(output, input, ctx)`.
2. Start the system text with `registerParagraph(ctx, type)` from `server/ops/_shared.mjs`: it carries the register, `rules.frame`, the say and never lists, the claims, the course terms, the Solutions list and the examples for the piece type.
3. Call it with `POST /api/ai/<name>` (the body is the input) or from the app with `api.ai('<name>', input)`. Ops are loaded on first use and reloaded when the file changes; no restart needed.

`ctx` is `{ rules, solutions, examples, accounts, settings, by }`, built by `ai.buildCtx()` from the store.

## How to add server routes (module builders)

Your module file (`server/rules.mjs`, `slots.mjs`, `video.mjs`, `recurring.mjs`, `images.mjs` or `link.mjs`) exports `routes`, an array of `{ method, path, handler }`. The handler receives `ctx = { req, res, params, query, body, by, store, ai, settings(), rules(), HttpError }`, plus the role guards `role()`, `isApprover()`, `requireApprover(what)` (manager or director), `isDirector()` and `requireDirector(what)`, and returns a JSON-serialisable value or throws `new ctx.HttpError(status, message)`. Module routes are mounted before the core routes, so a module may claim a more specific path. Export `enrichToday(payload, ctx)` to add a section to `GET /api/today`. `rules.mjs` may export `check(piece, rules, accounts)`; when it does, `POST /api/pieces/:id/approve` runs it first and refuses while any `block` violation stands.

## Tests

```bash
cd Studio && node --test server/*.test.mjs
```

`server/store.test.mjs` runs the shared store contract (`server/_storeContract.mjs`) that every store adapter must pass; `server/workspaces.test.mjs` covers workspaces, the owner and the isolation between companies. Each server test copies `server/` and `data/` to a temporary folder and starts its own server there on a free port, so the real data is never touched. Note: `node --test server/` (the bare folder) makes Node 24 run `server/index.mjs` itself, which starts the real server; use the glob.

## Workspaces: one company each

Studio is becoming a tool Venture Drafters runs for many client companies. Each company is a **workspace** with its own content, calendar, rules, users and roles; the contract and the five-phase plan are in `docs/WORKSPACES.md`. Venture Drafters is workspace one (`vd`) and its data stays in `data/*.json`. The registry of workspaces and the owners is `data/master/`. A workspace created later keeps its files in `data/workspaces/<id>/`, which git ignores.

The app sends the chosen workspace as `X-Studio-Workspace`; without it the server works in the default workspace, so scripts and the Network link work as before. An **owner** creates workspaces in Settings, Workspaces, and may enter any of them from the switcher in the left panel, working there as the director. `STUDIO_STORE` chooses the store: `json` (the default) or, from phase 2, `sheets`.

## Who may do what

Each person in Settings, Users has a role; the full contract is `docs/ROLES.md`.

- **Employee.** Writes, edits, places, moves, retires and restores pieces, makes pictures, runs the AI steps and submits a piece for review. Cannot approve.
- **Manager.** All of that, plus the review queue: approve, request changes, or send a piece to the director with a note. Records a piece as posted, regenerates slots, writes `calendar.csv`, imports calendar rows and events. A piece that must reach the director (Settings, Review routing: by default long YouTube videos, episodes, announcements and the offer and founder pillars) cannot be approved by a manager.
- **Director.** All of that, plus approving anything, returning a piece to the manager, settings, users, rules and review routing, deletes, the link token and runner answers.

The server enforces this on every route, whatever the app shows. Until hosting brings sign-in, the user is chosen in a picker and sent as a header, so a manager or the director should set a **PIN** (Settings, Users, Your PIN). Once set, the first action reserved for their role in a browser session asks for it. The PIN is stored as a hash and never shown; the Today strip on the calendar warns while a manager or director has none. Two demo users, an employee and a manager, are in the settings so the review path can be tried by switching in the picker; remove them when real people are added.

## What happens when

- **The Mac is off or asleep.** There is no tool: Studio runs on this Mac at `localhost:4747`. Hosting on the website is the next step (`docs/SPLIT-AND-HOSTING.md`).
- **The Claude login expires.** Every AI button fails with a plain message; everything else works. Run `claude` and `/login` in a terminal to restore it. The Today strip shows the state of the last AI call.
- **Two people edit at once.** A save made from a copy someone else changed meanwhile is refused with their name and time; the editor offers Reload or Save anyway, and every save stays in the versions list.

## When Claude cannot answer: the runner

With `settings.runnerWaitMs` above zero (Settings, AI, "Wait for a runner"), an AI request made while the command line is signed out waits that long for a runner instead of failing: a person or a process reads `GET /api/ai/pending`, writes the output in the operation's schema and posts it to `POST /api/ai/pending/:id/answer`. The result travels the same path as a model's answer (a version 2, an event's wording, a video outline) and the log marks it `byHand`. Any operation also accepts `handOutput` in its input for the same effect at once. This is the shape SPLIT-AND-HOSTING.md section 3 gives the hosted tool.

## The content round of 30 October 2026

Every imported piece now carries a version 2 from the review pass, written by hand in Claude's place because the login was expired, with a change note saying what changed and why; the imported text stays as version 1. Six festival greetings carry their three wordings, and an example announcement campaign holds three drafts.

## Posting, until phase 2

An approved piece has "Record as posted" in the editor: date, time, account, link and a note, recorded by hand by the person who posted it. The piece moves to Posted, the month card counts it, and the Friday measurement reads the link. Posting from Studio itself is phase 2.

## The link to Network

`GET /api/link/events?from&to` and `GET /api/link/pieces?status=published|approved` answer only with the header `X-Link-Token` equal to `settings.linkToken` (401 otherwise). The token is shown read-only in Settings, Link, with a copy button, to approvers only. Studio never calls Network. `data/settings.json` and `data/log.json` are not served under `/data/`.

## Data

- Every write is atomic (temp file, then rename) and kept in memory.
- A `PUT` or `PATCH` on a piece creates a version when any of `hook`, `pis`, `renditions`, `script`, `slides` or `notes` changed. `POST /api/pieces` creates version 1. Send `changeNote` in the body to label the version; it is not stored on the piece.
- A text change to an approved piece sends it back to `in-review`.
- `POST /api/pieces/:id/approve` is for approvers only (`settings.users[].approver`).
- `data/log.json` records every change and every AI call; it is ignored by git.
