// Builder box: Checker rules. Contract: docs/BUILDER.md.
// Edits the rules document (`rules`): voice, words, claims, limits, the checklist and the
// exception lists the checker reads (server/rules.mjs). Each card saves its own keys.
import { el, card, field, textarea, input, button, bullets, toast } from '../../ui.js';
import { stringList, rowList } from '../kit.js';

// kit.js hands null and false to replaceChildren, which prints them as text; strip those until the kit drops them.
const tidy = (node) => {
  const strip = () => { for (const c of [...node.childNodes]) if (c.nodeType === 3 && (c.data === 'null' || c.data === 'false')) c.remove(); };
  strip();
  new MutationObserver(strip).observe(node, { childList: true });
  return node;
};

const SCOPES = [
  { value: 'any', label: 'Anywhere' },
  { value: 'headline', label: 'Headline only' },
  { value: 'ourVoice', label: 'Our voice' },
];

const LIMITS = [
  { key: 'hookWords', label: 'Hook, words at most', def: 8 },
  { key: 'igHashtags', label: 'Instagram hashtags at most', def: 5 },
  { key: 'liHashtagsBottom', label: 'LinkedIn hashtags at the bottom', def: 3 },
  { key: 'liHookChars', label: 'LinkedIn characters before the cut', def: 210 },
  { key: 'statusLines', label: 'Status lines at most', def: 1 },
];

// Lists the checker reads with a code default (server/rules.mjs, CHECKER_LIST_DEFAULTS).
const EXCEPTIONS = [
  { key: 'emojiOk', label: 'Allowed symbols', hint: 'Never blocked as emoji.', placeholder: '©' },
  { key: 'capsOk', label: 'Allowed capitals', hint: 'Words in capitals that raise no warning.', placeholder: 'MSME' },
  { key: 'hinglish', label: 'Hinglish words', hint: 'Two in one field raise a warning.', placeholder: 'theek hai' },
  { key: 'companySuffixes', label: 'Company-name endings', hint: 'A capitalised name ending in one is flagged. A dot is optional.', placeholder: 'Pvt. Ltd.' },
  { key: 'notNames', label: 'Words that are not names', hint: 'Days, festivals, platforms. Never flagged as a firm.', placeholder: 'Diwali' },
];

const n = (arr) => (Array.isArray(arr) ? arr.length : 0);
const clean = (arr) => (arr || []).map((s) => String(s ?? '').trim()).filter(Boolean);
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const twoCol = (children) => el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '14px 18px' } }, children);

/** A folded list: the summary line shows the count, the list opens on a tap. */
function fold(label, arr, opts, open = false) {
  const head = el('summary', { style: { cursor: 'pointer', fontWeight: '600', padding: '4px 0' } });
  const setHead = () => { head.textContent = `${label} (${arr.length})`; };
  setHead();
  const list = tidy(stringList(arr, { ...opts, onChange: () => { setHead(); opts.onChange?.(); } }));
  return el('details', { open: open || undefined, style: { minWidth: '0' } }, [head, opts.hint ? el('div', { class: 'field-hint', text: opts.hint, style: { margin: '2px 0 8px' } }) : null, list]);
}

