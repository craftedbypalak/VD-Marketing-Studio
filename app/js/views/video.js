// Video: YouTube case studies from outline to hand-off. [video]
//
//   #/video        the projects list
//   #/video/:id    one project, as a stepper:
//                  Outline, Script, Scenes, Footage, Voice, Own clips, Edit, Shorts, Done
//
// The server side is server/video.mjs. Every AI step can fail with a 502 when the
// Claude command line is not signed in; the view then says what to run.

import { api } from '../api.js';
import {
  el, button, input, textarea, select, field, card, chip, statusPill, table, dialog, toast, empty, icon, fmt, switchInput,
} from '../ui.js';

export const route = ['#/video', '#/video/:id'];
export const title = (params) => (params && params.id ? 'Video project' : 'Video');

// ------------------------------------------------------------------ constants

const WPM = 140;
const STATUS_ORDER = ['outline', 'script', 'scenes', 'footage', 'voice', 'own-clips', 'edit', 'done'];
const STEP_ITEMS = [
  { id: 'outline', label: 'Outline', status: 'outline' },
  { id: 'script', label: 'Script', status: 'script' },
  { id: 'scenes', label: 'Scenes', status: 'scenes' },
  { id: 'footage', label: 'Footage', status: 'footage' },
  { id: 'voice', label: 'Voice', status: 'voice' },
  { id: 'own-clips', label: 'Own clips', status: 'own-clips' },
  { id: 'edit', label: 'Edit', status: 'edit' },
  { id: 'shorts', label: 'Shorts', status: null },
  { id: 'done', label: 'Done', status: 'done' },
];
const FACE_CHAPTERS = [1, 5, 6];
const MAX_UPLOAD_MB = 60;
const LOGIN_HINT = 'Run claude and /login in a terminal';
const KIND_LABEL = { broll: 'B-roll', screen: 'Screen', face: 'Face', card: 'Card' };

// ------------------------------------------------------------------ helpers

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const words = (s) => (String(s || '').match(/\S+/g) || []).length;
const normWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
};
const mb = (bytes) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;
const stepIndex = (status) => Math.max(0, STATUS_ORDER.indexOf(status));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

function parseScript(script) {
  const text = String(script || '').replace(/\r\n/g, '\n');
  const re = /^##\s+(\d+)\.\s*(.*)$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ n: parseInt(m[1], 10), title: m[2].trim(), at: m.index, end: m.index + m[0].length });
  if (!marks.length) return text.trim() ? [{ n: 1, title: '', text: text.trim() }] : [];
  return marks.map((mk, i) => ({ n: mk.n, title: mk.title, text: text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim() }));
}
function joinScript(chapters) {
  return chapters.filter((c) => c.text && c.text.trim()).sort((a, b) => a.n - b.n)
    .map((c) => `## ${c.n}. ${c.title || ''}`.trimEnd() + `\n\n${c.text.trim()}`).join('\n\n') + '\n';
}

/**
 * A confirmation dialog. ui.confirm resolves false when its Confirm button is
 * pressed (dialog.close runs onClose, which resolves false first), so this
 * view records the answer before it closes the dialog.
 */
function confirm({ title = 'Please confirm', message, confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    let d;
    const answer = (value) => { if (!answered) { answered = true; resolve(value); } d.close(); };
    d = dialog({
      title,
      body: el('p', { text: message || '' }),
      actions: [
        button({ kind: 'secondary', label: 'Cancel', onClick: () => answer(false) }),
        button({ kind: danger ? 'danger' : 'primary', label: confirmLabel, onClick: () => answer(true) }),
      ],
      onClose: () => { if (!answered) { answered = true; resolve(false); } },
    });
  });
}

async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label, 'ok'); }
  catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(label, 'ok'); } catch { toast('Copying failed. Select the text and copy it by hand.', 'warn'); }
    ta.remove();
  }
}

/** A dark block of text with a copy button above it. */
function codeBlock(text, { title: heading, light = false, label = 'Copy' } = {}) {
  return el('div', {}, [
    el('div', { class: 'vid-copyrow' }, [
      heading ? el('h3', { text: heading }) : el('span'),
      button({ kind: 'secondary', small: true, label, onClick: () => copyText(text, 'Copied to the clipboard') }),
    ]),
    el('pre', { class: `vid-pre${light ? ' vid-pre-light' : ''}`, text }),
  ]);
}

function counter(inputEl, max, { words: byWords = false } = {}) {
  const c = el('span', { class: 'vid-count' });
  const update = () => {
    const n = byWords ? words(inputEl.value) : inputEl.value.length;
    c.textContent = `${n} / ${max}${byWords ? ' words' : ''}`;
    c.classList.toggle('over', n > max);
  };
  inputEl.addEventListener('input', update);
  update();
  return c;
}

function warnList(items) {
  if (!items || !items.length) return null;
  return el('ul', { class: 'vid-warns' }, items.map((w) => el('li', { text: w })));
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}

/** Buttons for the top bar. window.studio is not set yet on the very first render, so fall back to the app module. */
function setTopActions(nodes) {
  if (window.studio?.setActions) window.studio.setActions(nodes);
  else import('../app.js').then((m) => m.setActions(nodes)).catch(() => {});
}

function injectCss() {
  if (document.getElementById('video-css')) return;
  const link = document.createElement('link');
  link.id = 'video-css'; link.rel = 'stylesheet'; link.href = 'css/video.css';
  document.head.appendChild(link);
}

// ------------------------------------------------------------------ render

export async function render(container, params) {
  injectCss();
  if (params.id) return renderProject(container, params);
  return renderList(container);
}

// ------------------------------------------------------------------ the list

async function renderList(container) {
  container.appendChild(el('div', { class: 'loading', text: 'Loading video projects' }));
  let videos; let pieces; let solutions;
  try {
    [videos, pieces, solutions] = await Promise.all([api.get('/videos'), api.get('/pieces', { type: 'youtube-long' }), api.get('/solutions')]);
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not load video projects: ${err.message}` }));
    return;
  }
  container.replaceChildren();
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const solutionName = new Map(solutions.map((s) => [s.id, s.publicName]));

  const newBtn = button({ kind: 'primary', label: 'New video project', icon: 'plus', onClick: () => openNewDialog({ solutions, pieces }) });
  setTopActions([newBtn]);

  container.appendChild(el('p', { class: 'vid-lead', text: 'YouTube runs fortnightly: one 30 to 45 minute episode every other Monday at 11:00 from 16 November 2026, Shorts between. The ten episodes of Built to Run: Stories carry their scripts from the series files; a VSP-system case study takes one system from an idea to a recording plan: outline, script, scenes, footage, voice, your own clips, then the edit in the brand-video pipeline. Each episode is 30 to 45 minutes, with two to four Shorts cut from it for the Mondays between.' }));

  if (!videos.length) {
    container.appendChild(empty({
      title: 'No video project yet',
      hint: 'Start from one of the systems in the Solutions register, or give a subject of your own.',
      action: button({ kind: 'primary', label: 'New video project', icon: 'plus', onClick: () => openNewDialog({ solutions, pieces }) }),
    }));
    return;
  }

  const rows = [...videos].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  container.appendChild(card({
    body: table({
      rowKey: 'id',
      rows,
      onRowClick: (v) => { location.hash = `#/video/${encodeURIComponent(v.id)}`; },
      columns: [
        { key: 'title', label: 'Title', render: (v) => el('a', { href: `#/video/${encodeURIComponent(v.id)}`, text: v.title || v.id }) },
        { key: 'solutionId', label: 'Solution', render: (v) => solutionName.get(v.solutionId) || v.subject || '' },
        {
          key: 'status', label: 'Step', render: (v) => el('div', { class: 'row' }, [
            statusPill(v.status), el('span', { class: 'vid-list-meta', text: `${stepIndex(v.status) + 1} of ${STATUS_ORDER.length}` }),
          ]),
        },
        {
          key: 'slot', label: 'Planned slot', render: (v) => {
            const p = pieceById.get(v.pieceId);
            return p?.plannedDate
              ? el('a', { href: `#/calendar/${p.plannedDate.slice(0, 7)}`, text: `${fmt.date(p.plannedDate)}${p.plannedTime ? ` ${p.plannedTime}` : ''}` })
              : el('span', { class: 'muted', text: 'Not placed in the calendar yet' });
          },
        },
        { key: 'shorts', label: 'Shorts made', num: true, render: (v) => String((v.shortsPieceIds || []).length) },
        { key: 'updatedAt', label: 'Updated', render: (v) => fmt.dateTime(v.updatedAt) },
      ],
    }),
  }));
}

function openNewDialog({ solutions, pieces }) {
  const free = pieces.filter((p) => !p.videoId);
  const solutionSel = select({ options: solutions.map((s) => ({ value: s.id, label: s.publicName })), placeholder: 'Choose a solution' });
  const subject = input({ placeholder: 'Or type a subject, for example how quotes get followed up' });
  const pieceSel = select({ options: free.map((p) => ({ value: p.id, label: p.hook || p.id })), placeholder: 'None, make a new piece' });
  const notes = textarea({ rows: 4, placeholder: 'What happened, in your words: the problem, what it cost, what changed. Real figures only.' });
  const target = input({ type: 'number', min: 30, max: 45, value: 38 });
  const err = el('div', { class: 'field-error' });
  const body = el('div', {}, [
    field({ label: 'System', input: solutionSel, hint: 'The case study tells one system from the Solutions register.' }),
    field({ label: 'Subject', input: subject }),
    free.length ? field({ label: 'Start from an existing YouTube long piece', input: pieceSel }) : null,
    field({ label: "Palak's notes", input: notes, hint: 'Figures come only from here. Anything the script needs that is not here is marked as a question.' }),
    field({ label: 'Target length in minutes', input: target, hint: '30 to 45.' }),
    err,
  ]);
  let d;
  const create = button({
    kind: 'primary', label: 'Create project',
    onClick: async () => {
      err.textContent = '';
      if (!solutionSel.value && !subject.value.trim() && !pieceSel.value) { err.textContent = 'Choose a system, give a subject, or pick a piece.'; return; }
      create.disabled = true;
      try {
        const r = await api.post('/video', {
          solutionId: solutionSel.value || undefined, subject: subject.value.trim() || undefined, pieceId: pieceSel.value || undefined,
          notes: notes.value, targetMinutes: parseInt(target.value, 10) || 38,
        });
        d.close();
        location.hash = `#/video/${encodeURIComponent(r.video.id)}`;
      } catch (e) { err.textContent = e.message; create.disabled = false; }
    },
  });
  d = dialog({ title: 'New video project', body, actions: [button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }), create] });
}

