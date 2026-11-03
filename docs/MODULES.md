# Studio modules: what each one does

Companion to `ARCHITECTURE.md` (the contract). Each section is the specification a module builder works from. Shapes and routes are in the contract; this file says what the screens do and what "done" looks like. Register: formal and warm, sentence case, no emoji, no exclamation marks, anywhere in the product.

---

## A. Content (library, piece editor, review queue, checker, import)

**Purpose.** Every piece of content lives here, written once, with its form per account, its pictures, its versions and its approval state.

**Screens.**
1. **Library** (`#/content`). A list with filters: type, pillar, status, target account, tag, campaign, checker result (blocked, warnings only, passes, not checked yet; also by link, `#/content?checker=blocked`), "not yet scheduled". Columns: hook, type, pillar, status pill, checker chip, planned date, targets (short labels), last updated. Search box over hook and text (`?q=` by link). Bulk actions: mark for review, retire. "Check all" runs the checker over every piece and stores the result. Buttons: "New piece" (opens the editor on a blank piece of a chosen type) and "Propose from a moment" (opens the AI propose dialog: one sentence, optional pillar and sector; shows three P.I.S. sets with hooks; choosing one creates a draft piece through `draft`).
2. **Piece editor** (`#/content/:id`). Three columns on a laptop, stacked on a phone.
   - Left: the piece. Type, pillar, hook (word counter), P.I.S. fields (problem, impact, solution lines, close), targets (account chips), tags, campaign, notes. For `broll` and `youtube-long`: the say-and-sees table (add row, reorder, shot codes). For carousels: the seven slides with slide types. Assets list with upload and link.
   - Middle: renditions. One tab per target account with its textarea, counter against the account limit, hashtags field where the account allows them, first-comment field. Under each: the live preview from `ui.preview.*`. A "Fill from P.I.S." button runs `draft` for the missing renditions only.
   - Right: the checker (deterministic result refreshed on every change through `POST /api/pieces/:id/check`, debounced; AI check on demand) with "What the checker looks for" folded under it; the Visuals card (the pictures saved with the piece, "Make a card in Visuals" naming the template that fits the type); the version list with change notes and revert; and the AI panel: Refine (instruction box), Check with AI, Illustration prompt, "Make Shorts from this" for youtube-long. Each AI button says what it will do; a failed call says in plain words that Claude is not signed in on this Mac.
   - Footer actions by status: Save; Mark for review; Request changes (approvers); Approve (approvers, disabled while any `block` violation stands); Retire. Approved pieces are read-only with an "Edit as new version" button.
3. **Review queue** (`#/review`), phone first. Cards in order of planned date: hook, type, planned slot, then the previews, the checker summary, the change note of the latest version, and for imported pieces an "Original" toggle showing version 1 beside the proposal. Actions: Approve, Request changes (with a note), Edit. Swipe or buttons to move to the next.

**Server.** `server/rules.mjs` per the contract section 8. `server/ops/propose.mjs`, `draft.mjs`, `check.mjs`, `refine.mjs`, `reviewPass.mjs`. `server/import/run.mjs` reading `../Marketing` as the phase 1 design section 5.2 lists (reels.json, episodes.json, carousels.json plus captions.json, BROLL-SCRIPTS.md, LINKEDIN-STORY-POSTS.md, LINKEDIN-PERSONAL.md, calendar.csv) into pieces with `status: in-review` (D1 to D3, note-dec and film as `idea`), `source` set, `passthrough` holding renderer fields, assets linked to `../Marketing/social-animations/out/...` by copying into `media/library/`, and filled calendar rows into slots. Re-runnable: match on id; add a new version only when repository text differs from version 1.

**Done when.** Import brings every piece in with its assets playable from the editor; a new piece can be proposed, drafted, checked, placed and approved end to end; the review queue works at 390 px; the checker blocks a course term, an emoji, an exclamation mark, a sixth Instagram hashtag and "runs without you" as a hook, and warns on an unmarked rupee figure.

