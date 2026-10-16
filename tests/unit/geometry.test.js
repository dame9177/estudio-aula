import { describe, expect, it } from 'vitest';
import {
  bubbleRect, nearestCorner, pointInCircle, fitContain, squareCrop, clientToCanvas, formatDuration,
  BUBBLE_MARGIN, BUBBLE_SIZES,
} from '../../src/renderer/lib/geometry.js';

describe('geometry', () => {
  it('places the bubble in each corner with a margin', () => {
    const d = BUBBLE_SIZES.m;
    expect(bubbleRect('br', 'm')).toEqual({ x: 1920 - BUBBLE_MARGIN - d, y: 1080 - BUBBLE_MARGIN - d, d });
    expect(bubbleRect('tl', 'm')).toEqual({ x: BUBBLE_MARGIN, y: BUBBLE_MARGIN, d });
    expect(bubbleRect('tr', 'p').x).toBe(1920 - BUBBLE_MARGIN - BUBBLE_SIZES.p);
    expect(bubbleRect('bl', 'g').y).toBe(1080 - BUBBLE_MARGIN - BUBBLE_SIZES.g);
  });

  it('falls back to medium for an unknown size', () => {
    expect(bubbleRect('br', 'xx').d).toBe(BUBBLE_SIZES.m);
  });

  it('snaps to the quadrant corner', () => {
    expect(nearestCorner(100, 100)).toBe('tl');
    expect(nearestCorner(1800, 100)).toBe('tr');
    expect(nearestCorner(100, 1000)).toBe('bl');
    expect(nearestCorner(1800, 1000)).toBe('br');
  });

  it('hit-tests the circle, not its box', () => {
    const r = { x: 0, y: 0, d: 100 };
    expect(pointInCircle(50, 50, r)).toBe(true);
    expect(pointInCircle(2, 2, r)).toBe(false);
  });

  it('letterboxes a 4:3 page into 16:9', () => {
    expect(fitContain(800, 600)).toEqual({ x: 240, y: 0, w: 1440, h: 1080, scale: 1.8 });
    expect(fitContain(960, 540)).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('crops the camera frame to a centered square', () => {
    expect(squareCrop(1280, 720)).toEqual({ sx: 280, sy: 0, s: 720 });
  });

  it('maps CSS-scaled pointer positions to output pixels', () => {
    const box = { left: 100, top: 50, width: 960, height: 540 };
    expect(clientToCanvas(580, 320, box)).toEqual({ x: 960, y: 540 });
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});
