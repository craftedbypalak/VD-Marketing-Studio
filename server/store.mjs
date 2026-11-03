// Studio store: the section 3 interface, backed by one JSON file per collection.
// [core] Every read and write in the app goes through this object, so another
// adapter (store-sheets.mjs, phase 2) can replace it without touching api.mjs.
//
// Each workspace (one company, docs/WORKSPACES.md) has its own store. The
// exported `store` hands every call to the store of the workspace the current
// request runs in (`withWorkspace`), so modules keep importing `store` exactly
// as before. Outside a request it is the default workspace's store.

import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// STUDIO_ROOT may point the store at a writable copy (the Vercel function copies
// data/ to /tmp on a cold start, because the deployed code folder is read-only).
export const STUDIO_ROOT = process.env.STUDIO_ROOT ? path.resolve(process.env.STUDIO_ROOT) : path.resolve(here, '..');
export const DATA_DIR = path.join(STUDIO_ROOT, 'data');

// People and touches live in the separate Network tool (docs/SPLIT-AND-HOSTING.md).
export const COLLECTIONS = [
  'pieces', 'versions', 'slots', 'accounts', 'rules', 'solutions',
  'events', 'campaigns', 'videos', 'settings', 'log', 'images',
  'festival-angles',   // the angle bank for festival concepts (data/festival-angles.json)
];

// Single-document collections and the id their one record carries.
export const SINGLETONS = { rules: 'rules', settings: 'settings' };

// Prefix used by nextId for each collection (section 3).
export const ID_PREFIX = {
  pieces: 'pc', slots: 'sl', events: 'ev',
  videos: 'vd', campaigns: 'cp', images: 'im', versions: 'vr', log: 'lg',
  accounts: 'ac', solutions: 'so', 'festival-angles': 'fa',
};

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const now = () => new Date().toISOString();

/**
 * A store over one folder of JSON files, one per collection.
 *   createJsonStore(dataDir, { collections, singletons, prefixes })
 * Returns the section 3 interface. Each store keeps its own in-memory copy.
 */
