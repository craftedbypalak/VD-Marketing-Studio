// Settings: users, review routing, AI, accounts (read-only), the solutions
// register, the Network link and workspaces. The checker rules and the posting
// rhythm are edited in Builder (#/builder/checker, #/builder/rhythm). [core]

import { api } from '../api.js';
import { el, card, field, input, textarea, select, switchInput, checkbox, button, table, tabs, toast, confirm, chip, bullets } from '../ui.js';
import { roleOf, userLabel, clearMe, ROLES, ROLE_LABEL, me as whoAmI } from '../roles.js';
import { TYPES, PILLARS, routingOf } from './piece.js';

export const route = '#/settings';
export const title = 'Settings';

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'routing', label: 'Review routing' },
  { id: 'ai', label: 'AI' },
  { id: 'posting', label: 'Posting' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'rules', label: 'Rules' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'link', label: 'Link' },
  { id: 'builder', label: 'Builder' },
];
// Shown to owners only: the companies this Studio serves (docs/WORKSPACES.md).
const OWNER_TABS = [{ id: 'workspaces', label: 'Workspaces' }];

const linesToList = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);

export async function render(container, params) {
  let settings, accounts, solutions, spaces;
  try {
    [settings, accounts, solutions, spaces] = await Promise.all([api.settings(), api.get('/accounts'), api.get('/solutions'), api.workspaces().catch(() => null)]);
  } catch (err) {
    container.appendChild(el('div', { class: 'banner banner-bad', text: `Could not load settings: ${err.message}` }));
    return;
  }

  const me = (api.user.get() || '').toLowerCase();
  // Only the director changes settings, users, rules and the review routing (docs/ROLES.md section 3).
  // An owner who is not a member works here as the director: the server's answer decides (docs/ROLES.md section 1).
  const isDirector = Boolean(me) && ((await whoAmI()).role === 'director');
  if (!isDirector) container.appendChild(el('div', { class: 'banner banner-info' }, [bullets(['Read-only for you', 'The director changes these settings', 'Your PIN is under Users'], { compact: true })]));
  const panel = el('div');
  const items = spaces?.owner ? [...TABS, ...OWNER_TABS] : TABS;
  const bar = tabs({
    items,
    active: params.query?.tab && items.some((t) => t.id === params.query.tab) ? params.query.tab : 'users',
    onChange: (id) => { history.replaceState(null, '', `#/settings?tab=${id}`); show(id); },
  });
  container.append(bar, panel);

  const views = {
    users: () => usersTab(settings),
    routing: () => routingTab(settings),
    ai: () => aiTab(settings),
    posting: () => moved('Posting moved to Builder, Posting rhythm', '#/builder/rhythm'),
    accounts: () => accountsTab(accounts),
    rules: () => moved('Rules moved to Builder, Checker rules', '#/builder/checker'),
    solutions: () => solutionsTab(solutions, () => api.get('/solutions').then((s) => { solutions = s; show('solutions'); })),
    link: () => linkTab(settings),
    workspaces: () => workspacesTab(spaces),
    builder: () => moved('Brand, visuals and tools are set up in Builder', '#/builder'),
  };
  function show(id) { panel.replaceChildren(views[id]()); }
  // A one-line pointer for what moved to Builder.
  function moved(text, href) {
    return card({ body: el('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } }, [
      el('span', { text }), button({ kind: 'primary', small: true, label: 'Open', href }),
    ]) });
  }
  show(bar.dataset.active);

  async function saveSettings(patch, label = 'Settings saved') {
    try {
      settings = await api.put('/settings/settings', { ...settings, ...patch });
      clearMe();
      toast(label, 'ok');
      return true;
    } catch (err) { toast(err.message, 'bad'); return false; }
  }

  // ------------------------------------------------------------- users
  function usersTab(s) {
    const users = (s.users || []).map((u) => ({ ...u, role: roleOf(u) }));
    const rows = () => table({
      columns: [
        { key: 'name', label: 'Name', render: (u) => input({ value: u.name || '', onInput: (e) => { u.name = e.target.value; } }) },
        { key: 'email', label: 'Email', render: (u) => input({ type: 'email', value: u.email || '', onInput: (e) => { u.email = e.target.value.trim(); } }) },
        { key: 'role', label: 'Role', render: (u) => el('div', { class: 'row', style: { flexWrap: 'nowrap' } }, [
          select({ options: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), value: u.role, 'aria-label': `Role of ${u.name || u.email || 'the new user'}`, onChange: (e) => { u.role = e.target.value; redraw(); } }),
          u.role !== 'employee' && chip({ label: u.pinSet ? 'PIN set' : 'No PIN', tone: u.pinSet ? 'ok' : 'warn' }),
        ]) },
        { key: 'x', label: '', render: (u) => button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: async () => {
          if (!(await confirm({ title: 'Remove this user', message: `Remove ${u.name || u.email} from Studio?`, confirmLabel: 'Remove', danger: true }))) return;
          users.splice(users.indexOf(u), 1); redraw();
        } }) },
      ],
      rows: users, empty: 'No users yet',
    });
    const holder = el('div');
    const redraw = () => holder.replaceChildren(rows());
    redraw();
    const workingAs = select({
      options: (s.users || []).map((u) => ({ value: u.email, label: userLabel(u) })),
      value: api.user.get(),
      onChange: (e) => { api.user.set(e.target.value); api.pin.set(''); toast(`Working as ${e.target.selectedOptions[0]?.text || e.target.value}`, 'ok'); },
    });
    // The PIN of a manager or the director: a stop-gap on a shared Mac until hosting brings sign-in.
    const me = (s.users || []).find((u) => String(u.email).toLowerCase() === String(api.user.get() || '').toLowerCase());
    const pinIn = input({ type: 'password', inputmode: 'numeric', placeholder: '4 to 8 digits', class: 'mono', autocomplete: 'off', 'aria-label': 'New PIN' });
    const pinBox = me && roleOf(me) !== 'employee' ? el('div', {}, [
      el('h3', { text: 'Your PIN', style: { margin: '14px 0 6px' } }),
      bullets(me.pinSet
        ? ['Asked once per browser session', `Guards what only a ${roleOf(me) === 'director' ? 'director' : 'manager'} may do`]
        : ['Anyone at this Mac can act as you', 'Set 4 to 8 digits to stop that'], { compact: true }),
      el('div', { class: 'row' }, [
        pinIn,
        button({ kind: 'secondary', small: true, label: me.pinSet ? 'Change the PIN' : 'Set the PIN', onClick: async () => {
          const v = pinIn.value.trim();
          if (!/^\d{4,8}$/.test(v)) { toast('A PIN is 4 to 8 digits', 'warn'); return; }
          try { await api.post('/settings/pin', { pin: v }); api.pin.set(v); clearMe(); toast('PIN saved', 'ok'); settings = await api.settings(); show('users'); } catch (err) { toast(err.message, 'bad'); }
        } }),
        me.pinSet && button({ kind: 'ghost', small: true, label: 'Clear the PIN', onClick: async () => {
          if (!(await confirm({ title: 'Clear your PIN', message: 'Your actions will no longer ask for a PIN.', confirmLabel: 'Clear', danger: true }))) return;
          try { await api.post('/settings/pin', { pin: '' }); api.pin.set(''); clearMe(); toast('PIN cleared', 'ok'); settings = await api.settings(); show('users'); } catch (err) { toast(err.message, 'bad'); }
        } }),
      ].filter(Boolean)),
    ]) : null;
    const noPin = (s.users || []).filter((u) => roleOf(u) !== 'employee' && !u.pinSet).map((u) => u.name || u.email);
    return card({
      title: 'Users and roles',
      body: [
        bullets([
          'Employee: writes, prepares and submits pieces',
          'Manager: also approves, sends to the director, records posts',
          'Director: also changes settings, users and rules, and deletes',
          'Until sign-in arrives, a PIN stops others acting as you',
        ], { compact: true }),
        noPin.length ? el('div', { class: 'banner banner-warn' }, [el('div', {}, [el('b', { text: 'No PIN: ' }), `${noPin.join(', ')}. Anyone at this Mac can act as them.`])]) : null,
        field({ label: 'Working as', input: workingAs }),
        holder,
        pinBox,
        el('div', { class: 'row', style: { marginTop: '12px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add user', onClick: () => { users.push({ name: '', email: '', role: 'employee' }); redraw(); } })),
      ],
      footer: isDirector ? [button({ kind: 'primary', label: 'Save users', onClick: () => {
        const clean = users.filter((u) => u.email).map((u) => ({ email: u.email, name: u.name || u.email, role: ROLES.includes(u.role) ? u.role : 'employee' }));
        if (!clean.some((u) => u.role === 'director')) { toast('At least one director is required', 'warn'); return; }
        saveSettings({ users: clean }, 'Users saved').then((ok) => { if (!ok) return; show('users'); window.dispatchEvent(new CustomEvent('studio:users')); });
      } })] : undefined,
    });
  }

  // ---------------------------------------------------- review routing
  // Which pieces must reach the director (docs/ROLES.md section 2). The director edits; others read.
  function routingTab(s) {
    const r = routingOf(s);
    const types = new Set(r.directorTypes);
    const pillars = new Set(r.directorPillars);
    let onWarnings = r.directorOnWarnings;
    const boxes = (items, set) => el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px 16px' } }, items.map((t) => checkbox({
      label: t.label, checked: set.has(t.value), disabled: !isDirector,
      onChange: (e) => { if (e.target.checked) set.add(t.value); else set.delete(t.value); },
    })));
    return card({
      title: 'Review routing',
      body: [
        bullets(['A manager approves most pieces', 'Ticked types and pillars must reach the director', 'A manager may send any piece on by choice'], { compact: true }),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Piece types that go to the director' }), boxes(TYPES, types)]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Pillars that go to the director' }), boxes(PILLARS, pillars)]),
        el('div', { class: 'field' }, [
          switchInput({ label: 'Any checker warning sends the piece to the director', checked: onWarnings, disabled: !isDirector, onChange: (e) => { onWarnings = e.target.checked; } }),
          el('span', { class: 'field-hint', text: 'Off: the manager weighs warnings. Blocks always stop approval.' }),
        ]),
      ],
      footer: isDirector ? [button({ kind: 'primary', label: 'Save the routing', onClick: () => saveSettings({
        reviewRouting: { directorTypes: TYPES.map((t) => t.value).filter((v) => types.has(v)), directorPillars: PILLARS.map((p) => p.value).filter((v) => pillars.has(v)), directorOnWarnings: Boolean(onWarnings) },
      }, 'Review routing saved') })] : undefined,
    });
  }

  // ---------------------------------------------------------------- AI
  function aiTab(s) {
    const model = select({ options: [{ value: 'sonnet', label: 'Sonnet (default)' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }], value: ['sonnet', 'opus', 'haiku'].includes(s.model) ? s.model : 'sonnet' });
    const customModel = input({ value: ['sonnet', 'opus', 'haiku'].includes(s.model) ? '' : (s.model || ''), placeholder: 'Or a full model id', class: 'mono' });
    const mode = select({ options: [{ value: 'cli', label: 'Claude Code command line (subscription)' }, { value: 'api', label: 'Claude API (ANTHROPIC_API_KEY on the server)' }], value: s.aiMode || 'cli' });
    const image = select({ options: [{ value: 'none', label: 'None (brand cards only)' }, { value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'OpenAI' }], value: s.imageProvider || 'none' });
    const imageModel = input({ value: s.imageModel || '', class: 'mono', placeholder: 'Provider default' });
    const prefix = textarea({ value: s.illustrationPrefix || '', rows: 3, placeholder: 'House default' });
    // Empty uses the house default; a dry run returns the prefix in force, which is the default when none is set.
    if (!s.illustrationPrefix) api.post('/images/illustration', { prompt: 'a desk', dryRun: true }).then((r) => { if (r?.prefix) prefix.placeholder = r.prefix; }).catch(() => {});
    const runnerWait = input({ type: 'number', min: 0, step: 30, value: Math.round((Number(s.runnerWaitMs) || 0) / 1000), class: 'mono' });
    const pingOut = el('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '10px 0 0', color: 'var(--text-secondary)' } });
    return card({
      title: 'AI',
      body: [
        el('div', { class: 'form-grid' }, [
          field({ label: 'Model', input: model, hint: 'Sonnet drafts. Opus for the review pass.' }),
          field({ label: 'Model id (optional)', input: customModel, hint: 'Overrides the model when filled.' }),
          field({ label: 'How Claude is called', input: mode, hint: 'The API needs a key on the server.' }),
          field({ label: 'Wait for a runner (seconds)', input: runnerWait, hint: '0 is off. A person may answer meanwhile.' }),
          field({ label: 'Image provider', input: image, hint: 'Brand cards need no provider.' }),
          field({ label: 'Image model', input: imageModel, hint: 'Empty uses the provider default.' }),
        ]),
        field({ label: 'House style for illustrations', input: prefix, hint: 'Put before every illustration prompt. Empty uses the default.' }),
        el('hr', { class: 'rule' }),
        el('h3', { text: 'How the tool runs', style: { marginBottom: '6px' } }),
        bullets([
          'Website: AI uses the API key in Vercel',
          'Mac: AI uses the Claude Code sign-in; run claude, then /login',
          'If AI fails, everything else keeps working',
          'A stale save is refused; every save stays in versions',
          'Every change and AI call is logged with who and when',
        ], { compact: true }),
        el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } }, [
          button({ kind: 'secondary', label: 'Test the bridge', icon: 'sparkle', onClick: async (e) => {
            e.target.closest('button').disabled = true;
            pingOut.textContent = 'Calling Claude';
            try {
              const r = await api.ai('ping', { text: 'Run the business. Not the follow-ups.' });
              pingOut.textContent = `${r.mode} · ${r.model} · ${r.ms} ms\n${JSON.stringify(r.output, null, 2)}`;
              toast('The AI bridge answered', 'ok');
            } catch (err) {
              pingOut.textContent = `${err.message}${err.detail ? `\n${JSON.stringify(err.detail, null, 2).slice(0, 1200)}` : ''}`;
              toast('The AI bridge did not answer', 'bad');
            } finally { e.target.closest('button').disabled = false; }
          } }),
          el('span', { class: 'note', text: 'Runs ping with the saved settings.' }),
        ]),
        pingOut,
      ],
      footer: isDirector ? [button({ kind: 'primary', label: 'Save AI settings', onClick: () => saveSettings({
        model: customModel.value.trim() || model.value, aiMode: mode.value, imageProvider: image.value, runnerWaitMs: Math.max(0, parseInt(runnerWait.value, 10) || 0) * 1000,
        imageModel: imageModel.value.trim() || undefined, illustrationPrefix: prefix.value.trim() || undefined,
      }, 'AI settings saved') })] : undefined,
    });
  }

  // --------------------------------------------------------------- link
  function linkTab(s) {
    const token = String(s.linkToken || '');
    const tokenField = input({ value: token, readOnly: true, class: 'mono', 'aria-label': 'Link token' });
    const origin = location.origin;
    const copyBtn = button({ kind: 'secondary', label: 'Copy token', onClick: async () => {
      try { await navigator.clipboard.writeText(token); toast('Token copied', 'ok'); }
      catch { tokenField.select(); toast('Select the token and copy it', 'warn'); }
    } });
    return card({
      title: 'Link to the Network tool',
      body: [
        bullets(['Network reads the calendar and published pieces', 'Two read-only routes; Studio never calls Network', 'Enter this token in Network as the Studio token'], { compact: true }),
        field({ label: 'Link token', input: tokenField, hint: token ? 'Sent by Network as X-Link-Token.' : 'Shown to the director only. None set: add linkToken to data/settings.json.' }),
        token ? el('div', { class: 'row' }, [copyBtn]) : null,
        el('hr', { class: 'rule' }),
        el('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, color: 'var(--text-secondary)' }, text: `GET ${origin}/api/link/events?from=YYYY-MM-DD&to=YYYY-MM-DD\nGET ${origin}/api/link/pieces?status=published` }),
      ],
    });
  }

  // --------------------------------------------------------- workspaces
  // Owners create a workspace for each company and pause or archive it (docs/WORKSPACES.md).
  function workspacesTab(info) {
    const list = info?.workspaces || [];
    const reload = async (label) => {
      try { spaces = await api.workspaces(); toast(label, 'ok'); show('workspaces'); } catch (err) { toast(err.message, 'bad'); }
    };
    const STATUS_LABEL = { active: 'Active', paused: 'Paused', archived: 'Archived' };
    const rows = table({
      columns: [
        { key: 'name', label: 'Company' },
        { key: 'id', label: 'Id', render: (w) => el('span', { class: 'mono', text: w.id }) },
        { key: 'role', label: 'Your role', render: (w) => (w.role === 'owner' ? 'Owner' : ROLE_LABEL[w.role] || '') },
        { key: 'status', label: 'Status', render: (w) => select({
          options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          value: w.status,
          'aria-label': `Status of ${w.name}`,
          onChange: async (e) => {
            try { await api.patch(`/workspaces/${w.id}`, { status: e.target.value }); await reload(`${w.name} is now ${STATUS_LABEL[e.target.value].toLowerCase()}`); }
            catch (err) { toast(err.message, 'bad'); e.target.value = w.status; }
          },
        }) },
        { key: 'createdAt', label: 'Created', render: (w) => el('span', { class: 'mono', text: String(w.createdAt || '').slice(0, 10) }) },
      ],
      rows: list,
      empty: 'No workspaces yet',
    });
    const name = input({ placeholder: 'Company name', 'aria-label': 'Company name' });
    const dirName = input({ placeholder: 'Director\'s name', 'aria-label': 'Director\'s name' });
    const dirEmail = input({ type: 'email', placeholder: 'Director\'s email', 'aria-label': 'Director\'s email' });
    const create = button({ kind: 'primary', label: 'Create workspace', onClick: async () => {
      const body = { name: name.value.trim(), director: { name: dirName.value.trim(), email: dirEmail.value.trim() } };
      if (!body.name || !body.director.email) { toast('A company name and the director\'s email are required', 'warn'); return; }
      try { const ws = await api.post('/workspaces', body); await reload(`${ws.name} created`); }
      catch (err) { toast(err.message, 'bad'); }
    } });
    return el('div', {}, [
      card({
        title: 'Workspaces',
        body: [
          bullets(['One workspace per company, with its own content and users', 'Enter any from the left panel; you work as its director', 'Paused or archived: closed to its members'], { compact: true }),
          rows,
        ],
      }),
      card({
        title: 'New workspace',
        body: [
          bullets(['Starts empty, with its director as the only user', 'Profile, channels and calendar come next'], { compact: true }),
          field({ label: 'Company name', input: name }),
          field({ label: 'Director\'s name', input: dirName }),
          field({ label: 'Director\'s email', input: dirEmail }),
        ],
        footer: [create],
      }),
    ]);
  }

  // ----------------------------------------------------------- accounts
  function accountsTab(list) {
    const dayLine = (a) => [
      ...(a.weekly || []).map((w) => `${w.day} ${w.time || w.timeNote || ''} ${w.kind}${w.optional ? ' (optional)' : ''}${w.alternate ? ' (alternate)' : ''}${w.derived ? ' (derived)' : ''}`),
      ...(a.monthly || []).map((m) => `${m.rule} ${m.time || m.timeNote || ''} ${m.kind}${m.derived ? ' (derived)' : ''}`),
    ].join('; ');
    return card({
      title: 'Accounts',
      body: [
        bullets(['Read-only here', 'Days and posting slots: Builder, Posting rhythm'], { compact: true }),
        table({
          columns: [
            { key: 'short', label: 'Short', mono: true },
            { key: 'label', label: 'Account' },
            { key: 'group', label: 'Group' },
            { key: 'platform', label: 'Platform' },
            { key: 'days', label: 'Allotted', render: (a) => el('span', { class: 'small', text: dayLine(a) || '—' }) },
            { key: 'limits', label: 'Limits', render: (a) => el('span', { class: 'small mono', text: `${a.limits?.textMax ?? ''} chars · ${a.limits?.hashtagsMax ?? 0} tags ${a.limits?.hashtagsWhere || ''}` }) },
            { key: 'repurposeTo', label: 'Repurposed to', render: (a) => el('div', { class: 'chips' }, (a.repurposeTo || []).map((r) => chip({ label: `${r.accountId}${r.when?.kind ? ` (${r.when.kind})` : ''}`, tone: 'muted' }))) },
          ],
          rows: list, empty: 'No accounts',
        }),
      ],
    });
  }

  // ---------------------------------------------------------- solutions
  function solutionsTab(list, reload) {
    const rows = list.map((s) => ({ ...s, _removes: (s.removes || []).join('\n') }));
    const saveRow = async (s) => {
      const { _removes, _new, ...rest } = s;
      const body = { ...rest, removes: linesToList(_removes) };
      if (!body.publicName?.trim()) { toast('A public name is required', 'warn'); return; }
      try {
        if (_new) { body.id = body.id?.trim() || body.publicName.trim().toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); await api.post('/solutions', body); }
        else await api.put(`/solutions/${encodeURIComponent(body.id)}`, body);
        toast('Solution saved', 'ok'); reload();
      } catch (err) { toast(err.message, 'bad'); }
    };
    const holder = el('div');
    const draw = () => holder.replaceChildren(table({
      columns: [
        { key: 'id', label: 'Id', width: '150px', render: (s) => s._new ? input({ value: s.id || '', class: 'mono', placeholder: 'auto', onInput: (e) => { s.id = e.target.value; } }) : el('span', { class: 'mono small', text: s.id }) },
        { key: 'publicName', label: 'Public name', render: (s) => input({ value: s.publicName || '', onInput: (e) => { s.publicName = e.target.value; } }) },
        { key: 'oneLine', label: 'One line', render: (s) => textarea({ value: s.oneLine || '', rows: 2, onInput: (e) => { s.oneLine = e.target.value; } }) },
        { key: '_removes', label: 'The problem it removes (one per line)', render: (s) => textarea({ value: s._removes || '', rows: 2, onInput: (e) => { s._removes = e.target.value; } }) },
        { key: 'confirm', label: '', width: '70px', render: (s) => s.confirm ? chip({ label: 'confirm', tone: 'warn' }) : '' },
        { key: 'x', label: '', width: '96px', render: (s) => el('div', { class: 'row', style: { flexWrap: 'nowrap' } }, [
          button({ kind: 'ghost', small: true, icon: 'check', title: 'Save', onClick: () => saveRow(s) }),
          (s._new || isDirector) && button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: async () => {
            if (s._new) { rows.splice(rows.indexOf(s), 1); draw(); return; }
            if (!(await confirm({ title: 'Remove this solution', message: `Remove ${s.publicName} from the register?`, confirmLabel: 'Remove', danger: true }))) return;
            try { await api.del(`/solutions/${encodeURIComponent(s.id)}`); toast('Solution removed', 'ok'); reload(); } catch (err) { toast(err.message, 'bad'); }
          } }),
        ]) },
      ],
      rows, empty: 'No solutions',
    }));
    draw();
    return card({
      title: 'Solutions',
      body: [
        bullets(['The only solution names the AI may use', 'Never an internal, course, client or staff name', 'Confirm: not yet confirmed as built'], { compact: true }),
        holder,
        el('div', { style: { marginTop: '10px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add solution', onClick: () => { rows.push({ _new: true, id: '', publicName: '', oneLine: '', _removes: '' }); draw(); } })),
      ],
    });
  }
}