---

## B. Calendar (slots, planner, export)

**Purpose.** The posting calendar: every account's allotted slots, the dark and greeting-only days, the events, and which piece sits where. Creating a piece from a slot gives it a date; moving it changes the date.

**Screens.**
1. **Month view** (`#/calendar/:yyyy-mm`). A grid; each day shows its slots as small rows (account short label, time, kind, the piece hook or "open"), its event markers (dark, greeting-only, compliance, event, quiet window shading), and today. Filters by account group (Venture Drafters, Palak, WhatsApp) and kind. Click a day to open the day panel.
2. **Week view**. Seven columns, slots in time order, with the previews on hover.
3. **Day panel**. For each slot: "Why this slot" (the plan's reason, from the account rule's `why`), the piece (or "Pick a piece" opening a library picker filtered to types that fit the kind, each candidate with its checker chip, or "Create new" which opens the editor with the slot, its day, time, account and first fitting type pre-attached), the repurpose list (every account the piece also goes to, with the how), and status. Move a piece to another slot by drag (desktop) or a "Move" button with a date picker (phone); the server validates kind and dark days and refuses with a reason.
4. **Allotted days** panel: the weekly and monthly rules per account, read from accounts, with a link to settings.
5. **Export**: "Write calendar.csv" writes `../Marketing/POSTING/calendar.csv` in its present column order so `build-kit.mjs` keeps working.

**Server.** `server/slots.mjs`: `generate(from, to)` from accounts and events; the rules the contract and the phase 1 design (section 10, item 5) set: one LinkedIn slot a week before 16 November 2026, carousel weeks fortnightly from 25 November 2026 replacing that week's Thursday LinkedIn slot, derived entries shown as `derived`, trial entries as `optional`, dark map parsed into `dark` and `greeting-only`, quiet windows as a `quiet` marker not a block, goDark from settings marking every slot from its `from` date as dark. Routes: regenerate, calendar range, place, unplace, export-csv. Fit table (kind to piece types): reel: reel-animated, episode, broll, youtube-short; trial: reel-animated, episode; carousel: carousel; li: linkedin-text, field-story, announcement; li-carousel: linkedin-carousel, carousel; status: status-rule, greeting, episode, reel-animated; note: wa-note; yt-long: youtube-long; yt-short: youtube-short, reel-animated, episode, broll; greeting: greeting.

**Done when.** November 2026 to March 2027 generates with the filled rows from the import in place; a piece can be created from an open slot and lands with that date; moving it to a dark day is refused with the reason; the CSV export round-trips the imported rows.

---

## C. Video (YouTube case studies and the production hand-off)

**Purpose.** YouTube runs fortnightly from 16 November 2026: one 30 to 45 minute episode every other Monday at 11:00, Shorts between. The first ten are the series Built to Run: Stories, imported from `Marketing/case-studies` with a project each; the VSP-system case studies join the alternate Mondays once one is produced. Take a 30 to 45 minute case study from an idea to a recording plan the founder can execute, in the same way the VSP promotional film was made: outline, script, scene plan, footage, voice, her own clips blended in, then the edit through the brand-video pipeline (`~/.claude/skills/brand-video`, the `bv` runner).

