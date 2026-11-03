// Builder box: Video defaults. Contract: docs/BUILDER.md.
// settings.video (pace, length, chapter plan, face scenes, Shorts, uploads) and settings.website.
// Read by server/video.mjs (videoConfig) and app/js/views/video.js; anything missing falls back to the defaults.
// The step list of a project (outline to done) is fixed and not edited here.
import { el, card, field, input, textarea, checkbox, button, bullets, toast, confirm } from '../../ui.js';
import { videoConfig, VIDEO_DEFAULTS, listAnd, range } from '../../views/video.js';

const GROUPS = {
  pace: ['wpm', 'targetMinutes', 'minMinutes', 'maxMinutes'],
  chapters: ['chapterPlan', 'faceChapters', 'maxFacePerChapter', 'partWords'],
  shorts: ['shortsMin', 'shortsMax', 'maxUploadMb'],
};

const int = (v) => (v === '' || v === null || v === undefined ? NaN : Math.round(Number(v)));

export const box = {
  id: 'video', title: 'Video defaults', icon: 'video', order: 60,
  summary(ctx) {
    const c = videoConfig(ctx.settings);
    return [
      `${c.wpm} words a minute`,
      `Episodes ${range(c.minMinutes, c.maxMinutes)} min, target ${c.targetMinutes}`,
      `${c.chapterPlan.length} chapters, face in ${c.faceChapters.length ? c.faceChapters.join(', ') : 'none'}`,
      ctx.settings?.website ? `Website: ${String(ctx.settings.website).replace(/^https?:\/\//, '')}` : `${range(c.shortsMin, c.shortsMax)} Shorts a video`,
    ];
  },
  async render(container, ctx) {
    if (!document.getElementById('video-css')) document.head.appendChild(el('link', { id: 'video-css', rel: 'stylesheet', href: 'css/video.css' }));
    const dis = !ctx.canEdit;
    container.replaceChildren();
    const cfg = videoConfig(ctx.settings);

    // Save only the keys of one group; the others keep what is stored.
    const saveGroup = async (keys, values, btn) => {
      if (btn) btn.disabled = true;
      try {
        await ctx.saveSettings((doc) => { doc.video = { ...(doc.video || {}) }; for (const k of keys) doc.video[k] = values[k]; });
        box.render(container, ctx);
      } catch (err) { toast(err.message, 'bad'); if (btn) btn.disabled = false; }
    };
    const resetGroup = async (keys, what) => {
      if (!(await confirm({ title: 'Reset to default', message: `Put ${what} back to the defaults?`, confirmLabel: 'Reset' }))) return;
      try {
        await ctx.saveSettings((doc) => { doc.video = { ...(doc.video || {}) }; for (const k of keys) delete doc.video[k]; });
        box.render(container, ctx);
      } catch (err) { toast(err.message, 'bad'); }
    };
    const actions = (onSave, keys, what) => (dis ? null : el('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } }, [
      button({ kind: 'primary', label: 'Save', onClick: (e) => onSave(e.currentTarget) }),
      keys && button({ kind: 'ghost', label: 'Reset to default', onClick: () => resetGroup(keys, what) }),
    ]));
    const num = (value, onInput, attrs = {}) => input({ type: 'number', value, disabled: dis, onInput: (e) => onInput(e.target.value), ...attrs });

    // ---- pace and length
    const pace = { wpm: cfg.wpm, targetMinutes: cfg.targetMinutes, minMinutes: cfg.minMinutes, maxMinutes: cfg.maxMinutes };
    const savePace = (btn) => {
      const v = Object.fromEntries(Object.entries(pace).map(([k, x]) => [k, int(x)]));
      if (Object.values(v).some((x) => !Number.isFinite(x) || x < 1)) { toast('Every number must be 1 or more', 'warn'); return; }
      if (v.wpm < 60 || v.wpm > 300) { toast('Words a minute: 60 to 300', 'warn'); return; }
      if (v.minMinutes > v.maxMinutes) { toast('Shortest must not be over longest', 'warn'); return; }
      if (v.targetMinutes < v.minMinutes || v.targetMinutes > v.maxMinutes) { toast('Target must sit inside the range', 'warn'); return; }
      saveGroup(GROUPS.pace, v, btn);
    };
    container.append(card({
      title: 'Pace and length',
      body: el('div', {}, [
        bullets(['Planning rate for scripts and timings', 'Length range for each episode'], { compact: true }),
        el('div', { class: 'form-grid' }, [
          field({ label: 'Words a minute', input: num(pace.wpm, (x) => { pace.wpm = x; }, { min: 60, max: 300 }) }),
          field({ label: 'Target minutes', input: num(pace.targetMinutes, (x) => { pace.targetMinutes = x; }, { min: 1 }) }),
          field({ label: 'Shortest episode, minutes', input: num(pace.minMinutes, (x) => { pace.minMinutes = x; }, { min: 1 }) }),
          field({ label: 'Longest episode, minutes', input: num(pace.maxMinutes, (x) => { pace.maxMinutes = x; }, { min: 1 }) }),
        ]),
        actions(savePace, GROUPS.pace, 'pace and length'),
      ]),
    }));

    // ---- chapters: the plan as rows, face scenes on each row
    const rows = cfg.chapterPlan.map((c, i) => ({ ...c, face: cfg.faceChapters.includes(i + 1) }));
    const extra = { maxFacePerChapter: cfg.maxFacePerChapter, partWords: cfg.partWords };
    const rowsHost = el('div', { class: 'bx-rows' });
    const drawRows = () => {
      rowsHost.replaceChildren(
        ...rows.map((r, i) => el('div', { class: 'bx-rowcard vbx-chapter' }, [
          el('span', { class: 'vbx-n', text: String(i + 1) }),
          el('div', { class: 'bx-rowgrid' }, [
            el('label', { class: 'bx-cell', style: { flexBasis: '220px' } }, [el('span', { class: 'bx-cell-label', text: 'Title' }), input({ value: r.title, disabled: dis, onInput: (e) => { r.title = e.target.value; } })]),
            el('label', { class: 'bx-cell', style: { flex: '0 1 90px' } }, [el('span', { class: 'bx-cell-label', text: 'Min minutes' }), input({ type: 'number', min: 1, value: r.min, disabled: dis, onInput: (e) => { r.min = e.target.value; } })]),
            el('label', { class: 'bx-cell', style: { flex: '0 1 90px' } }, [el('span', { class: 'bx-cell-label', text: 'Max minutes' }), input({ type: 'number', min: 1, value: r.max, disabled: dis, onInput: (e) => { r.max = e.target.value; } })]),
            el('div', { class: 'bx-cell', style: { flex: '0 1 140px', justifyContent: 'flex-end' } }, checkbox({ label: 'Face to camera', checked: r.face, disabled: dis, onChange: (e) => { r.face = e.target.checked; } })),
            el('label', { class: 'bx-cell', style: { flexBasis: '100%' } }, [el('span', { class: 'bx-cell-label', text: 'Brief for the AI' }), textarea({ rows: 2, value: r.brief, disabled: dis, onInput: (e) => { r.brief = e.target.value; } })]),
          ]),
          dis ? null : el('div', { class: 'vbx-move' }, [
            button({ kind: 'ghost', small: true, label: 'Up', title: 'Move up', disabled: i === 0, onClick: () => { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); drawRows(); } }),
            button({ kind: 'ghost', small: true, label: 'Down', title: 'Move down', disabled: i === rows.length - 1, onClick: () => { rows.splice(i + 1, 0, rows.splice(i, 1)[0]); drawRows(); } }),
            button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => { rows.splice(i, 1); drawRows(); } }),
          ]),
        ])),
        dis ? null : button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add a chapter', onClick: () => { rows.push({ title: '', min: 2, max: 4, brief: '', face: false }); drawRows(); rowsHost.querySelector('.vbx-chapter:last-of-type input')?.focus(); } }),
      );
    };
    drawRows();
    const saveChapters = (btn) => {
      const kept = rows.filter((r) => String(r.title).trim());
      if (!kept.length) { toast('Keep at least one chapter with a title', 'warn'); return; }
      const plan = [];
      for (const r of kept) {
        const min = int(r.min); const max = int(r.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) { toast(`${r.title}: minutes must be 1 or more, max not under min`, 'warn'); return; }
        plan.push({ title: String(r.title).trim(), min, max, brief: String(r.brief || '').trim() });
      }
      const maxFace = int(extra.maxFacePerChapter); const part = int(extra.partWords);
      if (!Number.isFinite(maxFace) || maxFace < 0) { toast('Face scenes a chapter: 0 or more', 'warn'); return; }
      if (!Number.isFinite(part) || part < 100 || part > 5000) { toast('Words a planning part: 100 to 5000', 'warn'); return; }
      const face = kept.map((r, i) => (r.face ? i + 1 : 0)).filter(Boolean);
      saveGroup(GROUPS.chapters, { chapterPlan: plan, faceChapters: face, maxFacePerChapter: maxFace, partWords: part }, btn);
    };
    container.append(card({
      title: 'Chapter plan',
      body: el('div', {}, [
        bullets([
          'The chapters every new outline follows, in order',
          'Tick the chapters where Palak speaks to camera',
          'Minutes per chapter must fit the episode range',
        ], { compact: true }),
        rowsHost,
        el('div', { class: 'form-grid', style: { marginTop: '12px' } }, [
          field({ label: 'Face scenes a chapter, at most', input: num(extra.maxFacePerChapter, (x) => { extra.maxFacePerChapter = x; }, { min: 0 }) }),
          field({ label: 'Words a scene-planning part', input: num(extra.partWords, (x) => { extra.partWords = x; }, { min: 100, max: 5000 }), hint: 'The script is planned in parts this size.' }),
        ]),
        actions(saveChapters, GROUPS.chapters, 'the chapter plan'),
      ]),
    }));

    // ---- Shorts and uploads
    const sh = { shortsMin: cfg.shortsMin, shortsMax: cfg.shortsMax, maxUploadMb: cfg.maxUploadMb };
    const saveShorts = (btn) => {
      const v = Object.fromEntries(Object.entries(sh).map(([k, x]) => [k, int(x)]));
      if (!Number.isFinite(v.shortsMin) || !Number.isFinite(v.shortsMax) || v.shortsMin < 0 || v.shortsMax < v.shortsMin) { toast('Shorts: fewest not over most', 'warn'); return; }
      if (!Number.isFinite(v.maxUploadMb) || v.maxUploadMb < 1) { toast('Upload limit: 1 MB or more', 'warn'); return; }
      saveGroup(GROUPS.shorts, v, btn);
    };
    container.append(card({
      title: 'Shorts and uploads',
      body: el('div', {}, [
        el('div', { class: 'form-grid' }, [
          field({ label: 'Shorts a video, fewest', input: num(sh.shortsMin, (x) => { sh.shortsMin = x; }, { min: 0 }) }),
          field({ label: 'Shorts a video, most', input: num(sh.shortsMax, (x) => { sh.shortsMax = x; }, { min: 0 }) }),
          field({ label: 'Largest upload, MB', input: num(sh.maxUploadMb, (x) => { sh.maxUploadMb = x; }, { min: 1 }), hint: 'Larger files are linked by path.' }),
        ]),
        actions(saveShorts, GROUPS.shorts, 'Shorts and uploads'),
      ]),
    }));

    // ---- website
    const site = input({ type: 'url', value: ctx.settings?.website || '', placeholder: 'https://venturedrafters.com/call', disabled: dis });
    const saveSite = async (btn) => {
      const v = site.value.trim();
      if (v && !/^https?:\/\/\S+\.\S+/.test(v)) { toast('Give a full link, starting https://', 'warn'); return; }
      btn.disabled = true;
      try { await ctx.saveSettings((doc) => { if (v) doc.website = v; else delete doc.website; }); box.render(container, ctx); }
      catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
    };
    container.append(card({
      title: 'Website',
      body: el('div', {}, [
        field({ label: 'Link for the 30-minute call', input: site, hint: 'Goes at the end of every YouTube description.' }),
        actions(saveSite, null),
      ]),
    }));

    container.append(card({
      flat: true,
      body: bullets([
        'Project steps stay fixed: outline to done',
        `Defaults: ${VIDEO_DEFAULTS.wpm} words a minute, ${VIDEO_DEFAULTS.minMinutes} to ${VIDEO_DEFAULTS.maxMinutes} min, face in ${listAnd(VIDEO_DEFAULTS.faceChapters)}`,
      ], { compact: true }),
    }));
  },
};
