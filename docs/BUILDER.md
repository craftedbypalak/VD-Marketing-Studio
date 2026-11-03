# Builder v2: tool boxes, a fixed logo, glanceable text

Version 2, 3 November 2026. Palak's brief:
- The logo sits at the bottom only, at a fixed place and a fixed size, however short the text.
- The Builder holds only things that can be edited, as a grid of tool boxes.
- Each box lets the director add, change and remove what it holds.
- No blocks of text anywhere in Studio. Short bullets, glanceable.

## 1. The Builder frame (done, do not restructure)
- `#/builder`: grid of tiles. Tile = icon, title, up to 4 bullets of current values, "Edit".
- `#/builder/<id>`: that box's editor. "All tools" goes back.
- "Show or hide tools": director hides boxes they do not use (`settings.builder.hidden`).
- Files:
  - `app/js/views/builder.js`: grid and box page
  - `app/js/builder/index.js`: the list of boxes
  - `app/js/builder/kit.js`: `makeCtx`, `stringList`, `rowList`
  - `app/js/builder/boxes/<id>.js`: one file per box
  - `app/css/builder.css`: `.bx-*` styles
- A box module:
```js
export const box = {
  id, title, icon /* a name in app/img/icons.svg */, order,
  summary(ctx) /* -> up to 4 short strings: the current values, e.g. "Logo: full, bottom" */,
  async render(container, ctx) /* the editor */,
};
```
- `ctx`: `settings`, `rules`, `accounts`, `canEdit`, `saveSettings(apply)`, `saveRules(apply)`, `api`, `toast`.
  - `saveSettings(doc => { doc.video = {...} })` fetches fresh, applies, PUTs, toasts "Saved".
  - Read-only users see the same editor with inputs disabled and no Save.
- Editor layout inside a box: one `card()` per group, a Save button per card (or one per box), add and remove on every list.

## 2. Boxes
| Box | id | Holds | Stored in |
|---|---|---|---|
| Brand and logo | brand | logo type, tagline text, tagline layout, live preview of every template | `settings.brand` |
| Card templates | cards | per template: on or off, default theme, default footer line, fixed words ("SWIPE", "A venture by VSP", "Warm wishes") | `settings.cards` |
| Posting rhythm | rhythm | weekly and monthly slots per account, calendar defaults, greeting time, time zone, go dark | `accounts[].weekly/monthly`, `settings.calendar`, `settings.timezone`, `settings.goDark` |
| Checker rules | checker | voice, say, never say, course terms, names, claims, limits, checklist, allowed emoji, allowed capitals, Hinglish words | `rules` |
| Video defaults | video | words a minute, target minutes and range, face chapters, face scenes per chapter, chapter plan, Shorts per video, website | `settings.video`, `settings.website` |
| Occasions | occasions | greeting time, Status account, years before a concept repeats, festival angle bank | `settings.occasions`, `festival-angles` collection |

- Every new setting falls back to today's hard-coded value when it is missing, so nothing changes until the director edits it.
- Marketing only (Palak, 3 November 2026). Accounts, solutions, AI, users and review routing stay in Settings.

## 3. The logo on visuals
- Bottom only. The "Top" choice is removed; a stored `position: 'top'` is read as bottom.
- Fixed per template format: x, bottom edge and height never change with the text, the theme, the logo choice or the tagline layout.
- The tagline never moves the logo. "Below logo" draws the tagline under the logo in the bottom margin; if it does not fit there, it falls back to one line beside the logo.
- Status cards (1080 x 1920) keep the WhatsApp safe zone; the logo sits on the safe zone's bottom line, not above empty space.

## 4. Glanceable text (everywhere in Studio)
- No paragraph over about 20 words. Use `bullets([...])` from `app/js/ui.js`.
- One idea per bullet, 3 to 5 bullets, start with the verb or the noun that matters.
- Hints under fields: one short line, or nothing.
- Confirm dialogs: one line of message.
- Keep the house register: sentence case, no emoji, no exclamation marks, no em dashes.

## 5. Rules for builders
- Plain JavaScript, no build step, no new dependencies.
- Run `node --test server/*.test.mjs` before you finish; all must pass.
- Test in the browser through a throwaway server (`server/_scratch.mjs` pattern) or a copy of `data/`; never leave changes in `data/` from testing.
- Works at 390 px with no horizontal scroll.
