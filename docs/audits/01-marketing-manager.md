# Audit 1: the marketing manager

Date: 29 October 2026, after the network split (commit 13a2ccf). Tool used in the built-in browser at desktop width and at 375 px, with the real data (85 pieces, 183 slots, 273 events). Walked as the person who plans the month, keeps the channel mix and cadence from the plan, keeps the review queue moving, approves and measures.

## What this person is trying to do

1. Plan December from the empty slots.
2. Move a piece to another day.
3. See at a glance what is due this week and what is blocked, and why.
4. Find and fix the pieces the checker flags (the README says 19).
5. Export calendar.csv for the old kit.
6. Understand, from the tool alone, why a slot asks for a Status rule card on Thursday at 9 am and a glimpse on Tuesday.

## What they tried, and where the tool got in the way

Ranked by how much it hurts. Route and state are exact.

### 1. There is no way to find the pieces the checker flags. Severe.

- Route `#/content`, 85 pieces, all filters at their defaults. The library has no checker column and no checker filter. The only word about the checker in the whole tool is the README's "19 pieces".
- Checked the data: only 2 of 85 pieces carried a stored check at all, because a check is stored only when a piece is opened in the editor or reached in the review queue. The manager would have to open 85 pieces to learn which 19 fail.
- Route `#/review`: the checker is shown per card, with "The checker blocks approval (1)" and the Approve button disabled, which is right, but the queue is 79 cards long and the only way to the blocked ones is to click through all of them.
- Ran the check over every piece through the API to confirm the number: 19 pieces fail, all with at least one block. Twelve of them are the b-roll scripts (B1 to B12) carrying six Instagram hashtags; eight say "best"; two still say "the work assigns itself"; two "we bring the brains"; one "workflow"; one "followups". Fixing twelve of the nineteen is deleting one hashtag.
- Verdict on this point: the manager cannot do task 4 without a developer.

### 2. Today does not show what is due this week or why it is stuck. Severe.

- Route `#/today`, 29 October. The page opens on "Waiting for review, 79", a flat list of every piece in review in the order they were imported, which pushes everything else below the fold (on the phone it is nine screens long before the next section).
- The second card is titled "Open slots in the next seven days, 10", but the ten rows are not open slots: they are filled slots whose piece is not yet approved. The title is wrong and the reason ("not approved") is buried in parentheses in the slot label. Nothing on the page says which of those are blocked by the checker and which simply await approval.
- The row links go to the calendar month, not to the piece or the review card, so "what is due and what to do about it" is two more screens away.

### 3. Nothing explains why a slot asks for what it asks for. Serious.

- Route `#/calendar/2026-12?day=2026-12-15`, the day panel. The Status slot reads "Status: a glimpse. WhatsApp Status (Palak). Takes: Status rule, greeting, episode, animated Reel." The Thursday slot reads "Status: a rule card". The panel never says why Tuesday is a glimpse and Thursday a rule, nor that Status is "the warm network sees it; nobody is written to". The reasoning is only in PLAN.html.
- The "Allotted days" panel at the foot of the calendar lists the fixed slots per account but again without the reason, and the link "Change the rules in Settings" leads to a read-only table.
- Task 6 cannot be done from the tool.

### 4. Planning December works, but the picker cannot tell "ready" from "written". Medium.

- Route `#/calendar/2026-12`. Open slots are easy to see; the day panel's "Pick a piece" lists only the types that fit the slot and says "Approved pieces come first". Since nothing is approved yet, every candidate is "In review" and the manager cannot tell which pieces are clean and which are blocked. Same root cause as point 1; the fix there covers it (the picker will show the checker state).
- The picker also lists pieces already planned on another date ("already planned Wed 18 Nov"), which is useful, but a filled December needs about 20 picks, and each pick closes the day panel's dialog and re-renders. Acceptable.

### 5. Moving a piece works well. Low.

- Route `#/calendar/2026-12?day=2026-12-22`, "Move" on the LinkedIn post. The dialog takes a date, lists the open slots that fit on that day, offers "a new Post slot on this date", and the server refuses a dark day with the reason. Moved the post to 17 December and back. Two toasts appear after a move ("Moved to Thu 17 Dec" and "The piece is not approved yet"); the second is correct but reads as if something went wrong. Left as is.

### 6. The CSV export is clear. Low.

- Route `#/calendar`, "Write calendar.csv". A confirmation explains that the file in Marketing/POSTING is replaced and a .bak kept. A dry run through the API produced 51 rows in the old column order. Not written tonight, so the Marketing folder stays untouched. The button is the only primary (yellow) action on the calendar toolbar although it is used once a month; cosmetic, left.

### 7. The review queue order. Low.

- Route `#/review`. Cards are in order of planned date, unplanned ones last, which is the right order for a manager clearing next week. The "Review pass" button (the AI proposal for every piece) says what it does in a dialog before it runs. With the login expired it fails at the first piece with a hint to run `claude` and `/login`; acceptable.

### Phone width (375 px)

- Calendar becomes a day list, the day panel fills the screen, the library stacks its seven filters above the table (a long scroll before the first row, but it works). Review cards fit. Today is the page that fails on the phone, for the reason in point 2.

## Verdict before the rework

The manager would keep the calendar and the review queue, and would stop using Today within a day. They would not be able to do the one thing the README promises (fix the 19 flagged pieces) without a developer. Not yet a tool they would run the month on.

## What was fixed tonight

1. **Checker visibility.** `POST /api/content/check-all` runs the deterministic checker over every piece that is not retired and stores the result. The library has a "Check all" button, a "Checker" filter (Blocked, Warnings only, Passed, Not checked yet) and a checker column; the filter can be opened by link (`#/content?checker=blocked`). The picker in the calendar day panel shows the same state beside each candidate.
2. **Today.** "Waiting for review" shows the first eight by planned date with a link to the rest. The slot list is now "Due in the next seven days" and each row shows the piece (or "Open"), a reason chip (open, not approved, blocked by the checker) and links to the review card. A "Blocked by the checker" card lists the pieces whose last check has a block, with a link to the filtered library.
3. **Why this slot.** Each weekly and monthly rule in `data/accounts.json` now carries a `why` line taken from the plan's channel table. The day panel shows it under the slot ("Why: the warm network sees it; nobody is written to. Tuesday is a glimpse, Thursday a rule card.") and the Allotted days panel shows the account's role.

## What was left, and why

- The twelve b-roll pieces with six hashtags and the seven wording violations were not edited: changing the content is the founder's call, and the review pass (AI) is the intended route for the wording. The tool now lets the manager find them in one click.
- The two toasts after a move, and the yellow export button: cosmetic.
- The review queue cannot be filtered to "blocked only": the library filter plus "Open in the queue" covers it in two clicks.
