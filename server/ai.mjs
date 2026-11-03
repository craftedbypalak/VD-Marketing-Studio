// The Claude bridge (section 6). [core]
//
//   run(opName, input, ctx?)  -> { output, usage, mode, ms, model }
//   listOps()                 -> [ { name, description, inputFields } ]
//   buildCtx()                -> { rules, solutions, examples, accounts, settings }
//   createJob(op, inputs, by) -> job (a sequential batch; poll getJob(id))
//
// cli mode: `claude -p` on the founder's subscription. The user prompt goes in
// on stdin; the JSON envelope comes back on stdout. 180 s timeout. One call at
// a time per operation name.
//
// api mode: the Claude Messages API with structured outputs
// (output_config.format = the op schema) and prompt caching on the system block.
// Note for the contract: section 6 asked for a forced tool call. The current
// Sonnet 5.5 and Opus 5.5 models reject tool_choice "tool"/"any" (HTTP 400), so
// the JSON comes back through output_config.format instead. Same schema, same
// result shape.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPS_DIR = path.join(here, 'ops');

export const CLI_TIMEOUT_MS = 180_000;
export const MODEL_IDS = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-5-5',
};
export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';

const opCache = new Map();

/** The last AI call, for Today: { at, op, ok, error, mode, ms }. Updated by run(). */
export const lastCall = { at: null, op: null, ok: null, error: null, mode: null, ms: null };

// ------------------------------------------------------------ the runner queue
//
// When the command line cannot answer (the login has expired) and
// settings.runnerWaitMs is above zero, a request waits here for a runner: a
// person or a process that reads GET /api/ai/pending and posts the output to
// POST /api/ai/pending/:id/answer. SPLIT-AND-HOSTING.md section 3 describes the
// same shape for the hosted tool (a Jobs tab polled by a process on the Mac).
// An input may also carry `handOutput`, an output written by hand, which is
// used as the answer at once; both paths are logged as such.

const pending = new Map();

export function listPending() {
  return [...pending.values()].map(({ resolve, reject, timer, ...p }) => p);
}

export function answerPending(id, output, by) {
  const p = pending.get(id);
  if (!p) return null;
  clearTimeout(p.timer);
  pending.delete(id);
  p.answeredBy = by || null;
  p.resolve(output);
  return { id, op: p.op, answeredBy: p.answeredBy };
}

