// Hash router and the view registry. [core]
//
// A view module exports { route, title, render(container, params) } and is
// listed in VIEWS below (module builders replace their placeholder file; the
// core owner adds new entries here). `route` is a string such as
// '#/content/:id' or an array of such strings. `params` carries the named
// segments plus `query` (from '#/path?x=y') and `route` (the matched pattern).
// render may return a cleanup function, called before the next view renders.

import * as library from './views/library.js';
import * as piece from './views/piece.js';
import * as review from './views/review.js';
import * as calendar from './views/calendar.js';
import * as video from './views/video.js';
import * as recurring from './views/recurring.js';
import * as cards from './views/cards.js';
import * as settings from './views/settings.js';
import * as builder from './views/builder.js';

// Today is no longer a page: its lists fold into the calendar's Today strip (30 October 2026).
export const VIEWS = [library, piece, review, calendar, video, recurring, cards, settings, builder];

// Main navigation, grouped: the calendar is the home view; Content holds the library, the review
// queue, video, pictures and recurring; Settings stands alone. The phone tab bar shows the three
// top-level entries and a sub-bar for the Content group.
export const NAV = [
  { id: 'calendar', label: 'Calendar', href: '#/calendar', icon: 'calendar' },
  {
    id: 'content', label: 'Content', href: '#/content', icon: 'content', group: true,
    items: [
      { id: 'library', label: 'Library', href: '#/content', icon: 'content' },
      { id: 'review', label: 'Review', href: '#/review', icon: 'review' },
      { id: 'video', label: 'Video', href: '#/video', icon: 'video' },
      { id: 'visuals', label: 'Visuals', href: '#/visuals', icon: 'pictures' },
      { id: 'occasions', label: 'Occasions', href: '#/occasions', icon: 'recurring' },
    ],
  },
  { id: 'settings', label: 'Settings', href: '#/settings', icon: 'settings' },
];

// Which item and group a path belongs to.
const ITEM_OF = { calendar: 'calendar', today: 'calendar', content: 'library', review: 'review', video: 'video', visuals: 'visuals', pictures: 'visuals', occasions: 'occasions', recurring: 'occasions', settings: 'settings', builder: 'builder' };
const GROUP_OF = { library: 'content', review: 'content', video: 'content', visuals: 'content', occasions: 'content' };

// Old routes keep working: Pictures became Visuals and Recurring became Occasions on 30 October 2026.
const RENAMED = { '/pictures': '/visuals', '/recurring': '/occasions' };
export function activeNav(path = parseHash().path) {
  const seg = path.split('/')[1] || 'calendar';
  const item = ITEM_OF[seg] || 'calendar';
  return { item, group: GROUP_OF[item] || item };
}

const compiled = [];
let cleanup = null;
let outlet = null;
let onChange = null;

function compile(view) {
  const routes = Array.isArray(view.route) ? view.route : [view.route];
  for (const r of routes) {
    const keys = [];
    const pattern = r.replace(/^#/, '').replace(/\/+$/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z0-9_-]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    compiled.push({ view, route: r, re: new RegExp(`^${pattern}/?$`), keys });
  }
}

export function parseHash(hash = location.hash) {
  const h = (hash || '#/calendar').replace(/^#/, '');
  const [pathPart, queryPart] = h.split('?');
  const path = pathPart || '/calendar';
  const query = Object.fromEntries(new URLSearchParams(queryPart || '').entries());
  return { path, query };
}

export function match(hash) {
  const { path, query } = parseHash(hash);
  for (const c of compiled) {
    const m = c.re.exec(path);
    if (!m) continue;
    const params = { query, route: c.route, path };
    c.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { view: c.view, params };
  }
  return null;
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) render();
}

export function activeNavId(path = parseHash().path) {
  return activeNav(path).item;
}

export async function render() {
  if (!outlet) return;
  // The old Today page: its lists now live on the calendar, opened with the strip unfolded.
  if (parseHash().path === '/today') { navigate('#/calendar?today=1', { replace: true }); return; }
  const { path: p0, query: q0 } = parseHash();
  if (RENAMED[p0]) { const q = new URLSearchParams(q0).toString(); navigate(`#${RENAMED[p0]}${q ? `?${q}` : ''}`, { replace: true }); return; }
  const hit = match(location.hash);
  if (!hit) { navigate('#/calendar', { replace: true }); return; }
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  outlet.replaceChildren();
  const title = typeof hit.view.title === 'function' ? hit.view.title(hit.params) : (hit.view.title || 'Studio');
  document.title = `${title} · Venture Drafters Studio`;
  if (onChange) onChange({ title, params: hit.params, view: hit.view });
  try {
    const result = await hit.view.render(outlet, hit.params);
    if (typeof result === 'function') cleanup = result;
  } catch (err) {
    console.error(err);
    const box = document.createElement('div');
    box.className = 'banner banner-bad';
    box.textContent = `This view could not be rendered: ${err.message}`;
    outlet.replaceChildren(box);
  }
  window.scrollTo({ top: 0 });
}

export function start({ outlet: el, onChange: cb } = {}) {
  outlet = el || document.getElementById('outlet');
  onChange = cb || null;
  compiled.length = 0;
  for (const v of VIEWS) if (v && v.route) compile(v);
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/calendar');
  return render();
}

export const router = { VIEWS, NAV, start, render, navigate, match, parseHash, activeNavId, activeNav };
export default router;
