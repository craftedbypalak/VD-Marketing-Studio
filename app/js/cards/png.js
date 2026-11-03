// SVG to PNG, shared by Visuals and Occasions. [pictures]

/** Draws an SVG string onto a canvas at its own pixel size and returns the PNG blob. */
export async function svgToPng(svg, w, h) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // The embedded fonts decode on first paint; a second draw makes sure they are in.
    ctx.drawImage(img, 0, 0, w, h);
    await new Promise((r) => setTimeout(r, 60));
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be made'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** Saves a browser download of a blob. */
export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
