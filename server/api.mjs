// Route table, validation and the auth stub (section 5). [core]
//
// Routes are plain objects: { method, path, handler }. A path may carry
// ':param' segments. The handler receives one ctx:
//
//   ctx = { req, res, params, query, body, by, workspace, store, ai, settings(), rules(), HttpError }
//         + role(), isApprover(), isDirector(), requireApprover(what), requireManager(what), requireDirector(what)
//         ("approver" means manager or director; docs/ROLES.md)
//
// and returns a JSON-serialisable value (sent as 200) or throws
// new HttpError(status, message). `by` comes from the X-Studio-User header.
// `workspace` is the company the request works in (X-Studio-Workspace, else the
// default one; docs/WORKSPACES.md); `store` reads and writes that workspace only.
//
// Module files (rules.mjs, slots.mjs, video.mjs, recurring.mjs, images.mjs, link.mjs)
// export `routes` in the same shape; index.mjs mounts them before the core
// routes, so a module can claim a more specific path. A module may also export
// `enrichToday(payload, ctx)` to add its section to GET /api/today.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { store, COLLECTIONS, SINGLETONS, ID_PREFIX, withWorkspace } from './store.mjs';
import * as workspaces from './workspaces.mjs';
import { ai, AiError } from './ai.mjs';
import { parseMultipart, imageSize } from './multipart.mjs';

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Text fields of a piece: a change to any of them makes a version (4.2).
export const PIECE_TEXT_FIELDS = ['hook', 'pis', 'renditions', 'script', 'slides', 'notes'];

// ---------------------------------------------------------------- the router

