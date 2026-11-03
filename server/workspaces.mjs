// Workspaces: one company each (docs/WORKSPACES.md). [core]
//
// A small master registry lists every workspace (id, name, Sheet id, Drive
// folder id, status, created date) and the owners: the people at the agency
// who create workspaces and may enter any of them. Each workspace has its own
// store, chosen by the STUDIO_STORE environment variable:
//
//   STUDIO_STORE=json     (default) data/ for the default workspace, data/workspaces/<id>/ for the others
//   STUDIO_STORE=sheets   one Google Sheet per workspace (phase 2; not built yet)
//
// The registry itself lives in data/master/ (workspaces.json, owners.json);
// with Sheets it becomes the master Sheet "Workspaces".
//
// Routes (mounted by api.mjs before the generic collection routes):
//   GET   /api/workspaces          the workspaces the caller may enter, with their role in each
//   GET   /api/workspaces/:id      one workspace (owner or member)
//   POST  /api/workspaces          { name, id?, director: { email, name } }  owner only
//   PATCH /api/workspaces/:id      { name?, status?, sheetId?, driveFolderId? } owner only

import crypto from 'node:crypto';
import path from 'node:path';
import { createJsonStore, DATA_DIR, STUDIO_ROOT, withWorkspace } from './store.mjs';

export const STATUSES = ['active', 'paused', 'archived'];
export const BACKENDS = ['json', 'sheets'];
export const WORKSPACE_ROLES = ['employee', 'manager', 'director'];

// Limits every new workspace starts with (ARCHITECTURE.md 4.5); the company profile fills the rest.
const STARTER_LIMITS = { hookWords: 8, igHashtags: 5, liHashtagsBottom: 3, liHookChars: 210, exclamation: 0, emoji: 0 };

class WorkspaceError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

const lower = (v) => String(v || '').trim().toLowerCase();
const now = () => new Date().toISOString();

// --------------------------------------------------------------- the registry

let master = null;
/** The master registry store: collections workspaces, owners and log. */
export function masterStore() {
  if (!master) {
    master = createJsonStore(process.env.STUDIO_MASTER_DIR || path.join(DATA_DIR, 'master'), {
      collections: ['workspaces', 'owners', 'log'],
      singletons: {},
      prefixes: { log: 'lg' },
    });
  }
  return master;
}

/** Every workspace in the registry. An empty registry reads as one default workspace on data/. */
export function listWorkspaces() {
  const rows = masterStore().list('workspaces');
  if (rows.length) return rows;
  return [{ id: 'default', name: 'Default workspace', status: 'active', sheetId: null, driveFolderId: null, dataDir: 'data', createdAt: null }];
}

export function getWorkspace(id) {
  return listWorkspaces().find((w) => w.id === id) || null;
}

/** The workspace a request without X-Studio-Workspace works in: STUDIO_DEFAULT_WORKSPACE, else the first active one. */
export function defaultWorkspace() {
  const all = listWorkspaces();
  const named = process.env.STUDIO_DEFAULT_WORKSPACE;
  return (named && all.find((w) => w.id === named)) || all.find((w) => w.status === 'active') || all[0];
}

export function isOwner(email) {
  const who = lower(email);
  if (!who) return false;
  return masterStore().list('owners').some((o) => lower(o.email) === who);
}

export function ownerOf(email) {
  const who = lower(email);
  return masterStore().list('owners').find((o) => lower(o.email) === who) || null;
}

// ------------------------------------------------------------------ stores

export function backend() {
  const b = lower(process.env.STUDIO_STORE || 'json');
  if (!BACKENDS.includes(b)) throw new WorkspaceError(500, `STUDIO_STORE must be one of ${BACKENDS.join(', ')}; it is ${b}`);
  return b;
}

const stores = new Map();   // workspace id -> store

/** The folder of a workspace's JSON files. */
export function dataDirOf(ws) {
  return path.resolve(STUDIO_ROOT, ws.dataDir || path.join('data', 'workspaces', ws.id));
}

/** The store of one workspace, made once and kept. */
export function storeFor(ws) {
  if (stores.has(ws.id)) return stores.get(ws.id);
  const b = backend();
  if (b === 'sheets') {
    throw new WorkspaceError(501, 'The Google Sheets store is not built yet (phase 2). Unset STUDIO_STORE to use the JSON files.');
  }
  const s = createJsonStore(dataDirOf(ws));
  stores.set(ws.id, s);
  return s;
}

/** Forget the cached stores (tests and import scripts). */
export function resetStores() { stores.clear(); master = null; }

// ------------------------------------------------------------- membership

/** The users of a workspace, as stored in its settings document. */
export function usersOf(ws) {
  const settings = storeFor(ws).getSingleton('settings');
  return Array.isArray(settings?.users) ? settings.users : [];
}

const roleOfUser = (u) => (WORKSPACE_ROLES.includes(u?.role) ? u.role : u?.approver ? 'director' : 'employee');

/** The caller's role in a workspace: their stored role, 'owner' for an owner who is not a member, else null. */
export function roleIn(ws, email) {
  const who = lower(email);
  if (!who) return null;
  const u = usersOf(ws).find((x) => lower(x.email) === who || lower(x.name) === who);
  if (u) return roleOfUser(u);
  return isOwner(who) ? 'owner' : null;
}

/** The workspace record as a client sees it, with the caller's role. */
export function publicWorkspace(ws, email) {
  const { dataDir, ...rest } = ws;
  return { ...rest, role: email ? roleIn(ws, email) : null };
}

/**
 * Which workspace a request works in, and whether the caller may enter it.
 * Returns the workspace record or throws a WorkspaceError (404, 403).
 */