// ------------------------------------------------------------------ the project page

async function renderProject(container, params) {
  const id = params.id;
  container.appendChild(el('div', { class: 'loading', text: 'Loading the project' }));
  const S = { video: null, piece: null, solutions: [], step: 'outline', busy: null, readAloud: false, warnings: {}, aiBanner: null, bv: null };
  try {
    S.video = await api.get(`/videos/${encodeURIComponent(id)}`);
    [S.piece, S.solutions] = await Promise.all([
      S.video.pieceId ? api.get(`/pieces/${encodeURIComponent(S.video.pieceId)}`).catch(() => null) : null,
      api.get('/solutions'),
    ]);
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: err.status === 404 ? 'That video project does not exist.' : `Could not load the project: ${err.message}` }),
      button({ kind: 'secondary', label: 'Back to the projects', href: '#/video' }));
    return;
  }
  container.replaceChildren();
  setTopActions([button({ kind: 'secondary', label: 'All projects', icon: 'back', href: '#/video' })]);

  const wantStep = params.query?.step;
  S.step = STEP_ITEMS.some((s) => s.id === wantStep) ? wantStep : (S.video.status === 'done' ? 'done' : S.video.status);
  let alive = true;

  const head = el('div', { class: 'vid-head' });
  const stepper = el('ol', { class: 'vid-stepper', 'aria-label': 'Steps' });
  const busyBar = el('div', { class: 'banner banner-info hidden', role: 'status' });
  const bannerHost = el('div');
  const panel = el('div', { class: 'vid-panel' });
  container.append(head, stepper, busyBar, bannerHost, panel);

  // ---- saving: a debounced PATCH of whatever changed
  let pending = {};
  let timer = null;
  const saveState = el('span', { class: 'vid-save', text: '' });
  const setSaveState = (text, bad = false) => { saveState.textContent = text; saveState.classList.toggle('bad', bad); };
  async function flush() {
    clearTimeout(timer);
    if (!Object.keys(pending).length) return;
    const body = pending; pending = {};
    setSaveState('Saving');
    try { await api.patch(`/videos/${encodeURIComponent(id)}`, body); setSaveState('Saved'); }
    catch (err) { pending = { ...body, ...pending }; setSaveState('Not saved', true); toast(`Could not save: ${err.message}`, 'bad'); }
  }
  function save(patch) {
    Object.assign(S.video, patch);
    Object.assign(pending, patch);
    setSaveState('Unsaved changes');
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }

  // ---- calls to the server
  function showBusy(text) {
    S.busy = text;
    busyBar.classList.toggle('hidden', !text);
    busyBar.replaceChildren(text ? el('span', { class: 'vid-progress', text }) : '');
  }
  function showAiError(err) {
    const signedOut = err.status === 502 || /authenticate|log ?in|oauth|claude/i.test(err.message || '');
    if (signedOut) {
      S.aiBanner = { tone: 'bad', text: `The AI step could not run: ${err.message}`, hint: `${LOGIN_HINT}, then try again.` };
      toast(`${LOGIN_HINT}, then try again.`, 'bad', { ms: 9000 });
    } else if (err.status === 424) {
      S.aiBanner = { tone: 'warn', text: err.message, command: err.detail?.command };
      toast(err.message, 'warn', { ms: 9000 });
    } else {
      S.aiBanner = { tone: 'bad', text: err.message };
      toast(err.message, 'bad', { ms: 7000 });
    }
    drawBanner();
  }
  function drawBanner() {
    const b = S.aiBanner;
    bannerHost.replaceChildren();
    if (!b) return;
    bannerHost.appendChild(el('div', { class: `banner banner-${b.tone === 'bad' ? 'bad' : 'warn'}` }, [
      icon('warn'),
      el('div', {}, [
        el('div', { text: b.text }),
        b.hint ? el('div', { text: b.hint, style: { fontWeight: '700', marginTop: '4px' } }) : null,
        b.command ? el('div', { class: 'vid-cmd', style: { marginTop: '8px' } }, [el('code', { text: b.command }), button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(b.command) })]) : null,
      ]),
      button({ kind: 'ghost', small: true, label: 'Dismiss', onClick: () => { S.aiBanner = null; drawBanner(); } }),
    ]));
  }
  async function server(path, body, { busy, quiet = false } = {}) {
    await flush();
    if (busy) showBusy(busy);
    try {
      const r = await api.post(`/video/${encodeURIComponent(id)}/${path}`, body ?? {});
      if (r?.video) Object.assign(S.video, r.video);
      if (r?.piece) S.piece = r.piece;
      if (!quiet) { S.aiBanner = null; drawBanner(); }
      return r;
    } catch (err) {
      showAiError(err);
      return null;
    } finally {
      if (busy) showBusy(null);
    }
  }
  async function showPrompt(path, body) {
    await flush();
    try {
      const r = await api.post(`/video/${encodeURIComponent(id)}/${path}`, { ...(body || {}), dryRun: true });
      dialog({
        title: 'The prompt for this step', wide: true,
        body: el('div', {}, [
          el('p', { class: 'vid-note', text: 'This is exactly what Claude receives. Use it to check the wording, or paste it into Claude yourself.' }),
          codeBlock(r.system, { title: 'System', light: true }),
          codeBlock(r.user, { title: 'User', light: true }),
          codeBlock(JSON.stringify(r.schema, null, 2), { title: 'Output schema', light: true }),
        ]),
      });
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ---- header and stepper
  function drawHead() {
    const v = S.video;
    const titleIn = el('input', {
      class: 'vid-title-input', value: v.title || '', 'aria-label': 'Working title',
      onInput: (e) => save({ title: e.target.value, titleAuto: false }),
    });
    head.replaceChildren(
      el('div', { class: 'vid-head-main' }, [
        titleIn,
        el('div', { class: 'vid-meta' }, [
          statusPill(v.status),
          el('span', { class: 'mono', text: `Step ${stepIndex(v.status) + 1} of ${STATUS_ORDER.length}` }),
          S.piece ? el('a', { href: `#/content/${encodeURIComponent(S.piece.id)}`, text: 'Open the piece in the library' }) : null,
          v.bvProject ? el('span', { class: 'mono', text: v.bvProject }) : null,
          saveState,
        ]),
      ]),
    );
  }
  function drawStepper() {
    const cur = stepIndex(S.video.status);
    stepper.replaceChildren(...STEP_ITEMS.map((s, i) => {
      let state = 'todo';
      if (s.id === 'shorts') state = (S.video.shortsPieceIds || []).length ? 'done' : (S.video.status === 'edit' || S.video.status === 'done' ? 'current' : 'todo');
      else if (S.video.status === 'done') state = 'done';
      else if (stepIndex(s.status) < cur) state = 'done';
      else if (stepIndex(s.status) === cur) state = 'current';
      return el('li', { class: `vid-step ${state}${S.step === s.id ? ' viewing' : ''}` },
        el('button', { type: 'button', 'aria-current': S.step === s.id ? 'step' : undefined, onClick: () => go(s.id) }, [
          el('span', { class: 'vid-step-n' }, state === 'done' ? icon('check') : String(i + 1)),
          s.label,
        ]));
    }));
  }
  function go(stepId) {
    S.step = stepId;
    history.replaceState(null, '', `#/video/${encodeURIComponent(id)}?step=${stepId}`);
    drawStepper();
    drawPanel();
    window.scrollTo({ top: 0 });
  }
  function advanceTo(statusName) {
    if (stepIndex(statusName) > stepIndex(S.video.status)) save({ status: statusName });
    drawHead(); drawStepper();
  }
  const nextBar = (backId, nextId, nextLabel, onNext) => el('div', { class: 'vid-nextbar' }, [
    backId ? button({ kind: 'ghost', label: STEP_ITEMS.find((s) => s.id === backId).label, icon: 'back', onClick: () => go(backId) }) : el('span'),
    nextId ? button({ kind: 'secondary', label: nextLabel || `Continue to ${STEP_ITEMS.find((s) => s.id === nextId).label}`, icon: 'next', onClick: () => { if (onNext) onNext(); go(nextId); } }) : null,
  ]);

  function drawPanel() {
    const fns = {
      outline: panelOutline, script: panelScript, scenes: panelScenes, footage: panelFootage, voice: panelVoice,
      'own-clips': panelOwnClips, edit: panelEdit, shorts: panelShorts, done: panelDone,
    };
    panel.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
    Promise.resolve(fns[S.step]()).then((node) => { if (alive) panel.replaceChildren(node); })
      .catch((err) => { console.error(err); if (alive) panel.replaceChildren(el('div', { class: 'banner banner-bad', text: `This step could not be drawn: ${err.message}` })); });
  }

  // ================================================================ Outline
  function panelOutline() {
    const v = S.video;
    const root = el('div');
    const solSel = select({
      options: [{ value: '', label: 'Not a listed system (use the subject)' }, ...S.solutions.map((s) => ({ value: s.id, label: s.publicName }))],
      value: v.solutionId || '', onChange: (e) => { save({ solutionId: e.target.value || null }); },
    });
    const subj = input({ value: v.subject || '', placeholder: 'For example, how quotes get followed up', onInput: (e) => save({ subject: e.target.value }) });
    const mins = input({ type: 'number', min: 30, max: 45, value: v.targetMinutes || 38, onInput: (e) => save({ targetMinutes: clamp(parseInt(e.target.value, 10) || 38, 30, 45) }) });
    const notes = textarea({ rows: 6, value: v.notes || '', placeholder: 'The problem, what it cost, what changed, in your words. Real figures only.', onInput: (e) => save({ notes: e.target.value }) });

    const draftBtn = button({
      kind: 'primary', icon: 'sparkle', label: v.outline?.length ? 'Redraft the outline' : 'Draft the outline',
      onClick: async () => {
        if (S.busy) return;
        if (v.outline?.length && !(await confirm({ title: 'Redraft the outline', message: 'The six chapters below will be replaced. Your edits to them will be lost.', confirmLabel: 'Redraft' }))) return;
        draftBtn.disabled = true;
        const r = await server('outline', {}, { busy: 'Drafting the outline. This takes up to a minute.' });
        draftBtn.disabled = false;
        if (r) { S.warnings.outline = r.warnings || []; toast('Outline drafted', 'ok'); drawHead(); drawStepper(); drawPanel(); }
      },
    });
    root.appendChild(card({
      title: 'The brief', eyebrow: 'Step 1',
      body: el('div', {}, [
        el('div', { class: 'vid-two' }, [
          field({ label: 'System', input: solSel }),
          field({ label: 'Subject, if not listed', input: subj }),
        ]),
        field({ label: "Palak's notes", input: notes, hint: 'Figures come only from here. Anything else the script needs is marked as a question for you.' }),
        el('div', { class: 'vid-two' }, [field({ label: 'Target length in minutes', input: mins, hint: '30 to 45. The build chapter takes most of it.' }), el('div')]),
        el('div', { class: 'vid-actions' }, [draftBtn, button({ kind: 'ghost', label: 'View the prompt', onClick: () => showPrompt('outline', {}) })]),
        warnList(S.warnings.outline),
      ]),
    }));

    if (!v.outline?.length) {
      root.appendChild(empty({ title: 'No outline yet', hint: 'Draft it from the brief above. You can edit every chapter afterwards.' }));
      return root;
    }

    // title, hook, opening, description intro
    const titleIn = input({ value: v.title || '', onInput: (e) => save({ title: e.target.value, titleAuto: false }) });
    const hookIn = input({ value: v.hook || '', onInput: (e) => save({ hook: e.target.value }) });
    const openIn = textarea({ rows: 4, value: v.openingLine || '', onInput: (e) => save({ openingLine: e.target.value }) });
    const introIn = textarea({ rows: 2, value: v.descriptionIntro || '', onInput: (e) => save({ descriptionIntro: e.target.value }) });
    root.appendChild(card({
      title: 'Title and opening',
      body: el('div', {}, [
        field({ label: 'YouTube title (under 70 characters)', input: titleIn }), el('div', { style: { marginTop: '-8px', marginBottom: '12px' } }, counter(titleIn, 69)),
        v.suggestedTitle && v.suggestedTitle !== v.title
          ? el('div', { class: 'row', style: { margin: '-4px 0 14px' } }, [
            el('span', { class: 'vid-note', text: `The outline suggests: ${v.suggestedTitle}` }),
            button({ kind: 'secondary', small: true, label: 'Use it', onClick: () => { titleIn.value = v.suggestedTitle; titleIn.dispatchEvent(new Event('input')); drawHead(); } }),
          ])
          : null,
        field({ label: 'Hook for the library piece (eight words or fewer)', input: hookIn }), el('div', { style: { marginTop: '-8px', marginBottom: '12px' } }, counter(hookIn, 8, { words: true })),
        field({ label: 'Opening, the first 30 seconds: the problem and its cost', input: openIn }), el('div', { style: { marginTop: '-8px', marginBottom: '12px' } }, counter(openIn, 80, { words: true })),
        field({ label: 'Description, first line (the system and the outcome)', input: introIn }), el('div', { style: { marginTop: '-8px' } }, counter(introIn, 150)),
      ]),
    }));

    // chapters
    const totalChip = el('span');
    const drawTotal = () => {
      const sum = v.outline.reduce((a, c) => a + (Number(c.minutes) || 0), 0);
      const ok = sum >= 30 && sum <= 45;
      totalChip.replaceChildren(chip({ label: `${sum} minutes in total${ok ? '' : ', aim for 30 to 45'}`, tone: ok ? 'ok' : 'bad' }));
    };
    const touch = () => save({ outline: v.outline });
    root.appendChild(el('div', { class: 'section-title' }, [el('h2', { text: 'The six chapters' }), totalChip]));
    drawTotal();
    for (const c of v.outline) {
      const titleField = el('input', { class: 'vid-chapter-title', value: c.title || '', 'aria-label': `Chapter ${c.n} title`, onInput: (e) => { c.title = e.target.value; touch(); } });
      const minIn = input({ type: 'number', class: 'vid-minutes', min: 1, max: 30, value: c.minutes, 'aria-label': `Chapter ${c.n} minutes`, onInput: (e) => { c.minutes = Math.max(0, parseInt(e.target.value, 10) || 0); touch(); drawTotal(); } });
      const onScreen = textarea({ rows: 5, value: (c.onScreen || []).join('\n'), onInput: (e) => { c.onScreen = lines(e.target.value); touch(); } });
      const toCam = textarea({ rows: 4, value: (c.toCamera || []).join('\n'), onInput: (e) => { c.toCamera = lines(e.target.value); touch(); } });
      const shortsHost = el('div');
      const drawShorts = () => {
        shortsHost.replaceChildren(...(c.shorts || []).map((s, i) => el('div', { class: 'vid-short-row' }, [
          input({ value: s.hook, placeholder: 'Re-hooked first line', 'aria-label': 'Short hook', onInput: (e) => { s.hook = e.target.value; touch(); } }),
          input({ value: s.from, class: 'mono', placeholder: 'from', 'aria-label': 'From', onInput: (e) => { s.from = e.target.value; touch(); } }),
          input({ value: s.to, class: 'mono', placeholder: 'to', 'aria-label': 'To', onInput: (e) => { s.to = e.target.value; touch(); } }),
          button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove this Short', onClick: () => { c.shorts.splice(i, 1); touch(); drawShorts(); } }),
        ])));
      };
      drawShorts();
      const faceOk = FACE_CHAPTERS.includes(c.n);
      root.appendChild(card({
        title: el('div', { class: 'vid-chapter-head' }, [el('span', { class: 'vid-chapter-n', text: String(c.n) }), titleField, minIn, el('span', { class: 'vid-note', text: 'min' })]),
        body: el('div', {}, [
          c.purpose ? el('p', { class: 'vid-note', text: c.purpose }) : null,
          el('div', { class: 'vid-two' }, [
            field({ label: 'On screen, one item a line', input: onScreen }),
            field({
              label: faceOk ? 'To camera: questions you answer' : 'To camera (none in this chapter)', input: toCam,
              hint: faceOk ? 'This is one of the three face moments.' : 'The face moments are chapters 1, 5 and 6. The build stays on screen.',
            }),
          ]),
          el('div', { class: 'eyebrow', text: 'Shorts candidates: re-hooked first line, from, to (minutes and seconds from the start of the chapter)', style: { margin: '4px 0 8px' } }),
          shortsHost,
          button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add a Short', onClick: () => { c.shorts = c.shorts || []; c.shorts.push({ hook: '', from: '0:00', to: '0:30' }); touch(); drawShorts(); } }),
        ]),
      }));
    }
    root.appendChild(nextBar(null, 'script', null, () => advanceTo('script')));
    return root;
  }

  // ================================================================ Script
  async function panelScript() {
    const v = S.video;
    const root = el('div');
    if (!v.outline?.length) {
      root.appendChild(empty({ title: 'The script follows the outline', hint: 'Draft the outline first.', action: button({ kind: 'primary', label: 'Go to the outline', onClick: () => go('outline') }) }));
      return root;
    }
    const texts = {};
    for (const c of parseScript(v.script)) texts[c.n] = c.text;
    const cards = new Map();
    const stats = el('div', { class: 'vid-stat' });
    const progress = el('span', { class: 'vid-progress' });
    let stop = false;

    const totals = () => {
      const w = v.outline.reduce((a, c) => a + words(texts[c.n]), 0);
      const target = v.outline.reduce((a, c) => a + (Number(c.minutes) || 0), 0);
      const est = w / WPM;
      stats.replaceChildren(
        el('div', {}, [el('b', { text: String(w) }), el('span', { text: 'spoken words' })]),
        el('div', {}, [el('b', { text: `${Math.round(est * 10) / 10}` }), el('span', { text: `minutes at ${WPM} words a minute` })]),
        el('div', {}, [el('b', { text: String(target) }), el('span', { text: 'minutes in the outline' })]),
      );
    };
    const persist = () => {
      const joined = joinScript(v.outline.map((c) => ({ n: c.n, title: c.title, text: texts[c.n] || '' })));
      save({ script: joined });
    };

    const stopBtn = button({ kind: 'ghost', label: 'Stop after this chapter', onClick: () => { stop = true; toast('Stopping after the chapter in progress', 'info'); } });
    stopBtn.classList.add('hidden');
    const writeChapters = async (list) => {
      if (S.busy) return;
      stop = false;
      stopBtn.classList.remove('hidden');
      let done = 0;
      for (const c of list) {
        if (stop) break;
        progress.textContent = `Writing chapter ${c.n} of ${v.outline.length}`;
        const r = await server('script', { chapter: c.n }, { busy: `Writing chapter ${c.n} of ${v.outline.length}. Each chapter takes up to a minute.` });
        if (!r) break;
        S.warnings[`script${c.n}`] = r.results?.[0]?.warnings || [];
        texts[c.n] = parseScript(S.video.script).find((x) => x.n === c.n)?.text || '';
        const cd = cards.get(c.n);
        if (cd && cd.ta.isConnected) { cd.ta.value = texts[c.n]; cd.update(); cd.lint(); }
        totals(); drawHead(); drawStepper();
        done += 1;
      }
      progress.textContent = '';
      stopBtn.classList.add('hidden');
      if (done) toast(`${plural(done, 'chapter', 'chapters')} written`, 'ok');
    };

    const missing = v.outline.filter((c) => !words(texts[c.n]));
    const anyText = v.outline.some((c) => words(texts[c.n]));
    const writeAll = button({
      kind: 'primary', icon: 'sparkle', label: anyText ? 'Rewrite every chapter' : 'Write the script',
      onClick: async () => {
        if (anyText && !(await confirm({ title: 'Rewrite every chapter', message: 'All six chapters will be written again. Your edits will be lost.', confirmLabel: 'Rewrite' }))) return;
        writeChapters(v.outline);
      },
    });
    const writeMissing = anyText && missing.length ? button({ kind: 'secondary', label: `Write the ${plural(missing.length, 'missing chapter', 'missing chapters')}`, onClick: () => writeChapters(missing) }) : null;
    const aloud = switchInput({ label: 'Read-aloud marks', checked: S.readAloud, onChange: (e) => { S.readAloud = e.target.checked; for (const cd of cards.values()) cd.mode(); } });

    root.appendChild(card({
      title: 'The script', eyebrow: 'Step 2',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: `Written chapter by chapter in the spoken register, at about ${WPM} words a minute. The problem and its cost come inside the first 30 seconds, with no introduction. Edit any chapter by hand.` }),
        stats,
        el('div', { class: 'vid-actions' }, [writeAll, writeMissing, stopBtn, aloud, progress, button({ kind: 'ghost', label: 'View the prompt (chapter 1)', onClick: () => showPrompt('script', { chapter: 1 }) })]),
      ]),
    }));
    totals();

    for (const c of v.outline) {
      const ta = textarea({ rows: 14, class: 'vid-script', value: texts[c.n] || '', placeholder: 'Not written yet.' });
      const meta = el('span', { class: 'vid-count' });
      const lintHost = el('div');
      const spokenHost = el('div', { class: 'vid-spoken hidden' });
      const openingHost = el('div');
      let spokenSegs = null;

      const update = () => {
        const w = words(ta.value);
        const target = (Number(c.minutes) || 0) * WPM;
        const off = target ? (w - target) / target : 0;
        meta.textContent = `${w} words, about ${Math.round((w / WPM) * 10) / 10} min against ${c.minutes} min planned`;
        meta.classList.toggle('over', Math.abs(off) > 0.15 && w > 0);
        meta.classList.toggle('ok', Math.abs(off) <= 0.15 && w > 0);
        openingHost.replaceChildren();
        if (c.n === 1 && w > 0) {
          openingHost.appendChild(el('div', { class: 'vid-opening' }, [el('b', { text: 'The first 30 seconds' }), ta.value.trim().split(/\s+/).slice(0, 70).join(' ')]));
        }
      };
      const drawSpoken = () => {
        spokenHost.replaceChildren();
        if (!spokenSegs) { spokenHost.textContent = 'Working out the spoken form'; return; }
        for (const s of spokenSegs) {
          if (s.spoken !== undefined) spokenHost.appendChild(el('mark', { text: s.spoken, title: `Written: ${s.written}` }));
          else spokenHost.appendChild(document.createTextNode(s.text));
        }
      };
      const mode = () => {
        const on = S.readAloud && ta.value.trim();
        ta.parentElement?.classList.toggle('hidden', Boolean(on));
        spokenHost.classList.toggle('hidden', !on);
        if (on) { drawSpoken(); lint(); }
      };
      const lint = async () => {
        if (!ta.value.trim()) { lintHost.replaceChildren(); return; }
        try {
          const r = await api.post('/video/spoken', { text: ta.value, marks: S.video.scriptMarks?.[c.n] || [], chapter: c.n });
          spokenSegs = r.segments;
          lintHost.replaceChildren(warnList([...(S.warnings[`script${c.n}`] || []).filter((w) => !/words against a target/.test(w)), ...r.warnings].filter((w, i, a) => a.indexOf(w) === i)) || '');
          if (S.readAloud) drawSpoken();
        } catch { /* the counters still work without it */ }
      };
      const lintSoon = debounce(lint, 900);
      ta.addEventListener('input', () => { texts[c.n] = ta.value; update(); totals(); persist(); lintSoon(); });

      const writeOne = button({
        kind: 'secondary', small: true, icon: 'sparkle', label: words(texts[c.n]) ? 'Rewrite this chapter' : 'Write this chapter',
        onClick: async () => {
          if (words(ta.value) && !(await confirm({ title: 'Rewrite this chapter', message: `Chapter ${c.n} will be written again. Your edits to it will be lost.`, confirmLabel: 'Rewrite' }))) return;
          writeChapters([c]);
        },
      });
      const holder = el('div', {}, ta);
      cards.set(c.n, { ta, update, lint, mode });
      root.appendChild(card({
        title: el('div', { class: 'vid-chapter-head' }, [el('span', { class: 'vid-chapter-n', text: String(c.n) }), el('h2', { text: c.title })]),
        actions: [writeOne, button({ kind: 'ghost', small: true, label: 'Prompt', onClick: () => showPrompt('script', { chapter: c.n }) })],
        body: el('div', {}, [openingHost, holder, spokenHost, el('div', { style: { marginTop: '6px' } }, meta), lintHost]),
      }));
      update(); lint(); mode();
    }
    root.appendChild(nextBar('outline', 'scenes', null, () => { if (v.outline.every((c) => words(texts[c.n]))) advanceTo('scenes'); }));
    return root;
  }

  // ================================================================ Scenes
  async function panelScenes() {
    const v = S.video;
    const root = el('div');
    if (!String(v.script || '').trim()) {
      root.appendChild(empty({ title: 'Scenes are planned from the script', hint: 'Write the script first.', action: button({ kind: 'primary', label: 'Go to the script', onClick: () => go('script') }) }));
      return root;
    }
    let info;
    try { info = await api.get(`/video/${encodeURIComponent(id)}/chunks`); } catch (err) { root.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return root; }
    const progress = el('span', { class: 'vid-progress' });
    let stop = false;
    const summary = el('div', { class: 'vid-stat' });
    const chaptersHost = el('div');

    const drawSummary = () => {
      const sc = v.scenes || [];
      const total = sc.reduce((a, s) => a + (Number(s.seconds) || 0), 0);
      const by = (k) => sc.filter((s) => s.kind === k).length;
      summary.replaceChildren(
        el('div', {}, [el('b', { text: String(sc.length) }), el('span', { text: 'scenes' })]),
        el('div', {}, [el('b', { text: clock(total) }), el('span', { text: 'planned length' })]),
        el('div', {}, [el('b', { text: `${by('broll')} / ${by('screen')} / ${by('face')} / ${by('card')}` }), el('span', { text: 'B-roll / screen / face / card' })]),
      );
    };
    const isStale = () => (v.scenes || []).length > 0
      && normWords(parseScript(v.script).map((c) => c.text).join(' ')).join(' ') !== normWords(v.scenes.map((s) => s.say).join(' ')).join(' ');

    const stopBtn = button({ kind: 'ghost', label: 'Stop after this part', onClick: () => { stop = true; } });
    stopBtn.classList.add('hidden');
    const plan = async (parts) => {
      if (S.busy) return;
      stop = false;
      stopBtn.classList.remove('hidden');
      let done = 0;
      for (const p of parts) {
        if (stop) break;
        progress.textContent = `Part ${p.part} of ${info.parts.length}`;
        const r = await server('scenes', { part: p.part }, { busy: `Planning scenes, part ${p.part} of ${info.parts.length} (chapter ${p.chapter}).` });
        if (!r) break;
        S.warnings[`scenes${p.part}`] = r.results?.[0]?.warnings || [];
        done += 1;
        drawSummary(); drawHead(); drawStepper();
      }
      progress.textContent = '';
      stopBtn.classList.add('hidden');
      if (done) { toast(`${plural(done, 'part', 'parts')} planned`, 'ok'); info = await api.get(`/video/${encodeURIComponent(id)}/chunks`); drawPanel(); }
    };

    const unplanned = info.parts.filter((p) => !p.planned);
    const have = (v.scenes || []).length > 0;
    const planBtn = button({
      kind: 'primary', icon: 'sparkle', label: have ? 'Plan the remaining parts' : 'Plan the scenes', disabled: !unplanned.length,
      onClick: () => plan(unplanned),
    });
    const replanBtn = have ? button({
      kind: 'secondary', label: 'Plan everything again',
      onClick: async () => {
        if (await confirm({ title: 'Plan everything again', message: 'Every scene is replaced. Footage choices and clip mappings for them are dropped. Your edits to the scenes are lost.', confirmLabel: 'Plan again', danger: true })) plan(info.parts);
      },
    }) : null;

    root.appendChild(card({
      title: 'The scenes', eyebrow: 'Step 3',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: `One row per scene: what is said, what the viewer sees, its kind and the stock search words. The words come from the script and cannot be edited here. Face scenes are the only ones you record yourself: they are kept to chapters 1, 5 and 6, at most ${3} in a chapter.` }),
        isStale() ? el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', { text: 'The script has changed since these scenes were planned. Plan the affected parts again, or the hand-off will warn you.' })]) : null,
        summary,
        el('div', { class: 'vid-actions' }, [planBtn, replanBtn, stopBtn, progress, button({ kind: 'ghost', label: 'View the prompt (part 1)', onClick: () => showPrompt('scenes', { part: 1 }) })]),
      ]),
    }));
    drawSummary();
    root.appendChild(chaptersHost);

    const outline = v.outline || [];
    const chapterNums = [...new Set(info.parts.map((p) => p.chapter))];
    for (const n of chapterNums) {
      const ch = outline.find((c) => c.n === n) || {};
      const inCh = () => (v.scenes || []).filter((s) => s.chapter === n);
      const det = el('details', { class: 'vid-details', open: n === chapterNums[0] ? '' : undefined });
      const tableHost = el('div', { class: 'vid-details-body' });
      const summ = el('summary');
      const drawSumm = () => {
        const list = inCh();
        const faces = list.filter((s) => s.kind === 'face').length;
        summ.replaceChildren(
          el('span', { class: 'vid-chapter-n', text: String(n) }),
          el('span', { text: ch.title || `Chapter ${n}` }),
          chip({ label: plural(list.length, 'scene', 'scenes'), tone: list.length ? 'default' : 'muted' }),
          list.length ? chip({ label: clock(list.reduce((a, s) => a + (Number(s.seconds) || 0), 0)), tone: 'muted' }) : null,
          faces ? chip({ label: plural(faces, 'face scene', 'face scenes'), tone: FACE_CHAPTERS.includes(n) && faces <= 3 ? 'navy' : 'bad' }) : null,
        );
      };
      drawSumm();
      const drawTable = () => {
        const list = inCh();
        if (!list.length) { tableHost.replaceChildren(el('p', { class: 'vid-note', text: 'No scenes planned for this chapter yet.' })); return; }
        const faces = list.filter((s) => s.kind === 'face').length;
        tableHost.replaceChildren(...[
          warnList(info.parts.filter((p) => p.chapter === n).flatMap((p) => S.warnings[`scenes${p.part}`] || [])),
          table({
            rowKey: 'n',
            rows: list,
            columns: [
              { key: 'n', label: '#', mono: true, width: '44px' },
              { key: 'say', label: 'Says', render: (s) => el('div', { class: 'say', text: s.say }) },
              {
                key: 'sees', label: 'Sees', render: (s) => {
                  const ta = textarea({ rows: 2, value: s.sees || '', onInput: (e) => { s.sees = e.target.value; save({ scenes: v.scenes }); } });
                  return ta;
                },
              },
              {
                key: 'kind', label: 'Kind', render: (s) => {
                  const flag = el('div', { class: 'vid-flag' });
                  const setFlag = () => {
                    const n2 = inCh().filter((x) => x.kind === 'face').length;
                    flag.textContent = s.kind === 'face' && !FACE_CHAPTERS.includes(n) ? 'Face scenes belong to chapters 1, 5 and 6.' : (s.kind === 'face' && n2 > 3 ? 'More than three face scenes in this chapter.' : '');
                  };
                  const sel = select({
                    options: Object.keys(KIND_LABEL).map((k) => ({ value: k, label: KIND_LABEL[k] })), value: s.kind,
                    onChange: (e) => { s.kind = e.target.value; save({ scenes: v.scenes }); setFlag(); drawSumm(); drawSummary(); qIn.disabled = s.kind !== 'broll'; },
                  });
                  const qIn = input({ value: s.query || '', placeholder: 'Search words', 'aria-label': 'Stock search words', disabled: s.kind !== 'broll', onInput: (e) => { s.query = e.target.value; save({ scenes: v.scenes }); } });
                  setFlag();
                  return el('div', { class: 'stack' }, [sel, qIn, flag]);
                },
              },
              {
                key: 'seconds', label: 'Seconds', render: (s) => input({
                  type: 'number', class: 'seconds mono', min: 1, step: 0.5, value: s.seconds,
                  onInput: (e) => { s.seconds = Math.max(1, Number(e.target.value) || s.seconds); save({ scenes: v.scenes }); drawSumm(); drawSummary(); },
                }),
              },
            ],
          }),
          faces > 3 ? el('div', { class: 'vid-flag', text: 'This chapter has more than three face scenes.' }) : null,
        ].filter(Boolean));
      };
      let drawn = false;
      det.addEventListener('toggle', () => { if (det.open && !drawn) { drawn = true; drawTable(); } });
      if (n === chapterNums[0]) { drawn = true; drawTable(); }
      const redo = button({
        kind: 'ghost', small: true, label: 'Plan this chapter again',
        onClick: async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (inCh().length && !(await confirm({ title: 'Plan this chapter again', message: `The scenes of chapter ${n} are replaced, with their footage choices.`, confirmLabel: 'Plan again' }))) return;
          plan(info.parts.filter((p) => p.chapter === n));
        },
      });
      summ.appendChild(redo);
      det.append(summ, tableHost);
      chaptersHost.appendChild(det);
    }
    root.appendChild(nextBar('script', 'footage', null, () => { if (have) advanceTo('footage'); }));
    return root;
  }

  // ================================================================ Footage
  async function ensureBv() {
    if (!S.bv) { try { S.bv = await api.get('/video/bv'); } catch (err) { S.bv = { ok: false, message: err.message }; } }
    return S.bv;
  }

  async function panelFootage() {
    const v = S.video;
    const root = el('div');
    const bv = await ensureBv();
    if (!(v.scenes || []).length) {
      root.appendChild(empty({ title: 'Footage is chosen per scene', hint: 'Plan the scenes first.', action: button({ kind: 'primary', label: 'Go to the scenes', onClick: () => go('scenes') }) }));
      return root;
    }
    if (!bv.ok) {
      root.appendChild(el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', {}, [
        el('div', { text: bv.message }),
        bv.command ? el('div', { class: 'vid-cmd', style: { marginTop: '8px' } }, [el('code', { text: bv.command }), button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(bv.command) })]) : null,
      ])]));
    }
    v.footage = v.footage || [];
    const entry = (n) => v.footage.find((x) => x.scene === n) || { scene: n, query: '', ids: [], own: false, path: null };
    const commit = (f) => { if (!v.footage.includes(f)) v.footage.push(f); };
    const brollScenes = v.scenes.filter((s) => s.kind === 'broll');
    const chosen = brollScenes.filter((s) => (v.footage.find((f) => f.scene === s.n)?.ids || []).length || (s.clipPath && /^clips\//.test(s.clipPath))).length;

    root.appendChild(card({
      title: 'Stock footage', eyebrow: 'Step 4',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'For each b-roll scene, search the free Mixkit library through the brand-video runner and press Use on a clip. The clip id goes into the scene; the hand-off downloads them. Stock is a placeholder for your own footage.' }),
        el('div', { class: 'vid-stat' }, [
          el('div', {}, [el('b', { text: `${chosen} / ${brollScenes.length}` }), el('span', { text: 'b-roll scenes with a clip' })]),
          el('div', {}, [el('b', { text: String(v.scenes.filter((s) => s.kind === 'face').length) }), el('span', { text: 'face scenes you record' })]),
          el('div', {}, [el('b', { text: String(v.scenes.filter((s) => s.kind === 'screen').length) }), el('span', { text: 'screen scenes you record' })]),
        ]),
      ]),
    }));

    // filter and list
    const chapterOpts = [{ value: '', label: 'All chapters' }, ...[...new Set(brollScenes.map((s) => s.chapter))].map((n) => ({ value: String(n), label: `Chapter ${n}` }))];
    let chapterFilter = ''; let onlyOpen = true; let shown = 15;
    const listHost = el('div');
    const moreBtn = button({ kind: 'secondary', label: 'Show more scenes', onClick: () => { shown += 15; drawList(); } });
    const chSel = select({ options: chapterOpts, onChange: (e) => { chapterFilter = e.target.value; shown = 15; drawList(); } });
    const openSw = switchInput({ label: 'Only scenes without a clip', checked: true, onChange: (e) => { onlyOpen = e.target.checked; shown = 15; drawList(); } });
    root.appendChild(el('div', { class: 'vid-actions' }, [chSel, openSw]));
    root.appendChild(listHost);
    root.appendChild(el('div', { class: 'vid-actions' }, moreBtn));

    function useClip(s, cid) {
      const f = entry(s.n); commit(f);
      if (!f.ids.includes(cid)) f.ids.push(cid);
      s.clipPath = `assets/broll/${f.ids[0]}.mp4`; s.start = 0;
      save({ footage: v.footage, scenes: v.scenes });
    }
    function dropClip(s, cid) {
      const f = entry(s.n); commit(f);
      f.ids = f.ids.filter((x) => x !== cid);
      s.clipPath = f.ids.length ? `assets/broll/${f.ids[0]}.mp4` : null;
      save({ footage: v.footage, scenes: v.scenes });
    }

    function sceneCard(s) {
      const f = entry(s.n);
      const q = input({ value: f.query || s.query || '', placeholder: 'One or two plain words', 'aria-label': 'Stock search words', onInput: (e) => { commit(f); f.query = e.target.value; s.query = e.target.value; save({ footage: v.footage, scenes: v.scenes }); } });
      const results = el('div');
      const picked = el('div', { class: 'vid-picked' });
      const drawPicked = () => {
        picked.replaceChildren(...f.ids.map((cid) => chip({ label: el('span', {}, [`Clip ${cid}`, el('button', { type: 'button', 'aria-label': `Remove ${cid}`, onClick: () => { dropClip(s, cid); drawPicked(); results.querySelectorAll('.vid-tile').forEach((t) => t.classList.toggle('picked', f.ids.includes(t.dataset.id))); chosenRefresh(); } }, '×')]), tone: 'ok' })));
        if (s.clipPath && /^clips\//.test(s.clipPath)) picked.appendChild(chip({ label: 'Your own clip is mapped', tone: 'navy' }));
      };
      drawPicked();
      const searchBtn = button({
        kind: 'secondary', small: true, label: 'Search stock', icon: 'sparkle', disabled: !bv.ok,
        onClick: async () => {
          if (!q.value.trim()) { toast('Give one or two plain words to search for', 'warn'); return; }
          searchBtn.disabled = true;
          results.replaceChildren(el('p', { class: 'vid-note', text: 'Searching the Mixkit library. A new search can take up to 20 seconds.' }));
          try {
            const r = await api.post(`/video/${encodeURIComponent(id)}/footage`, { scene: s.n, query: q.value });
            if (!r.results.length) { results.replaceChildren(el('p', { class: 'vid-note', text: `Nothing for "${r.query}". Try plainer words, for example office, factory, handshake.` })); }
            else {
              results.replaceChildren(el('div', { class: 'vid-results' }, r.results.slice(0, 24).map((c) => {
                const tile = el('div', { class: `vid-tile${f.ids.includes(c.id) ? ' picked' : ''}`, dataset: { id: c.id } }, [
                  el('img', { src: c.thumb, alt: '', loading: 'lazy', onError: (e) => { e.target.replaceWith(el('div', { class: 'vid-nothumb', text: 'No preview. Open it on Mixkit.' })); } }),
                  el('div', { class: 'vid-tile-body' }, [
                    el('div', { class: 'vid-tile-title', text: c.title }),
                    el('div', { class: 'vid-tile-foot' }, [
                      el('a', { href: c.url, target: '_blank', rel: 'noopener', text: `${c.id} on Mixkit` }),
                      button({ kind: 'primary', small: true, label: 'Use', onClick: () => { useClip(s, c.id); drawPicked(); tile.classList.add('picked'); chosenRefresh(); } }),
                    ]),
                  ]),
                ]);
                return tile;
              })));
            }
          } catch (err) {
            if (err.status === 424) { S.bv = { ok: false, message: err.message, command: err.detail?.command }; }
            showAiError(err);
            results.replaceChildren();
          }
          searchBtn.disabled = !bv.ok;
        },
      });
      return el('div', { class: 'vid-scene-card' }, [
        el('h3', { text: `Scene ${s.n}, chapter ${s.chapter}` }),
        el('div', { class: 'vid-scene-say', text: s.say.length > 220 ? `${s.say.slice(0, 220)}...` : s.say }),
        s.sees ? el('div', { class: 'vid-note', text: `Sees: ${s.sees}` }) : null,
        el('div', { class: 'vid-search', style: { marginTop: '8px' } }, [q, searchBtn]),
        picked, results,
      ]);
    }
    function chosenRefresh() { /* the counts above refresh on the next visit; the cards are already current */ }

    function drawList() {
      const list = brollScenes.filter((s) => (!chapterFilter || String(s.chapter) === chapterFilter)
        && (!onlyOpen || !((v.footage.find((f) => f.scene === s.n)?.ids || []).length || (s.clipPath && /^clips\//.test(s.clipPath)))));
      listHost.replaceChildren(...list.slice(0, shown).map(sceneCard));
      if (!list.length) listHost.appendChild(empty({ title: 'Nothing to choose', hint: onlyOpen ? 'Every b-roll scene in this view has a clip.' : 'There are no b-roll scenes here.' }));
      moreBtn.classList.toggle('hidden', list.length <= shown);
    }
    drawList();

    // footage list and shot plan as written
    const mdHost = el('div');
    root.appendChild(card({
      title: 'Footage list and shot plan', flat: true,
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'These two files are written into the project folder at the hand-off. Here is how they read now.' }),
        button({
          kind: 'secondary', small: true, label: 'Show them',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            try { const r = await api.get(`/video/${encodeURIComponent(id)}/footage-list`); mdHost.replaceChildren(codeBlock(r.footageList, { title: 'footage-list.md', light: true }), codeBlock(r.shotPlan, { title: 'shot-plan.md', light: true })); }
            catch (err) { toast(err.message, 'bad'); }
          },
        }),
        mdHost,
      ]),
    }));
    root.appendChild(nextBar('scenes', 'voice', null, () => advanceTo('voice')));
    return root;
  }

  // ================================================================ Voice
  async function panelVoice() {
    const v = S.video;
    const root = el('div');
    if (!String(v.script || '').trim()) {
      root.appendChild(empty({ title: 'The voice reads the script', hint: 'Write the script first.', action: button({ kind: 'primary', label: 'Go to the script', onClick: () => go('script') }) }));
      return root;
    }
    let vs; let files;
    try { [vs, files] = await Promise.all([api.get(`/video/${encodeURIComponent(id)}/voice-script`), api.get(`/video/${encodeURIComponent(id)}/files`)]); }
    catch (err) { root.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return root; }

    const full = vs.chapters.map((c) => `${c.n}. ${c.title}\n\n${c.spoken}`).join('\n\n\n');
    root.appendChild(card({
      title: 'Record the voice', eyebrow: 'Step 5',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'Record in your own voice, or generate it in ElevenLabs. Either way, read the text below, where every number, amount and acronym is written as it is said. Read at a steady pace; the picture is cut to the recording afterwards.' }),
        el('div', { class: 'vid-stat' }, [
          el('div', {}, [el('b', { text: String(vs.words) }), el('span', { text: 'spoken words' })]),
          el('div', {}, [el('b', { text: `${vs.minutes}` }), el('span', { text: `minutes at ${WPM} words a minute` })]),
        ]),
        el('div', { class: 'vid-actions' }, [button({ kind: 'secondary', label: 'Copy the whole script', icon: 'next', onClick: () => copyText(full, 'The whole script is on the clipboard') })]),
      ]),
    }));
    for (const c of vs.chapters) {
      root.appendChild(card({
        title: `${c.n}. ${c.title}`, flat: true,
        actions: [el('span', { class: 'vid-count', text: `${c.words} words, ${c.minutes} min` }), button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(c.spoken, `Chapter ${c.n} copied`) })],
        body: el('div', { class: 'vid-spoken', text: c.spoken }),
      }));
    }

    // the recording
    const current = files.voice.find((f) => /^vo-original\./.test(f.name));
    const drop = el('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/*' });
    const pathIn = input({ placeholder: '/Users/palakgupta/Movies/reminder-desk-voice.mp3' });
    const status = el('div', { class: 'vid-note' });
    const done = (r) => { S.video = r.video; toast('The voice file is saved', 'ok'); drawHead(); drawStepper(); drawPanel(); };
    const uploadBtn = button({
      kind: 'primary', icon: 'upload', label: 'Upload the recording',
      onClick: async () => {
        const f = drop.files[0];
        if (!f) { toast('Choose the recording first', 'warn'); return; }
        if (f.size > MAX_UPLOAD_MB * 1048576) { toast(`Files over ${MAX_UPLOAD_MB} MB cannot be uploaded here. Use the path below instead.`, 'warn', { ms: 7000 }); return; }
        uploadBtn.disabled = true; status.textContent = 'Uploading';
        try { const fd = new FormData(); fd.append('file', f, f.name); done(await api.post(`/video/${encodeURIComponent(id)}/voice`, fd)); }
        catch (err) { status.textContent = err.message; toast(err.message, 'bad'); uploadBtn.disabled = false; }
      },
    });
    const pathBtn = button({
      kind: 'secondary', label: 'Use this file',
      onClick: async () => {
        if (!pathIn.value.trim()) { toast('Give the full path of the file', 'warn'); return; }
        try { done(await api.post(`/video/${encodeURIComponent(id)}/voice`, { path: pathIn.value.trim() })); } catch (err) { toast(err.message, 'bad'); }
      },
    });
    root.appendChild(card({
      title: 'The recording',
      body: el('div', {}, [
        current
          ? el('p', {}, [chip({ label: current.name, tone: 'ok' }), ` ${mb(current.bytes)}, saved ${fmt.dateTime(current.at)}. Uploading again replaces it.`])
          : el('p', { class: 'vid-note', text: 'No recording yet. The pipeline reads it as voice/vo-original.mp3 (or .wav or .m4a).' }),
        el('div', { class: 'vid-actions' }, [drop, uploadBtn]),
        el('p', { class: 'vid-note', text: `Uploads are limited to ${MAX_UPLOAD_MB} MB. For a longer file, give its full path on this Mac and Studio links it into the project folder.` }),
        el('div', { class: 'vid-search' }, [pathIn, pathBtn]),
        status,
        el('p', { class: 'vid-note', text: 'ElevenLabs limits the length of one generation. Generate chapter by chapter, join the files in order, and save the result as one recording.' }),
      ]),
    }));
    root.appendChild(nextBar('footage', 'own-clips', null, () => advanceTo('own-clips')));
    return root;
  }

  // ================================================================ Own clips
  async function panelOwnClips() {
    const v = S.video;
    const root = el('div');
    if (!(v.scenes || []).length) {
      root.appendChild(empty({ title: 'Clips are mapped to scenes', hint: 'Plan the scenes first.', action: button({ kind: 'primary', label: 'Go to the scenes', onClick: () => go('scenes') }) }));
      return root;
    }
    let files;
    try { files = await api.get(`/video/${encodeURIComponent(id)}/files`); } catch (err) { root.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return root; }
    const clips = v.ownClips || [];
    const clipOf = (n) => clips.find((c) => c.scene === n);
    const faceScenes = v.scenes.filter((s) => s.kind === 'face');
    const screenScenes = v.scenes.filter((s) => s.kind === 'screen');
    const reload = (r) => { S.video = r.video; drawHead(); drawStepper(); drawPanel(); };

    async function uploadFor(sceneN, file, label) {
      if (file.size > MAX_UPLOAD_MB * 1048576) {
        toast(`Clips over ${MAX_UPLOAD_MB} MB cannot be uploaded here. Copy the file into video/${id}/clips/ and register it below.`, 'warn', { ms: 9000 });
        return;
      }
      const seconds = await videoDuration(file);
      const fd = new FormData();
      fd.append('scene', String(sceneN || '')); fd.append('label', label || file.name.replace(/\.[^.]+$/, '')); if (seconds) fd.append('seconds', String(seconds));
      fd.append('file', file, file.name);
      try { reload(await api.post(`/video/${encodeURIComponent(id)}/own-clips`, fd)); toast('Clip saved', 'ok'); }
      catch (err) { toast(err.message, 'bad', { ms: 7000 }); }
    }

    const needRow = (s) => {
      const c = clipOf(s.n);
      const fileIn = el('input', { type: 'file', accept: 'video/*', 'aria-label': `Clip for scene ${s.n}`, onChange: (e) => { if (e.target.files[0]) uploadFor(s.n, e.target.files[0], `Scene ${s.n}`); } });
      return el('div', { class: 'vid-scene-card' }, [
        el('h3', { text: `Scene ${s.n}, chapter ${s.chapter}` }),
        el('div', { class: 'vid-scene-say', text: s.say }),
        s.sees ? el('div', { class: 'vid-note', text: s.kind === 'face' ? `Framing: ${s.sees}` : `Show: ${s.sees}` }) : null,
        el('div', { class: 'row', style: { marginTop: '8px' } }, [
          c ? chip({ label: `${c.path.replace('clips/', '')}${c.seconds ? `, ${c.seconds} s` : ''}`, tone: 'ok' }) : chip({ label: 'Not recorded', tone: 'warn' }),
          fileIn,
        ]),
      ]);
    };

    root.appendChild(card({
      title: 'Your own clips', eyebrow: 'Step 6',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'Record the face scenes to camera, and the screen scenes as recordings of the masked copy. Upload each against its scene. A clip mapped to a scene replaces the stock or designed picture for it.' }),
        el('div', { class: 'vid-stat' }, [
          el('div', {}, [el('b', { text: `${faceScenes.filter((s) => clipOf(s.n)).length} / ${faceScenes.length}` }), el('span', { text: 'face scenes recorded' })]),
          el('div', {}, [el('b', { text: `${screenScenes.filter((s) => clipOf(s.n)).length} / ${screenScenes.length}` }), el('span', { text: 'screen scenes recorded' })]),
        ]),
      ]),
    }));

    if (faceScenes.length) {
      root.appendChild(el('div', { class: 'section-title' }, [el('h2', { text: 'To camera' }), el('span', { class: 'count', text: String(faceScenes.length) })]));
      for (const n of FACE_CHAPTERS) {
        const ch = (v.outline || []).find((c) => c.n === n);
        const sc = faceScenes.filter((s) => s.chapter === n);
        if (!sc.length) continue;
        if (ch?.toCamera?.length) root.appendChild(el('p', { class: 'vid-note' }, [el('b', { text: `Chapter ${n}: ` }), `Questions to answer: ${ch.toCamera.join(' ')}`]));
        sc.forEach((s) => root.appendChild(needRow(s)));
      }
      faceScenes.filter((s) => !FACE_CHAPTERS.includes(s.chapter)).forEach((s) => root.appendChild(needRow(s)));
    }

    if (screenScenes.length) {
      const det = el('details', { class: 'vid-details' }, [
        el('summary', {}, [el('span', { text: 'Screen recordings of the build' }), chip({ label: plural(screenScenes.length, 'scene', 'scenes'), tone: 'muted' })]),
        el('div', { class: 'vid-details-body' }, screenScenes.map(needRow)),
      ]);
      root.appendChild(det);
    }

    // everything registered, and a way to register a big file
    const regRows = clips.map((c) => ({ ...c }));
    const sceneOpts = [{ value: '', label: 'Not mapped' }, ...v.scenes.filter((s) => s.kind === 'face' || s.kind === 'screen' || s.clipPath === undefined).map((s) => ({ value: String(s.n), label: `Scene ${s.n} (${KIND_LABEL[s.kind]}, chapter ${s.chapter})` }))];
    root.appendChild(card({
      title: 'All registered clips',
      body: table({
        rowKey: 'path', rows: regRows, empty: 'No clip is registered yet.',
        columns: [
          { key: 'path', label: 'File', mono: true, render: (c) => c.path.replace('clips/', '') },
          { key: 'label', label: 'Label' },
          { key: 'seconds', label: 'Seconds', num: true, render: (c) => (c.seconds ? String(c.seconds) : '') },
          {
            key: 'scene', label: 'Scene', render: (c) => select({
              options: sceneOpts, value: c.scene ? String(c.scene) : '',
              onChange: async (e) => { try { reload(await api.post(`/video/${encodeURIComponent(id)}/own-clips`, { action: 'map', path: c.path, scene: e.target.value || null })); } catch (err) { toast(err.message, 'bad'); } },
            }),
          },
          {
            key: 'x', label: '', render: (c) => button({
              kind: 'ghost', small: true, icon: 'trash', title: 'Remove from the project (the file stays in clips/)',
              onClick: async () => { try { reload(await api.post(`/video/${encodeURIComponent(id)}/own-clips`, { action: 'remove', path: c.path })); } catch (err) { toast(err.message, 'bad'); } },
            }),
          },
        ],
      }),
    }));

    const unreg = files.clips.filter((f) => !f.registered);
    const folderSel = select({ options: unreg.map((f) => ({ value: f.name, label: `${f.name} (${mb(f.bytes)})` })), placeholder: unreg.length ? 'Choose a file in clips/' : 'No unregistered file in clips/' });
    const folderScene = select({ options: sceneOpts, value: '' });
    const pathIn = input({ placeholder: '/Users/palakgupta/Movies/face-problem.mov' });
    const pathScene = select({ options: sceneOpts, value: '' });
    const reg = async (body) => { try { reload(await api.post(`/video/${encodeURIComponent(id)}/own-clips`, { action: 'register', ...body })); toast('Clip registered', 'ok'); } catch (err) { toast(err.message, 'bad', { ms: 7000 }); } };
    root.appendChild(card({
      title: 'Large clips', flat: true,
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: `Uploads are limited to ${MAX_UPLOAD_MB} MB, and phone clips are often larger. Copy the file into video/${id}/clips/ in Finder, or give its full path on this Mac. Studio links it into the project; nothing is re-encoded.` }),
        el('div', { class: 'vid-search' }, [folderSel, folderScene, button({ kind: 'secondary', label: 'Register', onClick: () => { if (!folderSel.value) { toast('Choose a file first', 'warn'); return; } reg({ file: folderSel.value, scene: folderScene.value || null }); } })]),
        el('div', { class: 'vid-search', style: { marginTop: '10px' } }, [pathIn, pathScene, button({ kind: 'secondary', label: 'Link this file', onClick: () => { if (!pathIn.value.trim()) { toast('Give the full path of the file', 'warn'); return; } reg({ path: pathIn.value.trim(), scene: pathScene.value || null }); } })]),
      ]),
    }));
    root.appendChild(nextBar('voice', 'edit', null, () => advanceTo('edit')));
    return root;
  }

  // ================================================================ Edit
  async function panelEdit() {
    const v = S.video;
    const root = el('div');
    const bv = await ensureBv();
    const sc = v.scenes || [];
    const stockScenes = sc.filter((s) => s.kind === 'broll');
    const haveStock = stockScenes.filter((s) => (v.footage || []).find((f) => f.scene === s.n)?.ids?.length || s.clipPath).length;
    const face = sc.filter((s) => s.kind === 'face');
    const ready = [
      { ok: Boolean(String(v.script || '').trim()), label: 'Script written', detail: `${words(parseScript(v.script).map((c) => c.text).join(' '))} words` },
      { ok: sc.length > 0, label: 'Scenes planned', detail: `${sc.length} scenes` },
      { ok: stockScenes.length === 0 || haveStock === stockScenes.length, label: 'B-roll chosen', detail: `${haveStock} of ${stockScenes.length} scenes have a clip` },
      { ok: face.length === 0 || face.every((s) => s.clipPath), label: 'Face scenes recorded', detail: `${face.filter((s) => s.clipPath).length} of ${face.length}` },
      { ok: Boolean(v.voice), label: 'Voice recording saved', detail: v.voice ? v.voice.file : 'None yet; the pipeline waits for voice/vo-original.mp3' },
    ];
    const resultHost = el('div');

    const showResult = (r) => {
      resultHost.replaceChildren(
        card({
          title: 'The hand-off is written', eyebrow: r.at ? fmt.dateTime(r.at) : undefined,
          body: el('div', {}, [
            el('p', {}, ['The project folder is ', el('code', { text: r.path })]),
            el('div', { class: 'vid-actions' }, [button({ kind: 'secondary', small: true, label: 'Copy the folder path', onClick: () => copyText(r.path) })]),
            el('ul', { class: 'vid-files' }, r.files.map((f) => el('li', {}, el('code', { text: f })))),
            r.warnings?.length ? el('div', {}, [el('div', { class: 'eyebrow', text: 'Still open', style: { marginTop: '12px' } }), warnList(r.warnings)]) : null,
            codeBlock(r.commands.join('\n'), { title: 'The commands, in order (run in a terminal)' }),
            codeBlock(r.prompt, { title: 'The Claude Code prompt (open Claude Code, then paste)' }),
          ]),
        }),
      );
    };
    if (v.handoff) showResult({ ...v.handoff, files: v.handoff.files || [] });

    const handBtn = button({
      kind: 'primary', icon: 'sparkle', label: v.handoff ? 'Write the hand-off again' : 'Hand off to Claude Code',
      onClick: async () => {
        if (S.busy) return;
        handBtn.disabled = true;
        const r = await server('handoff', {}, { busy: 'Writing the project folder.' });
        handBtn.disabled = false;
        if (r) { showResult({ ...r, at: new Date().toISOString() }); toast('The hand-off folder is written', 'ok'); drawHead(); drawStepper(); }
      },
    });

    root.appendChild(card({
      title: 'Edit in the brand-video pipeline', eyebrow: 'Step 7',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'The hand-off writes script.md, brand.json, scenes-plan.json, footage-list.md, shot-plan.md and HANDOFF.md into the project folder, with the exact bv commands and a prompt to paste into Claude Code. Nothing is built or rendered from here.' }),
        !bv.ok ? el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', {}, [el('div', { text: bv.message }), bv.command ? el('div', { class: 'vid-cmd', style: { marginTop: '8px' } }, [el('code', { text: bv.command }), button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(bv.command) })]) : null])]) : null,
        el('ul', { class: 'vid-checks' }, ready.map((r) => el('li', {}, [
          el('span', { class: `pill pill-${r.ok ? 'ok' : 'warn'}`, text: r.ok ? 'Ready' : 'Open' }),
          el('div', {}, [r.label, el('small', { text: r.detail })]),
        ]))),
        el('div', { class: 'vid-actions', style: { marginTop: '14px' } }, [handBtn]),
        el('p', { class: 'vid-note', text: 'Open items do not stop the hand-off; they are listed in HANDOFF.md.' }),
      ]),
    }));
    root.appendChild(resultHost);
    root.appendChild(nextBar('own-clips', 'shorts', null, null));
    return root;
  }

  // ================================================================ Shorts
  async function panelShorts() {
    const v = S.video;
    const root = el('div');
    const ids = v.shortsPieceIds || [];
    const pieces = (await Promise.all(ids.map((pid) => api.get(`/pieces/${encodeURIComponent(pid)}`).catch(() => null)))).filter(Boolean);
    const count = select({ options: ['2', '3', '4'].map((x) => ({ value: x, label: `${x} Shorts` })), value: '3' });
    const makeBtn = button({
      kind: 'primary', icon: 'sparkle', label: pieces.some((p) => p.status !== 'retired') ? 'Make new Shorts' : 'Make Shorts',
      onClick: async () => {
        if (S.busy) return;
        const existing = pieces.filter((p) => p.status !== 'retired');
        if (existing.length && !(await confirm({ title: 'Make new Shorts', message: 'The Shorts still in draft are retired and new ones are made. Shorts you have already moved on are left alone.', confirmLabel: 'Make new Shorts' }))) return;
        makeBtn.disabled = true;
        const r = await server('shorts', { count: parseInt(count.value, 10), replace: existing.length > 0 }, { busy: 'Choosing the moments and writing the Shorts. This takes up to a minute.' });
        makeBtn.disabled = false;
        if (r) { S.warnings.shorts = r.warnings || []; toast(`${plural(r.pieces.length, 'Short', 'Shorts')} added to the library`, 'ok'); drawHead(); drawStepper(); drawPanel(); }
      },
    });
    root.appendChild(card({
      title: 'Shorts', eyebrow: 'Step 8',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'Two to four Shorts of 20 to 45 seconds, each a complete problem, impact and solution with a new first line, cut from a chapter of the long video. They go into the library as drafts, linked to this project.' }),
        el('div', { class: 'vid-actions' }, [count, makeBtn, button({ kind: 'ghost', label: 'View the prompt', onClick: () => showPrompt('shorts', { count: parseInt(count.value, 10) }) })]),
        warnList(S.warnings.shorts),
      ]),
    }));
    if (!pieces.length) {
      root.appendChild(empty({ title: 'No Shorts yet', hint: 'They are made from the script, so write it first.' }));
    } else {
      root.appendChild(card({
        title: 'In the library',
        body: table({
          rowKey: 'id', rows: pieces,
          onRowClick: (p) => { location.hash = `#/content/${encodeURIComponent(p.id)}`; },
          columns: [
            { key: 'hook', label: 'Hook', render: (p) => el('a', { href: `#/content/${encodeURIComponent(p.id)}`, text: p.hook || p.id }) },
            { key: 'title', label: 'YouTube title', render: (p) => p.renditions?.yt?.title || '' },
            { key: 'secs', label: 'Seconds', num: true, render: (p) => String(Math.round((p.script || []).reduce((a, l) => a + (Number(l.seconds) || 0), 0))) },
            { key: 'notes', label: 'From', render: (p) => el('span', { class: 'vid-note', text: (/chapter \d[^;]*; [^.]*/.exec(p.notes || '') || [''])[0] }) },
            { key: 'status', label: 'Status', render: (p) => statusPill(p.status) },
          ],
        }),
      }));
    }
    root.appendChild(nextBar('edit', 'done', null, null));
    return root;
  }

  // ================================================================ Done
  async function panelDone() {
    const v = S.video;
    const root = el('div');
    let info;
    try { info = await api.get(`/video/${encodeURIComponent(id)}/youtube`); } catch (err) { root.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return root; }
    const mp4 = input({ value: v.final?.mp4Path || '', placeholder: '/Users/palakgupta/Movies/reminder-desk.mp4' });
    const titleIn = input({ value: info.title });
    const descIn = textarea({ rows: 14, value: info.description });
    const notes = textarea({ rows: 3, value: v.final?.notes || '' });
    const checksHost = el('div');
    const checkHost = el('div');

    const drawChecks = (list) => {
      const tone = { pass: 'ok', warn: 'warn', fail: 'bad' };
      const label = { pass: 'Pass', warn: 'Check', fail: 'Fix' };
      checksHost.replaceChildren(el('ul', { class: 'vid-checks' }, list.map((c) => el('li', {}, [
        el('span', { class: `pill pill-${tone[c.status]}`, text: label[c.status] }),
        el('div', {}, [c.label, c.detail ? el('small', { text: c.detail }) : null]),
      ]))));
    };
    drawChecks(info.checks);

    const stampText = info.chapters.map((c) => `${c.stamp} ${c.title}`).join('\n');
    const saveToPiece = async () => {
      if (!S.piece) { toast('This project has no linked piece', 'warn'); return null; }
      try {
        const piece = await api.get(`/pieces/${encodeURIComponent(S.piece.id)}`);
        const renditions = { ...(piece.renditions || {}), yt: { ...(piece.renditions?.yt || {}), title: titleIn.value.trim(), description: descIn.value } };
        S.piece = await api.patch(`/pieces/${encodeURIComponent(piece.id)}`, { renditions, changeNote: 'YouTube title and description from the video project' });
        return S.piece;
      } catch (err) { toast(err.message, 'bad'); return null; }
    };
    const checkBtn = button({
      kind: 'secondary', label: 'Save to the piece and run the checker',
      onClick: async () => {
        checkBtn.disabled = true;
        const p = await saveToPiece();
        if (p) {
          try {
            const r = await api.post(`/pieces/${encodeURIComponent(p.id)}/check`, {});
            checkHost.replaceChildren(r.passed
              ? el('div', { class: 'banner banner-info' }, [icon('check'), el('div', { text: 'The checker found nothing to block or warn about.' })])
              : el('div', {}, [el('div', { class: `banner banner-${(r.violations || []).some((x) => x.severity === 'block') ? 'bad' : 'warn'}` }, [icon('warn'), el('div', { text: `${plural((r.violations || []).length, 'item', 'items')} from the checker` })]),
                el('ul', { class: 'vid-warns' }, (r.violations || []).map((x) => el('li', { text: `${x.text}${x.fix ? ` Fix: ${x.fix}` : ''}` })))]));
          } catch (err) { checkHost.replaceChildren(el('div', { class: 'banner banner-warn', text: `The checker is not available: ${err.message}` })); }
        }
        checkBtn.disabled = false;
      },
    });
    const doneBtn = button({
      kind: 'primary', icon: 'approve', label: v.status === 'done' ? 'Update the record' : 'Mark as done',
      onClick: async () => {
        doneBtn.disabled = true;
        const r = await server('done', { mp4Path: mp4.value.trim(), title: titleIn.value.trim(), description: descIn.value, notes: notes.value }, { busy: 'Saving.' });
        doneBtn.disabled = false;
        if (r) { drawChecks(r.checks); toast('The project is marked done', 'ok'); drawHead(); drawStepper(); }
      },
    });

    root.appendChild(card({
      title: 'Done', eyebrow: 'Step 9',
      body: el('div', {}, [
        el('p', { class: 'vid-note', text: 'Record the finished file, then take the title, the description and the chapter timestamps for YouTube. The chapter times follow the planned timing; check them against the final video before publishing.' }),
        field({ label: 'Final MP4 (full path on this Mac)', input: mp4 }),
        field({ label: 'YouTube title', input: titleIn }), el('div', { style: { marginTop: '-8px', marginBottom: '12px' } }, counter(titleIn, 69)),
        el('div', { class: 'vid-copyrow' }, [el('span', { class: 'field-label', text: 'Description' }), button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(descIn.value, 'Description copied') })]),
        descIn, el('div', { style: { marginTop: '6px', marginBottom: '12px' } }, counter(descIn, 5000)),
        field({ label: 'Notes', input: notes }),
        el('div', { class: 'vid-actions' }, [checkBtn, doneBtn]),
        checkHost,
      ]),
    }));
    root.appendChild(card({
      title: 'Chapter timestamps', flat: true,
      actions: [button({ kind: 'secondary', small: true, label: 'Copy', onClick: () => copyText(stampText, 'Timestamps copied') })],
      body: info.chapters.length ? el('pre', { class: 'vid-pre vid-pre-light', text: stampText }) : el('p', { class: 'vid-note', text: 'No chapters yet. Draft the outline.' }),
    }));
    root.appendChild(card({ title: 'Ready for YouTube', flat: true, body: checksHost }));
    root.appendChild(nextBar('shorts', null, null, null));
    return root;
  }

  // ---- first paint
  drawHead();
  drawStepper();
  drawPanel();

  return () => {
    alive = false;
    flush();
  };
}
