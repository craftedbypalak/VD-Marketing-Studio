# Audit 10: the grouped navigation and the calendar as the front page

Date: 30 October 2026, after the content round (commit 82f94bf). Palak's instruction, relayed: "the calendar should be on front so that I can view everything properly as a calendar", and the navigation grouped so nothing has to be hunted for. Built-in browser, desktop and 375 px, working as Palak.

## What changed

1. **The navigation is three things.** Calendar (the home view), then a Content group holding Library, Review, Video, Pictures and Recurring, then Settings. On the laptop the left nav shows the group with its five items indented under a small label. On the phone the tab bar shows Calendar, Content and Settings, and inside the Content group a sub-bar under the page title carries the five items.
2. **The calendar opens first.** `#/calendar` is the home; a bare address opens it. Before the first posting week it opens on the first month that has slots (November), not on an empty October. On the phone it opens on the week, on the laptop on the month, until the person chooses the other.
3. **Today is a strip above the calendar.** Folded, it is one line: the month's approved share with posted and open counts, what is due in seven days and not ready (and how many are blocked), the review queue, your pieces, and a red chip while no approver has a PIN. Unfolded, it is the whole of the old Today page: the month card, the due list with its reasons, your pieces, the queue, the checker's blocked list, events, video. `#/today` still works and opens the calendar with the strip unfolded.
4. **The calendar reads as a calendar.** The month grid shows every slot with its account, time, kind and piece, every event marker, and the dark, greeting-only and quiet days by colour; the week view lists seven days with full slot rows; the day panel opens the piece. The approver's three file actions (import, regenerate, write the CSV) fold under "Files" so the grid comes first on every screen.

## The perspectives

- **Director.** Opens the tool: the calendar with the month and the one-line strip. Unfolds the strip: the month card and the due list. Nothing else to find. Kept.
- **Marketing director.** Plans from the month grid, moves pieces from the day panel, reaches the library and the review queue from the Content group without leaving the calendar's frame of mind. The "Files" fold hides the three rare actions until needed.
- **Employee.** On the phone, the week shows the slots of the days ahead with their state; Create new from the day panel as before; the Content sub-bar reaches Review and Pictures in one tap.
- **The ICP reading the content.** Unchanged by this pass; the content audit (09) stands.

## Left

- The phone's week view opens on the current week, which is empty before 1 November; the "next" arrow is one tap away. A "first week with slots" rule, as the month has, was not added because the current week is the right home once posting starts.
- The old Today route redirects; links in older notes that say "Today" now mean the strip.