export function resolveWorkspace(requested, by) {
  const ws = requested ? getWorkspace(String(requested).trim()) : defaultWorkspace();
  if (!ws) throw new WorkspaceError(404, `No workspace ${requested}`);
  if (!by) return ws;
  const role = roleIn(ws, by);
  if (role === 'owner') return ws;
  if (!role) throw new WorkspaceError(403, `You are not a member of the workspace ${ws.name}`, { workspace: ws.id, member: false });
  if (ws.status !== 'active') throw new WorkspaceError(403, `The workspace ${ws.name} is ${ws.status}`, { workspace: ws.id, status: ws.status });
  return ws;
}

// ------------------------------------------------------------------ create

/** A url-safe id from a name: "Acme Foods Pvt Ltd" -> "acme-foods-pvt-ltd". */
export function slug(name) {
  return lower(name).normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a workspace with its own store, one director and empty collections. */
export async function createWorkspace(input, by) {
  const name = String(input?.name || '').trim();
  if (!name) throw new WorkspaceError(400, 'A company name is required');
  const id = slug(input?.id || name);
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new WorkspaceError(400, 'The workspace id may hold only lower-case letters, digits and hyphens');
  if (['master', 'workspaces'].includes(id)) throw new WorkspaceError(400, `The id ${id} is reserved`);
  if (masterStore().get('workspaces', id)) throw new WorkspaceError(409, `A workspace with the id ${id} already exists`);
  const director = input?.director || {};
  const email = String(director.email || '').trim();
  if (!EMAIL.test(email)) throw new WorkspaceError(400, 'The director\'s email is required');
  const ws = {
    id, name, status: 'active',
    sheetId: input?.sheetId || null, driveFolderId: input?.driveFolderId || null,
    dataDir: path.join('data', 'workspaces', id),
    createdAt: now(), createdBy: by || null,
  };
  const wsStore = storeFor(ws);
  await withWorkspace(wsStore, async () => {
    await wsStore.put('settings', {
      id: 'settings',
      users: [{ email, name: String(director.name || email).trim(), role: 'director' }],
      model: 'sonnet', aiMode: 'cli', imageProvider: 'none', timezone: input?.timezone || 'Asia/Kolkata',
      goDark: { on: false }, linkToken: crypto.randomBytes(18).toString('hex'), runnerWaitMs: 0,
      by: by || null,
    });
    await wsStore.put('rules', {
      id: 'rules', voice: [], say: [], never: [], courseTerms: [], claimsOk: [], claimsBlocked: [], allowNames: [],
      limits: { ...STARTER_LIMITS }, checklist: [], examplesByType: {}, frame: '',
    });
    await wsStore.log(by, 'workspace.create', { workspace: id });
  }, ws);
  const stored = await masterStore().put('workspaces', ws);
  await masterStore().log(by, 'workspace.create', { workspace: id });
  return stored;
}

/** Changes the name, status, Sheet id or Drive folder id of a workspace. */
export async function updateWorkspace(id, patch, by) {
  const ws = masterStore().get('workspaces', id);
  if (!ws) throw new WorkspaceError(404, `No workspace ${id}`);
  const next = {};
  if (patch?.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new WorkspaceError(400, 'A company name is required');
    next.name = name;
  }
  if (patch?.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new WorkspaceError(400, `The status must be one of ${STATUSES.join(', ')}`);
    next.status = patch.status;
  }
  for (const k of ['sheetId', 'driveFolderId']) if (patch?.[k] !== undefined) next[k] = patch[k] ? String(patch[k]).trim() : null;
  const stored = await masterStore().patch('workspaces', id, next);
  await masterStore().log(by, 'workspace.update', { workspace: id, fields: Object.keys(next) });
  return stored;
}

// ------------------------------------------------------------------ routes

function requireOwner(ctx, what) {
  if (!ctx.by) throw new WorkspaceError(401, `Choose a user to ${what}`);
  if (!isOwner(ctx.by)) throw new WorkspaceError(403, `Only an owner can ${what}`);
}

export const routes = [
  {
    method: 'GET', path: '/api/workspaces',
    handler: (ctx) => {
      const owner = isOwner(ctx.by);
      const all = listWorkspaces();
      const visible = all
        .map((w) => publicWorkspace(w, ctx.by))
        .filter((w) => (owner ? true : ctx.by ? w.role && w.status === 'active' : w.status === 'active'));
      return { current: ctx.workspace ? { id: ctx.workspace.id, name: ctx.workspace.name } : null, owner, workspaces: visible };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:id',
    handler: (ctx) => {
      const ws = getWorkspace(ctx.params.id);
      if (!ws) throw new WorkspaceError(404, `No workspace ${ctx.params.id}`);
      const shown = publicWorkspace(ws, ctx.by);
      if (!shown.role) throw new WorkspaceError(403, `You are not a member of the workspace ${ws.name}`);
      return shown;
    },
  },
  {
    method: 'POST', path: '/api/workspaces',
    handler: async (ctx) => {
      requireOwner(ctx, 'create a workspace');
      const ws = await createWorkspace(ctx.body || {}, ctx.by);
      ctx.res.statusCode = 201;
      return publicWorkspace(ws, ctx.by);
    },
  },
  {
    method: 'PATCH', path: '/api/workspaces/:id',
    handler: async (ctx) => {
      requireOwner(ctx, 'change a workspace');
      return publicWorkspace(await updateWorkspace(ctx.params.id, ctx.body || {}, ctx.by), ctx.by);
    },
  },
];

export { WorkspaceError };
