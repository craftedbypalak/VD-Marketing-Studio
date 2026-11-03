// Link: the read-only routes the separate Network tool pulls from (docs/SPLIT-AND-HOSTING.md, section 2). [core]
//
//   GET /api/link/events?from=YYYY-MM-DD&to=YYYY-MM-DD
//     -> [{ id, name, date, kind, scope, community, tiers, postingRule, greetingText, wording: { whatsapp } }]
//   GET /api/link/pieces?status=published|approved
//     -> [{ id, title, hook, channel, accountId, url, publishedAt, solutionId }]
//
// Both need the header X-Link-Token equal to settings.linkToken; anything else
// is refused with 401. Nothing flows the other way: Studio never calls Network.

import { store } from './store.mjs';

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Studio's statuses for "out in public". `published` is the word the link uses.
const STATUS_SETS = {
  published: ['posted', 'measured'],
  posted: ['posted'],
  measured: ['measured'],
  approved: ['approved'],
};

function guard(ctx) {
  const expected = String(ctx.settings().linkToken || '').trim();
  const given = String(ctx.req.headers['x-link-token'] || '').trim();
  if (!expected || !given || given !== expected) {
    throw new ctx.HttpError(401, 'A valid X-Link-Token header is required');
  }
}

export function linkEvent(ev) {
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    kind: ev.kind,
    scope: ev.scope || 'national',
    community: ev.whoGets || 'none',
    tiers: Array.isArray(ev.tiers) ? ev.tiers : [],
    postingRule: ev.postingRule || 'normal',
    greetingText: ev.greetingText || '',
    wording: { whatsapp: ev.templates?.whatsapp || ev.greetingText || '' },
  };
}

export function linkPiece(piece, accounts) {
  const accountId = Array.isArray(piece.targets) && piece.targets.length ? piece.targets[0] : null;
  const account = accountId ? accounts.find((a) => a.id === accountId) : null;
  return {
    id: piece.id,
    title: piece.renditions?.yt?.title || piece.hook || piece.id,
    hook: piece.hook || '',
    channel: account?.platform || null,
    accountId,
    url: piece.measure?.postedLink || null,
    publishedAt: piece.measure?.postedAt || piece.approvedAt || null,
    solutionId: piece.solutionId || null,
  };
}

export const routes = [
  {
    method: 'GET', path: '/api/link/events',
    handler: (ctx) => {
      guard(ctx);
      const { from, to } = ctx.query;
      if (!isYmd(from) || !isYmd(to)) throw new ctx.HttpError(400, 'from and to must be dates (YYYY-MM-DD)');
      if (to < from) throw new ctx.HttpError(400, 'to must not be before from');
      return store.list('events', (e) => e.date >= from && e.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)))
        .map(linkEvent);
    },
  },
  {
    method: 'GET', path: '/api/link/pieces',
    handler: (ctx) => {
      guard(ctx);
      const wanted = String(ctx.query.status || 'published').toLowerCase();
      const statuses = STATUS_SETS[wanted];
      if (!statuses) throw new ctx.HttpError(400, `status must be one of ${Object.keys(STATUS_SETS).join(', ')}`);
      const accounts = store.list('accounts');
      return store.list('pieces', (p) => statuses.includes(p.status))
        .sort((a, b) => String(b.measure?.postedAt || b.approvedAt || b.updatedAt).localeCompare(String(a.measure?.postedAt || a.approvedAt || a.updatedAt)))
        .map((p) => linkPiece(p, accounts));
    },
  },
];
