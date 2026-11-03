// Review (#/review), phone first, by role (docs/ROLES.md section 4). [content]
// One card at a time, oldest first, from GET /api/review/queue: the hook, the type,
// the planned slot, the previews, the checker summary, the change note of the latest
// version and, where there is one, the original beside the proposal.
//
//   employee   "Your pieces under review": where each stands, and the note when sent back.
//   manager    "Your queue" (in-review): Approve, Send to director, Request changes;
//              "With the director" (director-review), to read.
//   director   "Awaiting you" (director-review), the manager's note on top: Approve,
//              Request changes, Return to manager; the manager's queue, to act on too.
//
// Swipe, the arrow keys or the buttons move between cards. `?tab=` and `?piece=` open
// a given list or piece.

import { api } from '../api.js';
import { me } from '../roles.js';
import { el, button, chip, statusPill, dialog, toast, empty, fmt, tabs, switchInput, icon, bullets } from '../ui.js';
import {
  ensureStyles, loadRefs, typeLabel, pillarLabel, renditionKeys, RENDITION_LABEL, previewNode, mediaOf,
  checkSummary, violationList, compareView, aiFailed, directorRoute, noteDialog, trailList,
} from './piece.js';

export const route = '#/review';
export const title = 'Review';

const byPlanned = (a, b) => `${a.plannedDate || '9999'} ${a.plannedTime || ''} ${a.id}`.localeCompare(`${b.plannedDate || '9999'} ${b.plannedTime || ''} ${b.id}`);
const lower = (v) => String(v || '').toLowerCase();

/** The three lists. Falls back to the piece list while the server has no /review/queue. */
async function loadQueue(email) {
  try {
    const q = await api.get('/review/queue');
    if (q && Array.isArray(q.manager)) return { manager: q.manager, director: q.director || [], mine: q.mine || [] };
  } catch (err) { if (err.status === 0 || err.status === 401) throw err; }
  const [inReview, withDirector, sentBack] = await Promise.all([
    api.get('/pieces', { status: 'in-review' }),
    api.get('/pieces', { status: 'director-review' }).catch(() => []),
    api.get('/pieces', { status: 'changes-requested' }).catch(() => []),
  ]);
  const who = lower(email);
  const mine = who ? [...inReview, ...withDirector, ...sentBack].filter((p) => lower(p.by) === who || lower(p.lastBy) === who) : [];
  return { manager: inReview.sort(byPlanned), director: withDirector.sort(byPlanned), mine: mine.sort(byPlanned) };
}

