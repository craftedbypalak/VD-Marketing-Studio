# Audit 3: the director

Date: 29 October 2026, on the tool as reworked after audits 1 and 2 (commit b000ece). Built-in browser at desktop width and 375 px, real data, working as Palak (approver) and as the example staff user. The director opens the tool once a day for five minutes.

## What this person wants

1. One screen that says whether marketing is on plan, what needs their approval, what went out, what is slipping, and what it costs in AI and hours.
2. To trust that nothing goes out off-brief or unapproved; that a staff member cannot approve their own work, cannot see what they should not, and cannot break the data.
3. To know what happens when the Mac is off, when the Claude login expires, and when two people edit at once.
4. To see the storyline ("the tools are how we run it") in the content itself, not only in the documents.

## What they tried, and where the tool got in the way

### 1. Today answers two of the five questions. Serious.

- Route `#/today` as Palak. After audit 1 the page shows what is due this week and why it is stuck, what waits for approval (79) and what the checker blocks (19). It does not say whether the month is on plan (how many of the month's allotted slots are filled and approved), what went out (nothing has been posted yet, and the page does not say so), or what the AI has cost. Hours are not recorded anywhere.
- The log (`data/log.json`) records every change and every AI call with its duration and, in command-line mode, the cost the CLI reports; nothing reads it back.

### 2. The approval gate holds on the server, but the user picker is on trust. Severe.

- `POST /api/pieces/:id/approve` refuses a non-approver (403, verified by sending the staff user's header). The checker blocks approval while a block stands (409). A text change to an approved piece sends it back to review. All of this is server-side and correct.
- But the user is chosen in a picker and sent as a header. Working as the staff user, I switched the picker to "Palak Gupta (approver)" and could approve. The review card even says so: "Only an approver can approve. Choose an approver in the left panel or in Settings."
- Working as the staff user, `PUT /api/settings/settings` with my own user flagged as approver returned 200. Nothing stops a staff member from making themselves an approver, deleting a user, or changing the rules the checker reads.

### 3. Staff can delete and regenerate without a role. Severe.

- `DELETE /api/<collection>/<id>` is open to every user for every collection: a piece and all its versions, an event, a solution, an account. "Regenerate slots", "Fill from import file" and "Write calendar.csv" (which replaces a file in the Marketing folder) are open to every user. Nothing here is malicious by design; it is one mis-click away from a month's calendar.

### 4. Two people editing at once: the last save wins silently. Serious.

- Two saves of the same piece from two users, the second from a copy that was already stale: both returned 200, the second overwrote the first, and the first user is never told. Every save does make a version, so nothing is lost for good, but nobody is told to look.

### 5. The link token is shown to every user. Medium.

- Settings, Link, as the staff user: the token Network uses is readable and copyable. It unlocks only read-only calendar and piece data, but it is the one secret the tool holds and it should be the approver's to see.

### 6. The Mac off, the login expired. Clear once asked, said nowhere. Medium.

- When the Mac is off there is no tool: it runs on `localhost:4747`. When the Claude login expires, every AI button fails (now with a plain message) and everything else works. Neither fact is written in the tool; a director has to ask.

### 7. The storyline in the content. Serious, and only partly fixable tonight.

- Counted across the 85 imported pieces: 5 name a tool we built (the reminder desk, the weekly score, and so on); 39 say "system" with no tool named; 6 say "we run it with you" or "every week". Nineteen still carry retired lines or blocked words. The decided frame ("the tools are how we run it") is in `rules.frame` and in every AI prompt, and the review pass that would carry it into each piece has not run because the login expired. The checker warns on a solution line that says "system" alone, so the gap is visible piece by piece, but there is no count anywhere.

### Phone width

- Today stacks into one column and reads well. Settings tabs scroll sideways. Nothing specific to the director fails on the phone.

## Verdict before the rework

The director would trust the checker and the approval state, and would not trust the roles: anyone at the Mac can become the approver in two clicks. Today would be opened once and then skipped, because it does not answer "are we on plan" or "what did this cost". Not yet a five-minute screen.

## What was fixed tonight

1. **A PIN for approvers.** An approver may set a PIN in Settings, Users (stored as a hash, never shown). Once set, every request as that user that approves, requests changes, edits settings or rules, deletes, regenerates slots, imports or exports must carry the PIN; the app asks for it once per browser session when the picker is switched to that user. Without a PIN set, the tool behaves as before and Today says so to the approver. Sign-in replaces this when the tool is hosted.
2. **Roles on the server.** Settings and rules edits, deletes, slot regeneration, the calendar import and export, and the recurring import and expansion are refused for a non-approver (403), whatever the app shows. Staff can still write, edit, retire and restore pieces, place and move them, make pictures and run the AI steps.
3. **Stale saves are refused.** A `PUT` or `PATCH` on a piece, event, campaign, the rules or the settings that carries an `updatedAt` older than the stored one is refused (409) with who changed it and when. The editor then offers "Reload" or "Save anyway".
4. **The link token is shown to approvers only.** The server strips it from the settings document for anyone else; the Link tab says so.
5. **Today for the director.** A "This month" card: allotted slots, filled, approved, posted, and open; what has gone out (none yet, said plainly); AI calls this month with their reported cost and the mode (subscription, no bill); actions this week by each person, as the only record of hours the tool has; the AI sign-in state from the last call; the last change and who made it. A "The storyline in the content" line: pieces that name a tool, pieces whose solution line still says "system" alone, with a link to the filtered library.
6. **How it runs.** Settings, AI, carries three plain lines: the tool runs on this Mac only (off when the Mac is off); when the Claude login expires the AI steps fail and the rest works; two people may edit at once and the second is told when the first saved first.

## What was left, and why

- Hours are not recorded. The tool shows actions per person per week from the log; a timesheet is a different tool. Palak decides whether to want one.
- The storyline count is a proxy (named tools against "system" alone). Carrying the frame into every piece is the review pass's job, which needs the login.
- "What went out" waits for the first posts; the measurement entry on a piece (measure block) exists but no piece is posted yet.
- The PIN is a stop-gap on a shared Mac, not a sign-in. The hosted build with Google sign-in (SPLIT-AND-HOSTING.md section 3) replaces it.
