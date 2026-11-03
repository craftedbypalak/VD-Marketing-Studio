# Venture Drafters Studio, phase 1: plan and prepare content

Design document, 29 October 2026. Written for a builder who will plan and build this without going back to Palak. Where the document says "(my call)" the choice was made by the designer of this document and Palak can overturn it; where it says "(Palak)" it is her decision, recorded as she gave it; where it says "(guess)" it is an assumption she has not yet confirmed.

The brief, `00-brief.md`, wins over this document on anything about what Venture Drafters says, to whom, and how it looks.

---

## 1. Intent

Venture Drafters is marketed by one founder and, at most, one helper. Today the content lives in a dozen files across a git repository: JSON for the animated Reels and episodes, Markdown for the b-roll scripts and LinkedIn posts, a CSV calendar, a JSON file of channel rules, and a script that builds a clickable calendar page. It works, but every new piece is hand-written, nothing checks it against the brief, there is no picture-making step beyond the animation renderer, and approval is a conversation rather than a state.

Phase 1 builds **Studio**: one private web app where every piece of content is kept, planned onto the calendar, drafted with AI in the brief's voice, given its pictures, and approved. The posting of approved pieces is **phase 2 and out of scope here** (Palak: "content first, then posting; there are many tools for posting"). Phase 1 ends when an approved, finished piece can be handed to any posting tool or to Palak's own hands with nothing left to write, cut or check.

**Why now.** The first posting week is 1 November 2026. The storyline is being widened from "a systems partner that runs the follow-up on your sheet" to "business automation: we build the tools that run a business" (Palak, 29 October). Every existing piece needs a review against that widened story, and the review should happen inside the tool that will hold the content from then on, not in another round of file edits.

---

## 2. Goals, non-goals, anti-goals

**Goals**
1. Every existing piece (23 animated Reels, 10 episodes, 9 carousels, 12 b-roll scripts, 14 LinkedIn posts, the Status rules, greetings, the planned December note and film) is in the library on day one, each with a proposed refined version and a note saying what changed and why, waiting for Palak's approval. Nothing is silently overwritten.
2. From one owner moment or topic, the AI step produces a full set of drafts: the Problem, Impact, Solution and close lines; hook options; a caption for each channel; a b-roll script in the say-and-sees table form; seven carousel slides; a one-line Status rule; a YouTube title and description. All in the brief's register.
3. Every draft is checked automatically against the brief (the say and never-say lists, the claim rules, emoji, exclamation marks, hashtag limits, length limits, the "runs without you" headline rule, course terms, client names) and the violations are shown beside it.
4. Pictures: brand cards made deterministically from text, and AI illustrations in one locked house style, both saved against the piece.
5. A planner that shows the allotted slots, dark days and events for every account and lets a piece be placed in a slot. It replaces `POSTING/calendar.csv` and `calendar.html`.
6. An approval gate. A piece cannot be marked ready until Palak approves it. Approved content is frozen; any edit makes a new version and sends it back for review.
7. A log of what each posted piece earned (real replies, messages, calls, sends), entered by hand in phase 1, with the Friday review view the November plan already describes.
8. A format and an outline generator for the 30 to 60 minute YouTube case studies.
9. Works on a phone for review and approval; drafting is done on a Mac.

**Non-goals (phase 1)**
- Posting, scheduling to platforms, or reading platform analytics. The tool hands off; it does not publish.
- Rendering the animated videos. The renderer in `social-animations/` stays on the Mac and keeps its JSON files as its source. Studio links to the rendered files; it does not re-render them.
- Video editing of any kind.
- Replacing the research, ICP, positioning or sales documents. They stay as files; Studio holds the brief's rules as data because the AI and the checker need them.
- Multiple brands. This is for Venture Drafters only.

**Anti-goals (a failure even if it works)**
- A draft that breaks the brief going out because the tool let it. The checker and the gate are the point.
- AI pictures that pretend to be real: a fake screenshot of a system, a staged "real owner" photo, an invented client. The brief allows real footage and flat brand illustration. AI images are illustration and must read as such.
- Casual or hype copy from the AI. The register is formal and warm; the AI is given the brief and the existing approved pieces as its only examples.
- A tool that only Palak can operate, or that needs a developer to add a slot or a rule.
- API keys in a page anyone can view-source.

---

## 3. Who uses it, and the moments it serves