export function createRouter() {
  const table = [];
  return {
    add(method, routePath, handler) {
      const keys = [];
      const pattern = routePath
        .replace(/\/+$/, '')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
      table.push({ method: method.toUpperCase(), path: routePath, re: new RegExp(`^${pattern}/?$`), keys, handler });
    },
    mount(routes, label) {
      for (const r of routes || []) {
        if (!r || !r.method || !r.path || typeof r.handler !== 'function') {
          console.warn(`[api] skipped a malformed route in ${label || 'module'}`);
          continue;
        }
        this.add(r.method, r.path, r.handler);
      }
    },
    match(method, pathname) {
      for (const r of table) {
        if (r.method !== method.toUpperCase()) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
      return null;
    },
    list() { return table.map((r) => `${r.method} ${r.path}`); },
  };
}

// ------------------------------------------------------------------ helpers

export function sendJson(res, status, value) {
  const body = JSON.stringify(value ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

export async function readBody(req, limit = 1024 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isoDate(d = new Date(), tz = 'Asia/Kolkata') {
  // YYYY-MM-DD in the studio timezone.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const settingsDoc = () => store.getSingleton('settings') || { id: 'settings', users: [] };
const rulesDoc = () => store.getSingleton('rules') || { id: 'rules' };

/**
 * The user named by `by` in the current workspace. An owner who is not a member
 * of the workspace acts in it as its director (docs/ROLES.md section 1).
 */
function userOf(by) {
  if (!by) return null;
  const who = String(by).toLowerCase();
  const member = (settingsDoc().users || []).find((u) => String(u.email || '').toLowerCase() === who || String(u.name || '').toLowerCase() === who);
  if (member) return member;
  const owner = workspaces.ownerOf(who);
  return owner ? { email: owner.email, name: owner.name || owner.email, role: 'director', owner: true } : null;
}

// The three roles (docs/ROLES.md section 1).
export const ROLES = ['employee', 'manager', 'director'];

/** A stored user's role; one stored before roles reads as director when `approver: true`, else employee. */
function roleOfUser(u) {
  if (!u) return null;
  if (ROLES.includes(u.role)) return u.role;
  return u.approver ? 'director' : 'employee';
}

/** The role of the user named in X-Studio-User, or null when none is chosen or known. */
function roleOf(by) {
  return roleOfUser(userOf(by));
}

/** Manager or director: what older text calls an approver. */
function isApprover(by) {
  const role = roleOf(by);
  return role === 'manager' || role === 'director';
}

const isDirector = (by) => roleOf(by) === 'director';

export const hashPin = (pin) => crypto.createHash('sha256').update(`studio-pin:${String(pin)}`).digest('hex');

/**
 * The manager's or director's PIN, when one is set: a stop-gap on a shared Mac until
 * hosting brings sign-in. Checked on every action reserved for their role.
 */
function pinOk(ctx) {
  const user = userOf(ctx.by);
  if (!user?.pinHash) return true;
  const given = String(ctx.req.headers['x-studio-pin'] || '').trim();
  return Boolean(given) && hashPin(given) === user.pinHash;
}

/** Throws unless the request is from a manager or the director who has given their PIN (when one is set). */
function requireManager(ctx, what = 'do this') {
  if (!ctx.by) throw new HttpError(401, `Choose a user in Settings to ${what}`);
  if (!isApprover(ctx.by)) throw new HttpError(403, `Only a manager or the director can ${what}`);
  if (!pinOk(ctx)) throw new HttpError(403, `Your PIN is required to ${what}`, { pin: true });
}

/** Throws unless the request is from the director who has given their PIN (when one is set). */
/** Collections only the director creates or changes (set up in the Builder; docs/BUILDER.md). Deletes are director-only for every collection. */
const DIRECTOR_WRITES = ['accounts', 'solutions'];

function requireDirector(ctx, what = 'do this') {
  if (!ctx.by) throw new HttpError(401, `Choose a user in Settings to ${what}`);
  if (!isDirector(ctx.by)) throw new HttpError(403, `Only the director can ${what}`);
  if (!pinOk(ctx)) throw new HttpError(403, `Your PIN is required to ${what}`, { pin: true });
}

// ------------------------------------------------------------ review routing

// The defaults when settings.reviewRouting is absent (ROLES.md section 2).
export const DEFAULT_REVIEW_ROUTING = {
  directorTypes: ['youtube-long', 'episode', 'announcement'],
  directorPillars: ['offer', 'founder'],
  directorOnWarnings: false,
};

const TYPE_WHY = {
  'youtube-long': 'Long YouTube videos go to the director',
  episode: 'Episodes go to the director',
  announcement: 'Announcements go to the director',
};

const strings = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : null);

/** settings.reviewRouting with the defaults filled in. */
export function reviewRouting(settings) {
  const r = settings?.reviewRouting || {};
  return {
    directorTypes: strings(r.directorTypes) ?? [...DEFAULT_REVIEW_ROUTING.directorTypes],
    directorPillars: strings(r.directorPillars) ?? [...DEFAULT_REVIEW_ROUTING.directorPillars],
    directorOnWarnings: typeof r.directorOnWarnings === 'boolean' ? r.directorOnWarnings : DEFAULT_REVIEW_ROUTING.directorOnWarnings,
  };
}

/** Throws 400 unless `r` is a well-formed reviewRouting; returns it normalised. */
function validRouting(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new HttpError(400, 'reviewRouting must be an object');
  for (const k of ['directorTypes', 'directorPillars']) {
    if (r[k] !== undefined && !Array.isArray(r[k])) throw new HttpError(400, `reviewRouting.${k} must be a list`);
  }
  if (r.directorOnWarnings !== undefined && typeof r.directorOnWarnings !== 'boolean') throw new HttpError(400, 'reviewRouting.directorOnWarnings must be true or false');
  return reviewRouting({ reviewRouting: r });
}

/** Whether a piece must reach the director, and why in a plain sentence. */
export function needsDirector(piece, settings) {
  const r = reviewRouting(settings);
  if (piece?.type && r.directorTypes.includes(piece.type)) {
    return { needsDirector: true, why: TYPE_WHY[piece.type] || `Pieces of the type ${piece.type} go to the director` };
  }
  if (piece?.pillar && r.directorPillars.includes(piece.pillar)) {
    return { needsDirector: true, why: `Pieces on the ${piece.pillar} pillar go to the director` };
  }
  if (r.directorOnWarnings && (piece?.check?.violations || []).some((v) => v.severity === 'warn')) {
    return { needsDirector: true, why: 'Pieces with a checker warning go to the director' };
  }
  return { needsDirector: false, why: null };
}

// Statuses that mean "waiting for review" (Today, the queue).
export const AWAITING_REVIEW = ['in-review', 'director-review'];

/** Appends one entry to piece.reviewTrail (in place) and returns the piece. */
function addTrail(piece, by, action, note) {
  const entry = { at: new Date().toISOString(), by: by || null, role: roleOf(by), action };
  if (note) entry.note = note;
  piece.reviewTrail = [...(Array.isArray(piece.reviewTrail) ? piece.reviewTrail : []), entry];
  return piece;
}

/** When the piece entered its current review state: its last trail entry, else its last save. */
const reviewSince = (p) => String((p.reviewTrail || []).at(-1)?.at || p.updatedAt || '');

/** Whether `by` wrote the piece or last submitted it. */
function isMine(p, by) {
  if (!by) return false;
  const who = String(by).toLowerCase();
  if (String(p.by || '').toLowerCase() === who) return true;
  const sub = (p.reviewTrail || []).filter((e) => e.action === 'submitted').at(-1);
  return String(sub?.by || '').toLowerCase() === who;
}

/** The three review buckets, oldest first, each piece carrying needsDirector and needsDirectorWhy. */
function reviewQueue(by) {
  const settings = settingsDoc();
  const decorate = (p) => { const n = needsDirector(p, settings); return { ...p, needsDirector: n.needsDirector, needsDirectorWhy: n.why }; };
  const pick = (fn) => store.list('pieces', fn).sort((a, b) => reviewSince(a).localeCompare(reviewSince(b))).map(decorate);
  return {
    manager: pick((p) => p.status === 'in-review'),
    director: pick((p) => p.status === 'director-review'),
    mine: pick((p) => ['in-review', 'director-review', 'changes-requested'].includes(p.status) && isMine(p, by)),
  };
}

/** The settings document as a client may see it: no PIN hashes; a role and the derived approver per user; the link token for the director only. */
function publicSettings(doc, by) {
  if (!doc) return doc;
  const users = (doc.users || []).map(({ pinHash, approver, ...u }) => {
    const role = roleOfUser({ ...u, approver });
    return { ...u, role, approver: role !== 'employee', pinSet: Boolean(pinHash) };
  });
  const out = { ...doc, users, reviewRouting: reviewRouting(doc) };
  if (!isDirector(by)) delete out.linkToken;
  return out;
}

// Collections whose PUT and PATCH refuse a stale copy (updatedAt older than the stored one).
const GUARDED = ['pieces', 'events', 'campaigns', 'videos', 'settings', 'rules'];

function assertFresh(prev, body, collection) {
  if (!prev || !GUARDED.includes(collection)) return;
  if (body.force === true) return;
  const sent = body.updatedAt;
  if (sent && prev.updatedAt && String(sent) !== String(prev.updatedAt)) {
    const who = prev.by && prev.by !== body.by ? prev.by : (prev.lastBy || 'someone else');
    throw new HttpError(409, `This was changed by ${prev.lastBy || who} at ${prev.updatedAt} since you opened it. Reload to see the latest, or save anyway to overwrite.`, { conflict: true, by: prev.lastBy || who, at: prev.updatedAt });
  }
}

function stripForSnapshot(piece) {
  const { check, measure, ...rest } = piece;
  return rest;
}

function textChanged(a, b) {
  if (!a) return true;
  return PIECE_TEXT_FIELDS.some((f) => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null));
}

async function makeVersion(piece, by, changeNote) {
  const n = store.list('versions', (v) => v.pieceId === piece.id).length + 1;
  const version = {
    id: store.nextId('vr'),
    pieceId: piece.id,
    n,
    snapshot: stripForSnapshot(piece),
    by: by || null,
    at: new Date().toISOString(),
    changeNote: changeNote || null,
  };
  await store.put('versions', version);
  return version;
}

/** Run the deterministic checker when the content module has provided it. */
async function runChecker(piece, modules) {
  const rules = modules?.rules;
  if (rules && typeof rules.check === 'function') {
    const result = await rules.check(piece, rulesDoc(), store.list('accounts'));
    return { at: new Date().toISOString(), ...result };
  }
  return null;
}

// --------------------------------------------------------- the month card

/** The director's five-minute summary for the month of `today`, from slots, pieces and the log. */
function monthSummary(today, settings, by) {
  // The month shown is today's, unless it has no allotted slot (before the first posting
  // week, or after the last generated month): then the next month that has one.
  const monthRange = (ym) => { const next = addDays(`${ym}-28`, 7).slice(0, 7); return { from: `${ym}-01`, to: addDays(`${next}-01`, -1), next }; };
  let ym = today.slice(0, 7);
  let { from: monthStart, to: monthEnd, next } = monthRange(ym);
  for (let i = 0; i < 4; i += 1) {
    const any = store.list('slots', (s) => s.date >= monthStart && s.date <= monthEnd && !['derived', 'dark', 'optional'].includes(s.state)).length;
    if (any) break;
    const n = monthRange(next);
    if (!store.list('slots', (s) => s.date >= n.from && s.date <= n.to).length) break;
    ym = next; monthStart = n.from; monthEnd = n.to; next = n.next;
  }
  const weekStart = addDays(today, -6);
  const pieces = new Map(store.list('pieces').map((p) => [p.id, p]));
  const slots = store.list('slots', (s) => s.date >= monthStart && s.date <= monthEnd && !['derived', 'dark'].includes(s.state));
  const counts = { allotted: 0, filled: 0, approved: 0, posted: 0, open: 0, optional: 0 };
  for (const s of slots) {
    if (s.state === 'optional' && !s.pieceId) { counts.optional += 1; continue; }
    if (s.state === 'greeting-only' && !s.pieceId) continue;
    counts.allotted += 1;
    const p = s.pieceId ? pieces.get(s.pieceId) : null;
    if (!s.pieceId && !s.csv) { counts.open += 1; continue; }
    counts.filled += 1;
    if (p && ['approved', 'scheduled', 'posted', 'measured'].includes(p.status)) counts.approved += 1;
    if (p && ['posted', 'measured'].includes(p.status)) counts.posted += 1;
  }
  const postedPieces = store.list('pieces', (p) => ['posted', 'measured'].includes(p.status) && String(p.measure?.postedAt || p.updatedAt).slice(0, 7) === ym);
  const log = store.list('log');
  const monthLog = log.filter((e) => String(e.at).slice(0, 7) === ym);
  // AI calls over the last thirty days, not the shown month: the month may lie ahead of today.
  const thirtyAgo = addDays(today, -30);
  const aiCalls = log.filter((e) => String(e.what).startsWith('ai:') && String(e.at).slice(0, 10) >= thirtyAgo && String(e.at).slice(0, 10) <= today);
  const byHand = aiCalls.filter((e) => e.ref?.byHand).length;
  const failed = aiCalls.filter((e) => e.ref?.failed).length;
  let cost = 0; let costKnown = 0;
  for (const e of aiCalls) { const c = Number(e.ref?.usage?.total_cost_usd); if (Number.isFinite(c)) { cost += c; costKnown += 1; } }
  const weekLog = log.filter((e) => String(e.at).slice(0, 10) >= weekStart && String(e.at).slice(0, 10) <= today && e.by && !String(e.what).startsWith('ai:'));
  const byPerson = {};
  for (const e of weekLog) byPerson[e.by] = (byPerson[e.by] || 0) + 1;
  const last = log.length ? log[log.length - 1] : null;
  const me = userOf(by);
  const role = roleOfUser(me);
  return {
    month: ym, from: monthStart, to: monthEnd,
    slots: counts,
    posted: postedPieces.map((p) => ({ id: p.id, hook: p.hook, postedAt: p.measure?.postedAt || null, link: p.measure?.postedLink || null })),
    ai: { calls: aiCalls.length, byHand, failed, costUsd: costKnown ? Math.round(cost * 100) / 100 : null, costKnownFor: costKnown, mode: ai.aiModeOf(settings), last: ai.lastCall || null },
    actionsThisWeek: Object.entries(byPerson).map(([who, n]) => ({ by: who, actions: n })).sort((a, b) => b.actions - a.actions),
    lastChange: last ? { at: last.at, by: last.by, what: last.what } : null,
    approver: role === 'manager' || role === 'director',
    role,
    pinSet: Boolean(me?.pinHash),
    approversWithoutPin: (settings.users || []).filter((u) => roleOfUser(u) !== 'employee' && !u.pinHash).map((u) => u.name || u.email),
  };
}

// ------------------------------------------------------- the review record

// Fields only the review routes write; a client copy never overrides them.
const REVIEW_OWNED = ['reviewTrail', 'escalation'];

/**
 * Applies the review rules to a piece about to be saved through POST, PUT or PATCH:
 * keeps the server-owned review fields, refuses a status the review routes alone may set,
 * and writes `submitted` to the trail when the piece moves into in-review.
 */
function reviewOnSave(prev, next, by, note) {
  for (const k of REVIEW_OWNED) { if (prev?.[k] === undefined) delete next[k]; else next[k] = prev[k]; }
  const from = prev?.status;
  if (next.status !== from) {
    if (next.status === 'approved') throw new HttpError(403, 'A piece is approved only through Approve in Review');
    if (next.status === 'director-review') throw new HttpError(403, 'A piece reaches the director only through Send to director in Review');
    if (next.status === 'in-review') addTrail(next, by, 'submitted', note);
  }
  return next;
}

// ------------------------------------------------------------- core routes

/**
 * Registers every core route. `modules` is { rules, slots, video, recurring,
 * images, link } as loaded by index.mjs (each may be null).
 */
export function registerCoreRoutes(router, modules = {}) {
  // ---- workspaces: one company each (workspaces.mjs), before the generic collection routes
  router.mount(workspaces.routes, 'workspaces');

  // ---- health
  router.add('GET', '/api/health', () => ({
    ok: true, at: new Date().toISOString(), collections: COLLECTIONS, routes: router.list().length,
    // The hosted tool keeps its data in a copy that lasts only as long as the server
    // instance, until the Google Sheets store lands; the app shows a banner while so.
    hosting: {
      host: process.env.VERCEL ? 'vercel' : 'local',
      store: store.backend,
      persistent: !process.env.STUDIO_EPHEMERAL,
      aiMode: ai.aiModeOf(settingsDoc()),
    },
  }));

  // ---- today (section 5): the one call the Today view makes
  router.add('GET', '/api/today', async (ctx) => {
    const settings = settingsDoc();
    const today = ctx.query.date || isoDate(new Date(), settings.timezone);
    const in7 = addDays(today, 7);
    const in14 = addDays(today, 14);
    const payload = {
      date: today,
      goDark: settings.goDark || { on: false },
      month: monthSummary(today, settings, ctx.by),
      mine: ctx.by ? store.list('pieces', (p) => p.status !== 'retired' && (p.by === ctx.by || p.lastBy === ctx.by))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10)
        .map((p) => ({ id: p.id, hook: p.hook, type: p.type, status: p.status, plannedDate: p.plannedDate || null, updatedAt: p.updatedAt })) : [],
      review: store.list('pieces', (p) => AWAITING_REVIEW.includes(p.status) || p.status === 'changes-requested')
        .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))),
      openSlots: store.list('slots', (s) => s.state === 'open' && s.date >= today && s.date <= in7)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
      events: store.list('events', (e) => e.date >= today && e.date <= in14)
        .sort((a, b) => a.date.localeCompare(b.date)),
      videos: store.list('videos', (v) => v.status !== 'done'),
    };
    const queue = reviewQueue(ctx.by);
    payload.reviewCounts = {
      manager: queue.manager.length,
      director: queue.director.length,
      mine: queue.mine.length,
      changesRequested: store.list('pieces', (p) => p.status === 'changes-requested').length,
    };
    // Extension point: each module may add or reshape its section.
    for (const [name, mod] of Object.entries(modules)) {
      if (mod && typeof mod.enrichToday === 'function') {
        try { await mod.enrichToday(payload, ctx); }
        catch (err) { payload[`${name}Error`] = err.message; }
      }
    }
    return payload;
  });

  // ---- who is asking, and what their role allows (ROLES.md section 3)
  router.add('GET', '/api/me', (ctx) => {
    const user = userOf(ctx.by);
    const role = roleOfUser(user);
    const approver = role === 'manager' || role === 'director';
    const director = role === 'director';
    return {
      email: user?.email || ctx.by || null,
      name: user?.name || null,
      role,
      owner: workspaces.isOwner(ctx.by),
      workspace: ctx.workspace ? { id: ctx.workspace.id, name: ctx.workspace.name } : null,
      pinSet: Boolean(user?.pinHash),
      can: { approve: approver, escalate: approver, approveForDirector: director, settings: director, delete: director, recordPosted: approver },
    };
  });

  // ---- the review queue: with the manager, with the director, and the caller's own
  router.add('GET', '/api/review/queue', (ctx) => reviewQueue(ctx.by));

  // ---- pieces: the review path and versions (core); check/place/unplace are module routes
  const pieceOr404 = (id) => {
    const piece = store.get('pieces', id);
    if (!piece) throw new HttpError(404, 'Piece not found');
    return piece;
  };
  const noteOf = (ctx) => {
    const note = String(ctx.body?.note || '').trim();
    if (!note) throw new HttpError(400, 'A note is required');
    return note;
  };

  router.add('POST', '/api/pieces/:id/approve', async (ctx) => {
    requireManager(ctx, 'approve a piece');
    const piece = pieceOr404(ctx.params.id);
    const role = roleOf(ctx.by);
    if (piece.status === 'director-review' && role !== 'director') throw new HttpError(403, 'Only the director can approve a piece that is with the director');
    if (!AWAITING_REVIEW.includes(piece.status)) throw new HttpError(409, `This piece is ${piece.status}; only a piece in review can be approved`);
    const check = await runChecker(piece, modules);
    if (check) piece.check = check;
    const blocks = (piece.check?.violations || []).filter((v) => v.severity === 'block');
    if (blocks.length) {
      throw new HttpError(409, `The checker blocks approval (${blocks.length} ${blocks.length === 1 ? 'item' : 'items'})`, blocks);
    }
    if (role !== 'director') {
      const route = needsDirector(piece, settingsDoc());
      if (route.needsDirector) throw new HttpError(409, `${route.why}; send it to the director instead`, { needsDirector: true, why: route.why });
    }
    piece.status = 'approved';
    piece.approvedBy = ctx.by;
    piece.approvedAt = new Date().toISOString();
    piece.approvedRole = role;
    piece.lastBy = ctx.by;
    addTrail(piece, ctx.by, 'approved', String(ctx.body?.note || '').trim() || undefined);
    const stored = await store.put('pieces', piece);
    const version = await makeVersion(stored, ctx.by, ctx.body?.changeNote || 'Approved');
    await store.log(ctx.by, 'piece.approve', { pieceId: piece.id, versionId: version.id, role });
    return { piece: stored, version };
  });

  router.add('POST', '/api/pieces/:id/escalate', async (ctx) => {
    requireManager(ctx, 'send a piece to the director');
    const piece = pieceOr404(ctx.params.id);
    if (piece.status !== 'in-review') throw new HttpError(409, `This piece is ${piece.status}; only a piece with the manager can be sent to the director`);
    const note = noteOf(ctx);
    const at = new Date().toISOString();
    piece.status = 'director-review';
    piece.escalation = { note, by: ctx.by, at };
    piece.lastBy = ctx.by;
    addTrail(piece, ctx.by, 'escalated', note);
    const stored = await store.put('pieces', piece);
    await store.log(ctx.by, 'piece.escalate', { pieceId: piece.id, note });
    return stored;
  });

  router.add('POST', '/api/pieces/:id/request-changes', async (ctx) => {
    requireManager(ctx, 'request changes');
    const piece = pieceOr404(ctx.params.id);
    if (piece.status === 'director-review' && roleOf(ctx.by) !== 'director') throw new HttpError(403, 'Only the director can request changes on a piece that is with the director');
    if (!AWAITING_REVIEW.includes(piece.status)) throw new HttpError(409, `This piece is ${piece.status}; changes can be requested only on a piece in review`);
    const note = noteOf(ctx);
    piece.status = 'changes-requested';
    piece.review = { note, by: ctx.by || null, at: new Date().toISOString() };
    piece.lastBy = ctx.by;
    addTrail(piece, ctx.by, 'changes-requested', note);
    const stored = await store.put('pieces', piece);
    await store.log(ctx.by, 'piece.request-changes', { pieceId: piece.id, note });
    return stored;
  });

  router.add('POST', '/api/pieces/:id/return', async (ctx) => {
    requireDirector(ctx, 'return a piece to the manager');
    const piece = pieceOr404(ctx.params.id);
    if (piece.status !== 'director-review') throw new HttpError(409, `This piece is ${piece.status}; only a piece with the director can be returned to the manager`);
    const note = noteOf(ctx);
    piece.status = 'in-review';
    piece.lastBy = ctx.by;
    addTrail(piece, ctx.by, 'returned', note);
    const stored = await store.put('pieces', piece);
    await store.log(ctx.by, 'piece.return', { pieceId: piece.id, note });
    return stored;
  });

  router.add('GET', '/api/pieces/:id/versions', (ctx) => {
    if (!store.get('pieces', ctx.params.id)) throw new HttpError(404, 'Piece not found');
    return store.list('versions', (v) => v.pieceId === ctx.params.id).sort((a, b) => a.n - b.n);
  });

  router.add('POST', '/api/pieces/:id/revert', async (ctx) => {
    const piece = store.get('pieces', ctx.params.id);
    if (!piece) throw new HttpError(404, 'Piece not found');
    const version = store.get('versions', String(ctx.body?.versionId || ''));
    if (!version || version.pieceId !== piece.id) throw new HttpError(404, 'Version not found for this piece');
    const restored = { ...version.snapshot, id: piece.id, check: piece.check, measure: piece.measure, createdAt: piece.createdAt };
    // The review record is the piece's own history, not part of a version.
    for (const k of ['reviewTrail', 'review', 'escalation']) { if (piece[k] === undefined) delete restored[k]; else restored[k] = piece[k]; }
    // A revert is an edit: an approved piece, or one with the director, goes back to review.
    if (['approved', 'director-review'].includes(restored.status)) restored.status = 'in-review';
    delete restored.approvedBy; delete restored.approvedAt; delete restored.approvedRole;
    if (restored.status === 'in-review' && piece.status !== 'in-review') addTrail(restored, ctx.by, 'submitted', `Reverted to version ${version.n}`);
    const stored = await store.put('pieces', restored);
    const newVersion = await makeVersion(stored, ctx.by, `Reverted to version ${version.n}`);
    await store.log(ctx.by, 'piece.revert', { pieceId: piece.id, from: version.id, to: newVersion.id });
    return { piece: stored, version: newVersion };
  });

  // ---- the PIN of a manager or the director: set or clear it for the current user
  router.add('POST', '/api/settings/pin', async (ctx) => {
    const user = userOf(ctx.by);
    if (!user) throw new HttpError(401, 'Choose a user first');
    if (roleOfUser(user) === 'employee') throw new HttpError(403, 'Only a manager or the director has a PIN');
    if (user.pinHash && !pinOk(ctx)) throw new HttpError(403, 'Your current PIN is required to change it', { pin: true });
    const pin = String(ctx.body?.pin || '').trim();
    const doc = settingsDoc();
    const users = (doc.users || []).map((u) => {
      if (String(u.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) return u;
      const { pinHash, ...rest } = u;
      if (!pin) return rest;
      return { ...rest, pinHash: hashPin(pin) };
    });
    if (pin && !/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'A PIN is 4 to 8 digits');
    await store.put('settings', { ...doc, users });
    await store.log(ctx.by, pin ? 'settings.pin.set' : 'settings.pin.cleared', user.email);
    return { ok: true, pinSet: Boolean(pin) };
  });

  // ---- the runner queue: requests waiting for a person or a process to answer in Claude's place
  router.add('GET', '/api/ai/pending', (ctx) => {
    const full = ctx.query.full === '1';
    return ai.listPending().map((p) => (full ? p : { id: p.id, op: p.op, at: p.at, by: p.by, input: p.input }));
  });
  router.add('POST', '/api/ai/pending/:id/answer', async (ctx) => {
    requireDirector(ctx, 'answer an AI request');
    const output = ctx.body?.output;
    if (!output || typeof output !== 'object') throw new HttpError(400, 'Send { output } in the shape the operation\'s schema asks for');
    const r = ai.answerPending(ctx.params.id, output, ctx.by);
    if (!r) throw new HttpError(404, 'No pending request with that id (it may have timed out)');
    await store.log(ctx.by, 'ai.runner.answer', r);
    return r;
  });

  // ---- record as posted, by hand, until posting is connected (phase 2)
  router.add('POST', '/api/pieces/:id/record-posted', async (ctx) => {
    requireManager(ctx, 'record a piece as posted');
    const piece = store.get('pieces', ctx.params.id);
    if (!piece) throw new HttpError(404, 'Piece not found');
    if (!['approved', 'scheduled', 'posted', 'measured'].includes(piece.status)) throw new HttpError(409, 'Only an approved piece can be recorded as posted');
    const b = ctx.body || {};
    const postedAt = String(b.postedAt || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(postedAt)) throw new HttpError(400, 'postedAt must be a date (YYYY-MM-DD) or a date and time');
    // A posting is recorded after it happened: the time is read in the studio timezone and may not be ahead of now.
    const nowIst = new Date().toLocaleString('sv-SE', { timeZone: settingsDoc().timezone || 'Asia/Kolkata' }).replace(' ', 'T').slice(0, 16);
    const given = postedAt.length === 10 ? `${postedAt}T00:00` : postedAt.slice(0, 16);
    if (given > nowIst) throw new HttpError(400, `That time has not arrived yet (${given.replace('T', ' ')}). Record a posting after it has happened.`);
    const accountId = String(b.accountId || piece.targets?.[0] || '').trim();
    if (!accountId || !store.get('accounts', accountId)) throw new HttpError(400, 'accountId must name an account');
    const url = String(b.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'The link must start with http:// or https://');
    const measure = { ...(piece.measure || {}), postedAt, postedLink: url || piece.measure?.postedLink || '', postedAccount: accountId, postedBy: ctx.by, recordedByHand: true, note: String(b.note || piece.measure?.note || '').trim() };
    const stored = await store.patch('pieces', piece.id, { status: piece.status === 'measured' ? 'measured' : 'posted', measure, lastBy: ctx.by });
    await store.log(ctx.by, 'piece.record-posted', { pieceId: piece.id, accountId, postedAt, url: url || null });
    return stored;
  });

  // ---- AI (section 6)
  router.add('GET', '/api/ai/ops', () => ai.listOps());

  router.add('POST', '/api/ai/batch', (ctx) => {
    const { op, inputs } = ctx.body || {};
    if (!op) throw new HttpError(400, 'op is required');
    const job = ai.createJob(String(op), inputs, ctx.by);
    return { jobId: job.id, status: job.status, total: job.total };
  });

  router.add('GET', '/api/ai/jobs/:id', (ctx) => {
    const job = ai.getJob(ctx.params.id);
    if (!job) throw new HttpError(404, 'Job not found');
    return job;
  });

  router.add('POST', '/api/ai/:op', async (ctx) => {
    const result = await ai.run(ctx.params.op, ctx.body || {}, ai.buildCtx({ by: ctx.by }));
    return result;
  });

  // ---- media upload: multipart -> media/<file>
  router.add('POST', '/api/media', async (ctx) => {
    const type = ctx.req.headers['content-type'] || '';
    if (!/multipart\/form-data/i.test(type)) throw new HttpError(400, 'Send multipart/form-data');
    const parts = parseMultipart(ctx.rawBody, type).filter((p) => p.filename);
    if (!parts.length) throw new HttpError(400, 'No file in the upload');
    const mediaDir = path.join(store.root, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    const saved = [];
    for (const part of parts) {
      const safeBase = path.basename(part.filename).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
      const ext = path.extname(safeBase);
      const stem = safeBase.slice(0, safeBase.length - ext.length).slice(0, 60);
      let name = `${stem}${ext}`;
      let n = 1;
      while (fs.existsSync(path.join(mediaDir, name))) name = `${stem}-${++n}${ext}`;
      fs.writeFileSync(path.join(mediaDir, name), part.data);
      const size = imageSize(part.data);
      saved.push({
        path: `/media/${name}`, name, bytes: part.data.length, contentType: part.contentType,
        w: size?.w ?? null, h: size?.h ?? null, seconds: null, field: part.name,
      });
    }
    await store.log(ctx.by, 'media.upload', saved.map((s) => s.path));
    return saved.length === 1 ? saved[0] : saved;
  });

  // ---- generic collection routes (section 5)
  const assertCollection = (c) => {
    if (!COLLECTIONS.includes(c)) throw new HttpError(404, `Unknown collection: ${c}`);
  };

  router.add('GET', '/api/:collection', (ctx) => {
    assertCollection(ctx.params.collection);
    if (ctx.params.collection === 'settings') return store.list('settings').map((d) => publicSettings(d, ctx.by));
    const filters = Object.entries(ctx.query).filter(([k]) => !['_limit', '_offset', '_sort'].includes(k));
    let rows = store.list(ctx.params.collection, (r) => filters.every(([k, v]) => String(r[k] ?? '') === v));
    if (ctx.query._sort) {
      const desc = ctx.query._sort.startsWith('-');
      const key = desc ? ctx.query._sort.slice(1) : ctx.query._sort;
      rows.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
    }
    const offset = parseInt(ctx.query._offset || '0', 10) || 0;
    const limit = parseInt(ctx.query._limit || '0', 10) || 0;
    if (offset || limit) rows = rows.slice(offset, limit ? offset + limit : undefined);
    return rows;
  });

  router.add('GET', '/api/:collection/:id', (ctx) => {
    assertCollection(ctx.params.collection);
    const row = store.get(ctx.params.collection, ctx.params.id);
    if (!row) throw new HttpError(404, 'Not found');
    return ctx.params.collection === 'settings' ? publicSettings(row, ctx.by) : row;
  });

  router.add('POST', '/api/:collection', async (ctx) => {
    const c = ctx.params.collection;
    assertCollection(c);
    if (SINGLETONS[c]) throw new HttpError(405, `${c} is a single document; use PUT /api/${c}/${SINGLETONS[c]}`);
    if (DIRECTOR_WRITES.includes(c)) requireDirector(ctx, `change the ${c}`);
    const body = ctx.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object');
    const { changeNote, ...obj } = body;
    if (!obj.id) obj.id = store.nextId(ID_PREFIX[c] || c);
    else if (store.get(c, obj.id)) throw new HttpError(409, `${obj.id} already exists`);
    if (ctx.by && !obj.by) obj.by = ctx.by;
    if (c === 'pieces') reviewOnSave(null, obj, ctx.by);
    const stored = await store.put(c, obj);
    let version = null;
    if (c === 'pieces') version = await makeVersion(stored, ctx.by, changeNote || 'Created');
    await store.log(ctx.by, `${c}.create`, stored.id);
    ctx.res.statusCode = 201;
    return version ? { ...stored, _version: version.id } : stored;
  });

  router.add('PUT', '/api/:collection/:id', async (ctx) => {
    const c = ctx.params.collection;
    assertCollection(c);
    const body = ctx.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object');
    const { changeNote, force, ...obj } = body;
    obj.id = ctx.params.id;
    if (SINGLETONS[c] && obj.id !== SINGLETONS[c]) throw new HttpError(400, `${c} has the single id ${SINGLETONS[c]}`);
    if (SINGLETONS[c] || DIRECTOR_WRITES.includes(c)) requireDirector(ctx, `change the ${c}`);
    const prev = store.get(c, obj.id);
    assertFresh(prev, body, c);
    if (prev) obj.createdAt = prev.createdAt;
    if (ctx.by && !obj.by && !prev?.by) obj.by = ctx.by;
    if (ctx.by) obj.lastBy = ctx.by;
    if (c === 'settings') {
      // PIN hashes never travel to the client, so a saved copy keeps the stored ones; the link token likewise.
      const stored = new Map((prev?.users || []).map((u) => [String(u.email || '').toLowerCase(), u]));
      // Each user carries a role; `approver` is derived for older views and dropped here (ROLES.md section 1).
      if (!Array.isArray(obj.users)) obj.users = [];
      obj.users = obj.users.map(({ pinSet, pinHash: _p, approver, ...u }) => {
        if (u.role !== undefined && !ROLES.includes(u.role)) throw new HttpError(400, `A role is one of ${ROLES.join(', ')}`);
        const s = stored.get(String(u.email || '').toLowerCase());
        const row = { ...u, role: roleOfUser({ ...u, approver }) };
        return s?.pinHash && row.role !== 'employee' ? { ...row, pinHash: s.pinHash } : row;
      });
      if (obj.linkToken === undefined && prev?.linkToken) obj.linkToken = prev.linkToken;
      if (!obj.users.some((u) => u.role === 'director')) throw new HttpError(400, 'At least one director is required');
      if (obj.reviewRouting !== undefined) obj.reviewRouting = validRouting(obj.reviewRouting);
    }
    if (c === 'pieces') {
      // Any text change to an approved piece sends it back to review.
      let note;
      if (prev?.status === 'approved' && textChanged(prev, obj) && (obj.status === 'approved' || !obj.status)) {
        obj.status = 'in-review';
        delete obj.approvedBy; delete obj.approvedAt; delete obj.approvedRole;
        note = 'Edited after approval';
      }
      reviewOnSave(prev, obj, ctx.by, note);
      obj.check = obj.check ?? prev?.check;
    }
    const stored = await store.put(c, obj);
    let version = null;
    if (c === 'pieces' && textChanged(prev, stored)) version = await makeVersion(stored, ctx.by, changeNote || (prev ? 'Edited' : 'Created'));
    await store.log(ctx.by, `${c}.${prev ? 'replace' : 'create'}`, stored.id);
    const out = c === 'settings' ? publicSettings(stored, ctx.by) : stored;
    return version ? { ...out, _version: version.id } : out;
  });

  router.add('PATCH', '/api/:collection/:id', async (ctx) => {
    const c = ctx.params.collection;
    assertCollection(c);
    const body = ctx.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object');
    const { changeNote, id: _ignored, createdAt: _c, force, ...partial } = body;
    if (SINGLETONS[c] || DIRECTOR_WRITES.includes(c)) requireDirector(ctx, `change the ${c}`);
    const prev = store.get(c, ctx.params.id);
    if (!prev) throw new HttpError(404, 'Not found');
    assertFresh(prev, body, c);
    delete partial.updatedAt;
    if (ctx.by) partial.lastBy = ctx.by;
    if (c === 'settings') {
      delete partial.users; delete partial.linkToken;
      if (partial.reviewRouting !== undefined) partial.reviewRouting = validRouting(partial.reviewRouting);
    }
    if (c === 'pieces') {
      const merged = { ...prev, ...partial };
      let note;
      if (prev.status === 'approved' && textChanged(prev, merged) && (partial.status === undefined || partial.status === 'approved')) {
        partial.status = 'in-review';
        partial.approvedBy = null; partial.approvedAt = null; partial.approvedRole = null;
        note = 'Edited after approval';
      }
      const next = reviewOnSave(prev, { status: prev.status, ...partial }, ctx.by, note);
      for (const k of REVIEW_OWNED) { if (next[k] === undefined) delete partial[k]; else partial[k] = next[k]; }
    }
    const stored = await store.patch(c, ctx.params.id, partial);
    let version = null;
    if (c === 'pieces' && textChanged(prev, stored)) version = await makeVersion(stored, ctx.by, changeNote || 'Edited');
    await store.log(ctx.by, `${c}.patch`, stored.id);
    const out = c === 'settings' ? publicSettings(stored, ctx.by) : stored;
    return version ? { ...out, _version: version.id } : out;
  });

  router.add('DELETE', '/api/:collection/:id', async (ctx) => {
    const c = ctx.params.collection;
    assertCollection(c);
    if (SINGLETONS[c]) throw new HttpError(405, `${c} cannot be deleted`);
    if (c !== 'images') requireDirector(ctx, `delete from ${c}`);
    const ok = await store.remove(c, ctx.params.id);
    if (!ok) throw new HttpError(404, 'Not found');
    if (c === 'pieces') {
      for (const v of store.list('versions', (v) => v.pieceId === ctx.params.id)) await store.remove('versions', v.id);
    }
    await store.log(ctx.by, `${c}.delete`, ctx.params.id);
    return { ok: true, id: ctx.params.id };
  });
}

// --------------------------------------------------------------- dispatch

/** Handles one /api request. Returns true when handled. */
export async function handleApi(router, req, res, url) {
  const found = router.match(req.method, url.pathname);
  if (!found) {
    sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    return true;
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const by = (req.headers['x-studio-user'] || '').toString().trim() || null;
  const asked = (req.headers['x-studio-workspace'] || '').toString().trim() || null;
  // The health check and the workspace routes answer even when the chosen workspace
  // is refused, so the app can always list the workspaces and switch.
  const open = /^\/api\/(health|workspaces)(\/|$)/.test(url.pathname);
  let workspace;
  try {
    workspace = workspaces.resolveWorkspace(asked, by);
    if (!by && workspace.status !== 'active' && !open) throw new workspaces.WorkspaceError(403, `The workspace ${workspace.name} is ${workspace.status}`);
  } catch (err) {
    if (!open) { sendJson(res, err.status || 500, { error: err.message, detail: err.detail ?? undefined }); return true; }
    workspace = null;
  }
  const ctx = {
    req, res, params: found.params, query, body: null, rawBody: null, by, workspace,
    store, ai, settings: settingsDoc, rules: rulesDoc, HttpError,
    // For modules: "approver" means manager or director (ROLES.md section 1).
    role: () => roleOf(by),
    isApprover: () => isApprover(by),
    isDirector: () => isDirector(by),
    requireApprover: (what) => requireManager(ctx, what),
    requireManager: (what) => requireManager(ctx, what),
    requireDirector: (what) => requireDirector(ctx, what),
  };
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      ctx.rawBody = await readBody(req);
      const type = (req.headers['content-type'] || '').toLowerCase();
      if (ctx.rawBody.length && type.includes('application/json')) {
        try { ctx.body = JSON.parse(ctx.rawBody.toString('utf8')); }
        catch { throw new HttpError(400, 'Body is not valid JSON'); }
      } else if (ctx.rawBody.length && !type.includes('multipart/')) {
        try { ctx.body = JSON.parse(ctx.rawBody.toString('utf8')); } catch { ctx.body = null; }
      }
    }
    const run = () => found.route.handler(ctx);
    const result = workspace ? await withWorkspace(workspaces.storeFor(workspace), run, workspace) : await run();
    if (res.writableEnded) return true;
    sendJson(res, res.statusCode === 201 ? 201 : 200, result === undefined ? { ok: true } : result);
  } catch (err) {
    const status = err instanceof HttpError || err instanceof AiError || err instanceof workspaces.WorkspaceError ? err.status : 500;
    if (status >= 500) console.error('[api]', req.method, url.pathname, err);
    sendJson(res, status, { error: err.message, detail: err.detail ?? undefined });
  }
  return true;
}
