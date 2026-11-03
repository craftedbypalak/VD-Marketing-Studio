// Fetch wrapper for /api. [core]
//
//   import { api } from './api.js';
//   const pieces = await api.get('/pieces', { status: 'in-review' });
//   await api.post('/pieces', piece);
//   await api.put('/pieces/pc-0001', piece);
//   await api.patch('/pieces/pc-0001', { status: 'in-review' });
//   await api.del('/pieces/pc-0001');
//   await api.upload(file)             -> { path, w, h, seconds }
//   await api.ai('draft', input)       -> { output, usage, mode }
//
// Every request carries X-Studio-User from the chosen user (api.user) and
// X-Studio-Workspace from the chosen workspace (api.workspace; docs/WORKSPACES.md).

const USER_KEY = 'studio.user';
const WORKSPACE_KEY = 'studio.workspace';
const PIN_KEY = 'studio.pin';

/** The PIN of a manager or the director for this browser session, asked for once when the server wants it. */
export const pin = {
  get() { try { return sessionStorage.getItem(PIN_KEY) || ''; } catch { return ''; } },
  set(v) { try { if (v) sessionStorage.setItem(PIN_KEY, v); else sessionStorage.removeItem(PIN_KEY); } catch { /* private mode */ } },
};

let askingPin = null;
async function askPin(message) {
  if (askingPin) return askingPin;
  askingPin = (async () => {
    const { dialog, el, button } = await import('./ui.js');
    return new Promise((resolve) => {
      const field = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', class: 'input mono', placeholder: 'PIN', 'aria-label': 'PIN' });
      let d;
      let answered = false;
      // Resolve before closing: the dialog's onClose fires inside close() and must not win.
      const done = (v) => { if (answered) return; answered = true; resolve(v); d.close(); };
      d = dialog({
        title: 'Your PIN',
        body: el('div', {}, [el('p', { text: message || 'This action is reserved for a manager or the director. Enter your PIN to continue.' }), field]),
        actions: [button({ kind: 'secondary', label: 'Cancel', onClick: () => done('') }), button({ kind: 'primary', label: 'Continue', onClick: () => done(field.value.trim()) })],
        onClose: () => { if (!answered) { answered = true; resolve(''); } },
      });
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(field.value.trim()); });
      setTimeout(() => field.focus(), 50);
    });
  })().finally(() => { askingPin = null; });
  return askingPin;
}

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const user = {
  get() { try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; } },
  set(email) {
    try { if (email) localStorage.setItem(USER_KEY, email); else localStorage.removeItem(USER_KEY); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('studio:user', { detail: email }));
  },
};

/** The workspace (one company) every request works in; the server's default when none is chosen. */
export const workspace = {
  get() { try { return localStorage.getItem(WORKSPACE_KEY) || ''; } catch { return ''; } },
  set(id) {
    try { if (id) localStorage.setItem(WORKSPACE_KEY, id); else localStorage.removeItem(WORKSPACE_KEY); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('studio:workspace', { detail: id }));
  },
};

function qs(params) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, body, { params, raw, retried } = {}) {
  const headers = {};
  const who = user.get();
  if (who) headers['X-Studio-User'] = who;
  const ws = workspace.get();
  if (ws) headers['X-Studio-Workspace'] = ws;
  const p = pin.get();
  if (p) headers['X-Studio-Pin'] = p;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${path}${qs(params)}`, { method, headers, body: payload });
  } catch (err) {
    throw new ApiError(0, 'The server could not be reached');
  }
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    // The server wants the PIN of a manager or the director: ask once, keep it for the session, retry once.
    if (res.status === 403 && data?.detail?.pin && !retried) {
      const given = await askPin(data?.error);
      if (given) { pin.set(given); return request(method, path, body, { params, raw, retried: true }); }
    }
    if (res.status === 403 && data?.detail?.pin && retried) pin.set('');
    throw new ApiError(res.status, data?.error || `${res.status} ${res.statusText}`, data?.detail);
  }
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, undefined, { params }),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  async upload(file, field = 'file') {
    const fd = new FormData();
    fd.append(field, file, file.name);
    return request('POST', '/media', fd);
  },
  ai: (op, input) => request('POST', `/ai/${op}`, input ?? {}),
  ops: () => request('GET', '/ai/ops'),
  batch: (op, inputs) => request('POST', '/ai/batch', { op, inputs }),
  job: (id) => request('GET', `/ai/jobs/${id}`),
  today: (date) => request('GET', '/today', undefined, { params: date ? { date } : undefined }),
  settings: () => request('GET', '/settings/settings'),
  rules: () => request('GET', '/rules/rules'),
  workspaces: () => request('GET', '/workspaces'),
  user,
  workspace,
  pin,
  ApiError,
};

export default api;