**Screens** (`#/video`, `#/video/:id`).
1. **Projects list**: title, solution, status step, planned slot (the fortnightly Monday YouTube slot), Shorts made.
2. **Project page**, a stepper: Outline, Script, Scenes, Footage, Voice, Own clips, Edit, Done.
   - **Outline**: pick a solution from Solutions (or type a subject), add notes; "Draft outline" runs `caseStudyOutline` and shows the six chapters with minutes, on-screen items, to-camera questions and Shorts candidates; editable.
   - **Script**: "Write script" runs `videoScript` chapter by chapter; shows a text editor per chapter with a spoken-words counter and estimated minutes at 140 words a minute; a "Read-aloud marks" toggle shows numbers and acronyms as they should be spoken.
   - **Scenes**: "Plan scenes" runs `scenePlan`: one row per scene with say, sees, kind (b-roll, screen, face, card), stock search words, seconds. Editable table. The face scenes are the only ones the founder records herself; the planner keeps them to a few per chapter.
   - **Footage**: for each b-roll scene, the search words and a "Search stock" button that runs the `bv broll search` command on the Mac through the server and lists results with thumbnails; "Use" copies the clip id into the scene. A footage list and shot plan (what to film herself) are written as Markdown.
   - **Voice**: shows the paste-ready script for a voice recording (her own voice, or ElevenLabs as the pipeline allows); upload of the recorded voice file to `video/<id>/voice/`.
   - **Own clips**: upload her recorded clips; map each to a scene; the scene's kind becomes `face` with the clip path.
   - **Edit**: "Hand off to Claude Code" writes `video/<id>/script.md`, `brand.json` (from the tokens and logos), `scenes-plan.json`, `footage-list.md`, `shot-plan.md` and `HANDOFF.md` with the exact `bv` commands and a Claude Code prompt to run the brand-video skill on that folder. The step records the path and shows the commands to copy.
   - **Shorts**: "Make Shorts" runs `shortsCuts`: three to five youtube-short pieces are created in the library with the chapter and timecodes, status draft, linked to the project.
   - **Done**: records the final MP4 path, the YouTube title and description (from the linked youtube-long piece), and the chapter timestamps for the description.

**Server.** `server/video.mjs` with the routes in the contract; `server/ops/caseStudyOutline.mjs`, `videoScript.mjs`, `scenePlan.mjs`, `shortsCuts.mjs`. The outline follows the phase 1 design section 5.8 (six chapters). The `bv` runner is invoked only through `child_process` with the project path; if `bv setup` has not been run, the Footage step says so with the command.

**Done when.** A project can go from a solution to a hand-off folder with a script, scenes and a footage list without leaving the app; the Shorts appear in the library; the YouTube title and description pass the checker.

---

## D. Network: moved to the Network tool

On 29 October 2026 Palak decided the network CRM is not part of the marketing tool. People, tiers, touches, the due list, the weekly routine and the `touchSuggest` operation live in the separate Network tool (`../Network/`), for the founder only. Studio holds nothing about a person. What stays in Studio is the calendar's definition of each festival (its `tiers` and community), which Network reads over `GET /api/link/events`, and the published pieces, which Network reads over `GET /api/link/pieces`. The split, the link and the hosting plan are in `SPLIT-AND-HOSTING.md`.

---

## E. Occasions (festival greetings, compliance days, announcements; named Recurring until 30 October 2026)

**Purpose.** The things that come round: festivals, national days, compliance dates that keep owners busy, wedding seasons, and the firm's own announcements. They shape the calendar (dark and greeting-only days) and produce content (greeting pieces). One-to-one greetings to named people are prepared in the Network tool from the tiers each event carries.

