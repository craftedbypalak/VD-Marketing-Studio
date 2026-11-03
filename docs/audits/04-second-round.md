# Second round, shorter

Date: 30 October 2026, on the tool after all three reworks (commit 0583903). Each perspective walked again, looking only for what would make that person stop using the tool.

## Perspective 1, the marketing manager

Walked: Today, a blocked row into the editor, the Content checker filter, the review queue, the calendar day panel and picker, the move dialog.

- Today now answers "what is due and why it is stuck" in one card and leads straight to the piece or the review card. Kept.
- The checker filter finds the 19 in one click; the editor shows each block with its fix beside the field. Kept.
- **Found: a false block.** B1 was blocked twice, once for six hashtags and once for the hashtag `#followups`, because the brief's spelling rule ("always follow-ups, with the hyphen") was applied inside the hashtag field, where a hyphen cannot exist. Fixed: spelling-only rules (those whose note names the hyphen) are not applied to hashtag and tag fields. The count stays 19 (B1 still has the hashtag count block).
- **Found: approver-only buttons shown to staff.** "Regenerate slots", "Fill from import file" and "Write calendar.csv" on the calendar, "Save" on every Settings tab, "Import again" and "Delete" on Recurring were visible to a staff user and failed with a 403 message. Fixed: hidden for non-approvers, with a one-line note on Settings and Recurring saying who changes them. The server guard stays.
- Nothing left that would make the manager stop using it. Cosmetic: the library toolbar wraps to two lines below about 900 px.

## Perspective 2, the marketing employee

Walked: Today, the open Thursday slot, Create new, the editor, Save, Mark for review, the Pictures card, the card maker, back to the piece.

- From the open slot to a saved Status rule in review with its card: Today (1), Create new (2), write the hook, the lines and the Status text, Save (3), Mark for review (4), Make a card in Pictures (5), Export PNG (6). Six clicks, no knowledge assumed that the screen does not give.
- The AI failure reads as a sentence a new hire can act on ("Ask Palak to run claude and /login"); the piece can still be written by hand.
- Nothing left that would make the employee stop using it. Left for Palak: whether the Solutions list should be read-only for staff (it is editable by anyone today, and it is what the AI may name).

## Perspective 3, the director

Walked: Today as the approver and as staff, Settings Users and Link as both, a stale save, the PIN prompt.

- The month card answers on plan, went out, AI and people in one card; the Trust line warns until a PIN is set.
- As staff: no token on the Link tab, no Save buttons, no Delete, no Regenerate; a direct request to any of those routes is refused.
- The stale-save dialog names who saved and when and offers Reload or Save anyway.
- Nothing left that would make the director stop using it. Only Palak can decide: set the PIN; whether to require a PIN for every approver action or only for approval.

## Third round

Not needed: the second round found two small things (a false block and visible buttons), both fixed and re-checked in the browser, and nothing material.
