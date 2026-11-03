# Audit 6: the director, on the content

Date: 30 October 2026, on the tool at commit 9d2420d, with the runner queue answering every AI step by hand (the Claude login was still expired). Built-in browser at desktop width and 375 px, working as Palak (the approver). Walked the full flow once: an open slot, a new piece, the AI draft, the checks, approval, the pictures, and "Record as posted".

## The walk

1. Today showed November at 0 per cent approved and the open Thursday carousel slot on 12 November among the due list. Calendar, 12 November, "Create new" on the carousel slot: the editor opened as a carousel for Venture Drafters Instagram, planned for Thursday 12 November, 19:30.
2. Wrote the Problem, Impact, Solution and Close lines as the director would: the 7 pm questions, the cost of answers living in people's heads, the reminder desk and the owner's screen, the promise line. Hook: "Five questions you ask every evening".
3. **"Fill from P.I.S." did nothing.** No toast, no error, no draft. The console showed an uncaught error inside the editor (an empty Instagram tab with no caption yet made the "has text" test fail). Fixed in the walk so the walk could continue; the director would have given up here. Severe.
4. With the fix, "Fill from P.I.S." queued the request for the runner (the login is expired, `runnerWaitMs` is 15 minutes) and the answer, written by hand in the draft schema, arrived as the caption, five hashtags and seven slides. The checker reported nothing. "Check with AI" queued and came back with six checklist judgements and "Nothing to change". Saved as pc-0001, placed in the slot.
5. Marked for review, then approved in the same screen, one click later. The sole approver approved their own piece without the review queue. Accepted for a founder who is the only approver; see "left".
6. **The pictures.** "Make a card in Pictures" promised the carousel slides and opened the card maker on the **Status rule** template, showing the brand line "Run the business. Not the follow-ups." instead of the piece. Only after choosing "Carousel slide" and pressing "Use piece text" did slide 1 read "Five questions you ask every evening". "Export all 7" then saved seven 1080 x 1350 PNGs against the piece. Serious: the director would have exported a Status card for a carousel.
7. **Record as posted** opened with today's date and time, the piece's account and a link field. It accepted a date two weeks in the future (12 November) without a word. The piece moved to Posted; Today's month card showed 1 posted and "Went out: Five questions you ask every evening". Serious: a record of a posting that has not happened is the one thing this step must refuse.
8. Today's AI line read "No AI call this month yet" beside "Claude answered at 10:37 pm": the card counts November while the calls were made in October, and it called a hand answer "Claude". Medium.
9. On the phone the posted banner, the editor and the action bar read well.

## The content, judged as the director

- **ICP.** The piece speaks to an owner of a manufacturing or trading firm at 7 pm: dispatch, quote, payment, complaint. The impact is an impact (the evening is theirs, the client finds the mistake), not a second problem. It would be forwarded to a peer owner. Good.
- **Storyline.** The close names two tools we built and run (the reminder desk, the owner's screen) on the owner's own sheet. "Work needs a home" carries the design idea. The frame is visible in the piece itself.
- **Register.** Formal, calm, no emoji, no exclamation mark, five hashtags at the end, Problem, Impact, Solution in order. One phrase to change: "the dispatch boy" is the owner's own word for the role, but it reads as a slight to a member of staff in our voice; "the person at dispatch" keeps the scene. Changed as a version 3 (see fixes).
- **Channel.** Seven slides at 1080 x 1350, the point inside the first 125 characters of the caption, a plain ask to save and send. Fits the plan's Instagram row.

## Verdict before the rework

The flow runs from slot to posted in one sitting, and the content that came out is on brief. The director would not trust the tool with two of its steps: a picture step that opens on the wrong template and a posting record that accepts a date that has not arrived.

## What was fixed

1. "Fill from P.I.S." no longer fails on an empty rendition tab (the crash found in the walk).
2. Pictures opens on the template that fits the piece type (carousel slides for a carousel, the Status rule card for a Status rule, the thumbnail for YouTube, the LinkedIn image for LinkedIn text, the hook card otherwise) and fills from the piece; choosing another template with a piece selected refills from the piece.
3. "Record as posted" refuses a time in the future on the server, with the reason; the dialog says the time must have passed.
4. Today's AI line counts the last thirty days, says how many answers were written by hand, and names the mode of the last answer plainly (Claude, the API, or a person answering as the runner).
5. "The dispatch boy" became "the person at dispatch" in pc-0001, as version 3 with a change note.

## What was left

- A sole approver can approve their own piece at once. A second approver would change this; the rule "never your own piece" should come with the second approver, and Palak decides when.
- The posting record for pc-0001 was made for the walk and then undone (the piece is back to approved, with the record kept in the log), so the library tells the truth. The runner wait shows nothing on screen while it waits beyond the first toast; a progress line for long waits is a follow-up.
