# Prompt for the cloud session

Paste everything below the line into a new session at claude.ai/code, with this repository selected. It assumes the repository is on GitHub with the three-role work committed.

---

You are working on **Studio**, the marketing tool built by Venture Drafters. It is plain JavaScript with no build step: a Node server in `server/`, a single-page app in `app/`, and data in `data/*.json`. Before you change anything, read these files in this order: `README.md`, `docs/ARCHITECTURE.md` (the contract), `docs/ROLES.md` (the employee, manager and director review path, already built), and `docs/SPLIT-AND-HOSTING.md` (the hosting plan: Vercel, Google Sheets, Google Drive).

Studio lives on the `studio` branch of `craftedbypalak/venture-drafters-marketing`. That branch is the tool only. Venture Drafters' own strategy and content live on the `main` branch of the same repository: the brief, company profile, ICP, positioning and content system (`00-brief.md` to `05-content-system.md`), the case studies and the posting kit. Read them with `git fetch origin main` and `git show origin/main:<path>`, never by merging `main` in. Those documents are the source for Venture Drafters' company profile, the first workspace: feed them through the intake, never copy their text into the code.

## The goal

Turn Studio from a tool for one company into a tool that Venture Drafters runs for many client companies. Each company keeps its content, its calendar and its company profile in its own Google Sheet, so anyone on that company's team can open, read and correct it without the tool. The tool works on that Sheet, with the same three roles and the same review path.

## What must change

### 1. Workspaces: one company each

- A **workspace** is one company. It has its own Google Sheet, its own Google Drive folder and its own users and roles.
- A small master Sheet called **Workspaces** lists each workspace: id, company name, Sheet id, Drive folder id, status and created date.
- Venture Drafters is the first workspace, seeded from the current `data/*.json`.
- A user may belong to more than one workspace, with a different role in each. After sign-in the app shows a workspace switcher.
- The director of a workspace manages its users. A new role, **owner** (Venture Drafters), creates workspaces and can enter any of them.

### 2. Google Sheets as the backend

- Write `server/store-sheets.mjs` with exactly the interface of `server/store.mjs` (list, get, put, patch, remove, nextId, log, getSingleton). Choose the store from an environment variable, so the JSON store keeps working locally and in tests.
- Use one tab per collection. Lay the tabs out for people, not only for the code. The tabs people use every day (Pieces, Calendar or Slots, Campaigns, Events, Users) carry readable columns in a sensible order. For pieces: id, planned date, channel, type, pillar, status, hook, caption or body, owner, reviewer, approved by, approved at, updated at. Every nested field the code needs but a person does not goes into one trailing column, `_json`.
- Data-validation dropdowns on the status, role, type, pillar and channel columns; frozen header rows; a Readme tab that explains every tab in plain language.
- A hand edit that breaks a row is reported and skipped, never fatal. The stale-save check (`updatedAt`) stays.
- Read a tab once per request and write through, to stay well inside the Sheets quota (see `SPLIT-AND-HOSTING.md` section 3).
- One import script uploads a workspace's `data/*.json` to a new Sheet, and one export script writes it back, so data can move both ways.

### 3. The company profile: what makes the tool belong to a company

Today the company is spread across `data/rules.json` (voice, say and never lists, claims, frame, examples), `data/solutions.json`, `data/accounts.json`, the prompt text in `server/ops/_shared.mjs` and about 57 lines in `server/`, `server/ops/` and `app/js/` that name Venture Drafters, VSP or Palak directly. Move all of it into the workspace.

- **Profile tabs in each company's Sheet:** Company (name, one line, what they sell, region, language and register), ICP (segments, their problems, their words, objections), Voice (the say and never lists, banned claims, allowed claims, tone examples), Offer (the solutions or products: public name, one line, what each removes, proof), Channels (the current accounts tab), and Calendar rules.
- **Three ways to give a company's details, all ending in the same tabs:**
  1. **Upload a document** (Word, PDF or Google Doc) into the workspace's Drive folder from the app.
  2. **Paste text** into a box in Settings, Company profile.
  3. **Fill a template:** a Google Doc template, "Company profile template", with fixed headings matching the tabs. This is the recommended way, because a fixed structure gives the most accurate extraction.
- **An intake AI operation**, `profileIntake`, reads the document or text and proposes the tab contents. Each field is marked with where it came from and how confident the extraction is. Fields the source did not cover are listed as open questions, never invented.
- **The director reviews the proposal field by field** and approves it, the same way pieces are reviewed. Only an approved profile is used by the other AI operations.
- The source documents stay in the Drive folder, and the profile keeps a version history. Re-running the intake on an updated document shows the differences before anything changes.
- Every AI operation reads the company from the workspace profile through `registerParagraph`. No company name, person's name or product is left in the code. Prove it with a test that fails on any hard-coded "Venture Drafters", "VSP" or "Palak" outside the seed data and the docs.
- The brand look (logo, colours, fonts) also lives in the workspace: logo files in the Drive folder, colour and font tokens in the Company tab. The Visuals templates read them. The Venture Drafters product mark stays only in the tool's own header and sign-in page.

### 4. Sign-in and roles

- Google sign-in through Google Identity Services. The server verifies the ID token and looks up the email in the workspace's Users tab. The user picker and the PIN remain only for local development.
- Keep `docs/ROLES.md` exactly: the employee writes and submits; the manager approves, requests changes or sends to the director; the director approves, requests changes or returns. The routing rules (`reviewRouting`) are per workspace.

### 5. Hosting

Follow `SPLIT-AND-HOSTING.md` section 3: the app as static files on Vercel, the API as one Vercel function wrapping the existing router, media uploaded straight to Drive through a resumable session, and AI through the API key or the Mac runner (`claude -p` cannot run on Vercel).

## How to work

- Start each phase from the `studio` branch, work on a new branch, and open a pull request into `studio` (never into `main`) at the end of the phase. Do not merge, and never push to `main` or `studio` directly.
- Phases, each one leaving the tool working:
  1. Workspaces and the store interface, still on JSON files, with Venture Drafters as workspace one.
  2. The Sheets adapter, the human-friendly tab layout, and the import and export scripts.
  3. The company profile: tabs, intake operation, review, and removing every hard-coded company reference.
  4. Google sign-in and Drive uploads.
  5. The Vercel wrapper and deploy configuration.
- You do not have Google or Vercel credentials. Build the Sheets and Drive code against a fake in-memory Sheets client, so every test runs in this sandbox. Keep `node --test server/*.test.mjs` green (the glob, not the folder), and add tests for every new route and for the adapter.
- Write `docs/SETUP-GOOGLE.md`: step by step, in plain language, everything the founder must create by hand (the Google Cloud project, Sheets and Drive APIs, service account, master Sheet, a Sheet and Drive folder per company, OAuth client, Vercel project, environment variables), with the exact names the code expects.
- Update `README.md`, `docs/ARCHITECTURE.md` and `docs/ROLES.md` as you go.
- House style: formal, plain sentence-case labels, no emoji, design tokens only, and code that reads like the existing modules.
- Stop and ask before any decision that changes the data shape of an existing collection in a way the import script cannot carry across, and before adding any dependency (today there are none).

Start with phase 1. First give me a short plan: the files you will touch, the Sheet tab layout you propose for Pieces and Slots, and the profile tab fields. Then begin.