Two users: **Palak** (founder; writes, approves, posts) and **a helper** (drafts and prepares; cannot approve). Both sign in with Google; access is an allow-list of email addresses.

The moments:
- **Sunday evening, Mac.** The helper opens the week in the planner, sees Monday's Reel slot is empty, picks an episode from the library or asks the AI for a new piece from one owner moment, drafts, runs the check, attaches the pictures, and marks it for review.
- **Monday morning, phone.** Palak opens the review queue, reads the piece as it will appear on each channel, sees the checker's result, edits a line or approves. The piece is now ready, and she posts it by hand (phase 1) at 7:30 pm.
- **Friday, 15 minutes.** Palak opens the week, enters replies, messages, calls and sends against each posted piece, and reads the review view.
- **Once, in the first week.** Palak works through the imported library: each piece shows its original and the proposed refinement side by side with the change note. She approves, edits or keeps the original.
- **Once a month.** Palak chooses a VSP system for the next YouTube case study, gets an outline, and records from it.

---

## 4. Constraints

1. **The brief wins.** `00-brief.md` sections 4 and 6 (what we say and never say; visual rules) are the law. Studio stores them as data and the AI prompt and the checker are built from that data, so a change to the brief is a change in one place.
2. **No client can be named, no result promised**, until a client agrees in writing. The checker treats any named company or any rupee or hours figure not marked as an example as a violation.
3. **Course terms never appear.** BCI, Systems Master, FMS, PMS, MIS, PC, PISAT, autopilot: banned in every field the public could see. (`Sales/SALES-TOOLS-PLAN.md`, rule one.)
4. **Visual rules.** Navy `#0a3050`, warm yellow `#f9c74f`, white, surface `#f5f7fa`, border `#dde6ee`, yellow tint `#fef6dc`, yellow ink `#7a5500`; green `#8ace8a` for status only. Gilmer for headings, Plus Jakarta Sans for body, JetBrains Mono for numbers. Flat colour, no gradients, no emoji. The tool itself is built in these tokens (`design-system/venture-drafters-tokens.css`), so it looks like the brand it serves.
5. **Hosting.** Palak wants the tool on her website. The website is a static site (plain HTML, CSS, JS, no build step) on GitHub Pages. A static page cannot hold secrets or call paid APIs safely, so the tool needs a small backend (section 6).
6. **Dark days, events and the mourning rule** from `POSTING/channels.json` and the brief, section 5, must be honoured by the planner: a dark day cannot take a piece; a greeting-only day takes only a greeting.
7. **Data stays Palak's.** Everything the tool stores is in her own Google account. This is a constraint and a brand point.
8. **One person's time.** Palak has about 11 to 12 hours a week for marketing in total. The tool must save time from the first week, not add set-up.

---

## 5. What was decided

### 5.1 The content model

