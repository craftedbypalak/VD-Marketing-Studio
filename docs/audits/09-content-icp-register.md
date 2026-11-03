# Audit 9: the content, the ICP and the register

Date: 30 October 2026. Run inside each of the three poses (audits 6 to 8) and once over the whole library at the end. The brief (`Marketing/00-brief.md`, sections 1 to 5) was read first and wins on every judgement. The Claude login was expired all night, so the review pass, every draft, every check, the greeting wordings and the announcement drafts were written by hand in the operation's own schema and saved through the tool's own routes (the runner queue and `handOutput`); the log marks each as `byHand`. Six writers worked the six batches in parallel; one reviewer (this session) read the brief, the batch notes and a sample of each batch, judged the whole, and tightened the rules.

## What was judged, and against what

For every piece in the library (85 imported, 3 made in the poses, 3 example announcement drafts), every festival wording for the next two months, the example announcement, the card texts exported in the poses and every hand answer to an AI step:

1. **ICP.** Does it speak to the owner, founder or MD of an owner-led Indian business of 15 to 100 people, or the son or daughter systemising it: their problem (you are the memory, the follow-up department, new work lands on you, you find out last, everything waits for you), their day (the phone, the notes on the desk, the 7 pm), their words (chase, follow-up, slipped, "if I stop following up, work slows down")?
2. **Storyline.** Does it carry "the tools are how we run it": a tool we built and run, named from the Solutions list, on the owner's own sheet, with the honest limit (we run the system; the team still does the work)?
3. **Register.** Formal and warm, no emoji, no exclamation mark, sentence case, Problem then Impact then Solution, the retired lines gone, the hashtag rule kept, one voice across LinkedIn, Instagram, WhatsApp and YouTube.
4. **Channel.** Does each piece fit its channel's row in PLAN.html: Reel 35 to 60 seconds with the hook on camera; carousel of seven slides at 1080 x 1350 with the point in the first 125 characters; LinkedIn 900 to 1,900 characters, the hook in the first 210, one question at the end, no hashtag in the body; Status one plain line; YouTube title under 100 characters.

## The faults found, by pattern (85 imported pieces)

