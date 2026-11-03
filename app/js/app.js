// Boot: builds the navigation, the user picker and starts the router. [core]

import { api } from './api.js';
import { router, NAV } from './router.js';
import { el, icon, select, toast } from './ui.js';
import { roleOf, userLabel } from './roles.js';

const navList = document.getElementById('nav-list');
const tabbar = document.getElementById('tabbar');
const subnav = document.getElementById('subnav');
const navUser = document.getElementById('nav-user');
const navWorkspace = document.getElementById('nav-workspace');
const pageTitle = document.getElementById('page-title');
const pageEyebrow = document.getElementById('page-eyebrow');
const topbarActions = document.getElementById('topbar-actions');

const navItem = (n, cls) => el('a', { class: cls, href: n.href, dataset: { nav: n.id } }, [icon(n.icon), el('span', { text: n.label })]);

function buildNav() {
  // Desktop: the calendar, then the Content group with its items, then Settings.
  navList.replaceChildren(...NAV.map((n) => (n.group
    ? el('div', { class: 'nav-group' }, [el('span', { class: 'nav-group-label', text: n.label }), ...n.items.map((i) => navItem(i, 'nav-item nav-sub'))])
    : navItem(n, 'nav-item'))));
  // Phone: three tabs; the Content group's items sit in a sub-bar under the page title.
  tabbar.replaceChildren(...NAV.map((n) => navItem(n, 'tab-item')));
  const content = NAV.find((n) => n.group);
  if (subnav && content) subnav.replaceChildren(...content.items.map((i) => el('a', { class: 'subnav-item', href: i.href, dataset: { nav: i.id } }, [icon(i.icon), el('span', { text: i.label })])));
}

function markActive() {
  const { item, group } = router.activeNav();
  for (const a of document.querySelectorAll('.nav-item[data-nav], .subnav-item[data-nav]')) a.classList.toggle('active', a.dataset.nav === item);
  for (const a of document.querySelectorAll('.tab-item[data-nav]')) a.classList.toggle('active', a.dataset.nav === group);
  if (subnav) subnav.classList.toggle('is-on', group === 'content');
}

let workspaceName = '';
let isOwner = false;

/**
 * The workspace switcher: the companies the chosen user may enter (docs/WORKSPACES.md).
 * A stored choice the user may no longer enter falls back to the server's default.
 * Switching reloads the page, so every view reads the new company's data.
 */
async function buildWorkspaceSwitcher() {
  let info = null;
  try { info = await api.workspaces(); } catch (err) { toast(err.message, 'bad'); return; }
  isOwner = Boolean(info?.owner);
  const list = info?.workspaces || [];
  const chosen = api.workspace.get();
  if (!list.some((w) => w.id === chosen)) {
    const fallback = list.find((w) => w.id === info?.current?.id) || list[0];
    api.workspace.set(fallback?.id || '');
  }
  const current = list.find((w) => w.id === api.workspace.get());
  workspaceName = current?.name || '';
  if (!navWorkspace) return;
  if (list.length < 2) {
    navWorkspace.replaceChildren(...(current ? [el('span', { class: 'eyebrow', text: 'Workspace' }), el('span', { class: 'nav-workspace-name', text: current.name })] : []));
    return;
  }
  const picker = select({
    options: list.map((w) => ({ value: w.id, label: w.status === 'active' ? w.name : `${w.name} (${w.status})` })),
    value: api.workspace.get(),
    'aria-label': 'Workspace',
    onChange: (e) => { api.workspace.set(e.target.value); api.pin.set(''); location.reload(); },
  });
  navWorkspace.replaceChildren(el('span', { class: 'eyebrow', text: 'Workspace' }), picker);
}

async function buildUserPicker() {
  let settings = null;
  try { settings = await api.settings(); } catch (err) {
    // The chosen user is not a member of this workspace: choose again from its users.
    if (err.status === 403 && api.user.get()) { api.user.set(''); return buildUserPicker(); }
    toast(err.message, 'bad');
  }
  const users = [...(settings?.users || [])];
  const current = api.user.get();
  // An owner who is not a member works here as the director (docs/ROLES.md section 1).
  if (current && isOwner && !users.some((u) => String(u.email).toLowerCase() === current.toLowerCase())) {
    const m = await api.get('/me').catch(() => null);
    users.push({ email: current, name: m?.name || current, role: 'director', owner: true });
  }
  if ((!current || !users.some((u) => u.email === current)) && users.length) api.user.set(users[0].email);
  // Each name with its role: "Palak Gupta, Director" (docs/ROLES.md section 4).
  const picker = select({
    options: users.map((u) => ({ value: u.email, label: u.owner ? `${u.name}, Owner` : userLabel(u) })),
    value: api.user.get(),
    onChange: (e) => {
      api.user.set(e.target.value);   // roles.js forgets the cached role on this event
      api.pin.set('');   // a new user, a fresh PIN prompt
      const u = users.find((x) => x.email === e.target.value);
      toast(u && roleOf(u) !== 'employee' && u.pinSet ? `Working as ${userLabel(u)}. The PIN is asked for on the first action reserved for your role.` : `Working as ${e.target.selectedOptions[0]?.text || e.target.value}`, 'ok');
      // Redraw the view for the new role; the piece editor keeps its unsaved text and is left as it is.
      if (!/^\/content\/[^/]+/.test(router.parseHash().path)) router.render();
    },
  });
  navUser.replaceChildren(el('span', { class: 'eyebrow', text: 'Working as' }), picker);
  window.addEventListener('studio:user', (e) => { if (picker.value !== e.detail) picker.value = e.detail; });
}

/** Views may place buttons in the top bar: setActions([node, ...]). */
export function setActions(nodes = []) { topbarActions.replaceChildren(...nodes.filter(Boolean)); }
export function setEyebrow(text) { pageEyebrow.textContent = text || (workspaceName ? `${workspaceName}, Studio` : 'Studio'); }

/** The hosted preview keeps changes only for a while: say so above every page. */
async function hostingBanner() {
  const h = await api.get('/health').catch(() => null);
  if (!h?.hosting || h.hosting.persistent !== false) return;
  const main = document.getElementById('main');
  const outlet = document.getElementById('outlet');
  if (!main || !outlet) return;
  const ai = h.hosting.aiMode === 'api' ? '' : ' AI steps need ANTHROPIC_API_KEY in the Vercel project settings.';
  main.insertBefore(el('div', { class: 'banner banner-warn hosting-banner', role: 'status', text: `Hosted preview: changes are kept only for a short while and reset when the server restarts, until Google Sheets is connected.${ai}` }), outlet);
}

buildNav();
hostingBanner();
await buildWorkspaceSwitcher();
await buildUserPicker();
// The user changed: the workspaces they may enter may differ.
window.addEventListener('studio:user', async () => {
  const before = api.workspace.get();
  await buildWorkspaceSwitcher();
  if (api.workspace.get() !== before) location.reload();
});
// Settings saved new users or roles: rebuild the picker so the labels follow.
window.addEventListener('studio:users', () => { buildUserPicker(); });
await router.start({
  outlet: document.getElementById('outlet'),
  onChange: ({ title }) => { pageTitle.textContent = title; setActions([]); setEyebrow(); markActive(); },
});
window.studio = { api, router, setActions, setEyebrow };