A **piece** is one idea made once. It has:
- `id` (the existing ids are kept: `e01-follow-up`, `c1-five-signs`, `B1`, `L1`, `rule`, `greeting`; new pieces get the same style of id)
- `type`: one of `reel-animated`, `episode`, `carousel`, `broll`, `linkedin-text`, `linkedin-carousel`, `status-rule`, `greeting`, `wa-note`, `youtube-long`, `field-story`
- `pillar`: `problem`, `science`, `glimpse`, `offer`, `founder` (the brief's four plus the founder story)
- `hook` (eight words or fewer)
- `pis`: `problem`, `impact`, `solution` (one or two lines), `close`
- `renditions`: the text for each account the piece goes to: Instagram caption, Palak's LinkedIn post, company LinkedIn reshare line, Facebook text, WhatsApp Status text, YouTube title and description. One piece is written once; the renditions are its channel forms, as `channels.json` already says.
- `script`: for `broll` and `youtube-long`, the say-and-sees table (rows of `say`, `sees`, shot codes) exactly as `BROLL-SCRIPTS.md` lays it out
- `slides`: for carousels, the seven slides in the kit's slide types (`cover`, `point`, `list`, `cta`)
- `assets`: links to files: the rendered MP4 and cover PNG in Drive, carousel slides and PDF, generated images, the real photo for a LinkedIn post
- `source`: where it came from in the repo (file and id), so the renderer's JSON can be regenerated from Studio later
- `status`: `idea`, `draft`, `in-review`, `changes-requested`, `approved`, `posted`, `measured` (`scheduled` is reserved for phase 2)
- `owner`, `createdAt`, `updatedAt`, `notes`
- `measure`: `postedLink`, `realReplies`, `messages`, `callsBooked`, `sends`, `shares`, `note`

A **version** is a frozen snapshot of a piece with `n`, `author`, `when`, `changeNote`. Every save that changes text makes one. Approval freezes the latest.

A **slot** is one allotted posting opportunity: `date`, `time`, `account`, `kind`, `pieceId` (empty when open), `state` (`open`, `filled`, `dark`, `greeting-only`, `event`). Slots are generated from `channels.json`'s `weekly` and `monthly` rules, its `dark` and `events` maps and the quiet windows, from 1 November 2026 to 31 March 2027, and can be extended.

The **brief rules** are data: `say` words, `never` words and phrases (with a note for each, since some are banned only as headlines), `claimsAllowed`, `claimsBlocked`, per-channel limits (Instagram six hashtags at the end; LinkedIn none in the body, three at the bottom; LinkedIn first 210 characters carry the hook; Status one line), `visual` rules, and the pre-posting checklist from `POSTING/README.md`.

### 5.2 The library and the first load (the review of every piece)

A one-time import script reads the repository and writes every piece into Studio with `status: in-review`, version 1 being the original text exactly as it stands:

| From | Pieces |
|---|---|
| `social-animations/reels.json` | 23 `reel-animated` |
| `social-animations/episodes.json` | 10 `episode` |
| `social-animations/carousels.json` and `POSTING/captions.json` | 9 `carousel` |
| `november-2026/BROLL-SCRIPTS.md` | 12 `broll` (B1 to B12) |
| `november-2026/LINKEDIN-STORY-POSTS.md` | 8 `linkedin-text` (L1 to L8) |
| `LINKEDIN-PERSONAL.md` | 10 `linkedin-text` (the December bank) |
| `POSTING/calendar.csv` | the rules, greetings, D1 to D3, the December note and the film as pieces; every filled row becomes a filled slot |
| `social-animations/out/` | linked as assets after a one-time copy of the rendered files into the Drive folder |

Then the **refine pass** runs once over every imported piece: the AI reads the piece, the brief as updated for the widened storyline (section 5.9), and the sales-tools problem and impact bank, and proposes version 2 with a change note. The pass is told to change as little as possible and to say in the note when it recommends no change. Palak then sees original and proposal side by side and approves one, edits, or keeps the original. Nothing becomes approved without her.

The review is not only wording. The pass also flags, per piece: whether the hook is eight words or fewer; whether the middle beat is an impact (the storyline document found every Reel skipped it); whether the piece still says "the work assigns itself" or "we bring the brains" (retired lines); whether a close line claims the business runs by itself.

### 5.3 The planner

A month and a week view, built from the slots. Each slot shows account, time and kind (Monday Reel, Tuesday LinkedIn, Tuesday Status, and so on), its state, and the piece in it. Dark days, greeting-only days, the quiet windows and the events (BNI, Plast Pack, YEF) are shown exactly as `channels.json` describes them. A piece is placed by picking it from the library in the slot's panel; the planner refuses a piece whose type does not fit the slot's kind, refuses any piece on a dark day, and allows only a `greeting` on a greeting-only day. The repurposing rules show, in the slot, every account the piece will also go to and how. The CSV is exported from the planner on demand so the existing `build-kit.mjs` still works during the hand-over.

### 5.4 The AI step: text

All AI calls run on the backend with the brief rules and the approved pieces of the same type as context. Six operations, each with a fixed input and output shape:

| Operation | In | Out |
|---|---|---|
| `propose` | an owner moment or topic in a sentence; optional pillar and sector | three candidate P.I.S. sets, each with three hook options |
| `draft` | a P.I.S. set, the piece type, the target accounts | the full piece: renditions for every target account, and the script table or slides when the type needs them |
| `check` | a piece | a list of violations, each with the rule, the offending text and a suggested fix; plus the pre-posting checklist with what can be checked automatically ticked |
| `refine` | a piece and an instruction (or the standing refine-pass instruction) | a new version and a change note |
| `imagePrompts` | a piece | prompts for the house-style illustration and the text for the brand cards (section 5.5) |
| `caseStudyOutline` | a VSP system name and Palak's notes | the 30 to 60 minute structure in section 5.8 |

The AI is told, in its instructions: the register (formal, warm, a professional firm addressing a managing director); the order (problem, impact, solution; nothing opens on us); the say and never-say lists; the claims allowed and blocked; the one-Hindi-tag rule; that numbers come only from the owner or as a question; that every solution line must be something VSP actually runs (the register of twenty systems in `Sales/SALES-TOOLS-CONTENT.md` is supplied as the list of allowed solutions). It is given four or five approved pieces of the same type as examples. Model: Claude, a current Sonnet-class model by default, selectable per operation in settings (my call; the builder picks the exact model id from the current Claude API reference and keeps it in one setting). The brief and the examples are sent with prompt caching so a working session costs little.

`check` is two layers: a deterministic layer in the app (word lists, counts, limits, emoji, exclamation marks, hashtags, named companies against a list, figures not marked as examples) that runs on every keystroke, and the AI layer for what word lists cannot catch (a promised result in other words, a coach's tone, a casual aside, a feature list in place of a scene). The deterministic layer never needs the network.

### 5.5 Pictures

Two kinds, and the piece records which it used.

**Brand cards (no AI).** A set of templates rendered in the browser from text: a Status rule card, a quote card, a one-line hook card, a YouTube thumbnail, a LinkedIn carousel slide. Navy or white theme, Gilmer, the yellow `*starred*` word rule the kit already uses, the logo and tagline footer. Exported as PNG at the platform's size. This covers most of what a week needs and costs nothing.

**House-style illustrations (AI).** Only for a carousel cover, a LinkedIn post that has no real photo, or a YouTube thumbnail background; never as a feed post in its own right (Palak, 29 October). The feed stays real footage, brand cards and the flat animations. This pipeline is built last. One locked style, written once as a prompt prefix in settings: flat vector illustration, navy and warm yellow on white or navy, soft corners, no gradients, no text inside the image, no faces drawn as real people, never a screen, sheet or phone drawn as if it were a real product screenshot. The prompt for a piece is the prefix plus the scene the AI proposes from the piece's problem line (a desk at seven in the evening, a phone full of chats, a dispatch bay). Every generated image is saved to Drive against the piece with its prompt, and is used only after Palak approves the piece. Provider: any image model reachable from the backend by REST with an API key, behind one function, so the provider can change without touching the app (my call on the abstraction; the builder picks the first provider).

**Real photos and footage** are uploaded by Palak and attached to the piece; the tool never alters them.

### 5.6 Approval

The review screen shows one piece as it will look on each account it goes to: Instagram caption with its hashtags, the LinkedIn post cut at 210 characters with a "see more" line so the hook can be judged, the Status line, the YouTube title. Beside it: the checker's result, the version history with change notes, and the pre-posting checklist. Palak can edit in place (a new version), request changes with a note (status `changes-requested`, back to the helper), or approve. Only emails marked as approvers in settings see the approve button, and the backend enforces it. Approved pieces are read-only; "Edit" makes a new version and the status drops to `in-review`.

### 5.7 Measurement (by hand in phase 1)

On each posted piece: the link, real replies, messages started, calls booked, sends and shares, and the persona and source of each reply as the Friday review in `november-2026/PLAN.md` section 7 asks. A week view totals them and lists, per the plan: posted against plan, which piece earned real replies, which replies became messages and calls, and which piece was sent most. The owner lines that come back word for word are entered as quotes on the piece and collected in one list, because the plan says they become next month's hooks.

### 5.8 The YouTube case studies (30 to 60 minutes)

Palak wants long case studies. No client can be named, so each case study is one VSP system, told as how it was designed and what it changed, in the sales-tools' P.I.S.A.T. order (Palak, 29 October). The first is the reminder desk, because follow-up is the problem owners name most. The format Studio generates an outline for:

1. The owner's problem, as a scene (3 to 5 minutes). From the problem bank.
2. What it cost VSP, in VSP's own words (3 to 5 minutes). No client, lender or staff detail.
3. The design question: why it is a design problem, not a discipline problem (5 minutes).
4. The build: the system on the masked copy, walked through step by step (15 to 30 minutes). Every frame checked for real names before it is shown.
5. What changed, and the honest limit: we run the system, the team still does the work (5 minutes).
6. How an owner would start with one process (3 minutes). The call to action is the 30-minute call.

The outline lists, per chapter, the on-screen items, the questions to answer to camera, and three Shorts to cut from it (each a complete P.I.S. in under 60 seconds). The outline is a piece of type `youtube-long`; its Shorts become `reel-animated` or `broll` pieces linked to it. One a month, as the signed-off strategy allows; the strategy's six-to-ten-minute length is replaced by 30 to 60 for the case studies (Palak, 29 October). The monthly walkthrough slot in `channels.json` is the slot it fills.

### 5.9 The widened storyline

Palak (29 October): the storyline is business automation and building tools, not startup funding. Nothing in the repository was ever about startup funding, so there is nothing to remove on that count. The frame, decided by Palak on 29 October: **the tools are how we run it.** Venture Drafters builds the tools that run a business, on the owner's own Google account, and runs them with the owner every week. "We run it with you, every week" stays. "The owner's problem is a design problem" stays as the idea under the house. "This is not new software" is no longer the opener; it is kept only where it answers the "we tried software and it died" fear. The brief's section 1 and section 4 are updated to this frame before the Rules tab is seeded (a short edit, made by the builder and shown to Palak in the review queue as the first item).

The refine pass therefore carries two instructions: bring every piece into the brief's register and P.I.S. order, and where a piece describes the solution, say it as a tool we built and run (a reminder desk, a question tray, a weekly score, a dispatch flow) rather than as a vague "system", without ever saying the tool works without people.

---

## 6. How it is made

- **App:** a single-page app in plain HTML, CSS and JavaScript with no build step, in the same style as the website, using `design-system/venture-drafters-tokens.css`. Lives in the marketing repository under `studio/`. Published as a private page on the website (a path such as `/studio/`) or on the marketing repository's own GitHub Pages; builder's call, provided the page itself contains no secret.
- **Backend and store (my call):** Google Apps Script deployed as a web app, with one Google Sheet as the database (tabs: Pieces, Versions, Slots, Rules, Images, Measures, Settings, Log) and one Drive folder for assets. Reasons: it is inside Palak's own Google account, it costs nothing, Google sign-in and the allow-list come for free, API keys sit in Script Properties and never reach the browser, and it is the same shape as what Venture Drafters sells. The builder should treat Apps Script's limits (six minutes per call, URL fetch size) as design constraints: AI calls return in well under a minute; images are saved to Drive by the backend, not passed through the browser.
- **AI:** the Claude API from the backend for all text operations, with prompt caching for the brief and the examples. The builder reads the current Claude API reference before writing a call. One image provider behind one function.
- **Auth (my call, after the builder check):** the page stays on the website. It signs the user in with Google Identity Services in the browser and sends the ID token with every call. The Apps Script web app is deployed to accept anonymous calls, verifies the token against Google's token endpoint on every request, and only then checks the email against the allow-list in Settings and the approver flag. The allow-list and the approver role are therefore enforced on the backend, not in the page. (An Apps Script web app that serves its own pages cannot be reached by fetch from another origin when it is set to require sign-in, which is why the page cannot simply call a signed-in deployment.)
- **Import:** a Node script in `studio/import/` run once on the Mac, reading the repository files listed in 5.2 and writing to the Sheet through the backend. The rendered videos and slides are copied to the Drive folder by the same script.
- **Export:** the planner can write `POSTING/calendar.csv` in its current shape, and the library can write `reels.json`, `episodes.json` and `carousels.json` back in their current shapes, so the Mac renderer and the old calendar keep working until phase 2 retires them.
- **Phone:** the review, approval and measurement screens are built for a phone first; the planner and the drafting screens for a Mac.

---

## 7. Left to the builder

- Screen layout and navigation, within the tokens.
- The exact Sheet column layout and how versions are stored.
- Which image provider goes first, and the exact Claude model ids.
- How the deterministic checker stores its word lists (they come from the Rules tab).
- How the brand-card templates are drawn (SVG or canvas) and exported.
- How the Apps Script backend is deployed and updated from the repository (clasp or by hand).
- How the LinkedIn 210-character cut is approximated.
- Test data: invented owner moments only; never real client, lender or staff names.

---

## 8. Open items for Palak

Answered on 29 October: the storyline frame (5.9), the case-study subject (5.8), where AI images may appear (5.5).

Still open, deferred by Palak: **which Google account** holds the Sheet, the Drive folder and the Apps Script (tools@vspindia.com, whose Workspace admin settings may block sharing or web-app access outside the domain, or a Venture Drafters Google account). Until then the backend is built so that it is created by signing in to any Google account and running one set-up step; nothing in the code names an account. The helper's email and whether anyone else may approve are set in Settings later.

## 9. Phase 2 and after (boundary only)

Posting: direct where a platform allows it from a self-serve API (Facebook Page, Instagram, YouTube, Palak's personal LinkedIn), one-tap hand-off where it does not (the company LinkedIn page without partner approval, WhatsApp Status), or through a scheduling service. Reading analytics back. None of it is designed here; phase 1 must simply leave every approved piece with its renditions and assets ready for any of those routes.

## 10. Decisions taken after the builder check (my calls)

1. **Delivery order and cut-over.** The existing CSV and `calendar.html` carry the November posting until Studio's library, review queue and checker are live. Slices ship in this order: (1) backend, Sheet, sign-in, library, import of originals, review queue, deterministic checker; (2) AI operations `check`, `refine`, `propose`, `draft`; (3) the planner with CSV export; (4) brand cards, then AI illustrations; (5) measurement and the Friday view; (6) the case-study outline. The import is re-runnable: it matches on piece id, keeps every version Studio already holds, and only adds a new version when the repository text differs from Studio's version 1. Studio becomes the master record for a piece the day Palak approves it there; until then the repository file is the master for that piece.
2. **The brief as data.** `00-brief.md` stays the master document for people. The rules the checker and the AI use are written once as `studio/rules.json` in the repository, derived from the brief's sections 4 and 6, the voice table in `03-positioning-and-messaging.md` section 6, and the checklist in `POSTING/README.md`. The import seeds the Rules tab from that file; a change to the brief is mirrored in `rules.json` and re-seeded. Palak can edit a rule in the Sheet for a quick change, and the next re-seed carries it back only if `rules.json` was updated too, so the file is the master.
3. **Allowed solutions.** A Solutions tab holds one row per VSP system with a public-safe name and one-line description (the reminder desk, the question tray, the weekly score, My Day, the step-by-step job flow, Recruit, the academy, the stock colour sheet, and so on), written during the build from the public columns of the sales register. No internal name (FMS, PMS, MIS, PC, PISAT) and no sales document is stored in Studio or sent to the AI. The AI is given the Solutions tab as the only list of things a solution line may name, and the checker does not flag a solution line that names one of them.
4. **Named companies.** No list of VSP's clients or lenders is stored anywhere in Studio. The deterministic checker uses a heuristic (capitalised multi-word names, and suffixes such as Ltd, Pvt, LLP, Industries, Textiles, Enterprises) with an allow-list of names the brief permits (Voltas, Panasonic, GPC, Genuine Parts Company, Georgia Tech, VSP Consultants, Google, BNI, Plast Pack, AIMP, YEF). Anything else capitalised that looks like a firm is flagged for a human to look at, never auto-removed.
5. **Slot semantics not in `channels.json`.** Quiet windows (16 to 23 December, 4 to 14 January) are ordinary posting days, shown with a "quiet: best weeks for calls and demos" marker, since the plan lists them as clean posting weeks. LinkedIn before 16 November generates one slot a week (the Tuesday); the Thursday or Wednesday slot appears from 16 November. Carousel weeks on LinkedIn run fortnightly from Wednesday 25 November (so 9 December, 23 December, and on); in those weeks the Thursday LinkedIn slot is not generated. "Derived" weekly entries (the Friday company-page reshare, the family Status) are shown as automatic, not as slots to fill. "Trial" entries are optional slots. The free-text values in the `dark` map are parsed into `dark` and `greeting-only` by the words "greeting" and "dark". A "go dark now" switch in Settings marks every slot from today as dark until it is switched off, for the mourning rule.
6. **Examples for the first refine pass.** Before any piece is approved, the AI's examples are the headline bank and elevator pitches in `03-positioning-and-messaging.md` sections 4 and 8 and the P.I.S. table in `social-animations/STORYLINE-PIS.md` section 3, which are already signed-off copy. Once Palak has approved four pieces of a type, approved pieces of that type replace them.
7. **Pieces not yet written** (D1 to D3, the December note, the film) enter as `idea`, not `in-review`. The renderer's fields that Studio does not edit (`pScene`, `pFrom`, `mood`, and so on) are stored untouched so the JSON export is lossless.

---