export const box = {
  id: 'checker', title: 'Checker rules', icon: 'review', order: 50,
  summary(ctx) {
    const r = ctx.rules || {};
    const l = r.limits || {};
    return [
      `${n(r.never)} phrases never said`,
      `Hook: ${l.hookWords ?? 8} words max`,
      `${n(r.courseTerms)} course terms blocked`,
      `${n(r.checklist)} checks before posting`,
    ];
  },
  async render(container, ctx) {
    const canEdit = ctx.canEdit;
    const d = JSON.parse(JSON.stringify(ctx.rules || {}));
    let defaults = {};
    try { defaults = await ctx.api.get('/checker/defaults'); } catch { defaults = {}; }
    for (const k of ['voice', 'say', 'courseTerms', 'allowNames', 'claimsOk', 'claimsBlocked']) if (!Array.isArray(d[k])) d[k] = [];
    d.never = (d.never || []).map((x) => ({ phrase: x.phrase || '', scope: x.scope || 'any', note: x.note || '' }));
    d.checklist = (d.checklist || []).map((c) => ({ id: c.id || '', text: c.text || '', auto: Boolean(c.auto) }));
    const usingDefault = {};
    for (const x of EXCEPTIONS) {
      usingDefault[x.key] = !Array.isArray(d[x.key]);
      d[x.key] = [...(Array.isArray(d[x.key]) ? d[x.key] : (defaults[x.key] || []))];
    }

    const save = (label, apply) => canEdit ? [button({ kind: 'primary', label: `Save ${label}`, onClick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await ctx.saveRules(apply); } catch (err) { toast(err.message, 'bad'); } finally { b.disabled = false; }
    } })] : undefined;
    const lst = (label, key, placeholder) => fold(label, d[key], { canEdit, placeholder }, true);

    // Voice
    const frame = textarea({ value: d.frame || '', rows: 4, disabled: !canEdit, onInput: (e) => { d.frame = e.target.value; } });
    const voiceCard = card({
      title: 'Voice',
      body: [
        bullets(['The checker and every AI prompt read these', 'The brief wins if they disagree'], { compact: true }),
        field({ label: 'The frame', input: frame, hint: 'Storyline paragraph given to the AI.' }),
        twoCol([lst('Voice', 'voice', 'Short sentences. One idea each.'), lst('Say', 'say', 'follow-ups')]),
      ],
      footer: save('voice', (doc) => { doc.voice = clean(d.voice); doc.say = clean(d.say); doc.frame = String(d.frame || '').trim(); }),
    });

    // Never say
    const neverCount = el('div', { class: 'bx-list-label' });
    const setNever = () => { neverCount.textContent = `Phrases (${d.never.length})`; };
    setNever();
    const neverCard = card({
      title: 'Never say',
      body: [
        bullets(['Anywhere: blocked in every public field', 'Headline only: blocked in hooks, titles, first lines, slide 1', 'Our voice: a warning outside a quoted owner line'], { compact: true }),
        el('details', { open: true }, [
          el('summary', { style: { cursor: 'pointer', padding: '4px 0' } }, neverCount),
          tidy(rowList(d.never, {
            columns: [
              { key: 'phrase', label: 'Phrase', width: '180px' },
              { key: 'scope', label: 'Scope', type: 'select', options: SCOPES, width: '130px' },
              { key: 'note', label: 'Note', width: '200px' },
            ],
            newRow: () => ({ phrase: '', scope: 'any', note: '' }), canEdit, onChange: setNever, addLabel: 'Add phrase',
          })),
        ]),
      ],
      footer: save('never say', (doc) => {
        doc.never = d.never.filter((x) => String(x.phrase || '').trim()).map((x) => ({ phrase: x.phrase.trim(), scope: x.scope || 'any', note: String(x.note || '').trim() }));
      }),
    });

    // Names and terms
    const namesCard = card({
      title: 'Names and terms',
      body: twoCol([lst('Course terms, always blocked', 'courseTerms', 'Work OS'), lst('Names allowed', 'allowNames', 'Google Sheet')]),
      footer: save('names and terms', (doc) => { doc.courseTerms = clean(d.courseTerms); doc.allowNames = clean(d.allowNames); }),
    });

    // Claims
    const claimsCard = card({
      title: 'Claims',
      body: twoCol([lst('Claims we can make', 'claimsOk', 'Built to run VSP Consultants.'), lst('Claims we cannot make', 'claimsBlocked', 'Any named client.')]),
      footer: save('claims', (doc) => { doc.claimsOk = clean(d.claimsOk); doc.claimsBlocked = clean(d.claimsBlocked); }),
    });

    // Limits
    const lim = { ...(d.limits || {}) };
    const limitInputs = LIMITS.map((x) => [x.key, input({ type: 'number', min: 0, value: lim[x.key] ?? x.def, class: 'mono', disabled: !canEdit })]);
    const limitsCard = card({
      title: 'Limits',
      body: [
        el('div', { class: 'form-grid' }, LIMITS.map((x, i) => field({ label: x.label, input: limitInputs[i][1] }))),
        bullets(['Emoji and exclamation marks are always blocked'], { compact: true }),
      ],
      footer: save('limits', (doc) => {
        const next = { ...(doc.limits || {}) };
        for (const [k, inp] of limitInputs) next[k] = Math.max(0, parseInt(inp.value, 10) || 0);
        doc.limits = next;
      }),
    });

    // Before posting
    const checkCard = card({
      title: 'Before posting',
      body: [
        bullets(['Automatic: the checker ticks it', 'Others: a person ticks it before posting'], { compact: true }),
        tidy(rowList(d.checklist, {
          columns: [
            { key: 'text', label: 'Check', width: '260px' },
            { key: 'id', label: 'Id', width: '140px', placeholder: 'auto' },
            { key: 'auto', label: 'Automatic', type: 'check', width: '110px' },
          ],
          newRow: () => ({ id: '', text: '', auto: false }), canEdit, addLabel: 'Add check',
        })),
      ],
      footer: save('checklist', (doc) => {
        const seen = new Set();
        doc.checklist = d.checklist.filter((c) => String(c.text || '').trim()).map((c) => {
          let id = slug(c.id || c.text).slice(0, 40) || 'check';
          while (seen.has(id)) id = `${id}-2`;
          seen.add(id);
          return { id, text: c.text.trim(), auto: Boolean(c.auto) };
        });
      }),
    });

    // Exceptions
    const excCard = card({
      title: 'Exceptions',
      body: [
        bullets(['Words the checker lets through', 'Default lists apply until you save'], { compact: true }),
        twoCol(EXCEPTIONS.map((x) => fold(`${x.label}${usingDefault[x.key] ? ', default' : ''}`, d[x.key], { canEdit, placeholder: x.placeholder, hint: x.hint }))),
      ],
      footer: save('exceptions', (doc) => { for (const x of EXCEPTIONS) doc[x.key] = clean(d[x.key]); }),
    });

    container.append(voiceCard, neverCard, namesCard, claimsCard, limitsCard, checkCard, excCard);
  },
};
