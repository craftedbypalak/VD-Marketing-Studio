// Hand-written multipart/form-data parser for POST /api/media. [core]
// No dependency: reads the whole body into memory (uploads here are a few MB:
// a Reel, a carousel PDF, a photo), splits on the boundary and returns the
// parts. Files are written by the caller.

export function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('multipart boundary missing');
  const boundary = Buffer.from(`--${(m[1] || m[2]).trim()}`);
  const parts = [];
  let start = buffer.indexOf(boundary);
  if (start < 0) return parts;
  start += boundary.length;

  while (start < buffer.length) {
    // After a boundary: "--" means the end, otherwise CRLF then headers.
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headerText = buffer.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    let next = buffer.indexOf(boundary, bodyStart);
    if (next < 0) next = buffer.length;
    // The body ends with CRLF before the next boundary.
    let bodyEnd = next;
    if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const disposition = headers['content-disposition'] || '';
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    parts.push({
      name,
      filename,
      contentType: headers['content-type'] || null,
      data: buffer.slice(bodyStart, bodyEnd),
    });
    start = next + boundary.length;
  }
  return parts;
}

/** Image dimensions from the first bytes of a PNG, JPEG, GIF or WebP. */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.slice(0, 3).toString('ascii') === 'GIF') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // WebP (VP8 / VP8L / VP8X)
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  // JPEG: walk the markers to the first SOF.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
