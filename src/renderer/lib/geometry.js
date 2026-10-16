// Pure layout math for the 1920x1080 composition. No DOM here, so it is unit tested.

export const OUT_W = 1920;
export const OUT_H = 1080;

export const BUBBLE_SIZES = { p: 210, m: 280, g: 380 };
export const BUBBLE_MARGIN = 44;
export const CORNERS = ['tl', 'tr', 'bl', 'br'];

/** Circle (as a square box) for the camera bubble in a given corner. */
export function bubbleRect(corner, sizeKey, W = OUT_W, H = OUT_H) {
  const d = BUBBLE_SIZES[sizeKey] ?? BUBBLE_SIZES.m;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  return {
    x: left ? BUBBLE_MARGIN : W - BUBBLE_MARGIN - d,
    y: top ? BUBBLE_MARGIN : H - BUBBLE_MARGIN - d,
    d,
  };
}

/** Corner whose quadrant contains the point (used to snap after a drag). */
export function nearestCorner(x, y, W = OUT_W, H = OUT_H) {
  const v = y < H / 2 ? 't' : 'b';
  const h = x < W / 2 ? 'l' : 'r';
  return v + h;
}

export function pointInCircle(px, py, rect) {
  const r = rect.d / 2;
  const dx = px - (rect.x + r);
  const dy = py - (rect.y + r);
  return dx * dx + dy * dy <= r * r;
}

/** Largest box with the source aspect ratio that fits in W x H, centered (letterbox). */
export function fitContain(srcW, srcH, W = OUT_W, H = OUT_H) {
  const scale = Math.min(W / srcW, H / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, scale };
}

/** Centered square crop of a camera frame (for drawing it into a circle). */
export function squareCrop(srcW, srcH) {
  const s = Math.min(srcW, srcH);
  return { sx: (srcW - s) / 2, sy: (srcH - s) / 2, s };
}

/** Map a pointer position on the displayed (CSS-scaled) canvas to output pixels. */
export function clientToCanvas(clientX, clientY, box, W = OUT_W, H = OUT_H) {
  return {
    x: ((clientX - box.left) / box.width) * W,
    y: ((clientY - box.top) / box.height) * H,
  };
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