export async function render(container, params) {
  ensureStyles();
  container.appendChild(el('div', { class: 'loading', text: 'Loading the queue' }));
  let lists; let refs; let who;
  try {
    [refs, who] = await Promise.all([loadRefs(), me()]);
    lists = await loadQueue(who.email || api.user.get());
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not load the queue: ${err.message}` }));
    return;
  }
  container.replaceChildren();

  const role = who.role || 'employee';
  const can = who.can || {};
  const director = role === 'director';
  const short = Object.fromEntries(refs.accounts.map((a) => [a.id, a.short || a.id]));
  const nameOf = (by) => (refs.settings?.users || []).find((u) => lower(u.email) === lower(by))?.name || by || '';

  // The tabs each role sees, its own work first.
  const tabDefs = () => {
    const t = role === 'director'
      ? [{ id: 'director', label: 'Awaiting you' }, { id: 'manager', label: 'The manager\'s queue' }]
      : role === 'manager'
        ? [{ id: 'manager', label: 'Your queue' }, { id: 'director', label: 'With the director' }]
        : [{ id: 'mine', label: 'Your pieces under review' }];
    if (role !== 'employee' && lists.mine.length) t.push({ id: 'mine', label: 'Your pieces' });
    return t.map((x) => ({ ...x, label: `${x.label} (${lists[x.id].length})` }));
  };
  const ids = tabDefs().map((t) => t.id);
  let active = ids.includes(params.query?.tab) ? params.query.tab
    : (params.query?.piece && ids.find((id) => lists[id].some((p) => p.id === params.query.piece))) || ids[0];
  const pos = { manager: 0, director: 0, mine: 0 };
  if (params.query?.piece) pos[active] = Math.max(0, lists[active].findIndex((p) => p.id === params.query.piece));
  let showOriginal = false;
  let alive = true;
  const cache = new Map();   // pieceId -> { versions, check }
  const list = () => lists[active];

  const head = el('div', { class: 'rv-head' });
  const tabHost = el('div', { class: 'rv-tabs' });
  const cardHost = el('div');
  container.append(tabHost, head, cardHost, el('div', { class: 'rv-pad' }));

  // ----------------------------------------------------------- the header
  function drawHead() {
    const defs = tabDefs();
    if (!defs.some((t) => t.id === active)) active = defs[0].id;
    tabHost.replaceChildren(defs.length > 1
      ? tabs({ items: defs, active, onChange: (id) => { active = id; showOriginal = false; history.replaceState(null, '', `#/review?tab=${id}`); draw(); } })
      : el('div', { class: 'section-title' }, el('h2', { text: defs[0].label })));
    const q = list(); const idx = pos[active];
    const prev = button({ kind: 'secondary', small: true, icon: 'back', title: 'Previous', 'aria-label': 'Previous', disabled: idx <= 0, onClick: () => go(-1) });
    const next = button({ kind: 'secondary', small: true, icon: 'next', title: 'Next', 'aria-label': 'Next', disabled: idx >= q.length - 1, onClick: () => go(1) });
    head.replaceChildren(
      el('div', { class: 'rv-nav' }, [prev, el('span', { class: 'rv-pos', text: q.length ? `${idx + 1} of ${q.length}` : '0 of 0' }), next]),
      el('span', { class: 'ct-spacer' }),
      can.approve ? button({ kind: 'ghost', small: true, icon: 'sparkle', label: 'Review pass', title: 'AI review of pieces with only their original text', onClick: reviewPass }) : null,
    );
  }

  function go(d) {
    const n = pos[active] + d;
    if (n < 0 || n >= list().length) return;
    pos[active] = n; showOriginal = false; draw();
    window.scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------ the card
  async function dataFor(piece) {
    if (cache.has(piece.id)) return cache.get(piece.id);
    const [versions, check] = await Promise.all([
      api.get(`/pieces/${encodeURIComponent(piece.id)}/versions`).catch(() => []),
      api.post(`/pieces/${encodeURIComponent(piece.id)}/check`, {}).catch(() => null),
    ]);
    const d = { versions, check };
    cache.set(piece.id, d);
    return d;
  }

  function emptyFor(tab) {
    if (tab === 'mine') return { title: 'None of your pieces is under review', hint: 'Submit one from the editor or the library to see it here.' };
    if (tab === 'manager') return director
      ? { title: 'The manager\'s queue is empty', hint: 'Submitted pieces wait here for the manager, oldest first.' }
      : { title: 'Your queue is empty', hint: 'Pieces submitted for review appear here, oldest first.' };
    return director
      ? { title: 'Nothing is awaiting you', hint: 'Pieces the manager sends you appear here, with a note.' }
      : { title: 'Nothing is with the director', hint: 'Pieces you send on stay here until the director decides.' };
  }

  async function draw() {
    drawHead();
    const q = list();
    if (!q.length) {
      cardHost.replaceChildren(empty({ ...emptyFor(active), action: button({ kind: 'secondary', label: 'Open the library', href: '#/content' }) }));
      return;
    }
    const piece = q[pos[active]];
    const mine = piece.id;
    const tab = active;
    cardHost.replaceChildren(el('div', { class: 'loading', text: 'Loading the piece' }));
    const { versions, check } = await dataFor(piece);
    if (!alive || active !== tab || list()[pos[active]]?.id !== mine) return;
    cardHost.replaceChildren(card_(piece, versions, check));
  }

  /** Where the piece stands and why, above the hook: the route, the manager's note, the change request. */
  function standing(piece, check) {
    const nodes = [];
    const st = piece.status;
    const r = directorRoute(piece, refs.settings, check);
    if (st === 'director-review') {
      const e = piece.escalation || {};
      const lead = director ? 'Note from the manager' : (lower(e.by) === lower(who.email) ? 'Your note to the director' : 'Note to the director');
      nodes.push(el('div', { class: 'rv-escalation' }, [
        el('b', { text: `${lead}${e.by && !lead.startsWith('Your') ? `, ${nameOf(e.by)}` : ''}${e.at ? `, ${fmt.dateTime(e.at)}` : ''}: ` }),
        e.note || 'No note was given.',
      ]));
    }
    if (st === 'changes-requested') {
      const rv = piece.review || {};
      nodes.push(el('div', { class: 'banner banner-warn rv-route' }, [icon('warn'), el('div', {}, [
        el('b', { text: 'Changes requested. ' }), `${rv.by ? `${nameOf(rv.by)}: ` : ''}${rv.note || 'No note was given.'}`,
        el('div', { class: 'note', text: 'Revise, then submit again.' }),
      ])]));
    }
    if (st === 'in-review' && r.needsDirector) {
      nodes.push(el('div', { class: `banner ${director ? 'banner-info' : 'banner-warn'} rv-route` }, [icon('review'), el('div', {}, [
        el('b', { text: 'Goes to the director. ' }), `${r.why}.`,
        role === 'manager' ? el('div', { class: 'note', text: 'Send it on; a manager cannot approve it.' }) : director ? el('div', { class: 'note', text: 'You may approve it here.' }) : null,
      ])]));
    }
    return nodes;
  }

  function card_(piece, versions, check) {
    const latest = versions[versions.length - 1];
    const proposal = versions.length > 1;
    const blocks = (check?.violations || []).filter((v) => v.severity === 'block').length;
    const root = el('article', { class: 'rv-card', 'aria-label': piece.hook || piece.id });
    const where = { 'in-review': 'With the manager', 'director-review': 'With the director', 'changes-requested': 'Sent back to the author' }[piece.status];

    root.append(
      ...standing(piece, check),
      el('span', { class: 'eyebrow', text: `${typeLabel(piece.type)} · ${pillarLabel(piece.pillar)} · ${piece.id}` }),
      el('h2', { class: 'rv-hook', text: piece.hook || '(no hook yet)' }),
      el('div', { class: 'rv-meta' }, [
        statusPill(piece.status),
        active === 'mine' && where && piece.status !== 'director-review' ? chip({ label: where, tone: 'muted' }) : null,
        piece.plannedDate
          ? el('span', { class: 'rv-slot', text: `${fmt.weekday(piece.plannedDate)} ${fmt.date(piece.plannedDate)}${piece.plannedTime ? `, ${piece.plannedTime}` : ''}` })
          : el('span', { class: 'note', text: 'Not placed in the calendar' }),
        ...(piece.targets || []).map((t) => chip({ label: short[t] || t, tone: 'muted' })),
      ]),
    );

    // the change note of the latest version
    root.appendChild(el('div', { class: 'rv-sec' }, [
      el('span', { class: 'eyebrow', text: proposal ? `Version ${latest.n} · ${latest.by || 'unknown'}` : 'Version 1' }),
      el('div', { class: 'rv-note', text: latest?.changeNote || (proposal ? 'No change note.' : 'Original text, as it stands in the repository.') }),
    ]));

    // original beside the proposal
    if (proposal || piece.source) {
      const holder = el('div');
      const toggle = switchInput({
        label: 'Show the original beside the proposal', checked: showOriginal,
        onChange: (e) => { showOriginal = e.target.checked; paint(); },
      });
      const paint = () => {
        if (!showOriginal) { holder.replaceChildren(); return; }
        if (!proposal) { holder.replaceChildren(el('p', { class: 'note', style: { marginTop: '8px' }, text: 'The original. The review pass writes a proposal as version 2.' })); return; }
        holder.replaceChildren(el('div', { style: { marginTop: '10px' } }, compareView(versions[0].snapshot, piece, { leftTitle: 'Original (version 1)', rightTitle: `Proposal (version ${latest.n})` })));
      };
      root.appendChild(el('div', { class: 'rv-sec' }, [toggle, holder]));
      paint();
    }

    // the picture or the video
    const media = mediaOf(piece);
    if (media.videos.length) {
      const v = media.videos[0];
      root.appendChild(el('div', { class: 'rv-sec rv-media' }, [
        el('span', { class: 'eyebrow', text: 'The video' }),
        el('video', { src: v.path, controls: true, preload: 'metadata', playsinline: true, poster: media.images.find((i) => i.kind === 'cover')?.path }),
      ]));
    }
    if (media.images.length > 1) {
      root.appendChild(el('div', { class: 'rv-sec' }, [
        el('span', { class: 'eyebrow', text: `The slides (${media.images.length})` }),
        el('div', { class: 'rv-slides' }, media.images.map((a) => el('img', { src: a.path, alt: a.label || '', loading: 'lazy' }))),
      ]));
    }

    // the previews
    const keys = renditionKeys(piece);
    if (keys.length) {
      const prevHost = el('div', { class: 'rv-preview' });
      let activeKey = keys[0];
      const show = () => prevHost.replaceChildren(previewNode(piece, activeKey));
      const bar = keys.length > 1 ? tabs({ items: keys.map((k) => ({ id: k, label: RENDITION_LABEL[k] })), active: activeKey, onChange: (id) => { activeKey = id; show(); } }) : null;
      root.appendChild(el('div', { class: 'rv-sec' }, [el('span', { class: 'eyebrow', text: 'How it will look' }), bar, prevHost]));
      show();
    } else {
      root.appendChild(el('div', { class: 'rv-sec' }, [el('span', { class: 'eyebrow', text: 'Text' }), el('p', { text: [piece.pis?.problem, piece.pis?.impact, ...(piece.pis?.solution || []), piece.pis?.close].filter(Boolean).join(' ') || 'No text yet.' })]));
    }

    // the script
    if (piece.script?.length) {
      root.appendChild(el('details', { class: 'rv-sec rv-script' }, [
        el('summary', { text: `The script (${piece.script.length} lines)` }),
        el('ol', {}, piece.script.map((r) => el('li', {}, [r.say || '(end card)', ' ', el('span', { class: 'mono', text: `[${r.sees || ''}]` })]))),
      ]));
    }

    // the checker
    root.appendChild(el('details', { class: 'rv-sec', open: blocks > 0 }, [
      el('summary', {}, el('span', { class: 'eyebrow', style: { display: 'inline' }, text: 'The checker' })),
      el('div', { style: { marginTop: '8px' } }, [checkSummary(check), check?.violations?.length ? violationList(check.violations) : null]),
    ]));

    // the review trail
    if (Array.isArray(piece.reviewTrail) && piece.reviewTrail.length) {
      root.appendChild(el('details', { class: 'rv-sec' }, [
        el('summary', {}, el('span', { class: 'eyebrow', style: { display: 'inline' }, text: `Review history (${piece.reviewTrail.length})` })),
        el('div', { style: { marginTop: '8px' } }, trailList(piece.reviewTrail, refs.settings)),
      ]));
    }

    root.appendChild(actionsFor(piece, check, blocks));

    // swipe
    let sx = 0; let sy = 0;
    root.addEventListener('touchstart', (e) => { sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && !e.target.closest('video, .rv-slides, .table-wrap, .ct-cmp')) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    return root;
  }

  // ---------------------------------------------------------- the actions
  /** The buttons for this viewer and this piece; the server refuses anything else. */
  function actionsFor(piece, check, blocks) {
    const st = piece.status;
    const r = directorRoute(piece, refs.settings, check);
    const acts = [];
    let why = '';
    const blockWhy = blocks ? `Checker blocks approval (${blocks}): edit, or request changes.` : '';
    const approveBtn = () => button({ kind: 'primary', icon: 'approve', label: 'Approve', disabled: blocks > 0, onClick: (e) => approve(piece, e.currentTarget) });
    const changesBtn = () => button({ kind: 'secondary', label: 'Request changes', onClick: () => requestChanges(piece) });
    if (st === 'in-review' && can.approve) {
      if (!director && r.needsDirector) {
        acts.push(button({ kind: 'primary', label: 'Send to director', onClick: () => escalate(piece, r) }), changesBtn());
      } else {
        acts.push(approveBtn());
        if (!director) acts.push(button({ kind: 'secondary', label: 'Send to director', onClick: () => escalate(piece, r) }));
        acts.push(changesBtn());
        why = blockWhy;
      }
    } else if (st === 'director-review' && director) {
      acts.push(approveBtn(), changesBtn(), button({ kind: 'secondary', label: 'Return to manager', onClick: () => returnToManager(piece) }));
      why = blockWhy;
    } else if (st === 'director-review') {
      why = 'With the director: approve, request changes or return.';
    } else if (st === 'in-review') {
      why = 'With the manager: approve, request changes or send on.';
    }
    const revise = st === 'changes-requested';
    acts.push(button({ kind: revise ? 'primary' : 'secondary', icon: 'edit', label: revise ? 'Open and revise' : 'Edit', href: `#/content/${encodeURIComponent(piece.id)}` }));
    return el('div', { class: 'rv-actions' }, [why ? el('div', { class: 'rv-why', text: why }) : null, ...acts]);
  }

  /** Fetch the lists again after a step, keeping the place in the current list. */
  async function reload() {
    cache.clear();
    try { lists = await loadQueue(who.email || api.user.get()); } catch (err) { toast(err.message, 'bad'); }
    for (const k of Object.keys(pos)) pos[k] = Math.min(pos[k], Math.max(0, lists[k].length - 1));
    showOriginal = false;
    draw();
  }

  async function approve(piece, btn) {
    btn.disabled = true;
    try {
      await api.post(`/pieces/${encodeURIComponent(piece.id)}/approve`, {});
      toast(`Approved: ${piece.hook || piece.id}`, 'ok');
      reload();
    } catch (err) {
      btn.disabled = false; cache.delete(piece.id);
      if (err.status === 409 && err.detail?.needsDirector) {
        piece.needsDirector = true; piece.needsDirectorWhy = err.detail.why || '';
        toast(`${err.detail.why || 'This piece must reach the director'}. Send it on instead.`, 'warn', { ms: 6000 });
        draw(); return;
      }
      toast(err.message, 'bad');
      if (err.status === 409) draw();
    }
  }

  function escalate(piece, r) {
    noteDialog({
      title: 'Send to director', label: 'Note for the director', sendLabel: 'Send to director',
      placeholder: 'What should the director look at?',
      intro: r.needsDirector ? `${r.why}.` : 'You may approve it; send it on if the director should decide.',
      onSend: async (note) => {
        await api.post(`/pieces/${encodeURIComponent(piece.id)}/escalate`, { note });
        toast('Sent to the director', 'ok'); reload();
      },
    });
  }

  function requestChanges(piece) {
    noteDialog({
      title: 'Request changes', label: 'Note for the author', sendLabel: 'Send the request', placeholder: 'What should change?',
      onSend: async (note) => {
        await api.post(`/pieces/${encodeURIComponent(piece.id)}/request-changes`, { note });
        toast('Changes requested', 'ok'); reload();
      },
    });
  }

  function returnToManager(piece) {
    noteDialog({
      title: 'Return to manager', label: 'Note for the manager', sendLabel: 'Return to manager',
      placeholder: 'What should the manager decide or check?',
      intro: 'The piece goes back to the manager\'s queue with your note.',
      onSend: async (note) => {
        await api.post(`/pieces/${encodeURIComponent(piece.id)}/return`, { note });
        toast('Returned to the manager', 'ok'); reload();
      },
    });
  }

  // ----------------------------------------------------------- review pass
  async function reviewPass() {
    let eligible;
    try { eligible = await api.get('/content/review-pass'); } catch (err) { toast(err.message, 'bad'); return; }
    if (!eligible.total) { toast('No piece is waiting for the review pass', 'info'); return; }
    const out = el('div', { class: 'note', text: '' });
    const run = button({ kind: 'primary', label: `Queue ${eligible.total} ${eligible.total === 1 ? 'piece' : 'pieces'}`, onClick: async () => {
      run.disabled = true; out.textContent = 'Queueing';
      try {
        const res = await api.post('/content/review-pass', {});
        if (!res.jobId) { out.textContent = res.message || 'Nothing to do.'; return; }
        out.textContent = `Queued: 0 of ${res.total} done`;
        await pollPass(res.jobId, out);
      } catch (err) { out.textContent = ''; aiFailed(err); run.disabled = false; }
    } });
    const d = dialog({
      title: 'Review pass',
      body: [
        el('p', { text: `${eligible.total} ${eligible.total === 1 ? 'piece has' : 'pieces have'} only the original text.` }),
        bullets([
          'Reads each against the brief.',
          'Writes a proposal as version 2, with a change note.',
          'Approves nothing; the status stays in review.',
          'About a minute a piece through Claude; you may close this and come back.',
        ]),
        out,
      ],
      actions: [button({ label: 'Close', onClick: () => d.close() }), run],
    });
  }

  async function pollPass(jobId, out) {
    for (;;) {
      if (!alive) return;
      await new Promise((r) => setTimeout(r, 2500));
      let st;
      try { st = await api.get(`/content/review-pass/${encodeURIComponent(jobId)}`); } catch (err) { out.textContent = err.message; return; }
      const failed = st.items.filter((i) => i.ok === false);
      out.textContent = `${st.done} of ${st.total} done${failed.length ? `, ${failed.length} failed` : ''}`;
      if (st.appliedAt || st.status === 'done' || st.status === 'done-with-errors') {
        const written = st.items.filter((i) => i.applied?.versionId).length;
        out.textContent = `Finished. ${written} ${written === 1 ? 'proposal' : 'proposals'} written${failed.length ? `; ${failed.length} failed: ${failed[0].error}` : ''}.`;
        if (failed.length) toast(`${failed[0].error}. Hint: run claude and /login in a terminal.`, 'bad', { ms: 9000 });
        if (written) reload();
        return;
      }
    }
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || document.querySelector('.dialog-back')) return;
    if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);
  draw();
  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
