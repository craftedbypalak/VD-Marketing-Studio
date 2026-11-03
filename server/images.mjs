// Pictures routes [pictures]: brand cards posted from the browser, AI
// illustrations through a provider function, and the imagePrompts wrapper.
//
//   POST   /api/images/card          multipart: file (PNG), pieceId?, template, w, h, theme?, format?, fields?
//   POST   /api/images/illustration  { pieceId?, prompt, aspect?, dryRun? } -> Image record, or { error }
//   POST   /api/images/prompts       { pieceId? | piece?, kind?, dryRun? } -> the imagePrompts output, or the prompt itself
//   GET    /api/pieces/:id/images    the piece's pictures, `approved` following the piece
//   DELETE /api/images/:id           removes the record and its file under media/
//
// Cards render in the browser; the server only stores the PNG it is given and
// writes the Image record (shape 4.13). Illustrations need settings.imageProvider
// ('gemini' or 'openai') and the matching environment variable (GEMINI_API_KEY or
// OPENAI_API_KEY). Without them the route answers { error: 'No image provider configured' }
// with the full prompt in `detail`, so the app can offer it to copy.

import fs from 'node:fs';
import path from 'node:path';
import { parseMultipart, imageSize } from './multipart.mjs';
import { prefixFor, composePrompt, DEFAULT_PREFIX } from './ops/imagePrompts.mjs';

const MEDIA_ROOT = (store) => path.join(store.root, 'media');
const TEMPLATES = ['statusRule', 'quote', 'hook', 'thumbnail', 'carouselSlide', 'linkedinImage'];
const ASPECTS = { '1:1': '1024x1024', '16:9': '1536x1024', '4:5': '1024x1536', '9:16': '1024x1536' };

export { DEFAULT_PREFIX };

const isPng = (buf) => buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
const slug = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';

function uniqueName(dir, stem, ext) {
  let name = `${stem}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${stem}-${++n}${ext}`;
  return name;
}

async function attachToPiece(store, pieceId, imageId) {
  if (!pieceId) return;
  const piece = store.get('pieces', pieceId);
  if (!piece) return;
  const images = Array.isArray(piece.images) ? piece.images : [];
  if (!images.includes(imageId)) await store.patch('pieces', pieceId, { images: [...images, imageId] });
}

// ------------------------------------------------------------------ cards

async function postCard(ctx) {
  const { store, HttpError } = ctx;
  const type = ctx.req.headers['content-type'] || '';
  if (!/multipart\/form-data/i.test(type)) throw new HttpError(400, 'Send multipart/form-data with a PNG in "file"');
  const parts = parseMultipart(ctx.rawBody || Buffer.alloc(0), type);
  const filePart = parts.find((p) => p.filename && (p.name === 'file' || p.name === null || p.name === 'png')) || parts.find((p) => p.filename);
  if (!filePart) throw new HttpError(400, 'No PNG in the upload');
  const form = {};
  for (const p of parts) if (!p.filename && p.name) form[p.name] = p.data.toString('utf8');
  const buf = filePart.data;
  if (!isPng(buf)) throw new HttpError(400, 'The file is not a PNG');

  const template = String(form.template || '');
  if (!TEMPLATES.includes(template)) throw new HttpError(400, `Unknown template: ${template || '(none)'}`);
  const size = imageSize(buf);
  const w = parseInt(form.w, 10);
  const h = parseInt(form.h, 10);
  if (Number.isFinite(w) && Number.isFinite(h) && (size.w !== w || size.h !== h)) {
    throw new HttpError(400, `The PNG is ${size.w} x ${size.h} but ${w} x ${h} was declared`);
  }
  const pieceId = form.pieceId ? String(form.pieceId) : null;
  if (pieceId && !store.get('pieces', pieceId)) throw new HttpError(404, 'Piece not found');

  const dir = path.join(MEDIA_ROOT(store), 'cards');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, `${slug(pieceId || 'free')}-${slug(template)}-${size.w}x${size.h}`, '.png');
  fs.writeFileSync(path.join(dir, name), buf);

  let fields = null;
  try { fields = form.fields ? JSON.parse(form.fields) : null; } catch { fields = null; }
  if (fields && typeof fields === 'object') delete fields.imageData; // never store a picture's bytes in the record

  const record = await store.put('images', {
    id: store.nextId('im'),
    pieceId,
    kind: template === 'thumbnail' ? 'thumbnail' : 'card',
    template,
    prompt: null,
    provider: null,
    path: `/media/cards/${name}`,
    w: size.w,
    h: size.h,
    approved: false,
    theme: form.theme || null,
    format: form.format || null,
    fields,
    bytes: buf.length,
    by: ctx.by || null,
  });
  await attachToPiece(store, pieceId, record.id);
  await store.log(ctx.by, 'images.card', { id: record.id, template, pieceId });
  ctx.res.statusCode = 201;
  return record;
}

// ----------------------------------------------------------- illustrations

function mimeExt(mime) {
  if (/png/i.test(mime)) return '.png';
  if (/jpe?g/i.test(mime)) return '.jpg';
  if (/webp/i.test(mime)) return '.webp';
  return '.png';
}

async function readJson(res, label, HttpError) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: { message: text.slice(0, 300) } }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new HttpError(502, `${label} ${res.status}: ${msg}`);
  }
  return data;
}

/** Google Gemini image generation (REST generateContent). Untested until a key exists. */
async function callGemini({ prompt, aspect, key, model, HttpError }) {
  const m = model || 'gemini-2.5-flash-image';
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) { throw new HttpError(502, `Gemini request failed: ${err.message}`); }
  const data = await readJson(res, 'Gemini', HttpError);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
  if (!img) {
    const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no image in the answer';
    throw new HttpError(502, `Gemini returned no image (${why})`);
  }
  return { buffer: Buffer.from(img.data, 'base64'), mime: img.mimeType || img.mime_type || 'image/png', model: m };
}