| Pattern | Pieces | Where it came from |
|---|---|---|
| "System", "software", "one screen" or "a list" with no tool named | 49 | Every batch. The pieces were written before the Solutions list existed; the frame "the tools are how we run it" was decided on 29 October. |
| A beat missing (no problem line, no impact, or no solution) or the caption out of order | 27 | Reels and b-roll captions that summarised instead of following Problem, Impact, Solution; two episodes and a carousel with a second problem where the impact should be. |
| Hook over eight words | 14 | LinkedIn posts whose first sentence was the hook field; the rule cards whose hook is the Status line. |
| A LinkedIn post not ending on one question (none, two, or a link line after it) | 10 | The November story set and the older bank. |
| Six Instagram hashtags | 12 | All twelve b-roll scripts, from the old posting kit's six-tag limit (the brief now says five). |
| Square-bracket placeholders | 9 | Five LinkedIn bodies, two first-comment link slots, two script rows. |
| Retired lines ("the work assigns itself", "we bring the brains") | 4 | Two reels (hook and caption), 23-ownership and 10-autoflow. |
| "best" | 5 | Reels 07 and 20, episode e06, LP9, and the Christmas greeting text ("best wishes"). |
| A claim in other words ("moves by itself", "sort themselves", "fixes itself") | 4 | Reels 12 and 19, b-roll B7, episode e05's hashtag "#workflow". |
| Founder's story off the brief ("designed by a consultant", VSP named without "my family's firm") | 3 | LP6, LP9, LP10. |
| Channel format on the carousels (rupee glyph, cover without the hook's words, no caption on c9, a LinkedIn target with no LinkedIn text) | 8 | The rendered carousel set. |
| Hashtags in mixed case across pieces | 18 | The episode and older captions used CamelCase, the rest lower case. |
| Status rule with no starred phrase for the card | 4 | The four November and December rule cards. |
| Scene off the ICP (a glimpse with no owner's day) | 2 | Reels 11 and 21. |
| A name outside the allowed list ("Zoom", a survey company) | 2 | B11, L8. |
| Diwali greeting not "joyous and prosperous" | 1 | The imported Diwali piece. |

Emoji, exclamation marks, ALL CAPS, course terms, client names, promised figures: none found in any piece. Whole Hindi sentences: none; the one Hindi tag sits inside a quoted owner line everywhere it appears (c5's slide head is that quoted line and the checker still warns; left for Palak).

## What was rewritten

- **79 version 2s** through the review pass, one per in-review piece, each with a change note saying what changed and why (71 changed, 8 "no change recommended" with a reason). Every change note is in the review queue beside the original, with the diff under "Show the original beside the proposal". Nothing is approved; Palak approves, edits or keeps version 1.
- **Version 3s** on 19 pieces: hashtags put in one case across the library, 22-lockedin's caption closing on the brief's data line, and the carousel pc-0001's "dispatch boy" (audit 6).
- **Three new pieces** from the poses (a carousel, a b-roll script, a Status rule), approved with their cards.
- **Six festival wordings** (Madhya Pradesh Foundation Day, Dhanteras, Diwali, Chhath Puja, Guru Nanak Jayanti, Christmas): Status, LinkedIn and the one-to-one line each, saved on the event. The Christmas event's seed text lost "best wishes".
- **One example announcement campaign** (the first case study) with three drafts, labelled as an example to confirm before placing.
- **Nine card PNGs** exported in the poses (seven carousel slides, a Status rule, a Reel cover).

What was not rewritten: the on-screen text of the animated reels and episodes where it breaks the brief needs re-rendering on the Mac; the change notes name the seven pieces (reels 07, 10, 12, 19, 23; episode e06; carousel slides c2 and c8). Their captions were fixed; their videos still carry the old lines until re-rendered.

## What the rules now prevent

The checker (`server/rules.mjs`), the rules document (`data/rules.json`) and the prompts (`server/ops/_shared.mjs`, `reviewPass.mjs`, `greetingTemplates.mjs`) were tightened from the patterns above:

1. A placeholder in any field now **blocks** approval (was a warning).
2. A piece that speaks of a system, software, a screen or a list and names no tool, and carries none of the brief's standing lines, is **warned** as off the storyline (founder, greeting and announcement pieces exempt).
3. "fixes itself", "sort themselves", "sorts itself", "moves by itself" and "best wishes" are on the never list and in the runs-by-itself check, so the claim cannot return in other words.
4. A LinkedIn post that does not end on one question, a Status rule with no starred phrase, Instagram hashtags in mixed case, and the rupee glyph are warned.
5. The register paragraph every AI prompt starts from now carries the ICP in one breath (who they are, their day, their words, what they are buying) and the rule that every piece carries all three beats with the tool named. The standing review instruction carries the channel rules and the founder's story rules. The greeting operation never writes "best wishes".
6. Three checklist items were added to the rules document (the tool named; the LinkedIn question, the starred phrase and the hashtag case; no placeholder), and two voice lines (all three beats; hashtags).

After the rework the whole library checks as: 0 blocked, 10 with warnings, 81 passing. The warnings left are for Palak: seven hooks over eight words where the hook is the Status line or the title itself (c1, the four rule cards, D2, D3 and the film), the example figures on c2's slides (marked as examples on the cover, flagged line by line), L8's survey percentage (sourced, not promised), and c5's quoted "ho gaya" on a slide head.

## Written by hand instead of by the model

Everything AI tonight: 79 review-pass answers (six writers), three drafts, two propose sets, three AI checks, six greeting wordings, one announcement set. Each is in the log as `ai:<op>` with `byHand: true` or `mode: runner`, and each version carries "Review pass" or the pose's note in its change note. When the login is restored, the same operations can be re-run on any piece; the hand versions stay as versions, never overwritten.

## Only Palak can decide

- Approve, edit or keep version 1 for each of the 79 proposals; the queue holds them in planned-date order.
- Re-render the seven animated pieces whose on-screen text was changed (or keep the videos and accept the caption-only fix).
- c9-google-sheet has eight slides and no caption; c3, c5 and c8 target LinkedIn without LinkedIn text: decide whether those carousels go to LinkedIn at all.
- c2's "calculator on our site" and 19-money's "a reorder note goes to the vendor": claims about things that may not exist; confirm or cut.
- Whether "You own the data. We run the system." is the data line (the brief asks for a test with five owners first); it is now in the say list and in two pieces.
- The example announcement campaign: confirm the case-study date and link, or delete it.
