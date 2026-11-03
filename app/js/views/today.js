// Today: the day's lists across modules, from GET /api/today. [core]
// Since 30 October 2026 this is not a page of its own: the calendar (the home view)
// shows it as a strip above the month, folded, with a one-line summary; #/today redirects there.
// render(container, params, preloaded) draws the full lists; summary(data) draws the line.

import { api } from '../api.js';
import { el, card, listRow, statusPill, chip, icon, fmt, button, toast, bullets } from '../ui.js';

export const route = '#/today';
export const title = 'Today';

/** One line for the calendar's strip: the month, what is due and stuck, the queue, trust. */
export function summary(data) {
  const m = data.month || {};
  const s = m.slots || {};
  const pct = s.allotted ? Math.round((s.approved / s.allotted) * 100) : 0;
  const due = data.openSlots || [];
  const blockedDue = due.filter((x) => (x.missing || []).includes('blocked by the checker')).length;
  const mine = (data.mine || []).length;
  const noPin = (m.approversWithoutPin || []).length > 0;
  const monthLabel = m.from ? fmt.date(m.from).replace(/^\d+ /, '') : '';
  return el('div', { class: 'cal-today-line' }, [
    el('b', { text: 'Today' }),
    chip({ label: `${monthLabel}: ${pct}% approved, ${s.posted || 0} posted, ${s.open || 0} open`, tone: 'navy' }),
    chip({ label: `Due in seven days, not ready: ${due.length}`, tone: due.length ? 'warn' : 'ok' }),
    blockedDue ? chip({ label: `Blocked: ${blockedDue}`, tone: 'bad' }) : null,
    ...reviewChips(data),
    mine ? chip({ label: `Your pieces: ${mine}`, tone: 'muted' }) : null,
    noPin ? chip({ label: 'No PIN for a reviewer', tone: 'bad' }) : null,
    el('span', { class: 'cal-today-hint', text: 'Open for the lists' }),
  ]);
}

/** The review line for the chosen role, from reviewCounts; the plain queue count when the server has none. */
function reviewChips(data) {
  const c = data.reviewCounts;
  const role = data.month?.role;
  const n = (v) => Number(v) || 0;
  if (!c || !role) return [chip({ label: `Waiting for review: ${(data.review || []).length}`, tone: 'muted' })];
  const link = (label, tone, tab) => el('a', { href: `#/review?tab=${tab}`, class: 'cal-today-link', onClick: (e) => e.stopPropagation() }, chip({ label, tone }));
  if (role === 'director') return [link(`Awaiting you: ${n(c.director)}`, n(c.director) ? 'warn' : 'muted', 'director'), n(c.manager) ? chip({ label: `With the manager: ${n(c.manager)}`, tone: 'muted' }) : null];
  if (role === 'manager') return [link(`In your queue: ${n(c.manager)}`, n(c.manager) ? 'warn' : 'muted', 'manager'), n(c.director) ? chip({ label: `With the director: ${n(c.director)}`, tone: 'muted' }) : null];
  return [
    link(`Yours under review: ${n(c.mine)}`, 'muted', 'mine'),
    n(c.changesRequested) ? link(`Sent back to you: ${n(c.changesRequested)}`, 'bad', 'mine') : null,
  ];
}

const ACCOUNT_SHORT = {};

const SHOW_AT_MOST = 8;
const stat = (n, label) => el('div', { class: 'td-stat' }, [el('b', { class: 'mono', text: String(n) }), el('span', { text: label })]);

function section({ title: t, count, rows, emptyText, href, hrefLabel, note }) {
  const head = el('div', { class: 'section-title' }, [el('h2', { text: t }), el('span', { class: 'count', text: String(count) })]);
  const body = el('div', {}, [
    note ? el('p', { class: 'note', style: { margin: '0 0 8px' }, text: note }) : null,
    rows.length ? el('div', { class: 'list' }, rows) : el('div', { class: 'empty-inline', text: emptyText }),
  ]);
  const footer = href ? [button({ kind: 'ghost', label: hrefLabel, href, small: true })] : undefined;
  return card({ title: head, body, footer });
}

const REASON = {
  'no piece': { label: 'Open', tone: 'muted' },
  'not approved': { label: 'Not approved', tone: 'warn' },
  'blocked by the checker': { label: 'Blocked', tone: 'bad' },
};
const byPlanned = (a, b) => `${a.plannedDate || '9999'} ${a.plannedTime || ''} ${a.id}`.localeCompare(`${b.plannedDate || '9999'} ${b.plannedTime || ''} ${b.id}`);