/** OpenAI image generation (REST /v1/images/generations). Untested until a key exists. */
async function callOpenAI({ prompt, aspect, key, model, HttpError }) {
  const m = model || 'gpt-image-1';
  const body = { model: m, prompt, n: 1, size: ASPECTS[aspect] || '1024x1024' };
  if (/^dall-e/i.test(m)) body.response_format = 'b64_json';
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) { throw new HttpError(502, `OpenAI request failed: ${err.message}`); }
  const data = await readJson(res, 'OpenAI', HttpError);
  const item = data?.data?.[0];
  if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', model: m };
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new HttpError(502, `OpenAI image download failed (${img.status})`);
    return { buffer: Buffer.from(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/png', model: m };
  }
  throw new HttpError(502, 'OpenAI returned no image');
}

const PROVIDERS = {
  gemini: { env: 'GEMINI_API_KEY', call: callGemini },
  openai: { env: 'OPENAI_API_KEY', call: callOpenAI },
};

async function postIllustration(ctx) {
  const { store, HttpError } = ctx;
  const body = ctx.body || {};
  const scene = String(body.prompt || '').trim();
  if (!scene) throw new HttpError(400, 'A prompt is required');
  const aspect = ASPECTS[body.aspect] ? body.aspect : '1:1';
  const settings = ctx.settings();
  const provider = settings.imageProvider || 'none';
  const prefix = prefixFor(settings);
  const prompt = composePrompt(prefix, scene);
  const pieceId = body.pieceId ? String(body.pieceId) : null;
  if (pieceId && !store.get('pieces', pieceId)) throw new HttpError(404, 'Piece not found');

  if (body.dryRun) return { dryRun: true, provider, prefix, prompt, aspect };

  const spec = PROVIDERS[provider];
  if (!spec) throw new HttpError(422, 'No image provider configured', { reason: 'Set the image provider in Settings, AI.', prompt, prefix, provider });
  const key = process.env[spec.env];
  if (!key) throw new HttpError(422, 'No image provider configured', { reason: `${spec.env} is not set in the server environment.`, prompt, prefix, provider });

  const t0 = Date.now();
  const out = await spec.call({ prompt, aspect, key, model: settings.imageModel, HttpError });
  const dir = path.join(MEDIA_ROOT(store), 'illustrations');
  fs.mkdirSync(dir, { recursive: true });
  const ext = mimeExt(out.mime);
  const name = uniqueName(dir, `${slug(pieceId || 'free')}-${provider}`, ext);
  fs.writeFileSync(path.join(dir, name), out.buffer);
  const size = imageSize(out.buffer);
  const record = await store.put('images', {
    id: store.nextId('im'),
    pieceId,
    kind: 'illustration',
    template: null,
    prompt,
    provider,
    model: out.model,
    path: `/media/illustrations/${name}`,
    w: size?.w ?? null,
    h: size?.h ?? null,
    approved: false,
    aspect,
    by: ctx.by || null,
  });
  await attachToPiece(store, pieceId, record.id);
  await store.log(ctx.by, 'images.illustration', { id: record.id, provider, ms: Date.now() - t0, pieceId });
  ctx.res.statusCode = 201;
  return record;
}

// --------------------------------------------------------------- prompts

async function postPrompts(ctx) {
  const { store, HttpError, ai } = ctx;
  const body = ctx.body || {};
  let piece = body.piece || null;
  if (!piece && body.pieceId) piece = store.get('pieces', String(body.pieceId));
  if (!piece) throw new HttpError(404, 'Send a pieceId or a piece');
  const input = { piece, kind: body.kind || 'cover' };
  const context = ai.buildCtx({ by: ctx.by });
  if (body.dryRun) {
    const op = await ai.loadOp('imagePrompts');
    const { system, user } = op.buildPrompt(input, context);
    return { dryRun: true, system, user, schema: op.schema, prefix: prefixFor(context.settings) };
  }
  return ai.run('imagePrompts', input, context);
}

// ---------------------------------------------------------------- routes

export const routes = [
  { method: 'POST', path: '/api/images/card', handler: postCard },
  { method: 'POST', path: '/api/images/illustration', handler: postIllustration },
  { method: 'POST', path: '/api/images/prompts', handler: postPrompts },
  {
    method: 'GET', path: '/api/pieces/:id/images',
    handler: (ctx) => {
      const piece = ctx.store.get('pieces', ctx.params.id);
      if (!piece) throw new ctx.HttpError(404, 'Piece not found');
      const approved = piece.status === 'approved';
      return ctx.store.list('images', (im) => im.pieceId === piece.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((im) => ({ ...im, approved }));
    },
  },
  {
    method: 'DELETE', path: '/api/images/:id',
    handler: async (ctx) => {
      const { store, HttpError } = ctx;
      const im = store.get('images', ctx.params.id);
      if (!im) throw new HttpError(404, 'Picture not found');
      const media = MEDIA_ROOT(store);
      if (im.path && im.path.startsWith('/media/')) {
        const file = path.normalize(path.join(media, im.path.slice('/media/'.length)));
        if (file.startsWith(media + path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
      }
      if (im.pieceId) {
        const piece = store.get('pieces', im.pieceId);
        if (piece && Array.isArray(piece.images)) await store.patch('pieces', piece.id, { images: piece.images.filter((x) => x !== im.id) });
      }
      await store.remove('images', im.id);
      await store.log(ctx.by, 'images.delete', im.id);
      return { ok: true, id: im.id };
    },
  },
];
