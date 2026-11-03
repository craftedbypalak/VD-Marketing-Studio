# Audit 2: the marketing employee

Date: 29 October 2026, on the tool as reworked after audit 1 (commit 7ffb631). Built-in browser at desktop width and 375 px, real data. Walked as a new hire who has to create the content every day, is not a writer, has not read the brief, and works as a non-approver ("Studio helper (example)", a user added to Settings for the audit and removed afterwards).

## What this person is trying to do

Start from "a slot is open on Thursday" and get to a finished, checked, approved post with its picture, and know what to hand to Palak. The walk used Thursday 17 December, the open Status slot ("Status: a rule card").

## The walk, click by click, before the rework

1. Today. The due list shows the Thursday slot as "Open: Status: a rule card" with the chip Open. Click it: the calendar day panel opens on 17 December. (1 click)
2. In the day panel, "Why this slot" explains what a rule card is. Click "Create new" on the Status slot. (2)
3. **Dead end.** The editor opens as a blank **Animated reel** for **Instagram**, "Not placed in the calendar yet". The slot, the day, the account and the kind of piece are all lost. The route is `#/content/new?slot=sl-0051`; the editor reads `slotId`, so the slot is never attached, and the type is the default rather than the slot's kind. A new hire has no way to know that a Status slot needs a "Status rule" piece.
4. Change Type to Status rule. (3) The targets stay on Instagram; the new hire would now write an Instagram caption for a WhatsApp Status. Click ST, then click IG to remove it. (5) The empty Instagram tab stays in Renditions and in the review card, because an empty rendition counts as one.
5. Write the hook. The counter turns red at 10 / 8 words; nothing says what to do about it until the checker, lower down, says "Cut it from 10 words to 8 or fewer". Acceptable.
6. Write Problem, Impact, Solution, Close. The Solution hint says "Name the tool from the Solutions list" but there is no way to see the Solutions list from here (it is in Settings, Solutions).
7. Click "Fill from P.I.S." (6). After five seconds: "claude error: Failed to authenticate: OAuth session expired and could not be refreshed. Hint: run claude and /login in a terminal." The new hire cannot act on this; it does not say who can, or that the piece can still be written by hand.
8. Click the WhatsApp Status tab (7), write the Status text. The preview updates live and the *stars* rule is explained in the hint. Good.
9. Save (8). The piece is pc-0001, "Draft", not placed. Mark for review (9). Toast: "Saved, and waiting in the review queue". The footer shows "Working as a non-approver" and a disabled Approve. Nothing says what happens next, who approves, or whether anything has to be sent to Palak.
10. The picture. The AI card has one button, "Image prompts", which returns raw JSON. There is no link from the piece to the card maker. Only by knowing the route `#/pictures?piece=pc-0001` (10) does the Status rule card appear, pre-filled from the close line, and "Export PNG" (11) saves it against the piece.
11. Back on the piece (12), the picture is nowhere: the Files card lists uploads only, and the saved card (`piece.images`) is not shown. The new hire cannot tell Palak the picture is done.
12. On the phone the editor stacks cleanly and the action bar stays at the foot; the review card for the piece shows the empty Instagram tab first.

Twelve clicks, two of which need knowledge the tool does not give (the route to Pictures, and that a Status slot takes a Status rule), and one dead end at step 3.

## Where the tool assumes knowledge a new hire does not have

- Which piece type a slot takes, and which account it goes to (fixed by carrying the slot into the editor).
- The brief's rules: the checker reports violations but never lists what it checks, so a new hire learns the rules one mistake at a time.
- The Solutions list, named in a hint but not reachable from the editor.
- What "Animated reel" and "Episode" are: types a new hire cannot make (they are rendered on the Mac from the animation files), listed first in the Type menu with no hint.
- What "Fill from P.I.S.", "Refine", "Check with AI" and "Image prompts" will do before they are pressed, and what to do when they fail.
- What "Mark for review" leads to, and that nothing has to be sent by hand.

## Confusing labels and states

- "Not placed in the calendar yet" on a piece created from a slot.
- An empty Instagram tab that cannot be removed.
- "Working as a non-approver" with a visible but disabled Approve button and a Retire button in red beside it.
- "Image prompts" under a heading "Pictures": the one thing it does not make is a picture.

## The three paths

- **Status rule**: clear once the type is right; the card maker fills from the close line.
- **Carousel**: Type carousel shows the seven-slide editor with the kit's slide types; Pictures has "Export all slides". Reachable only by the same hidden route.
- **Reel script**: "B-roll video" shows the say-and-sees table with a spoken-word count; "Animated reel" shows nothing to write, which is right but unexplained.

## Verdict before the rework

The new hire would get a Status rule written and into review with help from a colleague on the first day, would not find the picture path on their own, and would stop trusting the AI buttons after the first failure. They would keep using the editor and the calendar; the piece-from-slot path and the pictures path have to work for them to work alone.

## What was fixed tonight

1. **Create new from a slot** carries the slot, the day and time, the account and the first piece type the slot takes. The editor opens as a Status rule for WhatsApp Status, planned for Thursday 17 December, and placing happens on save.
2. **Type and targets.** Changing the type swaps the targets to the new type's defaults when they were still the old defaults. An empty rendition no longer counts: removing an account removes its tab (in the editor and the review card).
3. **Pictures from the piece.** A Pictures card in the editor shows the pictures saved for the piece and a "Make a card in Pictures" button that opens the card maker on this piece, with the template that fits the type named. The old "Image prompts" button stays under it, with a line saying what it returns.
4. **The rules the checker checks** are listed under the checker ("What the checker looks for", folded), from the rules document, with the hand checks listed separately.
5. **AI buttons** carry a one-line description of what they will do, and a failed call says in plain words that Claude is not signed in on this Mac, who can fix it, and that the piece can be written by hand.
6. **After Mark for review** a banner says the piece is in the review queue, that an approver approves it there, and that nothing has to be sent by hand. For a non-approver the Approve button is replaced by that line.
7. **Type hints.** Animated reel and Episode carry a hint that they are rendered from the Mac's animation files and that a new video is written as a B-roll script.
8. **Solutions at hand.** The Solution field's hint links to the Solutions list.

## What was left, and why

- The hook counter still allows a 10-word hook into review (the checker warns, the approver decides). Deliberate: the brief's limit is a rule for the approver, not a lock on the writer.
- Carousel slides and the Pictures slide export stay two screens apart; the new Pictures card makes the second screen one click away. Rendering slides inside the editor is a larger build.
- Animated reels still cannot be made in Studio; that is by design (the renderer stays on the Mac).
