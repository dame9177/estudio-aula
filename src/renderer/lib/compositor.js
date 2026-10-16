// Draws the lesson frame (slide + camera bubble + pen strokes + laser) into the stage canvas.
// The same canvas is what gets recorded, so the preview is exactly the video.
import {
  OUT_W, OUT_H, bubbleRect, nearestCorner, pointInCircle, squareCrop, clientToCanvas,
} from './geometry.js';

export const PEN_COLORS = {
  clay: '#D97757',
  ink: '#191919',
  blue: '#3E6FB0',
};

const FPS = 30;
const RING = '#FAF9F5';
const LASER = '#E0563B';

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
    this.slide = null;
    this.camera = null; // HTMLVideoElement
    this.cameraVisible = true;
    this.bubble = { corner: 'br', size: 'm', mirror: true };
    this.tool = 'none'; // 'none' | 'laser' | 'pen'
    this.penColor = 'clay';
    this.strokes = [];
    this.laser = { x: 0, y: 0, inside: false };
    this.drag = null; // { dx, dy, x, y } while dragging the bubble
    this.onBubbleMoved = null;
    this._bindPointer();
    this._timer = setInterval(() => this.draw(), 1000 / FPS);
  }

  destroy() {
    clearInterval(this._timer);
    this._unbind?.();
  }

  setSlide(bitmap) {
    this.slide = bitmap;
    this.strokes = [];
  }

  setCamera(video) {
    this.camera = video;
  }

  clearStrokes() {
    this.strokes = [];
  }

  bubbleBox() {
    const r = bubbleRect(this.bubble.corner, this.bubble.size);
    if (this.drag) return { ...r, x: this.drag.x, y: this.drag.y };
    return r;
  }

  hasBubble() {
    return Boolean(this.cameraVisible && this.camera && this.camera.readyState >= 2);
  }

  draw() {
    const { ctx } = this;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    if (this.slide) ctx.drawImage(this.slide, 0, 0, OUT_W, OUT_H);
    this._drawStrokes();
    if (this.hasBubble()) this._drawBubble();
    if (this.tool === 'laser' && this.laser.inside) this._drawLaser();
  }

  _drawStrokes() {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      const pts = s.points;
      if (!pts.length) continue;
      ctx.strokeStyle = PEN_COLORS[s.color] || PEN_COLORS.clay;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts.at(-1).x, pts.at(-1).y);
      ctx.stroke();
    }
  }

  _drawBubble() {
    const { ctx } = this;
    const { x, y, d } = this.bubbleBox();
    const r = d / 2;
    const cx = x + r;
    const cy = y + r;

    // Soft shadow + cream ring.
    ctx.save();
    ctx.shadowColor = 'rgba(25, 25, 25, 0.28)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = RING;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Camera frame, center-cropped to a square, clipped to the circle.
    const v = this.camera;
    const { sx, sy, s } = squareCrop(v.videoWidth, v.videoHeight);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (this.bubble.mirror) {
      ctx.translate(x + d, y);
      ctx.scale(-1, 1);
      ctx.drawImage(v, sx, sy, s, s, 0, 0, d, d);
    } else {
      ctx.drawImage(v, sx, sy, s, s, x, y, d, d);
    }
    ctx.restore();
  }

  _drawLaser() {
    const { ctx } = this;
    const { x, y } = this.laser;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 40);
    halo.addColorStop(0, 'rgba(224, 86, 59, 0.55)');
    halo.addColorStop(1, 'rgba(224, 86, 59, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LASER;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _point(e) {
    return clientToCanvas(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
  }

  _updateCursor(p) {
    let cursor = 'default';
    if (this.hasBubble() && pointInCircle(p.x, p.y, this.bubbleBox())) cursor = this.drag ? 'grabbing' : 'grab';
    else if (this.tool === 'laser') cursor = 'none';
    else if (this.tool === 'pen') cursor = 'crosshair';
    this.canvas.style.cursor = cursor;
  }

  _bindPointer() {
    const c = this.canvas;
    const down = (e) => {
      if (e.button !== 0) return;
      const p = this._point(e);
      const box = this.bubbleBox();
      if (this.hasBubble() && pointInCircle(p.x, p.y, box)) {
        this.drag = { dx: p.x - box.x, dy: p.y - box.y, x: box.x, y: box.y };
      } else if (this.tool === 'pen') {
        this.strokes.push({ color: this.penColor, points: [p] });
        this._drawing = true;
      } else {
        return;
      }
      c.setPointerCapture(e.pointerId);
      this._updateCursor(p);
    };
    const move = (e) => {
      const p = this._point(e);
      this.laser = { x: p.x, y: p.y, inside: true };
      if (this.drag) {
        const d = this.bubbleBox().d;
        this.drag.x = Math.max(0, Math.min(OUT_W - d, p.x - this.drag.dx));
        this.drag.y = Math.max(0, Math.min(OUT_H - d, p.y - this.drag.dy));
      } else if (this._drawing) {
        const pts = this.strokes.at(-1).points;
        const last = pts.at(-1);
        if (Math.hypot(p.x - last.x, p.y - last.y) > 2) pts.push(p);
      }
      this._updateCursor(p);
    };
    const up = (e) => {
      if (this.drag) {
        const d = this.bubbleBox().d;
        const corner = nearestCorner(this.drag.x + d / 2, this.drag.y + d / 2);
        this.drag = null;
        this.bubble = { ...this.bubble, corner };
        this.onBubbleMoved?.(this.bubble);
      }
      this._drawing = false;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this._updateCursor(this._point(e));
    };
    const leave = () => {
      this.laser.inside = false;
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', leave);
    this._unbind = () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('pointerleave', leave);
    };
  }
}
