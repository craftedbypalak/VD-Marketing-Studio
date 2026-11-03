// Roles: who the chosen user is and what they may do (docs/ROLES.md). [core]
//
//   import { me, roleOf, userLabel, ROLE_LABEL } from './roles.js';
//   const m = await me();          -> { email, name, role, pinSet, can: { approve, escalate, approveForDirector, settings, delete, recordPosted } }
//   m.can.approve                  manager or director ("approver" in older text)
//   m.can.settings                 director only
//
// Read from GET /api/me once per user and cached; cleared when the user picker
// changes. Until the server serves /api/me, the role is derived from the users
// in settings (role, else approver: true is read as director).

import { api } from './api.js';

export const ROLES = ['employee', 'manager', 'director'];
export const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', director: 'Director' };

/** A stored user's role, with the migration rule of ROLES.md section 1. */
export const roleOf = (u) => (u && ROLES.includes(u.role) ? u.role : u?.approver ? 'director' : 'employee');

/** "Palak Gupta, Director", for the pickers. */
export const userLabel = (u) => `${u?.name || u?.email || ''}, ${ROLE_LABEL[roleOf(u)]}`;

/** The can flags a role carries, as the server derives them. */
export function canFor(role) {
  const reviewer = role === 'manager' || role === 'director';
  const director = role === 'director';
  return { approve: reviewer, escalate: reviewer, approveForDirector: director, settings: director, delete: director, recordPosted: reviewer };
}

const NOBODY = { email: '', name: '', role: null, pinSet: false, can: canFor(null) };

let cache = null;   // { email, promise }

/** Forget the cached answer, after the user changes or the users are saved. */
export function clearMe() { cache = null; }
window.addEventListener('studio:user', clearMe);

async function fromSettings(email) {
  let settings = null;
  try { settings = await api.settings(); } catch { return { ...NOBODY }; }
  const u = (settings?.users || []).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
  if (!u) return { ...NOBODY };
  const role = roleOf(u);
  return { email: u.email, name: u.name || u.email, role, pinSet: Boolean(u.pinSet), can: canFor(role) };
}

async function load(email) {
  if (!email) return { ...NOBODY };
  try {
    const r = await api.get('/me');
    // An older server answers 404, or treats "me" as a collection; neither carries a role.
    if (r && typeof r === 'object' && !Array.isArray(r) && 'role' in r && r.can) {
      const role = ROLES.includes(r.role) ? r.role : null;
      return { email: r.email || email, name: r.name || r.email || email, role, pinSet: Boolean(r.pinSet), can: { ...canFor(role), ...r.can } };
    }
  } catch { /* fall back to the settings below */ }
  return fromSettings(email);
}

/** The chosen user's role and can flags. */
export function me(force = false) {
  const email = api.user.get() || '';
  if (!force && cache && cache.email === email) return cache.promise;
  const promise = load(email).catch(() => ({ ...NOBODY }));
  cache = { email, promise };
  return promise;
}

export default { me, clearMe, roleOf, userLabel, canFor, ROLES, ROLE_LABEL };