export async function render(container, params, preloaded) {
  container.appendChild(el('div', { class: 'loading', text: 'Loading the day' }));
  let data;
  try {
    const [today, accounts] = preloaded ? [preloaded.today, preloaded.accounts] : await Promise.all([api.today(), api.get('/accounts')]);
    data = today;
    for (const a of accounts) ACCOUNT_SHORT[a.id] = a.short || a.id;
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not load today: ${err.message}` }));
    return;
  }
  container.replaceChildren();

  container.appendChild(el('p', { class: 'muted', text: `${fmt.weekday(data.date)} ${fmt.date(data.date)}` }));

  if (data.goDark?.on) {
    container.appendChild(el('div', { class: 'banner banner-bad' }, [icon('warn'),
      el('div', {}, [el('b', { text: 'Go dark is on. ' }), `Nothing is posted${data.goDark.from ? ` from ${fmt.date(data.goDark.from)}` : ''}${data.goDark.to ? ` to ${fmt.date(data.goDark.to)}` : ''}. ${data.goDark.reason || ''}`])]));
  }

  // The director's five minutes: the month, what went out, the AI, the people, the storyline.
  const m = data.month;
  if (m) {
    const s = m.slots;
    const pct = s.allotted ? Math.round((s.approved / s.allotted) * 100) : 0;
    const who = { cli: 'Claude on the subscription', api: 'the Claude API', hand: 'a person, by hand', runner: 'a person, as the runner' };
    const billing = m.ai.mode === 'cli' ? 'subscription, no bill' : 'API key, billed per token';
    const aiLine = m.ai.calls
      ? `${m.ai.calls} ${m.ai.calls === 1 ? 'call' : 'calls'}${m.ai.byHand ? `, ${m.ai.byHand} by hand` : ''}${m.ai.failed ? `, ${m.ai.failed} failed` : ''}${m.ai.costUsd !== null ? `, ${m.ai.costUsd} USD for ${m.ai.costKnownFor}` : ''}; ${billing}.`
      : `none; ${billing}.`;
    const aiState = m.ai.last?.at ? (m.ai.last.ok ? `${who[m.ai.last.mode] || m.ai.last.mode}, ${fmt.dateTime(m.ai.last.at)}.` : `failed ${fmt.dateTime(m.ai.last.at)}: ${/authenticate|oauth|login/i.test(m.ai.last.error || '') ? 'Claude is not signed in on this Mac.' : m.ai.last.error}`) : 'none since the server started.';
    const people = m.actionsThisWeek.length ? m.actionsThisWeek.map((a) => `${a.by} ${a.actions}`).join(', ') : 'none recorded';
    const story = data.checker?.storyline;
    container.appendChild(card({
      title: el('div', { class: 'section-title' }, [el('h2', { text: `This month, ${fmt.date(m.from).replace(/^\d+ /, '')}` }), el('span', { class: 'count', text: `${pct}% approved` })]),
      body: el('div', { class: 'td-month' }, [
        el('div', { class: 'td-stats' }, [
          stat(s.allotted, 'allotted slots'), stat(s.filled, 'filled'), stat(s.approved, 'approved'), stat(s.posted, 'posted'), stat(s.open, 'still open'),
        ]),
        el('ul', { class: 'td-lines' }, [
          el('li', {}, [el('b', { text: 'Went out: ' }), m.posted.length ? m.posted.map((p) => p.hook).join('; ') : 'nothing yet this month. Posting is by hand; mark it on the measure block.']),
          el('li', {}, [el('b', { text: 'AI, last thirty days: ' }), aiLine]),
          el('li', {}, [el('b', { text: 'Last AI answer: ' }), aiState]),
          el('li', {}, [el('b', { text: 'People, last seven days: ' }), `${people} (actions logged, not hours).`]),
          m.lastChange ? el('li', {}, [el('b', { text: 'Last change: ' }), `${m.lastChange.by || 'unknown'}, ${fmt.dateTime(m.lastChange.at)}, ${m.lastChange.what}.`]) : null,
          story ? el('li', {}, [el('b', { text: 'The storyline in the content: ' }), `${story.namesTool} of ${story.pieces} pieces name a tool we built; ${story.systemAlone} say "system" alone. `, el('a', { href: '#/content?q=system', text: 'See them' })]) : null,
          m.approversWithoutPin?.length ? el('li', { class: 'td-warn' }, [el('b', { text: 'Trust: ' }), `no PIN for ${m.approversWithoutPin.join(', ')}; anyone here can approve as them. `, el('a', { href: '#/settings?tab=users', text: 'Set one in Settings' })]) : el('li', {}, [el('b', { text: 'Trust: ' }), bullets(['Approval: a manager or the director, with PIN.', 'Deletes and settings: the director, with PIN.', 'The checker blocks pieces that break the brief.'], { compact: true })]),
        ].filter(Boolean)),
      ]),
    }));
  }

  const grid = el('div', { class: 'grid-2' });

  // What is due in the next seven days and is not ready: open, not approved, or blocked.
  const due = data.openSlots;
  const blockedDue = due.filter((s) => (s.missing || []).includes('blocked by the checker')).length;
  const openDue = due.filter((s) => (s.missing || []).includes('no piece')).length;
  grid.appendChild(section({
    title: 'Due in the next seven days, not yet ready',
    count: due.length,
    note: due.length ? `${openDue} ${openDue === 1 ? 'slot is' : 'slots are'} open, ${blockedDue} ${blockedDue === 1 ? 'piece is' : 'pieces are'} blocked by the checker, ${due.length - openDue - blockedDue} ${due.length - openDue - blockedDue === 1 ? 'waits' : 'wait'} for approval.` : null,
    rows: due.map((s) => {
      const why = (s.missing || [])[0] || 'not approved';
      const r = REASON[why] || { label: why, tone: 'muted' };
      const open = why === 'no piece';
      return listRow({
        date: `${fmt.weekday(s.date)} ${s.date.slice(5)} ${s.time || ''}`.trim(),
        title: open ? `Open: ${s.slotLabel || s.label || s.kind}` : (s.pieceHook || s.pieceId),
        sub: [ACCOUNT_SHORT[s.accountId] || s.accountId, s.slotLabel && !open ? s.slotLabel : null].filter(Boolean).join(' · '),
        aside: [chip({ label: r.label, tone: r.tone })],
        href: open ? `#/calendar/${s.date.slice(0, 7)}?day=${s.date}` : (why === 'blocked by the checker' ? `#/content/${encodeURIComponent(s.pieceId)}` : `#/review?piece=${encodeURIComponent(s.pieceId)}`),
      });
    }),
    emptyText: 'Everything due this week is approved and in place.',
    href: `#/calendar/${data.date.slice(0, 7)}?view=week&week=${data.date}`, hrefLabel: 'Open the week',
  }));

  if (Array.isArray(data.mine) && data.mine.length) {
    grid.appendChild(section({
      title: 'Your pieces',
      count: data.mine.length,
      note: 'What you created or last edited, newest first, with where each stands.',
      rows: data.mine.map((p) => listRow({
        title: p.hook || p.id,
        sub: [p.type, p.plannedDate ? `planned ${fmt.date(p.plannedDate)}` : 'not planned', `updated ${fmt.dateTime(p.updatedAt)}`].filter(Boolean).join(' · '),
        aside: [statusPill(p.status)],
        href: `#/content/${encodeURIComponent(p.id)}`,
      })),
      emptyText: 'Nothing yet.',
      href: '#/content', hrefLabel: 'Open the library',
    }));
  }

  const review = [...data.review].sort(byPlanned);
  grid.appendChild(section({
    title: 'Waiting for review',
    count: review.length,
    note: review.length > SHOW_AT_MOST ? `The first ${SHOW_AT_MOST} by planned date. The queue holds all ${review.length}.` : null,
    rows: review.slice(0, SHOW_AT_MOST).map((p) => listRow({
      title: p.hook || p.id,
      sub: [p.type, p.pillar, p.plannedDate ? `planned ${fmt.date(p.plannedDate)}` : 'not planned'].filter(Boolean).join(' · '),
      aside: [statusPill(p.status)],
      href: `#/review?piece=${encodeURIComponent(p.id)}`,
    })),
    emptyText: 'Nothing is waiting for review.',
    href: '#/review', hrefLabel: 'Open the review queue',
  }));

  const checker = data.checker || { blocked: [], unchecked: 0 };
  grid.appendChild(section({
    title: 'Blocked by the checker',
    count: checker.blocked.length,
    note: checker.unchecked ? `${checker.unchecked} not checked yet; run "Check all" in Content.` : null,
    rows: checker.blocked.slice(0, SHOW_AT_MOST).map((p) => listRow({
      title: p.hook || p.id,
      sub: [p.type, p.plannedDate ? `planned ${fmt.date(p.plannedDate)}` : 'not planned'].filter(Boolean).join(' · '),
      aside: [chip({ label: `${p.blocks} ${p.blocks === 1 ? 'block' : 'blocks'}`, tone: 'bad' })],
      href: `#/content/${encodeURIComponent(p.id)}`,
    })),
    emptyText: checker.unchecked ? 'No checked piece is blocked.' : 'No piece is blocked by the checker.',
    href: '#/content?checker=blocked', hrefLabel: 'All blocked pieces in Content',
  }));

  grid.appendChild(section({
    title: 'Events in the next fourteen days',
    count: data.events.length,
    rows: data.events.map((e) => listRow({
      date: `${fmt.weekday(e.date)} ${e.date.slice(5)}`,
      title: e.name,
      sub: [e.kind, e.scope].filter(Boolean).join(' · '),
      aside: [e.postingRule && e.postingRule !== 'normal' ? statusPill(e.postingRule === 'dark' ? 'dark' : e.postingRule === 'greeting-only' ? 'greeting-only' : e.postingRule) : null],
      href: '#/occasions',
    })),
    emptyText: 'No events in the next two weeks.',
    href: '#/occasions', hrefLabel: 'Open occasions',
  }));

  grid.appendChild(section({
    title: 'Video in progress',
    count: data.videos.length,
    rows: data.videos.map((v) => listRow({
      title: v.title || v.id,
      sub: v.solutionId || '',
      aside: [statusPill(v.status)],
      href: `#/video/${encodeURIComponent(v.id)}`,
    })),
    emptyText: 'No video project is open.',
    href: '#/video', hrefLabel: 'Open video',
  }));

  container.appendChild(grid);

  // Any error a module reported while enriching the payload.
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith('Error')) toast(`${k.replace('Error', '')} could not add to Today: ${v}`, 'warn');
  }
}