**Screens.**
1. **Events** (`#/occasions`): a list and a month strip; filters by kind and scope; each event shows date, confidence, posting rule, who gets a greeting, which tiers. Edit, add, import (from `research/india-calendar-2026-11-to-2027-12.json`).
2. **Greetings**: for the next 30 days, the events with a greeting: the generated Status text, the LinkedIn line and the WhatsApp line (from `greetingTemplates` or the event's own `greetingText`), with "Generate pieces" that creates `greeting` pieces placed on the eve's Status slot (the brief's rule: greetings on Status the evening before, plain text, no offer). It is idempotent (the event records what it generated).
3. **Concepts** (added 30 October 2026). The festivals of the next twelve months that allow a concept, each with its series, how many angles of its bank are unused, and the three concepts proposed for the year (by Claude, or written by hand through the runner). "Propose concepts" runs `festivalConcept` over the unused angles; "Make the piece" creates the piece of the chosen type in review, placed on the nearest allotted slot in the three to seven days before the festival (never a dark or greeting-only day), and marks the angle as used for that year, so a festival never repeats an idea within four years. A rule card on the tab says what Occasions does. Concepts are offered only where a playful commercial note is customary (`conceptAllowed` on the event, set by an approver); every dated instance of a festival carries a `series` key.
4. **Announcements**: campaigns of kind announcement, launch, offer, event, milestone: name, dates, facts in plain lines; "Draft pieces" runs `announcement` and creates one piece per chosen target account, status draft, in the campaign; they are placed through the calendar like any other piece.
5. **Rules**: a reminder of the standing rules the module enforces: greetings only on the eve as plain text, nothing on dark days, no topical tie-ins, the mourning rule's "go dark" switch (in settings) and what it does.

**Server.** `server/recurring.mjs`: import, expansion of `annual-fixed` events to the next year, generate pieces, upcoming list, the concept routes (`GET /api/occasions/concepts`, `POST .../propose`, `POST .../make`); `server/ops/greetingTemplates.mjs`, `announcement.mjs`, `festivalConcept.mjs`. The angle bank is `data/festival-angles.json` (collection `festival-angles`: id, series, title, image, scene, solutionId, solutionName, line, usedIn[]). 

**Done when.** The India calendar imports; the calendar module shows its dark and greeting-only days; Diwali 2026 produces a greeting piece on 7 November's Status slot and carries the four tiers for Network to read; an announcement campaign drafts pieces for three accounts.

---

## F. Visuals (brand cards and illustrations; named Pictures until 30 October 2026)

**Purpose.** Every picture a week needs without a designer: Status rule cards, quote cards, hook cards, YouTube thumbnails, carousel slides, LinkedIn image posts, all on-brand, rendered in the browser from text. AI illustrations only for covers and thumbnails, behind a provider function.

**Screens** (`#/visuals`, and an "Add picture" panel inside the piece editor).
1. **Card maker**: choose a template (Status rule 1080x1920, quote 1080x1350, hook 1080x1080 and 1080x1350, YouTube thumbnail 1280x720, carousel slide 1080x1350 in the kit's four slide types, LinkedIn image 1200x1500), theme navy or light, fields (eyebrow, head with `*starred*` yellow word, body, footer), logo placement per the brand rules (official SVG only, never redrawn). Live SVG preview; "Export PNG" renders through canvas at full size and posts it to `/api/images/card` against the piece.
2. **Illustration**: prompt field pre-filled from `imagePrompts`, the house-style prefix from settings shown and locked, "Generate" calls `/api/images/illustration`; with no provider configured it says so and offers the prompt to copy. Results saved against the piece and marked approved only with the piece.

**Server.** `/api/images/card` (store a posted PNG), `/api/images/illustration` (provider function with `none` returning a clear message; `gemini` and `openai` adapters wired to REST with keys from environment variables, untested until a key exists). `server/ops/imagePrompts.mjs`.

**Done when.** Each template exports a correct-size PNG with Gilmer rendered and the logo in the right colour for the theme; a Status rule card from a piece's close line matches the brand's flat look; the illustration path fails gracefully without a key.

---

## G. Today (the strip on the calendar)

Since 30 October 2026 the calendar is the home view and Today is a strip above it: one line always (the month's approved share, posted and open counts, what is due in seven days and not ready, the review queue, your pieces, the PIN warning), and the full lists when unfolded. `#/today` opens the calendar with the strip unfolded. The lists, from `/api/today`: First the month card: allotted slots, filled, approved, posted and open; what went out; AI calls and their reported cost; actions per person this week; the last change; the storyline count (pieces naming a tool against pieces saying "system" alone); a Trust line until every approver has a PIN. Then: what is due in the next seven days and is not ready, each with its reason (open, not approved, blocked by the checker) and a link to the piece or the review card; the first eight pieces waiting for review; the pieces the checker blocks; events in the next fourteen days; video in progress. Phone first.
