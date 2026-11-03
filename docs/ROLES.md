# Roles and the review path

Version 1, 30 October 2026. Studio has three roles. This document is the contract the server and the app are built to; `ARCHITECTURE.md` section 5 points here.

## 1. The three roles

| Role | Who | Does |
|---|---|---|
| `employee` | Marketing employee | Writes pieces, makes visuals, runs the AI steps, places pieces on slots, submits a piece for review, revises a piece sent back. Cannot approve. |
| `manager` | Marketing manager | Everything an employee does, plus: reviews the queue, approves a piece (it may then be posted), requests changes, or sends a piece to the director. Records a piece as posted, regenerates slots, writes and imports the calendar. |
| `director` | Director (Palak) | Everything a manager does, plus: approves any piece including those that must reach the director, changes settings, users, rules and the review routing, deletes, sees the link token, answers AI runner requests. |

"Approver" in older text means manager or director.

### The owner (across workspaces)

Studio serves many companies, one **workspace** each (`docs/WORKSPACES.md`). The three roles above are held per workspace: one person may be a manager in one workspace and an employee in another. The **owner** (Venture Drafters) sits above the workspaces and is listed in the master registry, not in a workspace's users. An owner creates workspaces, pauses or archives them, and may enter any workspace, where they work as its director. A workspace's users list never holds the role `owner`; the director of each workspace manages its users.

### The user record

```js
{ email, name, role: 'employee' | 'manager' | 'director', pinHash? }
```

- A stored user with no `role` is read as `director` when `approver: true`, else `employee` (the migration happens on read and on the next settings save; `approver` is dropped on save).
- The server serves each user with a derived `approver: role !== 'employee'` so older views keep working, plus `pinSet`.
- At least one director is required; a settings save without one is refused with 400.
- Managers and directors may set a PIN. When set, every action reserved for their role needs `X-Studio-Pin`, exactly as before.

## 2. The review path

```
idea / draft ──submit──▶ in-review ──manager approves──▶ approved ──▶ scheduled / posted
                            │  │
                            │  └──manager sends to director──▶ director-review ──director approves──▶ approved
                            │                                        │
                            └──request changes──▶ changes-requested ◀┘ (director requests changes)
                                                     │
                                                     └──employee revises and submits again──▶ in-review
```

New status: `director-review` ("With the director"). The full list:
`idea | draft | in-review | director-review | changes-requested | approved | scheduled | posted | measured | retired`.

Everywhere the code treats `in-review` as "waiting for review" (Today, the calendar, the checker, the library filters), `director-review` is treated the same way.

### Which pieces must reach the director

`settings.reviewRouting`, changed by the director only:

```js
reviewRouting: {
  directorTypes:   ['youtube-long', 'episode', 'announcement'],  // piece.type values
  directorPillars: ['offer', 'founder'],                          // piece.pillar values
  directorOnWarnings: false,                                      // true: any checker 'warn' sends it to the director
}
```

These are the defaults when the setting is absent. A piece that matches is `needsDirector: true`, with `needsDirectorWhy` a plain sentence ("Long YouTube videos go to the director", "Pieces on the offer pillar go to the director"). A manager cannot approve such a piece (409, `{ detail: { needsDirector: true, why } }`); the manager sends it to the director instead. A manager may send any other piece to the director too, by choice, with a note.

This is the first scenario. Later scenarios (by campaign, by channel, by spend, two managers) extend `reviewRouting` without changing the statuses.

### The trail

Each piece carries `reviewTrail: [{ at, by, role, action, note? }]`, appended by the server. `action` is one of `submitted | approved | escalated | changes-requested | returned`. `submitted` is written whenever a piece's status moves into `in-review` from any other status (through PUT, PATCH or the library's bulk move). The existing `review: { note, by, at }` stays as the latest change request; `escalation: { note, by, at }` holds the manager's note to the director.

## 3. Routes

| Route | Who | Effect |
|---|---|---|
| `GET /api/me` | anyone | `{ email, name, role, pinSet, can: { approve, escalate, approveForDirector, settings, delete, recordPosted } }`; `role: null` and every `can` false when no user is chosen |
| `GET /api/review/queue` | anyone | `{ manager: [...in-review], director: [...director-review], mine: [...the caller's pieces in in-review, director-review or changes-requested] }`; each piece decorated with `needsDirector` and `needsDirectorWhy`; oldest first |
| `POST /api/pieces/:id/approve` | manager (not when `needsDirector`), director | from `in-review` or (director only) `director-review` → `approved`; sets `approvedBy`, `approvedAt`, `approvedRole`; checker blocks still refuse |
| `POST /api/pieces/:id/escalate` `{ note }` | manager, director | `in-review` → `director-review`; note required |
| `POST /api/pieces/:id/request-changes` `{ note }` | manager (from `in-review`), director (from either) | → `changes-requested` |
| `POST /api/pieces/:id/return` `{ note }` | director | `director-review` → `in-review`, back to the manager with a note |
| `PUT /api/settings/settings` | director | users, roles and `reviewRouting` |
| `PUT /api/rules/rules`, `DELETE /api/:c/:id` | director | as before, now director only |
| record-posted, slot regeneration, calendar import and export, recurring import and expansion | manager, director | as before |

Errors are as before: 401 with no user, 403 with the role named ("Only a manager or the director can approve a piece", "Only the director can change the settings"), 403 `{ pin: true }` for a missing PIN.

`GET /api/today` adds `month.role` and `reviewCounts: { manager, director, mine, changesRequested }` for the strip.

## 4. What each person sees

- **Employee.** Review opens on "Your pieces under review": each piece with where it stands (with the manager, with the director, changes requested with the note). The piece editor shows "Submit for review" on ideas, drafts and pieces sent back, and the trail.
- **Manager.** Review opens on "Your queue" (in-review). Each card: Approve, Send to director, Request changes. A piece that must reach the director shows why, and Approve is replaced by Send to director. A second tab shows what is with the director.
- **Director.** Review opens on "Awaiting you" (director-review) with the manager's note at the top of each card: Approve, Request changes, Return to manager. A second tab is the manager's queue, which the director may also act on.
- **Settings, Users.** A role per person instead of the approver switch. **Settings, Review routing** (director edits, others read): the types, pillars and the warnings switch.
- The user picker shows each name with the role: "Palak Gupta, Director".

## 5. Demo users

The real `data/settings.json` carries two demo users so the flow can be tried at once by switching in the picker: `employee@venturedrafters.test` "Marketing Employee (demo)" and `manager@venturedrafters.test` "Marketing Manager (demo)". Palak is the director. Remove them in Settings, Users when real people are added.
