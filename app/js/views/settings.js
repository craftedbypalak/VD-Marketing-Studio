// Settings: users, AI, posting rules, accounts (read-only), the rules
// document and the solutions register. [core]

import { api } from '../api.js';
import { el, card, field, input, textarea, select, switchInput, checkbox, button, table, tabs, toast, confirm, chip, statusPill } from '../ui.js';
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
const listToLines = (arr) => (arr || []).join('\n');

export async function render(container, params) {
  let settings, rules, accounts, solutions, spaces;
  try {
    [settings, rules, accounts, solutions, spaces] = await Promise.all([api.settings(), api.rules(), api.get('/accounts'), api.get('/solutions'), api.workspaces().catch(() => null)]);
  } catch (err) {
    container.appendChild(el('div', { class: 'banner banner-bad', text: `Could not load settings: ${err.message}` }));
    return;
  }

  const me = (api.user.get() || '').toLowerCase();
  // Only the director changes settings, users, rules and the review routing (docs/ROLES.md section 3).
  // An owner who is not a member works here as the director: the server's answer decides (docs/ROLES.md section 1).
  const isDirector = Boolean(me) && ((await whoAmI()).role === 'director');
  if (!isDirector) container.appendChild(el('div', { class: 'banner banner-info' }, [el('div', { text: 'Settings are read-only for you. Users, the review routing, AI, posting, rules and solutions are changed by the director; the Link tab shows its token to the director only.' })]));
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
    posting: () => postingTab(settings),
    accounts: () => accountsTab(accounts),
    rules: () => rulesTab(rules),
    solutions: () => solutionsTab(solutions, () => api.get('/solutions').then((s) => { solutions = s; show('solutions'); })),
    link: () => linkTab(settings),
    workspaces: () => workspacesTab(spaces),
    builder: () => el('div', { class: 'card', style: { padding: '18px' } }, [el('p', { text: 'Brand on visuals and the tools are set up in Builder.' }), button({ kind: 'primary', label: 'Open Builder', href: '#/builder' })]),
  };
  function show(id) { panel.replaceChildren(views[id]()); }
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
          if (!(await confirm({ title: 'Remove this user', message: `${u.name || u.email} will no longer be able to work in Studio.`, confirmLabel: 'Remove', danger: true }))) return;
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
      el('p', { class: 'note', text: me.pinSet
        ? `A PIN is set for you. It is asked for once per browser session before the first action reserved for the ${roleOf(me) === 'director' ? 'director' : 'manager'}: an approval, a request for changes, sending a piece on${roleOf(me) === 'director' ? ', a change to settings or rules, a delete' : ''}, a slot regeneration or an import.`
        : `No PIN is set. Anyone at this Mac can pick your name in the left panel and act as the ${roleOf(me) === 'director' ? 'director' : 'manager'}. Set a PIN of 4 to 8 digits to require it for the actions reserved for your role.` }),
      el('div', { class: 'row' }, [
        pinIn,
        button({ kind: 'secondary', small: true, label: me.pinSet ? 'Change the PIN' : 'Set the PIN', onClick: async () => {
          const v = pinIn.value.trim();
          if (!/^\d{4,8}$/.test(v)) { toast('A PIN is 4 to 8 digits', 'warn'); return; }
          try { await api.post('/settings/pin', { pin: v }); api.pin.set(v); clearMe(); toast('PIN saved', 'ok'); settings = await api.settings(); show('users'); } catch (err) { toast(err.message, 'bad'); }
        } }),
        me.pinSet && button({ kind: 'ghost', small: true, label: 'Clear the PIN', onClick: async () => {
          if (!(await confirm({ title: 'Clear your PIN', message: 'The actions reserved for your role will no longer ask for a PIN on this Mac.', confirmLabel: 'Clear', danger: true }))) return;
          try { await api.post('/settings/pin', { pin: '' }); api.pin.set(''); clearMe(); toast('PIN cleared', 'ok'); settings = await api.settings(); show('users'); } catch (err) { toast(err.message, 'bad'); }
        } }),
      ].filter(Boolean)),
    ]) : null;
    const noPin = (s.users || []).filter((u) => roleOf(u) !== 'employee' && !u.pinSet).map((u) => u.name || u.email);
    return card({
      title: 'Users and roles',
      body: [
        el('p', { class: 'note', text: 'An employee writes, prepares and places pieces and submits them for review. A manager also approves, requests changes, sends a piece to the director, records posts, regenerates slots and imports. The director also approves the pieces that must reach the director and changes settings, users, rules and the review routing, and deletes. Until hosting brings sign-in, the user is chosen here (or in the left panel) and sent with every request; the PIN of a manager or the director is what stops anyone else acting in their name.' }),
        noPin.length ? el('div', { class: 'banner banner-warn' }, [el('div', {}, [el('b', { text: 'No PIN: ' }), `${noPin.join(', ')} can be chosen by anyone at this Mac. Set a PIN below.`])]) : null,
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
        el('p', { class: 'note', text: 'A manager approves most pieces. A piece of a type or on a pillar ticked here must reach the director: the manager sees why and sends it on with a note. A manager may send any other piece to the director too, by choice.' }),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Piece types that go to the director' }), boxes(TYPES, types)]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Pillars that go to the director' }), boxes(PILLARS, pillars)]),
        el('div', { class: 'field' }, [
          switchInput({ label: 'Any checker warning sends the piece to the director', checked: onWarnings, disabled: !isDirector, onChange: (e) => { onWarnings = e.target.checked; } }),
          el('span', { class: 'field-hint', text: 'Off: warnings are for the manager to weigh. Blocks always stop approval, whoever approves.' }),
        ]),
        !isDirector ? el('p', { class: 'note', text: 'Read-only for you. The director changes the routing.' }) : null,
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
    const runnerWait = input({ type: 'number', min: 0, step: 30, value: Math.round((Number(s.runnerWaitMs) || 0) / 1000), class: 'mono' });
    const pingOut = el('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', margin: '10px 0 0', color: 'var(--text-secondary)' } });
    return card({
      title: 'AI',
      body: [
        el('div', { class: 'form-grid' }, [
          field({ label: 'Model', input: model, hint: 'Sonnet for drafting. Opus for the review pass when quality matters more than time.' }),
          field({ label: 'Model id (optional)', input: customModel, hint: 'Overrides the choice above when filled.' }),
          field({ label: 'How Claude is called', input: mode, hint: 'The command line runs on the founder\'s subscription. The API needs a key on the server.' }),
          field({ label: 'Image provider', input: image, hint: 'For house-style illustrations. Brand cards need no provider.' }),
          field({ label: 'Wait for a runner (seconds)', input: runnerWait, hint: '0 means off. Above 0, when the command line is signed out, an AI request waits this long for a person or a process to answer it under /api/ai/pending, and the answer is marked as written by hand.' }),
        ]),
        el('hr', { class: 'rule' }),
        el('h3', { text: 'How the tool runs', style: { marginBottom: '6px' } }),
        el('ul', { class: 'rc-rules', style: { margin: '0 0 12px', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)' } }, [
          'Studio runs in two places: on the website (Vercel) and on a Mac at localhost:4747. On the website, changes are kept only until the server restarts until Google Sheets is connected; on a Mac they are saved to the files in data/.',
          'On the website the AI steps use the Claude API key set in the Vercel project. On a Mac they run through the Claude Code sign-in; when it expires, run claude and /login in a terminal. Either way, if AI fails everything else keeps working.',
          'Two people may work at once. A save made from a copy that someone else has changed meanwhile is refused with their name and time; the editor then offers Reload or Save anyway, and every save stays in the versions list.',
          'Every change and every AI call is written to data/log.json with who and when. The Today strip on the calendar shows the month\'s counts from it.',
        ].map((t) => el('li', { text: t }))),
        el('div', { class: 'row' }, [
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
          el('span', { class: 'note', text: 'Runs the ping operation with the current settings.' }),
        ]),
        pingOut,
      ],
      footer: isDirector ? [button({ kind: 'primary', label: 'Save AI settings', onClick: () => saveSettings({
        model: customModel.value.trim() || model.value, aiMode: mode.value, imageProvider: image.value, runnerWaitMs: Math.max(0, parseInt(runnerWait.value, 10) || 0) * 1000,
      }, 'AI settings saved') })] : undefined,
    });
  }

  // ------------------------------------------------------------ posting
  function postingTab(s) {
    const goDark = { on: false, from: '', to: '', reason: '', ...(s.goDark || {}) };
    const onSwitch = switchInput({ label: 'Go dark: pause every scheduled post', checked: goDark.on, onChange: (e) => { goDark.on = e.target.checked; } });
    const from = input({ type: 'date', value: goDark.from || '', onInput: (e) => { goDark.from = e.target.value; } });
    const to = input({ type: 'date', value: goDark.to || '', onInput: (e) => { goDark.to = e.target.value; } });
    const reason = input({ value: goDark.reason || '', placeholder: 'Mourning, budget day, a news day', onInput: (e) => { goDark.reason = e.target.value; } });
    const tz = input({ value: s.timezone || 'Asia/Kolkata' });
    return card({
      title: 'Posting',
      body: [
        el('div', { class: 'banner banner-info' }, [el('div', {}, [el('b', { text: 'The mourning rule. ' }), 'On the day a national figure dies or a mass-casualty event occurs, pause every scheduled post within the hour and stay dark through the funeral day. Switch go dark on here; the calendar shows it.'])]),
        el('div', { class: 'field' }, onSwitch),
        el('div', { class: 'form-grid' }, [
          field({ label: 'Dark from', input: from }),
          field({ label: 'Dark to', input: to }),
          field({ label: 'Reason', input: reason }),
        ]),
        el('hr', { class: 'rule' }),
        el('div', { class: 'form-grid' }, [
          field({ label: 'Timezone', input: tz }),
        ]),
      ],
      footer: isDirector ? [button({ kind: 'primary', label: 'Save posting settings', onClick: () => saveSettings({
        goDark: { on: goDark.on, from: from.value, to: to.value, reason: reason.value },
        timezone: tz.value.trim() || 'Asia/Kolkata',
      }, 'Posting settings saved') })] : undefined,
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
        el('p', { class: 'note', text: 'The separate Network tool reads the calendar and the published pieces from Studio over two read-only routes. Enter this token in Network\'s settings as the Studio token. Nothing about a person ever enters Studio, and Studio never calls Network.' }),
        field({ label: 'Link token', input: tokenField, hint: token ? 'Read-only. Sent by Network as the X-Link-Token header on every request.' : 'Shown to the director only. Work as the director to see it; if none is set, add linkToken to data/settings.json and restart the server.' }),
        token ? el('div', { class: 'row' }, [copyBtn]) : null,
        el('hr', { class: 'rule' }),
        el('p', { class: 'note', text: 'The two routes:' }),
        el('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-secondary)' }, text: `GET ${origin}/api/link/events?from=YYYY-MM-DD&to=YYYY-MM-DD\nGET ${origin}/api/link/pieces?status=published` }),
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
          el('p', { class: 'note', text: 'Each workspace is one company, with its own content, calendar, rules, users and roles. Its director manages its users. As an owner you may enter any workspace from the switcher in the left panel, and you work there as its director. A paused or archived workspace is closed to its members.' }),
          rows,
        ],
      }),
      card({
        title: 'New workspace',
        body: [
          el('p', { class: 'note', text: 'The new workspace starts empty, with its director as the only user. Its company profile, channels and calendar are added next.' }),
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
        el('p', { class: 'note', text: 'Read-only. Accounts, their allotted days and the repurposing rules are seeded from channels.json and edited there, then re-imported.' }),
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

  // -------------------------------------------------------------- rules
  function rulesTab(r) {
    const draft = JSON.parse(JSON.stringify(r));
    const voice = textarea({ value: listToLines(draft.voice), rows: 8 });
    const say = textarea({ value: listToLines(draft.say), rows: 8 });
    const courseTerms = textarea({ value: listToLines(draft.courseTerms), rows: 5 });
    const allowNames = textarea({ value: listToLines(draft.allowNames), rows: 6 });
    const claimsOk = textarea({ value: listToLines(draft.claimsOk), rows: 8 });
    const claimsBlocked = textarea({ value: listToLines(draft.claimsBlocked), rows: 6 });
    const frame = textarea({ value: draft.frame || '', rows: 5 });
    const limits = { hookWords: 8, igHashtags: 5, liHashtagsBottom: 3, liHookChars: 210, exclamation: 0, emoji: 0, ...(draft.limits || {}) };
    const limitInputs = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, input({ type: 'number', min: 0, value: v, class: 'mono' })]));

    // The never list: phrase, scope, note.
    const never = (draft.never || []).map((n) => ({ ...n }));
    const neverHolder = el('div');
    const drawNever = () => neverHolder.replaceChildren(table({
      columns: [
        { key: 'phrase', label: 'Phrase', render: (n) => input({ value: n.phrase || '', onInput: (e) => { n.phrase = e.target.value; } }) },
        { key: 'scope', label: 'Scope', width: '140px', render: (n) => select({ options: [{ value: 'any', label: 'Anywhere' }, { value: 'headline', label: 'Headline only' }, { value: 'ourVoice', label: 'Our voice' }], value: n.scope || 'any', onChange: (e) => { n.scope = e.target.value; } }) },
        { key: 'note', label: 'Note', render: (n) => input({ value: n.note || '', onInput: (e) => { n.note = e.target.value; } }) },
        { key: 'x', label: '', width: '44px', render: (n) => button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => { never.splice(never.indexOf(n), 1); drawNever(); } }) },
      ],
      rows: never, empty: 'No phrases',
    }));
    drawNever();

    const checklist = (draft.checklist || []).map((c) => ({ ...c }));
    const checkHolder = el('div');
    const drawCheck = () => checkHolder.replaceChildren(table({
      columns: [
        { key: 'id', label: 'Id', width: '160px', render: (c) => input({ value: c.id || '', class: 'mono', onInput: (e) => { c.id = e.target.value; } }) },
        { key: 'text', label: 'Check', render: (c) => input({ value: c.text || '', onInput: (e) => { c.text = e.target.value; } }) },
        { key: 'auto', label: 'Automatic', width: '90px', render: (c) => switchInput({ checked: Boolean(c.auto), onChange: (e) => { c.auto = e.target.checked; } }) },
        { key: 'x', label: '', width: '44px', render: (c) => button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => { checklist.splice(checklist.indexOf(c), 1); drawCheck(); } }) },
      ],
      rows: checklist, empty: 'No checks',
    }));
    drawCheck();

    const save = async () => {
      const next = {
        ...draft,
        voice: linesToList(voice.value), say: linesToList(say.value), courseTerms: linesToList(courseTerms.value),
        allowNames: linesToList(allowNames.value), claimsOk: linesToList(claimsOk.value), claimsBlocked: linesToList(claimsBlocked.value),
        never: never.filter((n) => n.phrase?.trim()).map((n) => ({ phrase: n.phrase.trim(), scope: n.scope || 'any', note: n.note || '' })),
        checklist: checklist.filter((c) => c.text?.trim()).map((c) => ({ id: (c.id || c.text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), text: c.text.trim(), auto: Boolean(c.auto) })),
        limits: Object.fromEntries(Object.entries(limitInputs).map(([k, i]) => [k, parseInt(i.value, 10) || 0])),
        frame: frame.value.trim(),
      };
      try { rules = await api.put('/rules/rules', next); toast('Rules saved', 'ok'); }
      catch (err) { toast(err.message, 'bad'); }
    };

    const lines = (label, ta, hint) => el('div', { class: 'lines-editor' }, field({ label, input: ta, hint: hint || 'One per line.' }));
    return el('div', {}, [
      el('div', { class: 'banner banner-info' }, [el('div', {}, [el('b', { text: 'The brief is data. ' }), 'The checker and every AI prompt read these lists. A change here is a change everywhere; the brief itself (00-brief.md) still wins if they disagree.'])]),
      card({ title: 'The frame', body: field({ label: 'Storyline paragraph given to the AI', input: frame }) }),
      card({ title: 'Voice and words', body: el('div', { class: 'grid-2' }, [lines('Voice', voice), lines('Say', say)]) }),
      card({ title: 'Never say', body: [el('p', { class: 'note', text: 'Anywhere: blocked in every public field. Headline only: blocked in the hook, the first line of a LinkedIn post, slide 1 and the YouTube title. Our voice: a warning when found outside a quoted owner line.' }), neverHolder, el('div', { style: { marginTop: '10px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add phrase', onClick: () => { never.push({ phrase: '', scope: 'any', note: '' }); drawNever(); } }))] }),
      card({ title: 'Course terms and names', body: el('div', { class: 'grid-2' }, [lines('Course terms (always blocked)', courseTerms), lines('Names the brief permits', allowNames)]) }),
      card({ title: 'Claims', body: el('div', { class: 'grid-2' }, [lines('Claims we can make', claimsOk), lines('Claims we cannot make', claimsBlocked)]) }),
      card({ title: 'Limits', body: el('div', { class: 'form-grid' }, [
        field({ label: 'Hook, words at most', input: limitInputs.hookWords }),
        field({ label: 'Instagram hashtags at most', input: limitInputs.igHashtags }),
        field({ label: 'LinkedIn hashtags at the bottom at most', input: limitInputs.liHashtagsBottom }),
        field({ label: 'LinkedIn characters before the cut', input: limitInputs.liHookChars }),
        field({ label: 'Exclamation marks allowed', input: limitInputs.exclamation }),
        field({ label: 'Emoji allowed', input: limitInputs.emoji }),
        ...Object.keys(limitInputs).filter((k) => !['hookWords', 'igHashtags', 'liHashtagsBottom', 'liHookChars', 'exclamation', 'emoji'].includes(k)).map((k) => field({ label: k, input: limitInputs[k] })),
      ]) }),
      card({ title: 'Before a post goes up', body: [checkHolder, el('div', { style: { marginTop: '10px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add check', onClick: () => { checklist.push({ id: '', text: '', auto: false }); drawCheck(); } }))] }),
      card({ title: 'Examples by type', body: [el('p', { class: 'note', text: 'Signed-off copy the AI is shown for each piece type. Edited from the piece editor when a piece is approved; listed here for reference.' }),
        table({ columns: [{ key: 'type', label: 'Type', mono: true }, { key: 'n', label: 'Examples', num: true }], rows: Object.entries(draft.examplesByType || {}).map(([type, arr]) => ({ id: type, type, n: (arr || []).length })) })] }),
      isDirector && el('div', { class: 'card-foot', style: { borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' } }, button({ kind: 'primary', label: 'Save rules', onClick: save })),
    ]);
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
            if (!(await confirm({ title: 'Remove this solution', message: `${s.publicName} will no longer be offered to the AI as an allowed solution name.`, confirmLabel: 'Remove', danger: true }))) return;
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
        el('p', { class: 'note', text: 'The public-safe register: the only solution names the AI may use. Never an internal or course name, never a client, lender or staff name. Rows marked confirm are not yet confirmed as built.' }),
        holder,
        el('div', { style: { marginTop: '10px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add solution', onClick: () => { rows.push({ _new: true, id: '', publicName: '', oneLine: '', _removes: '' }); draw(); } })),
      ],
    });
  }
}