export function createJsonStore(dataDir, {
  collections = COLLECTIONS, singletons = SINGLETONS, prefixes = ID_PREFIX,
} = {}) {
  const cache = new Map();          // collection -> array (the live copy)
  const writeQueue = new Map();     // collection -> promise chain, so writes never interleave

  const fileFor = (collection) => path.join(dataDir, `${collection}.json`);

  function assertCollection(collection) {
    if (!collections.includes(collection)) {
      throw new Error(`Unknown collection: ${collection}`);
    }
  }

  function load(collection) {
    assertCollection(collection);
    if (cache.has(collection)) return cache.get(collection);
    const file = fileFor(collection);
    let rows = [];
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim();
      rows = text ? JSON.parse(text) : [];
      if (!Array.isArray(rows)) throw new Error(`${file} must hold a JSON array`);
    }
    cache.set(collection, rows);
    return rows;
  }

  // Write to a temp file in the same folder, then rename: the file on disk is
  // always either the old complete copy or the new complete copy.
  async function persist(collection) {
    const rows = load(collection);
    const file = fileFor(collection);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const text = JSON.stringify(rows, null, 2) + '\n';
    const prev = writeQueue.get(collection) || Promise.resolve();
    const next = prev.then(async () => {
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, file);
    }).catch((err) => {
      console.error(`[store] write failed for ${collection}:`, err.message);
      fsp.unlink(tmp).catch(() => {});
    });
    writeQueue.set(collection, next);
    return next;
  }

  return {
    /** All records of a collection (copies), optionally filtered. */
    list(collection, filterFn) {
      const rows = load(collection);
      const out = typeof filterFn === 'function' ? rows.filter(filterFn) : rows;
      return clone(out);
    },

    /** One record by id, or null. */
    get(collection, id) {
      const rows = load(collection);
      const row = rows.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    /** Insert or replace by obj.id. Sets createdAt on insert and updatedAt always. */
    async put(collection, obj) {
      if (!obj || typeof obj !== 'object') throw new Error('put needs an object');
      if (!obj.id) throw new Error('put needs obj.id');
      const rows = load(collection);
      const i = rows.findIndex((r) => r.id === obj.id);
      const stamp = now();
      const record = clone(obj);
      if (i >= 0) {
        record.createdAt = rows[i].createdAt || record.createdAt || stamp;
        record.updatedAt = stamp;
        rows[i] = record;
      } else {
        record.createdAt = record.createdAt || stamp;
        record.updatedAt = stamp;
        rows.push(record);
      }
      await persist(collection);
      return clone(record);
    },

    /** Shallow merge into the record. Returns the stored copy, or null when missing. */
    async patch(collection, id, partial) {
      const rows = load(collection);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      const merged = { ...rows[i], ...clone(partial || {}), id, updatedAt: now() };
      merged.createdAt = rows[i].createdAt;
      rows[i] = merged;
      await persist(collection);
      return clone(merged);
    },

    /** Delete by id. */
    async remove(collection, id) {
      const rows = load(collection);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      await persist(collection);
      return true;
    },

    /**
     * Next id for a prefix, 'prefix-0001' style, unique within the collection
     * that uses the prefix. Scans existing ids so imported ids never collide.
     */
    nextId(prefix) {
      const collection = Object.keys(prefixes).find((c) => prefixes[c] === prefix) || prefix;
      const rows = collections.includes(collection) ? load(collection) : [];
      const re = new RegExp(`^${prefix}-(\\d+)$`);
      let max = 0;
      for (const r of rows) {
        const m = re.exec(String(r.id || ''));
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return `${prefix}-${String(max + 1).padStart(4, '0')}`;
    },

    /** Append one line to the log collection. Never throws. */
    async log(who, what, ref) {
      try {
        if (!collections.includes('log')) return null;
        const rows = load('log');
        const entry = { id: this.nextId(prefixes.log || 'lg'), at: now(), by: who || null, what, ref: ref ?? null };
        rows.push(entry);
        // Keep the file from growing without limit.
        if (rows.length > 5000) rows.splice(0, rows.length - 5000);
        await persist('log');
        return entry;
      } catch (err) {
        console.error('[store] log failed:', err.message);
        return null;
      }
    },

    /** Single documents: rules and settings. */
    getSingleton(collection) {
      const id = singletons[collection];
      if (!id) throw new Error(`${collection} is not a single-document collection`);
      return this.get(collection, id);
    },

    /** Drop the in-memory copy so the next read comes from disk (used by import scripts). */
    reload(collection) {
      if (collection) cache.delete(collection); else cache.clear();
    },

    /** Wait for every queued write (tests and scripts). */
    async flush() {
      await Promise.all([...writeQueue.values()]);
    },

    backend: 'json',
    collections,
    singletons,
    prefixes,
    dataDir,
    root: STUDIO_ROOT,
  };
}

// ------------------------------------------------- the current workspace

// The default workspace's store: data/ itself (Venture Drafters, workspace one).
const defaultStore = createJsonStore(DATA_DIR);
const scope = new AsyncLocalStorage();

/** Runs fn with `wsStore` as the store every module sees, for this request and what it awaits. */
export function withWorkspace(wsStore, fn, workspace = null) {
  return scope.run({ store: wsStore, workspace }, fn);
}

/** The store of the current request's workspace, else the default one. */
export const currentStore = () => scope.getStore()?.store || defaultStore;

/** The workspace record of the current request, or null outside one. */
export const currentWorkspace = () => scope.getStore()?.workspace || null;

export const store = {
  list: (c, fn) => currentStore().list(c, fn),
  get: (c, id) => currentStore().get(c, id),
  put: (c, obj) => currentStore().put(c, obj),
  patch: (c, id, partial) => currentStore().patch(c, id, partial),
  remove: (c, id) => currentStore().remove(c, id),
  nextId: (prefix) => currentStore().nextId(prefix),
  log: (who, what, ref) => currentStore().log(who, what, ref),
  getSingleton: (c) => currentStore().getSingleton(c),
  reload: (c) => currentStore().reload(c),
  flush: () => currentStore().flush(),
  get backend() { return currentStore().backend; },
  get dataDir() { return currentStore().dataDir; },
  collections: COLLECTIONS,
  singletons: SINGLETONS,
  prefixes: ID_PREFIX,
  root: STUDIO_ROOT,
  defaultStore,
};

export default store;
