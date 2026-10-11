/** Bounds of our scanline SVG masks. Crop the viewport, never stretch source pixels. */
export function maskViewBox(mask) {
  const fallback = `0 0 ${mask.width} ${mask.height}`;
  if (Array.isArray(mask.crop) && mask.crop.length === 4) {
    const [x,y,w,h]=mask.crop;
    if ([x,y,w,h].every(Number.isFinite) && x>=0 && y>=0 && w>0 && h>0 && x+w<=mask.width && y+h<=mask.height)
      return mask.crop.join(' ');
  }
  const rows = [...mask.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  if (!rows.length || rows.map(r => r[0]).join('') !== mask.path) return fallback;
  let left = mask.width, top = mask.height, right = 0, bottom = 0;
  for (const row of rows) {
    const x = Number(row[1]), y = Number(row[2]), width = Number(row[3]);
    if (width !== Number(row[4]) || x + width > mask.width || y >= mask.height) return fallback;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + width); bottom = Math.max(bottom, y + 1);
  }
  return `${left} ${top} ${right - left} ${bottom - top}`;
}