function waitForRunner({ op, input, prompt, schema, by, waitMs }) {
  const id = `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new AiError(504, `No runner answered the ${op} request within ${Math.round(waitMs / 1000)} seconds. Run claude and /login in a terminal, or answer it under /api/ai/pending.`));
    }, waitMs);
    pending.set(id, { id, op, at: new Date().toISOString(), by: by || null, input, system: prompt.system, user: prompt.user, schema, resolve, reject, timer });
  });
}

const isAuthFailure = (err) => /authenticate|oauth|login|not logged in|api key/i.test(String(err?.message || ''));

/** Resolve settings.model to an API model id. CLI aliases pass through. */
export function modelId(model, mode) {
  const m = (model || 'sonnet').trim();
  if (mode === 'cli') return m;              // the CLI accepts sonnet | opus | haiku | full ids
  return MODEL_IDS[m] || m;
}

// ---------------------------------------------------------------- operations

export async function loadOp(name) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) || name.startsWith('_')) {
    throw new AiError(404, `Unknown operation: ${name}`);
  }
  const file = path.join(OPS_DIR, `${name}.mjs`);
  if (!fs.existsSync(file)) throw new AiError(404, `Unknown operation: ${name}`);
  const stat = fs.statSync(file);
  const cached = opCache.get(name);
  if (cached && cached.mtime === stat.mtimeMs) return cached.op;
  // Cache-bust on change so an op can be edited while the server runs.
  const op = await import(`${file}?v=${stat.mtimeMs}`);
  if (typeof op.buildPrompt !== 'function' || !op.schema) {
    throw new AiError(500, `Operation ${name} must export buildPrompt and schema`);
  }
  opCache.set(name, { op, mtime: stat.mtimeMs });
  return op;
}

export async function listOps() {
  const out = [];
  for (const f of fs.readdirSync(OPS_DIR).sort()) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const name = f.replace(/\.mjs$/, '');
    try {
      const op = await loadOp(name);
      out.push({ name: op.name || name, description: op.description || '', inputFields: op.inputFields || [] });
    } catch (err) {
      out.push({ name, description: `Failed to load: ${err.message}`, inputFields: [] });
    }
  }
  return out;
}

/** The context every op receives: the brief as data. */
export function buildCtx(extra = {}) {
  const rules = store.getSingleton('rules') || {};
  return {
    rules,
    solutions: store.list('solutions'),
    examples: rules.examplesByType || {},
    accounts: store.list('accounts'),
    settings: store.getSingleton('settings') || {},
    ...extra,
  };
}

export class AiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// ------------------------------------------------------------- serialisation

const chains = new Map(); // opName -> tail promise

function serialise(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  const cleanup = () => { if (chains.get(key) === next) chains.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}

// ----------------------------------------------------------------------- run

export async function run(opName, input = {}, ctx) {
  const op = await loadOp(opName);
  const context = ctx || buildCtx();
  const settings = context.settings || {};
  const mode = settings.aiMode === 'api' ? 'api' : 'cli';
  const { handOutput, ...cleanInput } = input || {};
  const prompt = op.buildPrompt(cleanInput, context);
  if (!prompt || typeof prompt.system !== 'string' || typeof prompt.user !== 'string') {
    throw new AiError(500, `Operation ${opName}.buildPrompt must return { system, user }`);
  }
  const t0 = Date.now();
  let result;
  if (handOutput && typeof handOutput === 'object' && !Array.isArray(handOutput)) {
    // Written by hand (the model's work done by a person): the same shape, the same path, marked in the log.
    result = { output: handOutput, model: 'hand', usage: null, raw: null, byHand: true };
  } else {
    try {
      result = await serialise(opName, () =>
        mode === 'api'
          ? callApi({ ...prompt, schema: op.schema, model: modelId(settings.model, 'api') })
          : callCli({ ...prompt, schema: op.schema, model: modelId(settings.model, 'cli'), settings }),
      );
    } catch (err) {
      const waitMs = Number(settings.runnerWaitMs) || 0;
      if (mode === 'cli' && waitMs > 0 && isAuthFailure(err)) {
        const output = await waitForRunner({ op: opName, input: cleanInput, prompt, schema: op.schema, by: context.by, waitMs });
        result = { output, model: 'runner', usage: null, raw: null, byHand: true };
      } else {
        Object.assign(lastCall, { at: new Date().toISOString(), op: opName, ok: false, error: String(err.message || err).slice(0, 300), mode, ms: Date.now() - t0 });
        await store.log(context.by || null, `ai:${opName}`, { mode, ms: Date.now() - t0, failed: true, error: lastCall.error, input: summarise(cleanInput) });
        throw err;
      }
    }
  }
  const ms = Date.now() - t0;
  const modeOut = result.byHand ? result.model : mode;
  Object.assign(lastCall, { at: new Date().toISOString(), op: opName, ok: true, error: null, mode: modeOut, ms });
  let output = result.output;
  if (typeof op.postProcess === 'function') output = op.postProcess(output, cleanInput, context) ?? output;
  await store.log(context.by || null, `ai:${opName}`, {
    mode: modeOut, ms, model: result.model, input: summarise(cleanInput), usage: result.usage || null, ...(result.byHand ? { byHand: true } : {}),
  });
  return { output, usage: result.usage || null, mode: modeOut, ms, model: result.model, raw: result.raw };
}

function summarise(input) {
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? s.slice(0, 197) + '...' : s;
  } catch { return null; }
}

// ----------------------------------------------------------------- CLI mode

/**
 * The CLI prints one JSON envelope:
 *   { type: 'result', subtype: 'success', is_error, result: <string>,
 *     structured_output?: <object>, usage: {...}, total_cost_usd, duration_ms,
 *     session_id, ... }
 * With --json-schema the structured object may arrive in `structured_output`
 * or as a JSON string inside `result`; both are handled.
 *
 * --bare skips keychain reads, so it only works when a token is in the
 * environment (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY). Without one, the
 * flag is dropped so the keychain login is used. settings.cliBare (true/false)
 * forces either way.
 */
export function callCli({ system, user, schema, model, settings = {} }) {
  const hasToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  const bare = typeof settings.cliBare === 'boolean' ? settings.cliBare : hasToken;
  const args = ['-p'];
  if (bare) args.push('--bare');
  args.push(
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', model,
    '--system-prompt', system,
    '--tools', '',
    '--no-session-persistence',
  );
  // A Studio server started from inside a Claude Code session inherits the
  // nested-session guards; strip them so the child runs as a plain CLI call.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(settings.cliPath || 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new AiError(500, `Could not start claude: ${err.message}`));
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, CLI_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); reject(new AiError(500, `claude failed to run: ${err.message}`)); });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new AiError(504, `claude timed out after ${CLI_TIMEOUT_MS / 1000} s`));
      let envelope;
      try {
        envelope = parseEnvelope(stdout);
      } catch (err) {
        return reject(new AiError(502, `claude returned no JSON envelope (exit ${code})`, { stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) }));
      }
      if (envelope.is_error || (code !== 0 && !envelope.structured_output)) {
        return reject(new AiError(502, `claude error: ${envelope.result || stderr || `exit ${code}`}`, envelope));
      }
      let output = envelope.structured_output;
      if (output === undefined || output === null) {
        try { output = extractJson(envelope.result); }
        catch (err) { return reject(new AiError(502, `claude result was not JSON: ${err.message}`, envelope)); }
      }
      resolve({
        output,
        model: model,
        usage: {
          ...(envelope.usage || {}),
          total_cost_usd: envelope.total_cost_usd,
          duration_ms: envelope.duration_ms,
          duration_api_ms: envelope.duration_api_ms,
          session_id: envelope.session_id,
          modelUsage: envelope.modelUsage,
        },
        raw: envelope,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(user);
  });
}

function parseEnvelope(text) {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  // Stream-style output or a log line before the envelope: take the last JSON line.
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const j = JSON.parse(lines[i]); if (j && typeof j === 'object') return j; } catch { /* next */ }
  }
  throw new Error('no envelope');
}

/** JSON from a string that may carry fences or prose around it. */
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text ?? '').trim();
  try { return JSON.parse(s); } catch { /* keep going */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* keep going */ } }
  const first = s.search(/[{[]/);
  if (first >= 0) {
    const open = s[first];
    const close = open === '{' ? '}' : ']';
    let depth = 0; let inStr = false; let esc = false;
    for (let i = first; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return JSON.parse(s.slice(first, i + 1)); }
    }
  }
  throw new Error('no JSON object found');
}

// ----------------------------------------------------------------- API mode

/** Structured outputs need additionalProperties: false on every object. */
export function strictSchema(schema) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (['properties', '$defs', 'definitions'].includes(k) && v && typeof v === 'object') {
        out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)]));
      } else if (['items', 'anyOf', 'allOf', 'oneOf'].includes(k)) {
        out[k] = Array.isArray(v) ? v.map(walk) : walk(v);
      } else out[k] = v;
    }
    if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(schema);
}

export async function callApi({ system, user, schema, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError(503, 'ANTHROPIC_API_KEY is not set; switch aiMode to cli or set the key');
  const body = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: strictSchema(schema) } },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new AiError(502, `Claude API request failed: ${err.message}`);
  }
  clearTimeout(timer);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiError(502, `Claude API ${res.status}: ${data?.error?.message || res.statusText}`, data);
  if (data.stop_reason === 'refusal') throw new AiError(502, `Claude declined the request (${data.stop_details?.category || 'refusal'})`, data);
  if (data.stop_reason === 'max_tokens') throw new AiError(502, 'Claude output was cut at max_tokens', data);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let output;
  try { output = extractJson(text); } catch (err) { throw new AiError(502, `Claude API result was not JSON: ${err.message}`, data); }
  return { output, model: data.model || model, usage: data.usage || null, raw: { id: data.id, stop_reason: data.stop_reason } };
}

// --------------------------------------------------------------- batch jobs

const jobs = new Map();
let jobChain = Promise.resolve();

export function createJob(op, inputs, by) {
  if (!Array.isArray(inputs) || !inputs.length) throw new AiError(400, 'inputs must be a non-empty array');
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const job = {
    id, op, by: by || null, status: 'queued', total: inputs.length, done: 0,
    results: inputs.map(() => null), createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
  };
  jobs.set(id, job);
  jobChain = jobChain.catch(() => {}).then(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const ctx = buildCtx({ by });
    for (let i = 0; i < inputs.length; i++) {
      try {
        const r = await run(op, inputs[i], ctx);
        job.results[i] = { ok: true, output: r.output, usage: r.usage, ms: r.ms };
      } catch (err) {
        job.results[i] = { ok: false, error: err.message, detail: err.detail || null };
      }
      job.done = i + 1;
    }
    job.status = job.results.every((r) => r && r.ok) ? 'done' : 'done-with-errors';
    job.finishedAt = new Date().toISOString();
  });
  // Keep the map from growing without limit.
  if (jobs.size > 200) {
    const oldest = [...jobs.keys()].slice(0, jobs.size - 200);
    for (const k of oldest) jobs.delete(k);
  }
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export const ai = { run, listOps, loadOp, buildCtx, createJob, getJob, modelId, AiError, lastCall, listPending, answerPending };
export default ai;
